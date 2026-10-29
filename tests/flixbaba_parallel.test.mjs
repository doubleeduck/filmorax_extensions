import test from 'node:test';
import assert from 'node:assert/strict';
import { createVidy, transformVidy } from '../sources/flixbaba/src/vidy.mjs';

test('Vidy resolves available qualities concurrently without mixing their labels', async () => {
  const data = {
    sources: [
      { url: 'https://cdn.goldenkite.top/720.m3u8', quality: '720' },
      { url: 'https://cdn.goldenkite.top/1080.m3u8', quality: '1080' },
    ],
  };
  const encrypted = Buffer.from(
    transformVidy(new TextEncoder().encode('mvm1' + JSON.stringify(data)), 'seed', 603),
  ).toString('base64url');
  let release,
    ready,
    requests = 0;
  const gate = new Promise((resolve) => (release = resolve)),
    started = new Promise((resolve) => (ready = resolve));
  const resolve = createVidy({
    http: {
      request: async ({ url }) => {
        const uri = new URL(url);
        if (uri.pathname === '/seed') return { body: { seed: 'seed' } };
        if (uri.pathname.endsWith('/sources')) return { body: encrypted };
        requests++;
        if (requests === 2) ready();
        await gate;
        return { body: '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10\nsegment.ts' };
      },
    },
  });
  const resolving = resolve(new URL('flixbaba://stream?tmdbId=603&mediaType=movie'));
  try {
    await Promise.race([
      started,
      new Promise((_, reject) => setTimeout(() => reject(Error('Qualities were serialized')), 300)),
    ]);
    assert.equal(requests, 2);
  } finally {
    release();
  }
  const result = await resolving;
  assert.deepEqual(
    result.variants.map((row) => row.quality),
    ['720', '1080'],
  );
});
