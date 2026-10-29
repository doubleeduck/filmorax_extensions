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
    auth: {
      getSession: async () => ({ accessToken: typeof token === 'function' ? token() : token }),
    },
    http: {
      request: async (input) => {
        calls.push(input);
        return { body: typeof response === 'function' ? await response(input) : response };
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

test('director catalogue includes only directing jobs, merges movie/TV and intersects acting credits', async () => {
  const { source, calls } = fixture({
    response: (input) =>
      new URL(input.url).pathname.includes('/7/')
        ? { cast: [{ ...movie, media_type: 'movie' }] }
        : {
            crew: [
              { ...movie, media_type: 'movie', job: 'Director' },
              { id: 8, name: 'Series', media_type: 'tv', job: 'Director' },
              { ...movie, id: 9, media_type: 'movie', job: 'Producer' },
            ],
          },
  });
  const result = await source.search({ selectedFilters: { director: ['62'], section: ['all'] } });
  assert.deepEqual(
    result.items.map((row) => row.id),
    ['tmdb-movie-42', 'tmdb-tv-8'],
  );
  const both = await source.search({
    selectedFilters: { director: ['62'], actor: ['7'], section: ['all'] },
  });
  assert.deepEqual(
    both.items.map((row) => row.id),
    ['tmdb-movie-42'],
  );
  assert.equal(calls.length, 2);
});
test('studios use company IDs in both movie and TV discovery and remain paginated', async () => {
  const { source, calls } = fixture({ response: { results: [movie], page: 2, total_pages: 4 } });
  const result = await source.search({
    page: 2,
    selectedFilters: { studio: ['420'], section: ['all'] },
  });
  assert.equal(result.hasMore, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    ['/3/discover/movie', '/3/discover/tv'],
  );
  for (const call of calls) {
    const uri = new URL(call.url);
    assert.equal(uri.searchParams.get('with_companies'), '420');
    assert.equal(uri.searchParams.get('page'), '2');
  }
});
test('studio + director inspects only needed company metadata and reuses it across pages', async () => {
  const rows = Array.from({ length: 28 }, (_, index) => ({
    ...movie,
    id: index + 1,
    media_type: 'movie',
    job: 'Director',
  }));
  const { source, calls } = fixture({
    response: (input) =>
      new URL(input.url).pathname.includes('/person/')
        ? { crew: rows }
        : { production_companies: [{ id: 420 }] },
  });
  const filters = { director: ['62'], studio: ['420'], section: ['all'] };
  const first = await source.search({ selectedFilters: filters });
  assert.equal(first.items.length, 20);
  assert.equal(first.hasMore, true);
  const count = calls.length;
  const second = await source.search({ page: 2, selectedFilters: filters });
  assert.equal(second.items.length, 8);
  assert.equal(second.hasMore, false);
  assert.equal(calls.length, 29);
  assert.equal(calls.length - count, 4);
});
test('studio and director metadata navigate using IDs while displaying names', async () => {
  const { source } = fixture({
    response: {
      ...movie,
      production_companies: [{ id: 420, name: 'Studio' }],
      credits: { crew: [{ id: 62, name: 'Director', job: 'Director' }] },
    },
  });
  const entry = await source.loadDetails({ itemId: 'tmdb-movie-42' });
  assert.deepEqual(
    entry.metadata
      .filter((row) => ['studio', 'director'].includes(row.kind))
      .map((row) => [row.value, row.filterId, row.filterValue]),
    [
      ['Studio', 'studio', '420'],
      ['Director', 'director', '62'],
    ],
  );
});
test('TMDB keeps catalogue/search/filter pagination and has no video backend', async () => {
  const { source, calls } = fixture({ response: { results: [movie], page: 1, total_pages: 2 } });
  assert.deepEqual(
    source.getFilters().map((filter) => filter.id),
    ['section', 'collection', 'genre', 'sort', 'year', 'actor', 'director', 'studio'],
  );
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

test('TMDB cast uses the details response, safe mirrored portraits and optional catalogue targets', async () => {
  const { source, calls } = fixture({
    response: {
      ...movie,
      credits: {
        cast: [
          { id: 42, name: 'First actor', character: 'Hero', profile_path: '/actor.jpg' },
          { id: 43, name: 'Second actor', character: 'Friend' },
          { id: 42, name: 'Duplicate actor' },
          { id: -1, name: 'Invalid' },
          { id: 44 },
        ],
      },
    },
  });
  const item = await source.loadDetails({ itemId: 'tmdb-movie-42' });
  assert.equal(calls.length, 1);
  assert.equal(item.cast.length, 2);
  assert.equal(item.cast[0].name, 'First actor');
  assert.equal(item.cast[0].character, 'Hero');
  const portrait = new URL(item.cast[0].imageUrl);
  assert.equal(portrait.host, 'wsrv.nl');
  assert.equal(portrait.searchParams.get('url'), 'https://image.tmdb.org/t/p/w185/actor.jpg');
  assert.equal(item.cast[1].imageUrl, '');
  assert.deepEqual(item.cast[0].catalogFilters, { actor: ['42'], section: ['all'] });
});

test('TV aggregate cast covers seasons and merges character names without duplicate actors', async () => {
  const { source, calls } = fixture({
    response: {
      id: 42,
      name: 'Show',
      credits: { cast: [{ id: 9, name: 'Current season only' }] },
      aggregate_credits: {
        cast: [
          {
            id: 8,
            name: 'Whole show',
            roles: [{ character: 'Hero' }, { character: 'Guest' }, { character: 'Hero' }],
          },
        ],
      },
    },
  });
  const item = await source.loadDetails({ itemId: 'tmdb-tv-42' });
  assert.equal(item.cast[0].name, 'Whole show');
  assert.equal(item.cast[0].character, 'Hero, Guest');
  assert.equal(calls.length, 1);
  assert.match(new URL(calls[0].url).searchParams.get('append_to_response'), /aggregate_credits/);
});

const filmography = Array.from({ length: 43 }, (_, index) => ({
  id: Math.floor(index / 2) + 1,
  media_type: index % 2 ? 'tv' : 'movie',
  ...(index % 2
    ? { name: `Show ${index}`, first_air_date: '2026-01-01' }
    : { title: `Film ${index}`, release_date: '2025-01-01' }),
  popularity: 100 - index,
  genre_ids: [16],
  vote_average: 8,
}));
test('actor catalogue combines movies and TV, deduplicates credits, excludes crew, paginates and reuses completed data', async () => {
  const { source, calls } = fixture({
    response: {
      cast: [
        ...filmography,
        filmography[0],
        { ...filmography[0], id: 99, adult: true },
        { id: 100, media_type: 'person', name: 'Other' },
        { id: 101, media_type: 'movie' },
        null,
      ],
      crew: [{ ...movie, media_type: 'movie' }],
    },
  });
  const pages = [];
  for (let page = 1; page <= 3; page++)
    pages.push(await source.search({ page, selectedFilters: { actor: ['42'], section: ['all'] } }));
  assert.deepEqual(
    pages.map((page) => page.items.length),
    [20, 20, 3],
  );
  assert.deepEqual(
    pages.map((page) => page.hasMore),
    [true, true, false],
  );
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/3/person/42/combined_credits');
  const ids = pages.flatMap((page) => page.items.map((item) => item.id));
  assert.equal(new Set(ids).size, 43);
  assert.ok(ids.includes('tmdb-movie-1') && ids.includes('tmdb-tv-1'));
  assert.equal(
    (await source.search({ page: 4, selectedFilters: { actor: ['42'] } })).items.length,
    0,
  );
  await source.search({ selectedFilters: { actor: ['43'] } });
  assert.equal(calls.length, 2);
});

test('actor filters and search apply inside acting credits without calling normal title search', async () => {
  const { source, calls } = fixture({ response: { cast: filmography } });
  const page = await source.search({
    searchTerm: 'Show 1',
    selectedFilters: {
      actor: ['42'],
      section: ['tv'],
      year: ['2026'],
      genre: ['16'],
      collection: ['newest'],
    },
  });
  assert.equal(page.items.length, 6);
  assert.ok(page.items.every((item) => item.kind === 'series' && item.year === 2026));
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/3/person/42/combined_credits');
  assert.equal((await source.search({ selectedFilters: { actor: ['../42'] } })).items.length, 0);
  assert.equal(calls.length, 1);
});

test('filmography cache respects credentials/mirrors and never retains a failed request', async () => {
  let token = 'first-token',
    fail = false;
  const config = { options: {} };
  const { source, calls } = fixture({
    config,
    token: () => token,
    response: () => {
      if (fail) throw new Error('fixture failure');
      return { cast: filmography };
    },
  });
  const args = { selectedFilters: { actor: ['42'] } };
  await source.search(args);
  token = 'second-token';
  await source.search(args);
  assert.equal(calls.length, 2);
  config.options['tmdb.api_mirror_mode'] = 'directMirror';
  config.options['tmdb.api_mirror_url'] = 'https://api.example.org';
  await source.search(args);
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[2].url).host, 'api.example.org');
  token = 'third-token';
  fail = true;
  await assert.rejects(source.search(args), /fixture failure/);
  fail = false;
  await source.search(args);
  assert.equal(calls.length, 5);
});

test('all section supports mixed search and browsing as well as actor navigation', async () => {
  const { source, calls } = fixture({
    response: (input) => {
      const path = new URL(input.url).pathname;
      return {
        page: 1,
        total_pages: 2,
        results: path.endsWith('/multi')
          ? [
              { ...movie, media_type: 'movie' },
              { id: 7, name: 'Show', media_type: 'tv' },
              { id: 8, name: 'Person', media_type: 'person' },
              null,
            ]
          : path.includes('/tv/')
            ? [{ id: 7, name: 'Show' }]
            : [movie],
      };
    },
  });
  const args = { selectedFilters: { section: ['all'] } };
  const mixed = await source.search({ ...args, searchTerm: 'Example' });
  assert.deepEqual(
    mixed.items.map((item) => item.kind),
    ['movie', 'series'],
  );
  assert.equal(new URL(calls[0].url).pathname, '/3/search/multi');
  const browse = await source.search(args);
  assert.equal(browse.items.length, 2);
  assert.equal(browse.hasMore, true);
  assert.equal(calls.length, 3);
});
