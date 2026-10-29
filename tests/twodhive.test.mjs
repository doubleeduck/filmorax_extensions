import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { createBabaStream } from '../sources/twodhive/src/babastream.mjs';
import createSource from '../sources/twodhive/src/index.mjs';
import { readFile } from 'node:fs/promises';

test('browser login is declared with source-scoped session permissions', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../sources/twodhive/manifest.json', import.meta.url), 'utf8'),
  );
  const source = manifest.sources[0];
  assert.ok(manifest.permissions.includes('sourceSession'));
  assert.ok(source.capabilities.includes('auth'));
  assert.equal(source.web.loginUrl, 'https://2dhive.com');
  assert.deepEqual(source.web.cookieOrigins, ['https://2dhive.com']);
  assert.deepEqual(source.network.authOrigins, ['https://2dhive.com']);
  assert.equal(source.network.userAgentProfile, 'browser');
  assert.equal(source.isNsfw, false);
});

test('latest catalog poster origins are granted separately from playback', async () => {
  const {
    sources: [source],
  } = JSON.parse(
    await readFile(new URL('../sources/twodhive/manifest.json', import.meta.url), 'utf8'),
  );
  for (const poster of [
    'https://cdn.anipixcdn.co/poster/fixture.webp',
    'https://s4.anilist.co/file/anilistcdn/media/anime/cover/fixture.jpg',
  ])
    assert.ok(source.network.imageOrigins.includes(new URL(poster).origin));
  assert.ok(!source.network.origins.includes('https://cdn.anipixcdn.co'));
  assert.ok(!source.network.authOrigins.includes('https://cdn.anipixcdn.co'));
});
const key = Buffer.alloc(32, 7),
  pk = key.toString('base64');

test('default 2Dhive catalogue uses the full Top collection and follows its next page', async () => {
  const calls = [];
  const source = createSource({
    baseUrl: 'https://2dhive.com',
    settings: { network: async () => ({}) },
    http: {
      request: async (input) => {
        calls.push(new URL(input.url));
        return { body: 'fixture', url: input.url };
      },
    },
    html: {
      extract: async () => ({
        cards: [{ link: '/anime?anime=42', title: 'Fixture' }],
        links: ['/?list=top&page=3#anime-list'],
      }),
    },
  });
  const result = await source.search({ page: 2 });
  assert.equal(calls[0].searchParams.get('list'), 'top');
  assert.equal(result.hasMore, true);
  await source.search({ selectedFilters: { list: ['latest'] } });
  assert.equal(calls[1].searchParams.get('list'), 'latest');
});
function encrypt({ key: encoded, plaintext }) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(encoded, 'base64'), iv);
  return Buffer.concat([
    iv,
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
}
function decrypt({ key: encoded, envelope }) {
  const raw = Buffer.from(envelope, 'base64'),
    cipher = createDecipheriv('aes-256-gcm', Buffer.from(encoded, 'base64'), raw.subarray(0, 12));
  cipher.setAuthTag(raw.subarray(-16));
  return Buffer.concat([cipher.update(raw.subarray(12, -16)), cipher.final()]).toString('utf8');
}
function provider({ badCap = false } = {}) {
  let verified = false,
    challenges = 0,
    resolves = 0;
  const context = {
    baseUrl: 'https://2dhive.com',
    parameters: {
      playerOrigin: 'https://babastream.top',
      verificationOrigin: 'https://hostinger.babastream.top',
    },
    crypto: {
      aesGcmEncrypt: async (input) => encrypt(input),
      aesGcmDecrypt: async (input) => decrypt(input),
      nonceSearch: async (jobs) =>
        jobs.map(({ prefix, targetHex }) => {
          for (let nonce = 0; nonce < 2000000; nonce++)
            if (
              createHash('sha256')
                .update(prefix + nonce)
                .digest('hex')
                .startsWith(targetHex)
            )
              return nonce;
          throw Error('No proof');
        }),
    },
    http: {
      request: async (input) => {
        const url = new URL(input.url);
        let body;
        if (url.pathname.startsWith('/embed/'))
          body = `<script>var CFG = ${JSON.stringify({ pk, sid: url.pathname, cap: badCap ? 'https://evil.example/' : 'https://hostinger.babastream.top/test/' })};</script>`;
        else if (url.pathname === '/api/resolve') {
          resolves++;
          const clear = JSON.parse(decrypt({ key: pk, envelope: input.body.d }));
          assert.equal(typeof clear.ts, 'number');
          body = {
            d: encrypt({
              key: pk,
              plaintext: JSON.stringify(
                verified
                  ? {
                      t: 'hls',
                      u: 'https://babastream.top/stream.m3u8',
                      tracks: [{ file: '/en.vtt', label: 'English' }],
                    }
                  : { t: 'error', m: 'verify' },
              ),
            }),
          };
        } else if (url.pathname.endsWith('/challenge')) {
          challenges++;
          body = { token: 'fixture', challenge: { c: 2, s: 8, d: 1 } };
        } else if (url.pathname.endsWith('/redeem')) {
          assert.equal(input.body.solutions.length, 2);
          body = { success: true, token: 'redeemed' };
        } else if (url.pathname === '/api/cap-verify') {
          verified = true;
          body = { d: encrypt({ key: pk, plaintext: '{"t":"ok"}' }) };
        } else if (url.pathname === '/stream.m3u8')
          body = '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\n720.m3u8\n';
        else throw Error('Unexpected route');
        return { body };
      },
    },
  };
  return { context, counts: () => ({ challenges, resolves }) };
}
test('2Dhive keeps SFW status, genre names and every page filter', async () => {
  let last;
  const context = {
    baseUrl: 'https://2dhive.com',
    parameters: {},
    settings: { network: async () => ({}) },
    http: {
      request: async (input) => {
        last = new URL(input.url);
        return { body: 'fixture' };
      },
    },
    html: {
      extract: async (_, query) => {
        if (query.fields.islands)
          return {
            islands: [
              JSON.stringify({
                genres: [1, [[0, { id: [0, 9], name: [0, 'Hentai'], count: [0, 20] }]]],
              }),
            ],
            genres: [],
            format: [],
            score: [],
            sort: [],
          };
        return {
          cards: [
            {
              link: '/anime?anime=42',
              title: 'Fixture',
              image: 'https://s4.anilist.co/poster.jpg',
            },
          ],
          links: ['?page=3'],
        };
      },
    },
  };
  const source = createSource(context),
    filters = await source.getFilters();
  assert.equal(filters.find((f) => f.id === 'genre').options[0].label, 'Hentai');
  const page = await source.search({ page: 2, selectedFilters: { genre: ['9'] } });
  assert.equal(last.pathname, '/genre');
  assert.equal(last.searchParams.get('name'), 'Hentai');
  assert.equal(page.hasMore, true);
  assert.equal(page.items[0].isNsfw, false);
});
test('BabaStream preserves encrypted sessions, shared verification, native HLS and subtitles', async () => {
  const { context, counts } = provider(),
    resolve = createBabaStream(context);
  const first = resolve({ url: 'twodhive://episode/42/1?lang=sub' }),
    duplicate = resolve({ url: 'twodhive://episode/42/1?lang=sub' });
  assert.equal(first, duplicate);
  const result = await first;
  assert.deepEqual(
    result.variants.map((v) => v.quality),
    ['auto', '720'],
  );
  assert.equal(result.subtitleTracks[0].url, 'https://babastream.top/en.vtt');
  await resolve({ url: 'twodhive://episode/42/2?lang=sub' });
  assert.deepEqual(counts(), { challenges: 1, resolves: 3 });
});
test('BabaStream rejects a replaced verification authority without contacting it', async () => {
  const { context } = provider({ badCap: true });
  await assert.rejects(
    createBabaStream(context)({ url: 'twodhive://episode/42/1?lang=sub' }),
    (error) => error.code === 'permission_denied',
  );
});
