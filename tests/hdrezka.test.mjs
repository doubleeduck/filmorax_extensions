import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPath, menuRows, sortForm } from '../sources/hdrezka/src/filters.mjs';
import { decodePlaylist, playlistVariants, cinemarMedia } from '../sources/hdrezka/src/player.mjs';
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
