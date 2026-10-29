import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createSource from '../sources/tmdb/src/index.mjs';
const definition = JSON.parse(
  await readFile(new URL('../sources/tmdb/manifest.json', import.meta.url)),
).sources[0];
for (const [sort, movie, tv] of [
  ['popular', 'popularity.desc', 'popularity.desc'],
  ['least_popular', 'popularity.asc', 'popularity.asc'],
  ['rating', 'vote_average.desc', 'vote_average.desc'],
  ['lowest_rated', 'vote_average.asc', 'vote_average.asc'],
  ['new', 'primary_release_date.desc', 'first_air_date.desc'],
  ['old', 'primary_release_date.asc', 'first_air_date.asc'],
  ['name_asc', 'original_title.asc', 'original_name.asc'],
  ['name_desc', 'original_title.desc', 'original_name.desc'],
])
  test(`TMDB explicit ${sort} sort uses discovery for movies and TV without dropping filters or page`, async () => {
    const calls = [];
    const source = createSource({
      baseUrl: definition.baseUrl,
      parameters: definition.parameters,
      settings: { network: async () => ({}) },
      auth: { getSession: async () => ({}) },
      http: {
        request: async (input) => {
          calls.push(new URL(input.url));
          return { body: { results: [], page: 2, total_pages: 3 } };
        },
      },
    });
    const result = await source.search({
      page: 2,
      selectedFilters: { section: ['all'], genre: ['16'], studio: ['420'], sort: [sort] },
    });
    assert.equal(result.hasMore, true);
    assert.deepEqual(
      calls.map((uri) => uri.searchParams.get('sort_by')),
      [movie, tv],
    );
    for (const uri of calls) {
      assert.ok(uri.pathname.includes('/discover/'));
      assert.equal(uri.searchParams.get('page'), '2');
      assert.equal(uri.searchParams.get('with_genres'), '16');
      assert.equal(uri.searchParams.get('with_companies'), '420');
    }
  });

test('filmography sorting uses local dates and names without requesting credits again', async () => {
  let calls = 0;
  const source = createSource({
    baseUrl: definition.baseUrl,
    parameters: definition.parameters,
    settings: { network: async () => ({}) },
    auth: { getSession: async () => ({}) },
    http: {
      request: async () => {
        calls++;
        return {
          body: {
            cast: [
              { id: 1, media_type: 'movie', title: 'Zulu', release_date: '2000-01-01' },
              { id: 2, media_type: 'tv', name: 'Alpha', first_air_date: '2020-01-01' },
            ],
          },
        };
      },
    },
  });
  const sorted = await source.search({
    selectedFilters: { actor: ['7'], section: ['all'], sort: ['name_asc'] },
  });
  assert.deepEqual(
    sorted.items.map((item) => item.title),
    ['Alpha', 'Zulu'],
  );
  const dated = await source.search({
    selectedFilters: { actor: ['7'], section: ['all'], sort: ['old'] },
  });
  assert.deepEqual(
    dated.items.map((item) => item.title),
    ['Zulu', 'Alpha'],
  );
  assert.equal(calls, 1);
});
