import {
  text,
  array,
  object,
  first,
  fail,
  dedupe,
  base64Bytes,
  hlsVariants,
} from '../../../sdk/video.mjs';
const rotate = (value, count) =>
  count === 0 ? value >>> 0 : ((value << count) | (value >>> (32 - count))) >>> 0;
function mix(value) {
  value >>>= 0;
  value ^= value >>> 16;
  value = Math.imul(value, 2246822507);
  value ^= value >>> 13;
  value = Math.imul(value, 3266489909);
  return (value ^ (value >>> 16)) >>> 0;
}
export function transformVidy(bytes, seed, id) {
  if (bytes.length > 1500000 || seed.length > 1024 || !Number.isSafeInteger(id) || id <= 0)
    throw fail('Invalid Vidy envelope');
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619) >>> 0;
  let state = mix(mix(hash) ^ mix(id ^ 2654435769));
  const values = new Uint32Array(61),
    used = new Uint8Array(61);
  for (let n = 0; n < 8; n++) {
    const slot = state % 61;
    state = rotate((state + 2654435769) >>> 0, 7 + (n & 7));
    values[slot] = (state ^ mix(state)) >>> 0;
    used[slot] = 1;
    state = mix((state + slot) >>> 0);
  }
  let accumulator = mix((2779096485 ^ state) >>> 0);
  for (let offset = 0, counter = 0; offset < bytes.length; counter++) {
    const slot = accumulator % 61,
      previous = used[slot] ? values[slot] : 0,
      active = used[slot] ? 0xffffffff : 0,
      mixed = (previous ^ Math.imul(counter + 1, 2654435769)) >>> 0,
      combined = ((accumulator ^ mixed) | (accumulator & mixed & active)) >>> 0,
      rotated =
        rotate((combined + accumulator) >>> 0, slot & 31) ^ rotate(accumulator, (slot * 7) & 31);
    accumulator = mix((rotated + 2654435769) >>> 0);
    values[slot] = accumulator;
    used[slot] = 1;
    for (let shift = 0; shift < 32 && offset < bytes.length; shift += 8)
      bytes[offset++] ^= (accumulator >>> shift) & 255;
  }
  return bytes;
}
export function decodeVidy(value, seed, id) {
  if (value.length > 2000000) throw fail('Oversized Vidy envelope');
  const bytes = transformVidy(base64Bytes(value.replace(/-/g, '+').replace(/_/g, '/')), seed, id);
  if (bytes[0] !== 109 || bytes[1] !== 118 || bytes[2] !== 109 || bytes[3] !== 49)
    throw fail('Invalid Vidy envelope signature');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(4));
}
export const sourceQuality = (value) =>
  text(value).toLowerCase() === '4k'
    ? '2160'
    : (/^(\d{3,4})p?$/.exec(text(value).toLowerCase())?.[1] ?? 'auto');
const critical = (error) =>
  ['cancelled', 'permission_denied', 'auth_session_changed', 'resource_limit'].includes(
    error?.code,
  );
export function createVidy(context) {
  return async (uri) => {
    const p = uri.searchParams,
      id = p.get('tmdbId') ?? '',
      type = p.get('mediaType') ?? 'movie',
      season = p.get('season') ?? '1',
      episode = p.get('episode') ?? '1';
    if (
      !/^[1-9]\d*$/.test(id) ||
      !['movie', 'tv'].includes(type) ||
      (type === 'tv' && (!/^[1-9]\d*$/.test(season) || !/^[1-9]\d*$/.test(episode)))
    )
      throw fail('Invalid Vidy title or episode');
    const origin = p.get('provider') === 'framextv' ? 'https://www.movy.bz' : 'https://www.vidy.st',
      headers = { Origin: origin, Referer: origin + '/' },
      request = async (url, json = false) =>
        (
          await context.http.request({
            method: 'GET',
            url,
            responseType: json ? 'json' : 'text',
            userAgentProfile: 'browser',
            headers,
          })
        ).body;
    const seed = text(
      object(await request('https://api.wecollege.net/seed?mediaId=' + id, true)).seed,
    );
    if (!seed || seed.length > 1024) throw fail('Vidy seed is missing');
    for (const server of ['miami', 'atlanta', 'dallas']) {
      try {
        const url = new URL(`https://api.wecollege.net/${server}/sources`);
        for (const [key, value] of Object.entries({
          mediaType: type,
          tmdbId: id,
          enc: '2',
          seed,
          ...(type === 'tv' ? { seasonId: season, episodeId: episode } : {}),
        }))
          url.searchParams.set(key, value);
        for (const key of ['title', 'year', 'imdbId'])
          if (text(p.get(key))) url.searchParams.set(key, p.get(key));
        const data = object(
            JSON.parse(decodeVidy(text(await request(url.href)), seed, Number(id))),
          ),
          variants = [];
        for (const row of array(data.sources)) {
          const target = text(row.url);
          if (!/^https:\/\//.test(target)) continue;
          const path = new URL(target).pathname,
            quality = sourceQuality(row.quality),
            mime = path.endsWith('.m3u8')
              ? 'application/vnd.apple.mpegurl'
              : path.endsWith('.mp4')
                ? 'video/mp4'
                : '';
          if (!mime) continue;
          if (mime.includes('mpegurl')) {
            try {
              const playlist = text(await request(target));
              if (!playlist.trimStart().startsWith('#EXTM3U')) continue;
              const renditions = hlsVariants(playlist, target, headers);
              variants.push(
                ...(renditions.length > 1
                  ? renditions.filter((variant) => variant.url !== target)
                  : renditions.map((variant) => ({ ...variant, quality }))),
              );
            } catch (error) {
              if (critical(error)) throw error;
            }
          } else variants.push({ url: target, quality, mimeType: mime, headers });
        }
        if (!variants.length) continue;
        return {
          variants: dedupe(variants, (row) => `${row.url}:${row.quality}`),
          subtitleTracks: dedupe(
            array(data.subtitles)
              .filter((v) => /^https:\/\//.test(text(v.url)))
              .map((row) => ({
                id: row.url,
                url: row.url,
                label: first(row.label, row.language, row.lang),
                language: first(row.lang, row.language),
                headers,
              })),
            (row) => row.id,
          ),
        };
      } catch (error) {
        if (critical(error)) throw error;
      }
    }
    throw fail('Vidy returned no native sources', 'stream_unavailable');
  };
}
