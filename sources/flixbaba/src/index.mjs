import { text, array, object, first, dedupe, fail } from '../../../sdk/video.mjs';
import { filters, idParts, item } from './mapper.mjs';
import { createVidy } from './vidy.mjs';
import { createVsembed } from './vsembed.mjs';
export default function createSource(context) {
  const vidy = createVidy(context),
    vsembed = createVsembed(context);
  async function get(path, params = {}) {
    const config = await context.settings.network();
    const site = config.baseUrl || context.baseUrl;
    const api = text(config.options?.['flixbaba.api_url']) || context.parameters.apiOrigin;
    const url = new URL(api.replace(/\/+$/, '') + path);
    for (const [key, value] of Object.entries({ api_key: context.parameters.apiKey, ...params }))
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    return object(
      (
        await context.http.request({
          method: 'GET',
          url: url.href,
          responseType: 'json',
          userAgentProfile: 'browser',
          headers: {
            Accept: 'application/json',
            'Accept-Language': 'en-US,en;q=0.9,ru;q=0.7',
            Referer: site.replace(/\/+$/, '') + '/',
            Origin: new URL(site).origin,
          },
        })
      ).body,
    );
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    const f = selectedFilters,
      type = f.section?.[0] === 'tv' ? 'tv' : 'movie',
      term = text(searchTerm);
    page = Math.max(1, Math.min(500, page));
    const sort =
        {
          rating: 'vote_average.desc',
          newest: type === 'tv' ? 'first_air_date.desc' : 'primary_release_date.desc',
          oldest: type === 'tv' ? 'first_air_date.asc' : 'primary_release_date.asc',
        }[f.sort?.[0]] || 'popularity.desc',
      params = term
        ? { query: term, page, include_adult: false }
        : {
            page,
            include_adult: false,
            include_video: false,
            with_original_language: 'en',
            sort_by: sort,
            ...(text(f.genre?.[0]) ? { with_genres: f.genre[0] } : {}),
            ...(text(f.year?.[0])
              ? { [type === 'tv' ? 'first_air_date_year' : 'primary_release_year']: f.year[0] }
              : {}),
            ...(f.sort?.[0] === 'rating' ? { 'vote_count.gte': 100 } : {}),
          };
    const data = await get(`/3/${term ? 'search' : 'discover'}/${type}`, params),
      items = dedupe(
        array(data.results)
          .map((row) => item(row, type))
          .filter(Boolean),
        (v) => v.id,
      ).slice(0, 24);
    return { items, hasMore: page < Math.min(500, Number(data.total_pages) || page) };
  }
  async function loadDetails({ itemId }) {
    const match = idParts(itemId);
    if (!match) return null;
    return item(
      await get(`/3/${match[1]}/${match[2]}`, {
        append_to_response: 'images,videos,credits,recommendations,similar,external_ids',
      }),
      match[1],
      true,
    );
  }
  async function videasy(uri) {
    const p = uri.searchParams,
      parts = uri.pathname.split('/').filter(Boolean),
      type = p.get('mediaType') === 'tv' || parts[0] === 'tv' ? 'tv' : 'movie',
      id = first(p.get('tmdbId'), parts[1]),
      title = text(p.get('title')),
      year = text(p.get('year'));
    if (!id || !title || !year) throw fail('Videasy requires title, year and TMDB ID');
    const compound = parts[2]?.split('-') ?? [],
      season = first(p.get('season'), compound[1], parts[2], '1'),
      episode = first(p.get('episode'), parts[3], compound[2], '1'),
      url = new URL('https://api.videasy.net/mb-flix/sources-with-title'),
      headers = { Origin: 'https://player.videasy.net', Referer: 'https://player.videasy.net/' };
    for (const [key, value] of Object.entries({
      title,
      mediaType: type,
      year,
      episodeId: episode,
      seasonId: season,
      tmdbId: id,
      ...(text(p.get('imdbId')) ? { imdbId: p.get('imdbId') } : {}),
    }))
      url.searchParams.set(key, value);
    const encrypted = text(
      (
        await context.http.request({
          method: 'GET',
          url: url.href,
          responseType: 'text',
          userAgentProfile: 'browser',
          headers,
        })
      ).body,
    );
    if (!encrypted) throw fail('Videasy returned an empty response');
    // Compatibility with the pre-migration provider: ciphertext only is sent
    // to this explicitly declared decoder service; never app credentials.
    const decoded = object(
      (
        await context.http.request({
          method: 'POST',
          url: 'https://enc-dec.app/api/dec-videasy',
          responseType: 'json',
          userAgentProfile: 'browser',
          headers: { 'Content-Type': 'application/json' },
          body: { text: encrypted, id },
        })
      ).body,
    );
    if (String(decoded.status) !== '200')
      throw fail('Videasy decoder service failed', 'stream_unavailable');
    const result = object(decoded.result),
      variants = [];
    for (const row of array(result.sources)) {
      if (!/^https:\/\//.test(text(row.url))) continue;
      const path = new URL(row.url).pathname.toLowerCase(),
        mime = path.endsWith('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : path.endsWith('.mp4')
            ? 'video/mp4'
            : '';
      if (mime)
        variants.push({
          url: row.url,
          quality: text(row.quality).toLowerCase().replaceAll('p', '') || 'auto',
          mimeType: mime,
          headers: { Referer: headers.Referer },
        });
    }
    if (!variants.length) throw fail('Videasy has no native files', 'stream_unavailable');
    const preferred = [360, 480, 720].find((q) => variants.some((v) => Number(v.quality) === q));
    const subtitles = dedupe(
      [...array(result.subtitles), ...array(result.tracks), ...array(result.captions)]
        .map((row) => {
          const file = first(row.url, row.file);
          if (!file) return null;
          const uri = new URL(file, 'https://player.videasy.net/');
          return uri.protocol === 'https:'
            ? {
                id: uri.href,
                url: uri.href,
                label: first(row.label, row.lang),
                language: first(row.language, row.srclang, row.lang),
                mimeType: uri.pathname.endsWith('.srt') ? 'application/x-subrip' : 'text/vtt',
                headers: { Referer: headers.Referer },
                isDefault: row.default === true,
              }
            : null;
        })
        .filter(Boolean),
      (v) => v.id,
    );
    return {
      variants: dedupe(variants, (v) => `${v.quality}:${v.url}`).map((v) => ({
        ...v,
        isPreferred: preferred != null && Number(v.quality) === preferred,
      })),
      subtitleTracks: subtitles,
    };
  }
  async function resolveStream({ url }) {
    const uri = new URL(url),
      provider =
        uri.hostname === 'vsembed.ru'
          ? 'vsembed'
          : uri.hostname === 'player.videasy.net'
            ? 'videasy'
            : text(uri.searchParams.get('provider')).toLowerCase();
    if (uri.protocol !== 'flixbaba:' && uri.protocol !== 'https:')
      throw fail('Unsupported FlixBaba URL');
    if (provider === 'vsembed') return vsembed(uri);
    if (provider === 'vidy' || provider === 'framextv') return vidy(uri);
    if (provider === 'videasy') return videasy(uri);
    throw fail('Unsupported FlixBaba provider');
  }
  return {
    getFilters: filters,
    search,
    loadDetails,
    resolveStream,
    getPopular: ({ page = 1 }) =>
      search({ page, selectedFilters: { section: ['movie'], sort: ['popular'] } }),
    getLatest: ({ page = 1 }) =>
      search({ page, selectedFilters: { section: ['movie'], sort: ['newest'] } }),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
    loadPlaybackGroups: async (args) =>
      args.url ? [] : ((await loadDetails(args))?.playbackGroups ?? []),
  };
}
