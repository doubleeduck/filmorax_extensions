import { text, array, object, fail, dedupe, hlsVariants } from '../../../sdk/video.mjs';
function derive(value, size) {
  let state = 2166136261;
  for (let i = 0; i < value.length; i++)
    state = Math.imul(state ^ value.charCodeAt(i), 16777619) >>> 0;
  let result = '';
  while (result.length < size) {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    result += state.toString(16).padStart(8, '0');
  }
  return result.slice(0, size);
}
function jobs(token, challenge) {
  const { c, s, d } = object(challenge);
  if (
    !token ||
    token.length > 4096 ||
    !Number.isInteger(c) ||
    c < 1 ||
    c > 128 ||
    !Number.isInteger(s) ||
    s < 1 ||
    s > 64 ||
    !Number.isInteger(d) ||
    d < 1 ||
    d > 4
  ) {
    throw fail('Unsupported verification challenge', 'challenge_required');
  }
  return Array.from({ length: c }, (_, i) => ({
    prefix: derive(`${token}${i + 1}`, s),
    targetHex: derive(`${token}${i + 1}d`, d),
  }));
}
const https = (value, base) => {
  try {
    const url = new URL(value, base);
    return value && url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};
export function createBabaStream(context) {
  let verification;
  const pending = new Map();
  const request = async (url, { method = 'GET', body, headers = {}, responseType = 'json' } = {}) =>
    (
      await context.http.request({
        method,
        url,
        responseType,
        headers,
        userAgentProfile: 'browser',
        ...(body == null ? {} : { body }),
      })
    ).body;
  async function resolve(url) {
    const match = /^twodhive:\/\/episode\/([1-9]\d*)\/([1-9]\d*)\?lang=(sub|dub)$/.exec(url);
    if (!match) throw fail('Invalid 2Dhive episode', 'episode_not_found');
    const [, anime, episode, lang] = match,
      embed = `${context.parameters.playerOrigin}/embed/${anime}/${episode}/${lang}`;
    const html = text(
      await request(embed, { responseType: 'text', headers: { Referer: `${context.baseUrl}/` } }),
    );
    if (html.length > 2000000) throw fail('Oversized player configuration', 'resource_limit');
    const raw = /var\s+CFG\s*=\s*(\{[^\r\n]+\})\s*;/.exec(html)?.[1];
    if (!raw) throw fail('Player configuration is missing', 'stream_unavailable');
    const config = object(JSON.parse(raw)),
      key = text(config.pk),
      sid = text(config.sid),
      origin = new URL(embed).origin;
    if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || !sid || sid.length > 256)
      throw fail('Invalid player session');
    const headers = { Origin: origin, Referer: embed };
    async function api(path, payload = {}) {
      const encrypted = await context.crypto.aesGcmEncrypt({
        key,
        plaintext: JSON.stringify({ ...payload, ts: Date.now() }),
      });
      const response = object(
        await request(`${origin}${path}`, {
          method: 'POST',
          headers,
          body: { s: sid, d: encrypted },
        }),
      );
      return object(
        JSON.parse(await context.crypto.aesGcmDecrypt({ key, envelope: text(response.d) })),
      );
    }
    let data = await api('/api/resolve');
    if (data.t === 'error' && data.m === 'verify' && verification) {
      await verification;
      data = await api('/api/resolve');
    }
    if (data.t === 'error' && data.m === 'verify') {
      verification = (async () => {
        const cap = new URL(text(config.cap));
        if (
          cap.origin !== context.parameters.verificationOrigin ||
          cap.username ||
          cap.password ||
          cap.search ||
          cap.hash ||
          !cap.pathname.endsWith('/')
        ) {
          throw fail('Unsupported verification endpoint', 'permission_denied');
        }
        const challenge = object(
          await request(new URL('challenge', cap).href, { method: 'POST', headers }),
        );
        const token = text(challenge.token),
          solutions = await context.crypto.nonceSearch(jobs(token, challenge.challenge));
        const redeemed = object(
          await request(new URL('redeem', cap).href, {
            method: 'POST',
            headers,
            body: { token, solutions },
          }),
        );
        if (redeemed.success !== true || !text(redeemed.token))
          throw fail('Verification failed', 'challenge_required');
        const result = await api('/api/cap-verify', { token: redeemed.token, mode: 'invisible' });
        if (result.t !== 'ok') throw fail('Verification rejected', 'challenge_required');
      })();
      try {
        await verification;
      } finally {
        verification = undefined;
      }
      data = await api('/api/resolve');
    }
    const media = https(text(data.u), embed);
    if (!media || !['direct', 'hls'].includes(data.t))
      throw fail('Provider returned no native media', 'stream_unavailable');
    const variants =
      data.t === 'hls'
        ? hlsVariants(text(await request(media, { responseType: 'text', headers })), media, headers)
        : [{ quality: 'auto', url: media, mimeType: 'video/mp4', headers, isPreferred: true }];
    if (!variants.length) throw fail('Provider HLS is unavailable', 'stream_unavailable');
    return {
      variants,
      subtitleTracks: dedupe(
        [...array(data.tracks), ...array(data.subtitles)]
          .map((track) => ({ track, url: https(text(track.file ?? track.url ?? track.u), embed) }))
          .filter((row) => row.url)
          .map(({ track, url }) => ({
            id: url,
            label: text(track.label),
            url,
            language: text(track.language),
            mimeType: 'text/vtt',
            headers,
            isDefault: track.default === true,
          })),
        (track) => track.id,
      ),
    };
  }
  return ({ url }) => {
    if (!pending.has(url))
      pending.set(
        url,
        resolve(url).finally(() => pending.delete(url)),
      );
    return pending.get(url);
  };
}
