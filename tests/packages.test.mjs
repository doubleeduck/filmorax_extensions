import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pack } from '../tools/pack.mjs';
import { canonicalJson, verifyPackage } from '../tools/package_format.mjs';

const project = fileURLToPath(new URL('../examples/torrserver', import.meta.url));
const { privateKey } = generateKeyPairSync('ed25519');
const key = privateKey.export({ type: 'pkcs8', format: 'pem' });

test('feature example is reproducible, signed and contains no executable payload', async () => {
  const a = await pack({ project, key, keyId: 'test.publisher' });
  const b = await pack({ project, key, keyId: 'test.publisher' });
  assert.deepEqual(a.archive, b.archive);
  const manifest = verifyPackage(a.archive, Buffer.from(a.publicRecord.publicKey, 'base64'));
  assert.deepEqual(manifest.contributions.hostFeatures, ['torrents.torrserver']);
  assert.equal(manifest.entrypoint, undefined);
  assert.deepEqual(Object.keys(manifest.files), ['LICENSE', 'assets/icon.png']);
  assert.equal(manifest.icon, 'assets/icon.png');
});
test('a different publisher cannot verify the package', async () => {
  const result = await pack({ project, key, keyId: 'test.publisher' });
  assert.throws(() => verifyPackage(result.archive, Buffer.alloc(32)), /signature/iu);
});
test('canonical JSON is shared with the Dart verifier', () => {
  const value = { z: [true, null, { b: 2, a: 1 }], a: 'Ж' };
  assert.equal(canonicalJson(value), '{"a":"Ж","z":[true,null,{"a":1,"b":2}]}');
  assert.equal(createHash('sha256').update(canonicalJson(value)).digest('hex').length, 64);
  assert.throws(() => canonicalJson({ bad: Infinity }));
  assert.throws(() => canonicalJson('\ud800'));
});
