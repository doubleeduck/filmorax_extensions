import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollaps } from '../resolvers/collaps.mjs';
import { createCdnVideoHub } from '../resolvers/cdnvideohub.mjs';
import { readFile } from 'node:fs/promises';

test('Kinogo declares the current Collaps stream CDN', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../sources/kinogo/manifest.json', import.meta.url), 'utf8'),
  );
  assert.ok(manifest.sources[0].network.streamOrigins.includes('https://interkh.com'));
});

test('Collaps shares one recent embed but not selected episodes, failures or expired data', async () => {
  let calls = 0,
    now = 0;
  const context = {
    http: {
      request: async () => {
        calls++;
        if (calls === 4) throw Error('temporary failure');
        return {
          body: 'makePlayer({seasons:[{season:1,episodes:[{episode:1,hls:"/one.m3u8"},{episode:2,hls:"/two.m3u8"}]}]})',
        };
      },
    },
  };
  const player = createCollaps(context, { now: () => now });
  const base =
    'collaps://embed?url=' + encodeURIComponent('https://api.nextembed.ws/embed/movie/42');
  const groups = await player.groups(base);
  assert.equal(calls, 1);
  assert.equal(
    (await player.resolve(groups[0].episodes[1].url)).variants[0].url,
    'https://api.nextembed.ws/two.m3u8',
  );
  assert.equal(
    (await player.resolve(groups[0].episodes[0].url)).variants[0].url,
    'https://api.nextembed.ws/one.m3u8',
  );
  assert.equal(calls, 1);
  now = 15000;
  await player.resolve(groups[0].episodes[1].url);
  assert.equal(calls, 2);
  await player.resolve(
    groups[0].episodes[0].url +
      '&referer=' +
      encodeURIComponent('https://go3.kinogo.cc/title.html'),
  );
  assert.equal(calls, 3);
  now = 30000;
  await assert.rejects(player.resolve(base), /temporary failure/);
  await player.resolve(base);
  assert.equal(calls, 5);
});
test('Collaps selects only the exact unblocked episode and keeps signed media/subtitles', async () => {
  const html = `makePlayer({seasons:${JSON.stringify([
    {
      season: 1,
      episodes: [
        { episode: 1, hls: '/wrong.m3u8' },
        {
          episode: 2,
          title: 'Second',
          hls: '/right.m3u8',
          cc: [{ url: '/sub.vtt', name: 'English' }],
        },
        { episode: 3, blocked: true, hls: '/blocked.m3u8' },
      ],
    },
  ])}});var lok=1,suffix="abcdef";`;
  const player = createCollaps({ http: { request: async () => ({ body: html }) } });
  const input = 'collaps://embed?url=https%3A%2F%2Fnextembed.ws%2Fembed%2F42&season=1&episode=2';
  const stream = await player.resolve(input);
  assert.equal(stream.variants[0].url, 'https://nextembed.ws/right.m3u8?abcdef');
  assert.equal(stream.subtitleTracks[0].url, 'https://nextembed.ws/sub.vtt');
  const groups = await player.groups(input);
  assert.equal(groups[0].episodes.length, 2);
  assert.equal(groups[0].episodes[1].id, 'collaps-42-1-2');
  await assert.rejects(
    player.resolve(input.replace('episode=2', 'episode=3')),
    (error) => error.code === 'episode_not_found',
  );
});
test('CDN playlist selection preserves episode/season/voice and one adaptive HLS variant', async () => {
  const requests = [];
  const resolve = createCdnVideoHub({
    http: {
      request: async (input) => {
        requests.push(new URL(input.url));
        return {
          body: input.url.includes('/playlist')
            ? {
                items: [
                  { episode: 1, season: 1, voiceStudio: 'Other', vkId: 'wrong' },
                  { episode: 1, season: 1, voiceStudio: 'Dub', vkId: 'right' },
                ],
              }
            : {
                sources: {
                  url720: 'https://media.vkuser.net/720.mp4',
                  mpegHighUrl: 'https://media.vkuser.net/720.mp4',
                  hlsUrl: 'https://media.vkuser.net/master.m3u8',
                },
              },
        };
      },
    },
  });
  const result = await resolve(
    'https://ru.yummyani.me/iframeCVH.html?anime_id=42&season=1&episode=1&dubbing_code=Dub',
  );
  assert.equal(requests[0].searchParams.get('pub'), '745');
  assert.equal(requests[1].pathname, '/api/v1/player/sv/video/right');
  assert.equal(result.variants.length, 2);
  assert.equal(result.variants[1].quality, 'auto');
});
