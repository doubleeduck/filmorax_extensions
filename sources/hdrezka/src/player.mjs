import {
  text,
  array,
  object,
  first,
  dedupe,
  fail,
  base64Text,
  base64Bytes,
  base64EncodeText,
  hlsVariants,
} from '../../../sdk/video.mjs';
import { literalProperty } from '../../../sdk/literal.mjs';
import { createCollaps, isCollaps } from '../../../resolvers/collaps.mjs';
const trash = [];
for (const a of ['@', '#', '!', '^', '$'])
  for (const b of ['@', '#', '!', '^', '$']) {
    trash.push(base64EncodeText(a + b));
    for (const c of ['@', '#', '!', '^', '$']) trash.push(base64EncodeText(a + b + c));
  }
export function decodePlaylist(value) {
  value = text(value);
  if (!value.startsWith('#h')) return value;
  let payload = value.slice(2).split('//_//').join('');
  for (const code of trash) payload = payload.split(code).join('');
  try {
    return base64Text(payload.slice(2));
  } catch {
    return value;
  }
}
const mediaMime = (url) => {
  const path = new URL(url).pathname.toLowerCase();
  return path.endsWith('.m3u8')
    ? 'application/vnd.apple.mpegurl'
    : path.endsWith('.mpd')
      ? 'application/dash+xml'
      : path.endsWith('.mp4')
        ? 'video/mp4'
        : '';
};
export function playlistVariants(value, headers = {}) {
  value = decodePlaylist(value);
  const matches = [...value.matchAll(/\[[^\]]*?\d{3,4}p?[^\]]*\]/g)],
    variants = [];
  for (let i = 0; i < matches.length; i++) {
    const chunk = value
        .slice(matches[i].index, matches[i + 1]?.index ?? value.length)
        .replace(/,$/, ''),
      match = /^\s*\[[^\]]*?(\d{3,4})p?[^\]]*\](.+)$/s.exec(chunk);
    if (!match) continue;
    for (const raw of match[2].split(/\s+or\s+/i)) {
      try {
        const uri = new URL(raw.trim()),
          mimeType = mediaMime(uri.href);
        if (uri.protocol === 'https:' && mimeType)
          variants.push({ url: uri.href, quality: match[1], mimeType, headers });
      } catch {}
    }
  }
  return dedupe(variants, (v) => `${v.quality}:${v.url}`);
}
export function cinemarMedia(html, embed) {
  const encoded = literalProperty(html, 'file');
  if (typeof encoded !== 'string') return [];
  let best = [],
    score = 0;
  // Current Cinemar #2 envelopes shuffle bounded base64 chunks. Read data,
  // never evaluate the site's PlayerJS or its string-based dispatch function.
  let current;
  if (/^#2\d{2}/.test(encoded)) {
    try {
      const separator = String.fromCharCode(Number(encoded.slice(2, 4)));
      const payload = encoded
        .slice(4)
        .split(separator)
        .map((part) => {
          if (part.length <= 32) return part;
          const count = Number(part.at(-1));
          if (!Number.isInteger(count) || count < 0 || count > 9 || part.length < 3 * count + 1)
            throw fail('Invalid Cinemar envelope');
          return part.slice(2 * count, part.length - count - 1) + part.slice(0, count);
        })
        .join('');
      current = JSON.parse(base64Text(payload));
    } catch {}
  }
  for (let offset = 0; offset <= 24 && offset < encoded.length; offset++) {
    try {
      const decoded = current
          ? ''
          : new TextDecoder().decode(
              base64Bytes(encoded.slice(offset).replace(/[^A-Za-z0-9+/=]/g, '')),
            ),
        start = decoded.indexOf('[{'),
        end = decoded.lastIndexOf('}]');
      if (!current && (start < 0 || end < start)) continue;
      const pending = [current ?? JSON.parse(decoded.slice(start, end + 2))],
        rows = [];
      let count = 0;
      while (pending.length && count++ < 20000) {
        const row = pending.pop();
        if (Array.isArray(row)) {
          pending.push(...row.slice().reverse());
          continue;
        }
        if (!row || typeof row !== 'object') continue;
        if (typeof row.file === 'string' || typeof row.data === 'string') rows.push(row);
        if (Array.isArray(row.folder)) pending.push(...row.folder.slice().reverse());
      }
      if (rows.length > score) {
        score = rows.length;
        best = rows;
      }
      if (current) break;
    } catch {}
  }
  return dedupe(
    best
      .map((row, index) => {
        try {
          const uri = new URL(text(row.file), embed);
          const url = uri.protocol === 'https:' && mediaMime(uri.href) ? uri.href : '';
          const data = text(row.data);
          if (!url && (!data || data.length > 16384 || !text(row.id))) return null;
          const title = text(row.title2),
            full = /(\d+)\s*(?:сезон|season)\D+(\d+)\s*(?:сер|episode)/i.exec(title),
            episode = full?.[2] ?? /(\d+)\s*(?:сер|episode)/i.exec(title)?.[1] ?? String(index + 1),
            season = full?.[1] ?? '1';
          return {
            id: first(row.id, url),
            title: title || `episodes.fallback ${episode}`,
            voice: first(row.title, 'Cinemar'),
            episode,
            season,
            url,
            ...(data ? { data } : {}),
            durationSeconds:
              Number.isInteger(Number(row.duration)) && row.duration != null
                ? Number(row.duration)
                : null,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean),
    (v) => v.id,
  );
}
export const embedSupported = (value) => {
  try {
    const uri = new URL(value);
    return (
      isCollaps(value) ||
      (uri.protocol === 'https:' &&
        (uri.hostname === 'cinemar.cc' || uri.hostname.endsWith('.cinemar.cc')))
    );
  } catch {
    return false;
  }
};
export function cinemarGroups(media, lazy) {
  const voices = new Map();
  for (const row of media) {
    if (!voices.has(row.voice)) voices.set(row.voice, []);
    voices.get(row.voice).push(row);
  }
  return [...voices].map(([voice, rows]) => ({
    id: 'hdrezka-cinemar-' + encodeURIComponent(voice),
    playerId: 'hdrezka',
    playerLabel: 'HDRezka',
    title: voice,
    subtitle: 'Cinemar',
    episodes: rows
      .sort((a, b) => Number(a.season) - Number(b.season) || Number(a.episode) - Number(b.episode))
      .map((row) => {
        const uri = new URL(lazy);
        uri.searchParams.set('media_id', row.id);
        return {
          id: 'hdrezka-cinemar-' + row.id,
          title: row.title,
          number: row.episode,
          season: row.season,
          subtitle: voice,
          url: uri.href,
          durationSeconds: row.durationSeconds,
        };
      }),
  }));
}
export function createPlayer(context) {
  const collaps = createCollaps(context);
  async function embedHtml(uri, referer) {
    return text(
      (
        await context.http.request({
          method: 'GET',
          url: uri.href,
          responseType: 'text',
          userAgentProfile: 'browser',
          headers: { Accept: 'text/html', ...(referer ? { Referer: referer } : {}) },
        })
      ).body,
    );
  }
  function collapsUri(uri) {
    const result = new URL('collaps://embed');
    for (const key of ['url', 'referer', 'season', 'episode'])
      if (uri.searchParams.has(key)) result.searchParams.set(key, uri.searchParams.get(key));
    return result.href;
  }
  async function groups({ url }) {
    const uri = new URL(url);
    if (uri.protocol === 'collaps:') return collaps.groups(url);
    if (uri.protocol !== 'hdrezka:' || uri.hostname !== 'embed' || uri.searchParams.has('media_id'))
      return [];
    const embed = new URL(uri.searchParams.get('url'));
    if (isCollaps(embed.href)) return collaps.groups(collapsUri(uri));
    if (!embedSupported(embed.href)) return [];
    return cinemarGroups(
      cinemarMedia(await embedHtml(embed, uri.searchParams.get('referer')), embed),
      url,
    );
  }
  async function resolve({ url }) {
    const uri = new URL(url);
    if (uri.protocol === 'collaps:') return collaps.resolve(url);
    if (uri.protocol !== 'hdrezka:') throw fail('Unsupported HDRezka URL');
    if (uri.hostname === 'embed') {
      const embed = new URL(uri.searchParams.get('url'));
      if (!embedSupported(embed.href)) throw fail('Unsupported HDRezka embed');
      if (isCollaps(embed.href)) return collaps.resolve(collapsUri(uri));
      const rows = cinemarMedia(await embedHtml(embed, uri.searchParams.get('referer')), embed),
        id = text(uri.searchParams.get('media_id')),
        row = id ? rows.find((v) => v.id === id) : rows[0];
      if (!row) throw fail('HDRezka embed has no supported native file', 'stream_unavailable');
      const headers = { Referer: embed.href, Origin: embed.origin };
      let mediaUrl = row.url;
      if (row.data) {
        const response = object(
          (
            await context.http.request({
              method: 'POST',
              url: new URL('/api/playlist/load', embed).href,
              responseType: 'json',
              userAgentProfile: 'browser',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify(row.data),
            })
          ).body,
        );
        if (response.success === false)
          throw fail('Cinemar rejected this media', 'stream_unavailable');
        mediaUrl = text((response.data ?? response).file);
      }
      let media;
      try {
        media = new URL(mediaUrl, embed);
      } catch {
        throw fail('Invalid Cinemar media', 'stream_unavailable');
      }
      if (!mediaUrl || media.protocol !== 'https:' || !mediaMime(media.href))
        throw fail('Cinemar has no supported native media', 'stream_unavailable');
      let variants = [
        {
          url: media.href,
          quality: /(?:^|[/_.-])(\d{3,4})p?(?:[/_.-]|$)/.exec(media.pathname)?.[1] ?? 'auto',
          mimeType: mediaMime(media.href),
          headers,
          isPreferred: true,
        },
      ];
      if (mediaMime(media.href) === 'application/vnd.apple.mpegurl') {
        try {
          const playlist = text(
            (
              await context.http.request({
                method: 'GET',
                url: media.href,
                responseType: 'text',
                userAgentProfile: 'browser',
                headers,
                timeoutMs: 4000,
              })
            ).body,
          );
          const renditions = hlsVariants(playlist, media.href, headers);
          if (renditions.length > 1) variants = renditions;
        } catch (error) {
          if (error?.code === 'cancelled') throw error;
          // Quality discovery is optional; retain the original native stream.
        }
      }
      return { variants };
    }
    if (uri.hostname !== 'stream') throw fail('Unsupported HDRezka URL');
    const base = first(
        uri.searchParams.get('base'),
        (await context.settings.network()).baseUrl,
        context.baseUrl,
      ).replace(/\/+$/, ''),
      referer = first(uri.searchParams.get('referer'), base + '/'),
      action = first(uri.searchParams.get('action'), 'get_stream'),
      payload = {
        id: first(uri.pathname.split('/').filter(Boolean)[0], uri.searchParams.get('id')),
        translator_id: text(uri.searchParams.get('translator_id')),
        ...(action !== 'get_movie'
          ? {
              season: first(uri.searchParams.get('season'), '1'),
              episode: first(uri.searchParams.get('episode'), '1'),
            }
          : {}),
        favs: text(uri.searchParams.get('favs')),
        action,
      };
    if (!payload.id || !payload.translator_id) throw fail('HDRezka stream identifiers are missing');
    const endpoint = new URL(base + '/ajax/get_cdn_series/');
    endpoint.searchParams.set('t', String(Date.now() - 40000));
    const data = object(
      (
        await context.http.request({
          method: 'POST',
          url: endpoint.href,
          responseType: 'json',
          userAgentProfile: 'browser',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json',
            Referer: referer,
            Origin: base,
          },
          body: new URLSearchParams(payload).toString(),
        })
      ).body,
    );
    if (data.success === false)
      throw fail(first(data.message, 'HDRezka stream is unavailable'), 'stream_unavailable');
    const variants = playlistVariants(data.url, { Referer: referer, Origin: base });
    if (!variants.length)
      throw fail('HDRezka response has no playable files', 'stream_unavailable');
    return { variants };
  }
  return { groups, resolve };
}
