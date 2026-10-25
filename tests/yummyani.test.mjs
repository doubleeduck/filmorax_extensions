import test from 'node:test';
import assert from 'node:assert/strict';
import createSource from '../sources/yummyani/src/index.mjs';
import { item } from '../sources/yummyani/src/mapper.mjs';

test('large series classifies each iframe route once and preserves every video', () => {
  const NativeURL = globalThis.URL;
  let parses = 0;
  globalThis.URL = class extends NativeURL {
    constructor(...args) {
      super(...args);
      parses++;
    }
  };
  try {
    const videos = Array.from({ length: 1880 }, (_, index) => ({
      video_id: index + 1,
      number: String((index % 148) + 1),
      iframe_url:
        index % 2
          ? '//ru.yummyani.me/iframeCVH.html?anime_id=136&episode=' + ((index % 148) + 1)
          : '//kodikplayer.com/season/51779/818a73d599fe3408dda49f49385fc2fe/720p?episode=' +
            ((index % 148) + 1),
      data: { player_id: index % 2, dubbing: 'Voice ' + Math.floor(index / 148) },
    }));
    const result = item(
      { anime_url: 'fixture', title: 'Fixture', videos },
      'https://ru.yummyani.me',
    );
    assert.equal(result.playbackGroups.flatMap((group) => group.episodes).length, videos.length);
    assert.ok(parses <= 6, `Repeated URL parsing: ${parses}`);
  } finally {
    globalThis.URL = NativeURL;
  }
});

test('route reuse preserves each episode query and rejects URL credentials', () => {
  const urls = [
    'https://kodikplayer.com/season/1/hash/720p?episode=1&token=a%2Fb#one',
    'https://kodikplayer.com/season/1/hash/720p?episode=2&token=second#two',
    'https://user:secret@kodikplayer.com/season/1/hash/720p?episode=3',
    'https://kodikplayer.com/season/1/hash/720p?episode=4\\bad',
  ];
  const result = item(
    {
      anime_url: 'fixture',
      title: 'Fixture',
      videos: urls.map((url, i) => ({
        video_id: i + 1,
        number: i + 1,
        iframe_url: url,
        data: { dubbing: 'Voice' },
      })),
    },
    'https://ru.yummyani.me',
  );
  assert.deepEqual(
    result.playbackGroups.flatMap((g) => g.episodes).map((e) => e.url),
    urls.slice(0, 2),
  );
});

test('video API errors propagate instead of marking a playable title unavailable', async () => {
  const failure = new Error('temporary network failure');
  const source = createSource({
    baseUrl: 'https://ru.yummyani.me/api',
    parameters: { siteOrigin: 'https://ru.yummyani.me' },
    settings: { network: async () => ({}) },
    http: {
      request: async ({ url }) => {
        if (url.endsWith('/videos')) throw failure;
        return { body: { response: { anime_url: 'fixture', anime_id: 42, title: 'Fixture' } } };
      },
    },
  });
  await assert.rejects(
    source.loadDetails({ itemId: 'yummyani-fixture' }),
    (error) => error === failure,
  );
});

test('posters prefer the optimized native WebP size and keep legacy fallbacks', () => {
  const base = { anime_url: 'film', title: 'Film' };
  assert.equal(
    item(
      {
        ...base,
        poster: { big: '//imgproxy.yani.tv/poster.webp', fullsize: '//imgproxy.yani.tv/full.jpg' },
      },
      'https://ru.yummyani.me',
    ).posterUrl,
    'https://imgproxy.yani.tv/poster.webp',
  );
  assert.equal(
    item({ ...base, poster: 'https://imgproxy.yani.tv/legacy.jpg' }, 'https://ru.yummyani.me')
      .posterUrl,
    'https://imgproxy.yani.tv/legacy.jpg',
  );
});
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
