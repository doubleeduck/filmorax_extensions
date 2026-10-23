import { createCipheriv } from 'node:crypto';
import { transformVidy } from '../../sources/flixbaba/src/vidy.mjs';
export function flixbabaFixture() {
  const payload = {
      sources: [{ url: 'https://moon.zenoak.top/master.m3u8', quality: '1080' }],
      subtitles: [{ url: 'https://moon.zenoak.top/en.vtt', lang: 'en' }],
    },
    vidy = Buffer.from(
      transformVidy(
        new TextEncoder().encode('mvm1' + JSON.stringify(payload)),
        'fixture-seed',
        603,
      ),
    ).toString('base64url'),
    key = Uint8Array.from({ length: 32 }, (_, i) => i + 1),
    mask = Uint8Array.from({ length: 32 }, (_, i) => (i * 9 + 3) & 255),
    other = Uint8Array.from(key, (v, i) => v ^ mask[i]),
    data = [2, 0, 0x41, 0, 0x0b, 32, ...mask, 0, 0x41, 64, 0x0b, 32, ...other],
    wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 11, data.length, ...data]),
    nonce = Uint8Array.from({ length: 12 }, (_, i) => i),
    cipher = createCipheriv('chacha20', key, Buffer.from([0, 0, 0, 0, ...nonce])),
    encrypted = Buffer.concat([
      nonce,
      cipher.update('https://oakhollowoutpost.space/master.m3u8\n'),
      cipher.final(),
    ]).toString('base64');
  return { vidy, wasm: wasm.toString('base64'), encrypted };
}
