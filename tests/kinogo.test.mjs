import test from 'node:test';
import assert from 'node:assert/strict';
import createSource, { titlePath, catalogPath } from '../sources/kinogo/src/index.mjs';
import manifest from '../sources/kinogo/manifest.json' with { type: 'json' };
test('Kinogo identifiers and filter paths cannot escape their site routes', () => {
  assert.equal(titlePath('/104087-title.html'), '104087-title');
  assert.equal(titlePath('/../../secret.html'), '');
  assert.equal(catalogPath('/filmy/genre-filmy-komediya/'), '/filmy/genre-filmy-komediya/');
  assert.equal(catalogPath('/ads/'), '');
});

test('Kinogo loads the current Collaps embed and keeps the selected episode', async () => {
  const definition = manifest.sources[0];
  const player = 'https://api.embf.net';
  assert.ok(definition.network.origins.includes(player));
  assert.ok(manifest.resolvers[0].origins.includes(player));
  const source = createSource({
    baseUrl: definition.baseUrl,
    settings: { network: async () => ({}) },
    http: {
      request: async ({ url, headers }) => {
        if (!url.startsWith(player)) return { body: 'fixture page', url };
        assert.equal(headers.Referer, definition.baseUrl + '/104087-title.html');
        return {
          body: 'makePlayer({seasons:[{season:2,episodes:[{episode:1,hls:"/one.m3u8"},{episode:2,hls:"/two.m3u8"}]}]})',
        };
      },
    },
    html: {
      extract: async () => ({
        title: 'Fixture',
        players: [{ lazy: '//api.embf.net/embed/movie/42?host=kinogo.cc' }],
      }),
      text: async () => ['', ''],
    },
  });
  const details = await source.loadDetails({ itemId: 'kinogo-104087-title' });
  const episodes = details.playbackGroups[0].episodes;
  assert.deepEqual(
    episodes.map(({ season, number }) => [season, number]),
    [
      ['2', '1'],
      ['2', '2'],
    ],
  );
  assert.equal(
    (await source.resolveStream({ url: episodes[1].url })).variants[0].url,
    player + '/two.m3u8',
  );
});
