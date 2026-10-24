import test from 'node:test';
import assert from 'node:assert/strict';
import createSource from '../sources/yummyani/src/index.mjs';
import { item } from '../sources/yummyani/src/mapper.mjs';
test('YummyAni mapper preserves stable voice/provider groups and metadata filters', () => {
  const result = item(
    {
      anime_url: '/catalog/item/fixture',
      title: 'Fixture',
      year: 2026,
      poster: { fullsize: '/poster.jpg' },
      type: { title: 'TV', alias: 'tv' },
      studios: [{ name: 'Studio', alias: 'studio' }],
      genres: [{ title: 'Drama', alias: 'drama' }],
      videos: [
        {
          video_id: 7,
          number: 1,
          duration: 1440,
          iframe_url: 'https://kodikplayer.com/seria/123/hash/720p',
          data: { dubbing: 'Dub', player: 'kodik', player_id: 'kodik' },
        },
      ],
    },
    'https://ru.yummyani.me',
  );
  assert.equal(result.id, 'yummyani-fixture');
  assert.equal(result.playbackGroups[0].id, 'yummyani-Dub / kodik');
  assert.equal(result.playbackGroups[0].episodes[0].id, '7');
  assert.equal(result.metadata.find((m) => m.kind === 'studio').filterValue, 'studio');
});
test('YummyAni uses dynamic filters, correct API prefix and search/studio parameters', async () => {
  const calls = [];
  const source = createSource({
    baseUrl: 'https://ru.yummyani.me/api',
    parameters: { siteOrigin: 'https://ru.yummyani.me' },
    settings: { network: async () => ({}) },
    http: {
      request: async (input) => {
        const url = new URL(input.url);
        calls.push(url);
        return {
          body: url.pathname.endsWith('/genres')
            ? { response: { genres: [{ alias: 'drama', title: 'Drama' }] } }
            : url.pathname.endsWith('/types')
              ? { response: { types: [] } }
              : url.pathname.includes('/studio/')
                ? { response: { id: 42 } }
                : { response: [] },
        };
      },
    },
  });
  const filters = await source.getFilters();
  assert.equal(filters.find((f) => f.id === 'types').options.length, 5);
  await source.search({ searchTerm: 'Test' });
  assert.equal(calls.at(-1).pathname, '/api/search');
  await source.search({
    page: 2,
    selectedFilters: { studio: ['my-studio'], genres: ['drama'], sort: ['year:asc'] },
  });
  const request = calls.at(-1);
  assert.equal(request.pathname, '/api/anime');
  assert.equal(request.searchParams.get('offset'), '24');
  assert.equal(request.searchParams.get('studio_ids'), '42');
  assert.equal(request.searchParams.get('genres'), 'drama');
  assert.equal(request.searchParams.get('sort_forward'), 'true');
});

test('YummyAni keeps current mixed-case CDNVideoHub iframe episodes', () => {
  const result = item(
    {
      anime_url: 'fixture',
      title: 'Fixture',
      videos: [
        {
          video_id: 11,
          number: 1,
          data: { dubbing: 'Dub', player: 'CDNVideoHub', player_id: 7 },
          iframe_url: '//ru.yummyani.me/iframeCVH.html?anime_id=42&episode=1&dubbing_code=Dub',
        },
      ],
    },
    'https://ru.yummyani.me',
  );
  assert.equal(result.playbackGroups.length, 1);
  assert.equal(result.playbackGroups[0].episodes[0].id, '11');
  assert.equal(result.playbackGroups[0].playerId, 'cdnVideoHub');
});
