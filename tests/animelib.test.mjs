import test from 'node:test';
import assert from 'node:assert/strict';
import createSource from '../sources/animelib/src/index.mjs';
import { item, richText } from '../sources/animelib/src/mapper.mjs';
test('AniLib keeps rich text, metadata and stable lazy provider/episode IDs', () => {
  assert.equal(
    richText({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ text: 'One' }, { text: ' two' }] },
        { type: 'paragraph', content: [{ text: 'Three' }] },
      ],
    }),
    'Onetwo\n\nThree',
  );
  const data = {
    slug_url: '42-fixture',
    rus_name: 'Fixture',
    releaseDate: '2026-01-01',
    genres: [
      { id: 1, name: 'Drama' },
      { id: 2, name: 'Hidden', adult: true },
    ],
    episodes: [
      { id: 11, number: 1 },
      { id: 12, number: 2 },
    ],
  };
  const anonymous = item(data),
    authenticated = item(data, true);
  assert.equal(anonymous.id, 'animelib-42-fixture');
  assert.deepEqual(anonymous.tags, ['Drama']);
  assert.equal(anonymous.playbackGroups[0].id, 'animelib-kodik');
  assert.equal(anonymous.playbackGroups[0].episodes[0].id, '11 / kodik');
  assert.equal(authenticated.playbackGroups.length, 2);
});
test('AniLib applies all filters, seed pagination and scoped API headers', async () => {
  const calls = [],
    source = createSource({
      baseUrl: 'https://hapi.hentaicdn.org/api',
      settings: { network: async () => ({}) },
      http: {
        request: async (input) => {
          calls.push(input);
          return {
            body: new URL(input.url).pathname.endsWith('/constants')
              ? {
                  data: {
                    types: [
                      { id: 1, name: { ru: 'TV' }, site_ids: [5] },
                      { id: 2, name: 'Wrong site', site_ids: [1] },
                    ],
                  },
                }
              : { data: [], meta: { seed: 'stable-seed' } },
          };
        },
      },
    });
  const filters = await source.getFilters();
  assert.equal(filters.find((f) => f.id === 'types').options.length, 1);
  await source.search({
    selectedFilters: {
      sort: ['rate_avg:asc'],
      genres: ['1', '2'],
      rate_min: ['7,5'],
      licensed: ['true'],
    },
  });
  const call = calls.at(-1),
    url = new URL(call.url);
  assert.equal(url.searchParams.get('rate_min'), '75');
  assert.equal(url.searchParams.get('sort_type'), 'asc');
  assert.deepEqual(url.searchParams.getAll('genres[]'), ['1', '2']);
  assert.equal(url.searchParams.get('licensed'), 'true');
  assert.equal(call.headers['Site-Id'], '5');
  await source.search({ page: 2 });
  assert.equal(new URL(calls.at(-1).url).searchParams.get('seed'), 'stable-seed');
});
test('AniLib lazy groups preserve selected voice and never expose private player anonymously', async () => {
  let token = '';
  const source = createSource({
    baseUrl: 'https://hapi.hentaicdn.org/api',
    settings: { network: async () => ({}) },
    auth: { getSession: async () => ({ accessToken: token }) },
    http: {
      request: async () => ({
        body: {
          data: {
            id: 11,
            number: 1,
            players: [
              {
                id: 7,
                player: 'AniLib',
                team: { id: 3, name: 'Dub' },
                translation_type: { id: 1, label: 'Voice' },
                video: { quality: [{ quality: 720, href: 'a/720.mp4' }] },
              },
            ],
          },
        },
      }),
    },
  });
  assert.deepEqual(
    await source.loadPlaybackGroups({ url: 'animelib://episode/11?player=animelib' }),
    [],
  );
  await assert.rejects(
    () => source.resolveStream({ url: 'animelib://episode/11?player=animelib' }),
    { code: 'auth_required' },
  );
  token = 'test-token';
  const groups = await source.loadPlaybackGroups({ url: 'animelib://episode/11?player=animelib' });
  assert.equal(groups[0].id, 'animelib-7 / 3 / 1 / animelib');
  const stream = await source.resolveStream({ url: groups[0].episodes[0].url });
  assert.equal(stream.variants[0].quality, '720');
  assert.equal(stream.variants[0].url, 'https://video1.cdnlibs.org/.%D0%B0s/a/720.mp4');
  await assert.rejects(
    () => source.resolveStream({ url: 'animelib://episode/11?player=animelib&player_id=wrong' }),
    /no supported players/,
  );
});
