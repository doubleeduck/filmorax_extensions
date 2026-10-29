import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import { decodeVidy } from '../sources/flixbaba/src/vidy.mjs';
import { decryptUrls, wasmKeyCandidates } from '../sources/flixbaba/src/vsembed.mjs';
import { item } from '../sources/flixbaba/src/mapper.mjs';
import { flixbabaFixture } from './support/flixbaba_fixture.mjs';
const publicVector =
  '_ugkauLG68RJWI20rUQfzxtjBKZdEG5jbQuqABGwscTT4wuPOGA2jLj21zYcIJWdsP15GDwE6WZNPyfaUvqfoWMIDFrgtAsRanAk5GqYI1p9Aj0m5SmLl5hX8-jv_s7t88jO1-X7wgyGik58ObC5FjmZTxQdGc10fZ5UouZhMd9nnQhN3g';
test('FlixBaba Vidy decoder matches the existing public mvm1 test vector', () => {
  const decoded = JSON.parse(decodeVidy(publicVector, 'fixture-seed', 603));
  assert.equal(decoded.sources[0].url, 'https://cdn.test/master.m3u8');
  assert.equal(decoded.sources[0].quality, '1080');
  assert.throws(() => decodeVidy(publicVector, 'wrong-seed', 603));
  assert.throws(() => decodeVidy(publicVector, 'fixture-seed', 604));
});
test('FlixBaba reads WASM data masks without executing WASM and decrypts the current ChaCha envelope', async () => {
  const fixture = flixbabaFixture(),
    wasm = Buffer.from(fixture.wasm, 'base64');
  assert.equal(wasmKeyCandidates(wasm).length, 3);
  const context = {
    crypto: {
      chacha20DecryptCandidates: async ({ keys, nonce, ciphertext }) =>
        keys.map((key) => {
          try {
            const cipher = createDecipheriv(
              'chacha20',
              Buffer.from(key, 'base64'),
              Buffer.concat([Buffer.alloc(4), Buffer.from(nonce, 'base64')]),
            );
            return new TextDecoder('utf-8', { fatal: true }).decode(
              Buffer.concat([cipher.update(Buffer.from(ciphertext, 'base64')), cipher.final()]),
            );
          } catch {
            return null;
          }
        }),
    },
  };
  assert.deepEqual(await decryptUrls(context, fixture.encrypted, wasm), [
    'https://oakhollowoutpost.space/master.m3u8',
  ]);
  assert.throws(() => wasmKeyCandidates(wasm.subarray(0, 15)));
});
test('FlixBaba preserves item/provider/episode IDs and every season for all four providers', () => {
  const result = item(
    {
      id: 603,
      name: 'Fixture',
      first_air_date: '2026-01-01',
      seasons: [
        { season_number: 0, episode_count: 1 },
        { season_number: 1, episode_count: 2 },
        { season_number: 2, episode_count: 3 },
      ],
    },
    'tv',
    true,
  );
  assert.equal(result.id, 'flixbaba-tv-603-fixture');
  assert.deepEqual(
    result.playbackGroups.map((g) => g.id),
    ['flixbaba-vidy', 'flixbaba-vsembed', 'flixbaba-framextv', 'flixbaba-videasy'],
  );
  for (const group of result.playbackGroups) {
    assert.equal(group.episodes.length, 5);
    const url = new URL(group.episodes.at(-1).url);
    assert.equal(url.searchParams.get('season'), '2');
    assert.equal(url.searchParams.get('episode'), '3');
  }
});
