import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createSource from '../sources/shikimori/src/index.mjs';
const title = {
  id: 52991,
  name: 'Sousou no Frieren',
  russian: 'Фрирен',
  url: '/animes/52991-frieren',
  kind: 'tv',
  image: { original: '/cover.jpg' },
  aired_on: '2023-09-29',
  score: '8.84',
  genres: [{ id: 10, name: 'Fantasy' }],
  studios: [{ id: 11, name: 'Studio' }],
  description_html: '<p>Story</p>',
};
function fixture(config = {}) {
  const calls = [];
  const context = {
    baseUrl: 'https://shikimori.io',
    settings: { network: async () => config },
    html: {
      text: async () => ['Story'],
      extract: async () => ({ title: '52991', publisher: '3058', aggregator: 'mali' }),
    },
    http: {
      request: async (input) => {
        calls.push(input);
        const uri = new URL(input.url);
        let body;
        if (uri.pathname === '/api/animes')
          body = Array.from({ length: 20 }, (_, i) => ({
            ...title,
            id: Number(uri.searchParams.get('page')) * 100 + i,
          }));
        else if (uri.pathname === '/api/genres')
          body = [
            { id: 10, name: 'Fantasy', kind: 'genre', entry_type: 'Anime' },
            { id: 12, name: 'Manga only', kind: 'genre', entry_type: 'Manga' },
            { id: 22, name: 'Hentai', kind: 'genre', entry_type: 'Anime' },
          ];
        else if (uri.pathname === '/api/studios') body = [{ id: 11, name: 'Studio' }];
        else if (uri.pathname.endsWith('/similar')) body = [{ ...title, id: 33352 }];
        else if (uri.pathname === '/api/animes/52991') body = title;
        else if (uri.pathname.endsWith('/watch')) body = 'watch';
        else if (uri.pathname.endsWith('/playlist'))
          body = {
            items: [
              { voiceStudio: 'Voice A', season: 1, episode: 2, vkId: '102' },
              { voiceStudio: 'Voice A', season: 1, episode: 1, vkId: '101' },
              { voiceStudio: 'Voice B', season: 1, episode: 1, vkId: '201' },
              { voiceStudio: 'Voice A', season: 1, episode: 1, vkId: '101' },
            ],
          };
        else if (uri.pathname.endsWith('/video/101'))
          body = {
            sources: {
              mpegHighUrl: 'https://cdn.vkuser.net/episode.mp4',
              hlsUrl: 'https://cdn.vkuser.net/master.m3u8',
            },
          };
        else throw Error(`Unexpected ${uri}`);
        return { body, url: uri.href };
      },
    },
  };
  return { source: createSource(context), calls };
}
test('non-NSFW Shikimori has an icon, catalogue and an explicitly permitted shared player', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../sources/shikimori/manifest.json', import.meta.url)),
  );
  assert.equal(manifest.sources[0].isNsfw, false);
  assert.ok(manifest.sources[0].network.origins.includes('https://plapi.cdnvideohub.com'));
  assert.equal(manifest.sources[0].presentation.icon, 'assets/icon.png');
});
test('Shikimori catalogue paginates and sends filters to the configured mirror', async () => {
  const { source, calls } = fixture({ baseUrl: 'https://mirror.example' });
  const a = await source.search(),
    b = await source.search({
      page: 2,
      searchTerm: 'Frieren',
      selectedFilters: { genre: ['10'], studio: ['11'] },
    });
  assert.equal(a.items.length, 20);
  assert.equal(b.hasMore, true);
  assert.notEqual(a.items[0].id, b.items[0].id);
  const uri = new URL(calls.at(-1).url);
  assert.equal(uri.origin, 'https://mirror.example');
  assert.equal(uri.searchParams.get('page'), '2');
  assert.equal(uri.searchParams.get('genre'), '10');
  assert.equal(uri.searchParams.get('studio'), '11');
  assert.equal(uri.searchParams.get('search'), 'Frieren');
  assert.equal(uri.searchParams.get('censored'), 'true');
  assert.equal(b.items[0].isNsfw, false);
});
test('filter inventories are reused per mirror and details expose actual sorted episodes/voices', async () => {
  const { source, calls } = fixture();
  const filters = await source.getFilters();
  await source.getFilters();
  assert.equal(calls.length, 2);
  assert.deepEqual(filters.find((row) => row.id === 'genre').options, [
    { value: '10', label: 'Fantasy' },
  ]);
  const entry = await source.loadDetails({ itemId: 'shikimori-52991' });
  assert.equal(entry.overview, 'Story');
  assert.equal(entry.relatedItems.length, 1);
  assert.equal(entry.playbackGroups.length, 2);
  assert.deepEqual(
    entry.playbackGroups[0].episodes.map((episode) => episode.number),
    [1, 2],
  );
  assert.equal(
    entry.playbackGroups[0].episodes[0].url,
    'https://plapi.cdnvideohub.com/api/v1/player/sv/video/101',
  );
});
test('Shikimori reuses CDNVideoHub native streams with mirror headers; unsupported players reject', async () => {
  const { source } = fixture({ baseUrl: 'https://mirror.example' });
  const result = await source.resolveStream({
    url: 'https://plapi.cdnvideohub.com/api/v1/player/sv/video/101',
  });
  assert.equal(result.variants.length, 2);
  assert.equal(result.variants[0].headers.Origin, 'https://mirror.example');
  await assert.rejects(source.resolveStream({ url: 'https://evil.example/video/101' }));
});
