import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollaps } from '../resolvers/collaps.mjs';

test('Collaps uses declared native transport and master quality filtering without losing audio', async () => {
  const calls = [];
  const player = createCollaps({
    http: {
      request: async (input) => {
        calls.push(input);
        if (new URL(input.url).pathname.startsWith('/embed/'))
          return {
            body: 'var lok=1,token="abcd"; const options={hlsNativeParam:true,hlsNativeQuality:"resolutionFilter"}; makePlayer({source:{hls:"https://media.interkh.com/master.m3u8?sign=original",dash:"https://media.interkh.com/video.mpd",download:"https://media.interkh.com/video.mp4?m=original%26signature"}})',
          };
        assert.equal(new URL(input.url).searchParams.get('hls'), 'native');
        assert.equal(input.timeoutMs, 4000);
        return {
          body: '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="dub",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,AUDIO="dub"\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,AUDIO="dub"\n720-failover.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360,AUDIO="dub"\n360.m3u8',
        };
      },
    },
  });
  const result = await player.resolve(
    'collaps://embed?url=https%3A%2F%2Fnextembed.ws%2Fembed%2F42',
  );
  assert.equal(calls.length, 2);
  const hls = result.variants.filter((v) => v.mimeType.includes('mpegurl'));
  assert.deepEqual(
    hls.map((v) => v.quality),
    ['auto', '720', '360'],
  );
  for (const variant of hls) {
    const url = new URL(variant.url);
    assert.equal(url.pathname, '/master.m3u8');
    assert.equal(url.searchParams.get('hls'), 'native');
    assert.equal(url.searchParams.get('sign'), 'original');
    assert.ok(url.searchParams.has('abcd'));
    assert.equal(variant.headers.Referer, 'https://nextembed.ws/embed/42');
  }
  assert.equal(new URL(hls[1].url).searchParams.get('resolutionFilter'), '1280x720');
  assert.equal(new URL(hls[2].url).searchParams.get('resolutionFilter'), '640x360');
  const download = result.variants.find((v) => v.mimeType === 'video/mp4');
  assert.equal(new URL(download.url).searchParams.get('m'), 'original&signature&abcd');
});

test('Collaps quality timeout keeps native Auto; cancellation is not swallowed', async () => {
  for (const code of ['timeout', 'cancelled']) {
    const player = createCollaps({
      http: {
        request: async (input) => {
          if (input.url.includes('/embed/'))
            return {
              body: 'const config={hlsNativeParam:true,hlsNativeQuality:"resolutionFilter"};makePlayer({source:{hls:"https://media.interkh.com/master.m3u8"}})',
            };
          throw Object.assign(Error(code), { code });
        },
      },
    });
    const result = player.resolve('collaps://embed?url=https%3A%2F%2Fnextembed.ws%2Fembed%2F42');
    if (code === 'cancelled') await assert.rejects(result, (e) => e.code === code);
    else assert.equal(new URL((await result).variants[0].url).searchParams.get('hls'), 'native');
  }
});
