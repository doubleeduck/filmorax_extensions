import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPath, menuRows, sortForm } from '../sources/hdrezka/src/filters.mjs';
import {
  decodePlaylist,
  playlistVariants,
  cinemarMedia,
  createPlayer,
} from '../sources/hdrezka/src/player.mjs';
test('HDRezka preserves real genre exceptions, legacy filters and POST sorting', () => {
  const menu = menuRows([{ url: '/serialy/serial-muzyka/', name: 'Music' }]);
  assert.equal(
    catalogPath({ section: ['serialy'], genre: ['muzyka'] }, 2, menu),
    '/serialy/serial-muzyka/page/2/',
  );
  assert.equal(
    catalogPath({ section: ['serialy'], genre: ['filmy/komedija'] }, 2, []),
    '/serialy/serialy-komedija/page/2/',
  );
  assert.deepEqual(sortForm({ sort: ['popular'] }), { sortix: 'popular' });
});
test('HDRezka decodes obfuscation, preserves MP4/HLS variants and exact Cinemar episode', () => {
  const raw =
    '[720p]https://host.cinemap.cc/720/master.m3u8 or https://host.cinemap.cc/720/video.mp4,[480p]https://host.cinemap.cc/480/video.mp4';
  assert.equal(decodePlaylist('#hAA' + Buffer.from(raw).toString('base64')), raw);
  assert.equal(playlistVariants(raw).length, 3);
  const payload = [
    {
      id: 'season',
      folder: [
        {
          id: 'one',
          title: 'Voice',
          title2: '1 сезон 1 серия',
          file: '//host.cinemap.cc/one/master.m3u8',
        },
        {
          id: 'two',
          title: 'Voice',
          title2: '1 сезон 2 серия',
          file: '//host.cinemap.cc/two/master.m3u8',
        },
      ],
    },
  ];
  const media = cinemarMedia(
    'Cinemar({"file":"#237RhNca8W' +
      Buffer.from(JSON.stringify(payload)).toString('base64') +
      '"})',
    new URL('https://cinemar.cc/embed/1'),
  );
  assert.deepEqual(
    media.map((v) => [v.id, v.season, v.episode]),
    [
      ['one', '1', '1'],
      ['two', '1', '2'],
    ],
  );
});

test('current Cinemar data envelopes select exact media and load via its official API', async () => {
  const entries = [
    { id: 'one', title: 'Dub', title2: '1 серия', data: 'opaque-one', file: '#ba404' },
    { id: 'two', title: 'Dub', title2: '2 серия', data: 'opaque-two', file: '#ba404' },
  ];
  const b64 = Buffer.from(JSON.stringify(entries)).toString('base64');
  const shuffled = b64.slice(-2) + 'xx' + b64.slice(0, -2) + 'yy2';
  const html = `Cinemar(${JSON.stringify({ file: '#237' + shuffled })})`;
  const calls = [];
  const player = createPlayer({
    http: {
      request: async (input) => {
        calls.push(input);
        return {
          body: input.method === 'POST' ? { file: 'https://host.cinemap.cc/two/hls.m3u8' } : html,
        };
      },
    },
  });
  const lazy = 'hdrezka://embed?url=' + encodeURIComponent('https://cinemar.cc/embed/42');
  const groups = await player.groups({ url: lazy });
  assert.equal(groups[0].episodes.length, 2);
  const result = await player.resolve({ url: groups[0].episodes[1].url });
  assert.equal(result.variants[0].url, 'https://host.cinemap.cc/two/hls.m3u8');
  assert.equal(calls.at(-1).body, JSON.stringify('opaque-two'));
  assert.equal(calls.at(-1).headers.Referer, 'https://cinemar.cc/embed/42');
  await assert.rejects(
    player.resolve({ url: lazy + '&media_id=missing' }),
    (e) => e.code === 'stream_unavailable',
  );
});
