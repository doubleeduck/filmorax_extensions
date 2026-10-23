import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { pack } from '../tools/pack.mjs';
import createSource from '../sources/anikage/src/index.mjs';

function fixture(
  handler = () => {
    throw Error('Unexpected HTTP');
  },
) {
  const calls = [];
  const source = createSource({
    baseUrl: 'https://anikage.cc',
    parameters: { proxyOrigin: 'https://og.bakayaro.live' },
    settings: { network: async () => ({}) },
    http: {
      request: async (input) => {
        calls.push(input);
        return { body: await handler(new URL(input.url), input) };
      },
    },
    html: {
      extract: async (body) => body.replace(/<[^>]*>/g, ''),
      text: async (bodies) => bodies.map((b) => b.replace(/<[^>]*>/g, '')),
    },
  });
  return { source, calls };
}
const anime = {
  slug: 'xyz123',
  title: { english: 'Fixture', romaji: 'Fixture JP' },
  year: 2026,
  format: 'TV',
  genres: ['Action'],
  coverImage: { large: 'https://s4.anilist.co/file/poster.jpg' },
  averageScore: 81,
  subCount: 2,
  dubCount: 1,
  duration: 24,
  description: 'A <b>description</b>',
  studios: [{ name: 'Studio', isAnimationStudio: true }],
};

test('Anikage keeps every filter and exact API pagination/filter semantics', async () => {
  const { source, calls } = fixture(() => ({ data: [anime], hasNext: true }));
  const filters = source.getFilters();
  assert.equal(filters.length, 12);
  assert.equal(filters.find((f) => f.id === 'tags').options.length, 356);
  const result = await source.search({
    page: 3,
    searchTerm: 'Fixture',
    selectedFilters: {
      genres: ['Action', 'Drama'],
      tags: ['4-koma'],
      format: ['TV'],
      status: ['RELEASING'],
      season: ['SUMMER'],
      year: ['2026'],
      country: ['JP'],
      episodes: ['65-'],
      source: ['MANGA'],
      audio: ['dub'],
      scoreMin: ['80'],
      sort: ['trending'],
    },
  });
  assert.equal(result.hasMore, true);
  assert.equal(result.items[0].overview, 'A description');
  const query = new URL(calls[0].url).searchParams;
  assert.equal(query.get('genres'), 'Action,Drama');
  assert.equal(query.get('yearMin'), '2026');
  assert.equal(query.get('yearMax'), '2026');
  assert.equal(query.get('epMin'), '65');
  assert.equal(query.has('epMax'), false);
  assert.equal(query.get('dub'), 'true');
  assert.equal(query.get('adult'), 'false');
  assert.equal(query.get('page'), '3');
});
test('Anikage preserves groups, episode identity, recommendations and metadata', async () => {
  const { source } = fixture((url) =>
    url.pathname.endsWith('/episodes')
      ? [
          { number: 2, title: 'Second' },
          { number: 1, title: 'First' },
          { number: 1, title: 'Duplicate' },
        ]
      : {
          anime: {
            ...anime,
            recommendations: [{ ...anime, slug: 'other' }],
            relations: [{ ...anime, slug: 'other' }, anime],
          },
        },
  );
  const result = await source.loadDetails({ itemId: 'anikage-xyz123' });
  assert.equal(result.playbackGroups.length, 2);
  assert.deepEqual(
    result.playbackGroups.map((g) => g.episodes.length),
    [2, 1],
  );
  assert.equal(result.playbackGroups[0].episodes[0].id, 'anikage-xyz123-1');
  assert.equal(result.playbackGroups[0].episodes[0].url, 'anikage://episode/xyz123/1?lang=sub');
  assert.equal(result.relatedItems.length, 1);
  assert.equal(result.metadata.find((m) => m.kind === 'genre').filterValue, 'Action');
  assert.equal(await source.loadDetails({ itemId: '../../bad' }), null);
});
test('Anikage resolves only exact episode/language servers and deduplicates native HLS', async () => {
  const token = 'abcdefghijklmnop';
  const { source, calls } = fixture((url) => {
    if (url.pathname.endsWith('/servers'))
      return {
        servers: [
          { id: 'badlang', subTypes: ['dub'] },
          { id: 'one', default: true, subTypes: ['sub'] },
          { id: 'one', subTypes: ['sub'] },
        ],
      };
    if (url.pathname.endsWith('/sources'))
      return {
        sources: [
          { url: token, type: 'hls' },
          { url: token, type: 'hls' },
        ],
        subtitles: [{ file: 'https://og.bakayaro.live/sub.vtt', label: 'English', default: true }],
      };
    return '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\n720/index.m3u8\n';
  });
  const result = await source.resolveStream({ url: 'anikage://episode/xyz123/1?lang=sub' });
  assert.equal(result.variants.length, 2);
  assert.equal(result.variants[0].quality, 'auto');
  assert.equal(result.variants[1].quality, '720');
  assert.equal(result.subtitleTracks[0].isDefault, true);
  assert.equal(new URL(calls[1].url).searchParams.get('server'), 'one');
  await assert.rejects(source.resolveStream({ url: 'anikage://episode/xyz123/1?lang=other' }));
});
test('Anikage bundles shared SDK into a self-contained signed extension', async () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const { archive } = await pack({
    project: new URL('../sources/anikage/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    keyId: 'test.publisher',
  });
  assert.ok(archive.length > 5000);
});
