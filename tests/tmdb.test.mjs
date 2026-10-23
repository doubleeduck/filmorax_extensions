import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createSource from '../sources/tmdb/src/index.mjs';
const definition = JSON.parse(
  await readFile(new URL('../sources/tmdb/manifest.json', import.meta.url), 'utf8'),
).sources[0];
function fixture({ config = {}, token = '', response = {} } = {}) {
  const calls = [];
  const source = createSource({
    baseUrl: definition.baseUrl,
    parameters: definition.parameters,
    settings: { network: async () => config },
    auth: { getSession: async () => ({ accessToken: token }) },
    http: {
      request: async (input) => {
        calls.push(input);
        return { body: response };
      },
    },
  });
  return { source, calls };
}
const movie = {
  id: 42,
  title: 'Fixture',
  original_title: 'Original',
  poster_path: '/poster.jpg',
  release_date: '2026-05-01',
  vote_average: 8.3,
  genre_ids: [16],
};
test('TMDB keeps catalogue/search/filter pagination and has no video backend', async () => {
  const { source, calls } = fixture({ response: { results: [movie], page: 1, total_pages: 2 } });
  assert.equal(source.getFilters().length, 4);
  const result = await source.search({
    page: 1,
    selectedFilters: { genre: ['16'], year: ['2026'], collection: ['top_rated'] },
  });
  assert.equal(result.items[0].id, 'tmdb-movie-42');
  assert.equal(result.items[0].tags[0], 'Animation');
  assert.equal(result.hasMore, true);
  assert.equal(result.items[0].playbackGroups.length, 0);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/3/discover/movie');
  assert.equal(url.searchParams.get('with_genres'), '16');
  assert.equal(url.searchParams.get('primary_release_year'), '2026');
  assert.equal(url.searchParams.get('sort_by'), 'vote_average.desc');
  assert.equal(new URL(result.items[0].posterUrl).host, 'wsrv.nl');
  assert.equal(source.resolveStream, undefined);
  await source.search({ page: 999, searchTerm: 'Search', selectedFilters: { section: ['tv'] } });
  const search = new URL(calls[1].url);
  assert.equal(search.pathname, '/3/search/tv');
  assert.equal(search.searchParams.get('page'), '500');
});
test('TMDB explicit key/token overrides the default without credential fallback', async () => {
  for (const [token, bearer] of [
    ['0123456789abcdef0123456789abcdef', false],
    ['Bearer token.jwt.value', true],
  ]) {
    const { source, calls } = fixture({ token });
    await source.getPopular({});
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.has('api_key'), !bearer);
    if (bearer) assert.equal(calls[0].headers.Authorization, 'Bearer token.jwt.value');
    else assert.equal(url.searchParams.get('api_key'), token);
  }
});
test('TMDB carries independent mirror options, details metadata and deduplicated recommendations', async () => {
  const { source, calls } = fixture({
    config: {
      options: {
        'tmdb.api_mirror_mode': 'lampaProxy',
        'tmdb.api_mirror_url': 'https://api.example.org',
        'tmdb.image_mirror_mode': 'directMirror',
        'tmdb.image_mirror_url': 'https://image.example.org',
      },
    },
    response: {
      ...movie,
      production_companies: [{ name: 'Studio' }],
      production_countries: [{ name: 'Japan' }],
      credits: { crew: [{ name: 'Director', job: 'Director' }] },
      runtime: 98,
      recommendations: { results: [{ ...movie, id: 43 }] },
      similar: { results: [{ ...movie, id: 43 }] },
    },
  });
  const item = await source.loadDetails({ itemId: 'tmdb-movie-42' });
  assert.equal(new URL(calls[0].url).pathname, '/https://api.themoviedb.org/3/movie/42');
  assert.equal(item.posterUrl, 'https://image.example.org/t/p/w342/poster.jpg');
  assert.equal(item.metadata.find((m) => m.kind === 'director').value, 'Director');
  assert.equal(item.relatedItems.length, 1);
  assert.equal(await source.loadDetails({ itemId: '../../bad' }), null);
});
