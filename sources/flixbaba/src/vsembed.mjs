import {
  text,
  array,
  object,
  first,
  fail,
  dedupe,
  base64Bytes,
  base64FromBytes,
  hlsVariants,
} from '../../../sdk/video.mjs';
import { parseLiteral } from '../../../sdk/literal.mjs';
function endpoint(base, value) {
  if (!text(value)) throw fail('Provider endpoint is missing');
  const uri = new URL(value, base);
  if (uri.protocol !== 'https:' || uri.username || uri.password)
    throw fail('Invalid provider endpoint');
  return uri;
}
export function wasmKeyCandidates(wasm) {
  if (
    wasm.length > 262144 ||
    wasm.length < 8 ||
    [0, 97, 115, 109, 1, 0, 0, 0].some((v, i) => wasm[i] !== v)
  )
    throw fail('Invalid provider data envelope');
  let position = 8;
  const keys = [],
    read = (limit) => {
      if (position >= limit) throw fail('Truncated provider data');
      return wasm[position++];
    },
    leb = (limit) => {
      let value = 0;
      for (let shift = 0; shift < 35; shift += 7) {
        const byte = read(limit);
        value += (byte & 127) * 2 ** shift;
        if (!(byte & 128)) return value;
      }
      throw fail('Invalid provider integer');
    };
  while (position < wasm.length) {
    const section = read(wasm.length),
      size = leb(wasm.length),
      end = position + size;
    if (end > wasm.length) throw fail('Truncated provider section');
    if (section === 11) {
      const count = leb(end);
      if (count > 128) throw fail('Provider section limit');
      for (let i = 0; i < count; i++) {
        const flags = leb(end);
        if (flags === 2) leb(end);
        if (flags === 0 || flags === 2) {
          if (read(end) !== 0x41) throw fail('Unsupported data expression');
          leb(end);
          if (read(end) !== 0x0b) throw fail('Invalid data expression');
        } else if (flags !== 1) throw fail('Unsupported data segment');
        const length = leb(end);
        if (position + length > end) throw fail('Truncated provider key data');
        if (length === 32 && keys.length < 8) keys.push(wasm.slice(position, position + length));
        position += length;
      }
    }
    position = end;
  }
  const candidates = [...keys];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++)
      candidates.push(Uint8Array.from(keys[i], (v, k) => v ^ keys[j][k]));
  return dedupe(candidates.map(base64FromBytes), (v) => v);
}
export async function decryptUrls(context, encrypted, wasm) {
  if (encrypted.length > 65536) throw fail('Oversized stream envelope');
  const bytes = base64Bytes(encrypted);
  if (bytes.length <= 12) throw fail('Truncated stream envelope');
  const candidates = await context.crypto.chacha20DecryptCandidates({
    keys: wasmKeyCandidates(wasm),
    nonce: base64FromBytes(bytes.slice(0, 12)),
    ciphertext: base64FromBytes(bytes.slice(12)),
  });
  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    const urls = value.split('\n').map(text).filter(Boolean);
    if (
      urls.length &&
      urls.every((v) => {
        try {
          return endpoint('https://vsembed.ru', v).href === v;
        } catch {
          return false;
        }
      })
    )
      return urls;
  }
  throw fail('Unsupported stream encryption envelope');
}
const critical = (error) =>
  ['cancelled', 'permission_denied', 'auth_session_changed', 'resource_limit'].includes(
    error?.code,
  );
export function createVsembed(context) {
  const request = async (uri, { referer = '', origin = '', type = 'text' } = {}) =>
    (
      await context.http.request({
        method: 'GET',
        url: uri.href,
        responseType: type,
        userAgentProfile: 'browser',
        headers: {
          Accept: type === 'json' ? 'application/json' : 'text/html',
          ...(referer ? { Referer: referer } : {}),
          ...(origin ? { Origin: origin } : {}),
        },
      })
    ).body;
  function configuration(html, name) {
    const at = new RegExp('window\\.' + name + '\\s*=\\s*').exec(html);
    if (!at) throw fail('Provider configuration is missing');
    const value = object(parseLiteral(html, at.index + at[0].length));
    if (!Object.keys(value).length) throw fail('Invalid provider configuration');
    return value;
  }
  return async (source) => {
    const p = source.searchParams,
      direct = source.protocol !== 'flixbaba:',
      type = direct
        ? source.pathname.includes('/tv')
          ? 'tv'
          : 'movie'
        : (p.get('mediaType') ?? 'movie'),
      id = direct ? (p.get('tmdb') ?? '') : (p.get('tmdbId') ?? ''),
      season = p.get('season') ?? '1',
      episode = p.get('episode') ?? '1';
    if (
      !/^\d+$/.test(id) ||
      !['movie', 'tv'].includes(type) ||
      (type === 'tv' && (!/^[1-9]\d*$/.test(season) || !/^[1-9]\d*$/.test(episode)))
    )
      throw fail('Invalid VSEmbed title');
    const embed = new URL('https://vsembed.ru/embed/' + type);
    embed.searchParams.set('tmdb', id);
    if (type === 'tv') {
      embed.searchParams.set('season', season);
      embed.searchParams.set('episode', episode);
    }
    const html = text(await request(embed, { referer: 'https://flixbaba.best/' })),
      api = endpoint(
        embed,
        text(await context.html.extract(html, { selector: '#player_iframe', attr: 'data-api' })),
      ),
      configResponse = object(await request(api, { referer: embed.href, type: 'json' })),
      landing = endpoint(embed, configResponse.src),
      landingConfig = configuration(
        text(await request(landing, { referer: embed.origin + '/' })),
        'CFG',
      ),
      player = endpoint(landing, landingConfig.playerUrl),
      config = configuration(text(await request(player, { referer: landing.href })), 'CONFIG'),
      tvApi = type === 'tv' && text(config.streamBase),
      streamApi = endpoint(player, config[tvApi ? 'streamBase' : 'api']);
    if (tvApi) {
      streamApi.searchParams.set('season', season);
      streamApi.searchParams.set('episode', episode);
      streamApi.searchParams.set('stream_urls', '');
    }
    if (text(config.apiToken)) streamApi.searchParams.set('api_token', config.apiToken);
    const payload = object(
        await request(streamApi, {
          referer: player.origin + '/',
          origin: player.origin,
          type: 'json',
        }),
      ),
      raw = payload.data?.stream_urls;
    let urls;
    if (Array.isArray(raw)) urls = raw.filter((v) => typeof v === 'string');
    else if (typeof raw === 'string' && raw) {
      const protection = object(payload.vs),
        inline = text(protection.wasm);
      if (inline.length > 350000) throw fail('Oversized provider configuration');
      const wasm = inline
        ? base64Bytes(inline)
        : Uint8Array.from(
            array(
              await request(endpoint(streamApi, protection.wasm_url), {
                referer: player.origin + '/',
                type: 'bytes',
              }),
            ),
          );
      urls = await decryptUrls(context, raw, wasm);
    } else throw fail('Provider returned no native streams');
    const headers = { Referer: player.origin + '/', Origin: player.origin };
    for (const value of dedupe(urls, (v) => v)) {
      try {
        const uri = endpoint(player, value),
          raw = text(
            await request(new URL('/generate.php', uri), {
              referer: headers.Referer,
              origin: headers.Origin,
            }),
          );
        if (raw.length > 4096) throw fail('Invalid CDN token');
        let token = raw;
        if (/^[{\["]/.test(raw)) {
          const decoded = JSON.parse(raw);
          token =
            typeof decoded === 'string'
              ? decoded
              : first(decoded?.token, decoded?.data, decoded?.string, decoded?.result);
        }
        if (!token || /[<>\s]/.test(token)) throw fail('CDN token is missing');
        const target = uri.href.includes('__TOKEN__')
          ? new URL(uri.href.replaceAll('__TOKEN__', encodeURIComponent(token)))
          : uri;
        if (!uri.href.includes('__TOKEN__')) target.searchParams.set('token', token);
        const playlist = text(
          await request(target, { referer: headers.Referer, origin: headers.Origin }),
        );
        if (!playlist.trimStart().startsWith('#EXTM3U')) continue;
        const renditions = hlsVariants(playlist, target.href, headers),
          variants =
            renditions.length > 1 ? renditions.filter((v) => v.url !== target.href) : renditions;
        if (variants.length) return { variants };
      } catch (error) {
        if (critical(error)) throw error;
      }
    }
    throw fail('Provider CDN has no accessible HLS streams', 'stream_unavailable');
  };
}
