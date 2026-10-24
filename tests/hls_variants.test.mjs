import test from 'node:test';
import assert from 'node:assert/strict';
import { hlsVariants } from '../sdk/video.mjs';

test('HLS qualities preserve muxed audio, headers and relative references', () => {
  const headers = { Referer: 'https://player.example/' };
  const variants = hlsVariants(
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\n720/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=854x480\n480/index.m3u8',
    'https://media.example/master.m3u8',
    headers,
  );
  assert.deepEqual(
    variants.map((v) => v.quality),
    ['auto', '720', '480'],
  );
  assert.equal(variants[1].url, 'https://media.example/720/index.m3u8');
  assert.equal(variants[1].headers, headers);
});

test('HLS does not expose silent video children of external audio masters', () => {
  const playlist =
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="dub",LANGUAGE="ru",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,AUDIO="dub"\n720/index.m3u8';
  const master = 'https://media.example/master.m3u8';
  const variants = hlsVariants(playlist, master);
  assert.equal(variants.length, 1);
  assert.equal(variants[0].url, master);
});

test('in-band audio groups still allow fixed quality children', () => {
  const playlist =
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="dub",NAME="ru"\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,AUDIO="dub"\n720/index.m3u8';
  assert.equal(hlsVariants(playlist, 'https://media.example/master.m3u8').length, 2);
});
