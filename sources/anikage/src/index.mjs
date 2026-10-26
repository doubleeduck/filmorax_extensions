import {
  text,
  array,
  object,
  first,
  fail,
  dedupe,
  queryUrl,
  hlsVariants,
} from '../../../sdk/video.mjs';
import { tags } from './tags.mjs';

const ranges = ['1-1', '2-12', '13-26', '27-64', '65-'];
const labels = {
  popularity: 'source_filter.sort.popularity',
  score: 'source_filter.sort.rating',
  trending: 'source_filter.collection.trending',
  favourites: 'Favourites',
  year: 'source_filter.sort.year',
  updated: 'source_filter.sort.update_date',
  title: 'source_filter.sort.name_latin',
  sub: 'SUB',
  dub: 'DUB',
  FINISHED: 'source_filter.status.completed',
  RELEASING: 'source_filter.status.ongoing',
  NOT_YET_RELEASED: 'source_filter.status.announced',
  CANCELLED: 'Cancelled',
  HIATUS: 'Hiatus',
  MOVIE: 'source_filter.type.movie',
  SPECIAL: 'source_filter.type.special',
  WINTER: 'Winter',
  SPRING: 'Spring',
  SUMMER: 'Summer',
  FALL: 'Fall',
  JP: 'source_filter.country.japan',
  KR: 'source_filter.country.south_korea',
  CN: 'source_filter.country.china',
  TW: 'source_filter.country.taiwan',
  '1-1': 'source_filter.episode_1',
  '2-12': '2–12',
  '13-26': '13–26',
  '27-64': '27–64',
  '65-': '65+',
};
function select(id, title, values, kind = 'singleSelect') {
  return {
    id,
    title,
    kind,
    defaultValues: kind === 'sort' ? [values[0]] : [],
    options: values.map((value) => ({
      value,
      label:
        id === 'scoreMin'
          ? `${Number(value) / 10}+`
          : id === 'source'
            ? `source_filter.original_source.${value.toLowerCase()}`
            : (labels[value] ?? value),
    })),
  };
}
const filters = () => [
  select(
    'genres',
    'source_filter.genre',
    [
      'Action',
      'Adventure',
      'Comedy',
      'Drama',
      'Ecchi',
      'Fantasy',
      'Horror',
      'Mahou Shoujo',
      'Mecha',
      'Music',
      'Mystery',
      'Psychological',
      'Romance',
      'Sci-Fi',
      'Slice of Life',
      'Sports',
      'Supernatural',
      'Thriller',
    ],
    'multiSelect',
  ),
  select('tags', 'source_filter.tags', tags, 'multiSelect'),
  select(
    'format',
    'source_filter.type',
    ['TV', 'MOVIE', 'TV_SHORT', 'OVA', 'ONA', 'SPECIAL', 'MUSIC'],
    'multiSelect',
  ),
  select('status', 'source_filter.status', [
    'FINISHED',
    'RELEASING',
    'NOT_YET_RELEASED',
    'CANCELLED',
    'HIATUS',
  ]),
  select('season', 'source_filter.season', ['WINTER', 'SPRING', 'SUMMER', 'FALL']),
  select(
    'year',
    'source_filter.year',
    Array.from({ length: new Date().getFullYear() + 2 - 1940 }, (_, i) =>
      String(new Date().getFullYear() + 1 - i),
    ),
  ),
  select('country', 'source_filter.country', ['JP', 'KR', 'CN', 'TW']),
  select('episodes', 'media.episodes', ranges),
  select(
    'source',
    'source_filter.original_source',
    [
      'ORIGINAL',
      'MANGA',
      'LIGHT_NOVEL',
      'WEB_NOVEL',
      'NOVEL',
      'VISUAL_NOVEL',
      'VIDEO_GAME',
      'MULTIMEDIA_PROJECT',
      'OTHER',
    ],
    'multiSelect',
  ),
  select('audio', 'player.voice', ['sub', 'dub']),
  select('scoreMin', 'source_filter.score_from', ['60', '70', '80', '90']),
  select(
    'sort',
    'source_filter.sort',
    ['popularity', 'score', 'trending', 'favourites', 'year', 'updated', 'title'],
    'sort',
  ),
];
const slugOf = (id) => /^anikage-([a-zA-Z0-9]+)$/.exec(id)?.[1];
function groups(slug, info, rows) {
  const episodes = array(rows)
    .filter((row) => Number(row.number) > 0)
    .sort((a, b) => Number(a.number) - Number(b.number));
  return ['sub', 'dub']
    .map((lang) => {
      const count = Number(info[`${lang}Count`] ?? (lang === 'sub' ? episodes.length : 0));
      return {
        id: `anikage-${lang}`,
        playerId: 'anikage',
        playerLabel: 'Anikage',
        title: lang.toUpperCase(),
        subtitle: 'Anikage',
        episodes: dedupe(
          episodes.filter((row) => Number(row.number) <= count),
          (row) => text(row.number),
        ).map((row) => ({
          id: `anikage-${slug}-${text(row.number)}`,
          title: first(row.title, `episodes.fallback ${text(row.number)}`),
          number: text(row.number),
          season: text(row.seasonNumber),
          durationSeconds: Math.max(0, Math.trunc(Number(row.runtime ?? info.duration ?? 0)) * 60),
          url: `anikage://episode/${slug}/${text(row.number)}?lang=${lang}`,
        })),
      };
    })
    .filter((group) => group.episodes.length);
}
function item(data, overview, episodes) {
  const slug = text(data.slug),
    title = first(data.title?.english, data.title?.romaji, data.title?.native);
  if (!/^[a-zA-Z0-9]+$/.test(slug) || !title) return null;
  const genres = array(data.genres).map(text).filter(Boolean),
    format = text(data.format);
  const year =
    Number.isInteger(Number(data.year)) && Number(data.year) >= 1800 ? Number(data.year) : null;
  const relatedItems =
    episodes == null
      ? []
      : dedupe(
          [...array(data.recommendations), ...array(data.relations)]
            .map((row) => item(object(row), '', null))
            .filter((row) => row && row.id !== `anikage-${slug}`),
          (row) => row.id,
        ).slice(0, 24);
  const metadata = (kind, value, filterId) => ({
    kind,
    labelKey: `media.metadata.${kind}`,
    value,
    ...(filterId ? { filterId, filterValue: value } : {}),
  });
  return {
    id: `anikage-${slug}`,
    webUrl: `https://anikage.cc/anime/info/${encodeURIComponent(slug)}`,
    title,
    originalTitle: text(data.title?.romaji),
    subtitle: [year && String(year), format].filter(Boolean).join(' · '),
    overview,
    kind: format === 'MOVIE' ? 'movie' : 'anime',
    rating: Math.min(10, Math.max(0, (Number(data.averageScore) || 0) / 10)),
    year,
    posterUrl:
      typeof data.coverImage === 'string'
        ? data.coverImage
        : first(data.coverImage?.large, data.coverImage?.extraLarge, data.coverImage?.medium),
    backdropUrl: text(data.bannerImage),
    isNsfw: data.isAdult === true || genres.includes('Hentai'),
    tags: genres,
    metadata: [
      ...(year ? [metadata('year', String(year), 'year')] : []),
      ...(format ? [metadata('type', format, 'format')] : []),
      ...genres.map((genre) => metadata('genre', genre, 'genres')),
      ...array(data.studios)
        .filter((s) => s.isAnimationStudio === true && text(s.name))
        .map((s) => metadata('studio', text(s.name))),
    ],
    playbackGroups: episodes == null ? [] : groups(slug, data, episodes),
    relatedItems,
  };
}

export default function createSource(context) {
  const proxy = context.parameters.proxyOrigin;
  const origin = async () =>
    ((await context.settings.network()).baseUrl || context.baseUrl).replace(/\/+$/, '');
  const get = async (path, params = {}) => {
    const base = await origin();
    return (
      await context.http.request({
        method: 'GET',
        url: queryUrl(base + '/', path.replace(/^\//, ''), params),
        responseType: 'json',
        headers: { Referer: new URL(base).origin + '/', Accept: 'application/json' },
        userAgentProfile: 'browser',
      })
    ).body;
  };
  const plain = async (value) =>
    text(value) ? text(await context.html.extract(text(value), { text: true })) : '';
  async function parsed(data, episodes) {
    return item(object(data), await plain(data?.description), episodes);
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    const f = selectedFilters,
      params = {
        sort: first(f.sort?.[0], 'popularity'),
        limit: 24,
        adult: false,
        page: Math.max(1, page),
        q: text(searchTerm),
      };
    for (const key of [
      'genres',
      'tags',
      'format',
      'status',
      'season',
      'scoreMin',
      'source',
      'country',
    ]) {
      const values = array(f[key]).map(text).filter(Boolean);
      if (values.length) params[key] = values.join(',');
    }
    if (/^\d{4}$/.test(f.year?.[0] ?? '')) params.yearMin = params.yearMax = f.year[0];
    if (['sub', 'dub'].includes(f.audio?.[0])) params[f.audio[0]] = true;
    if (ranges.includes(f.episodes?.[0])) {
      const [a, b] = f.episodes[0].split('-');
      params.epMin = a;
      if (b) params.epMax = b;
    }
    const response = object(await get('/api/media/anime/browse', params));
    // Batched HTML stripping keeps a 24-tile catalogue to one parser-isolate call.
    const rows = array(response.data),
      descriptions = rows.map((row) => text(row.description));
    const cleaned = descriptions.some(Boolean) ? await context.html.text(descriptions) : [];
    return {
      items: rows.map((row, i) => item(object(row), text(cleaned[i]), null)).filter(Boolean),
      hasMore: response.hasNext === true,
    };
  }
  async function loadDetails({ itemId }) {
    const slug = slugOf(itemId);
    if (!slug) return null;
    const [response, episodes] = await Promise.all([
      get(`/api/media/anime/${slug}`),
      get(`/api/media/anime/${slug}/episodes`),
    ]);
    return response?.banned === true ? null : parsed(response?.anime, episodes);
  }
  function resource(value, { hls = false } = {}) {
    value = text(value);
    if (/^https:\/\//.test(value)) {
      try {
        const url = new URL(value);
        return url.username || url.password ? null : url.href;
      } catch {
        return null;
      }
    }
    return /^[a-zA-Z0-9_-]{16,16000}$/.test(value)
      ? `${proxy}/${hls ? 'm3u8' : 'stream'}/${value}`
      : null;
  }
  async function resolveStream({ url }) {
    const match =
      /^anikage:\/\/episode\/([a-zA-Z0-9]+)\/([1-9]\d*(?:\.\d+)?)\?lang=(sub|dub)$/.exec(url);
    if (!match) throw fail('Invalid Anikage episode', 'episode_not_found');
    const [, slug, number, lang] = match,
      path = `/api/media/anime/${slug}/episodes/${number}`;
    const available = await get(`${path}/servers`);
    const servers = dedupe(
      array(available?.servers)
        .filter((s) => array(s.subTypes).includes(lang))
        .sort((a, b) => Number(b.default === true) - Number(a.default === true)),
      (s) => text(s.id),
    );
    for (const server of servers) {
      if (!text(server.id)) continue;
      try {
        const data = await get(`${path}/sources`, {
          provider: first(server.providerId, server.id),
          lang,
          server: text(server.id),
        });
        const streamHeaders = { Referer: new URL(await origin()).origin + '/' };
        const variants = [];
        for (const row of dedupe(
          array(data?.sources),
          (row) => `${row.url}|${row.type}|${row.isM3U8}`,
        )) {
          const hls = row.isM3U8 === true || row.type === 'hls',
            media = resource(row.url, { hls });
          if (!media) continue;
          if (hls || new URL(media).pathname.endsWith('.m3u8')) {
            const response = await context.http.request({
              method: 'GET',
              url: media,
              responseType: 'text',
              headers: streamHeaders,
              userAgentProfile: 'browser',
            });
            variants.push(...hlsVariants(text(response.body), media, streamHeaders));
          } else if (row.type === 'mp4' || new URL(media).pathname.endsWith('.mp4')) {
            variants.push({
              quality: /\d{3,4}/.exec(text(row.resolution ?? row.quality))?.[0] ?? 'auto',
              url: media,
              mimeType: 'video/mp4',
              headers: streamHeaders,
            });
          }
        }
        if (!variants.length) continue;
        return {
          variants: dedupe(variants, (v) => `${v.url}|${v.quality}|${v.mimeType}`),
          subtitleTracks: dedupe(
            array(data?.subtitles)
              .map((track) => ({ track, url: resource(track.file) }))
              .filter((row) => row.url)
              .map(({ track, url }) => ({
                id: url,
                label: text(track.label),
                url,
                language: text(track.language),
                mimeType: 'text/vtt',
                headers: streamHeaders,
                isDefault: track.default === true,
              })),
            (s) => s.id,
          ),
        };
      } catch (error) {
        if (
          ['permission_denied', 'cancelled', 'auth_session_changed', 'resource_limit'].includes(
            error?.code,
          )
        )
          throw error;
        // Another server is allowed only for this exact episode/language.
      }
    }
    throw fail('Anikage returned no accessible native streams', 'stream_unavailable');
  }
  return {
    getFilters: filters,
    getPopular: ({ page = 1 }) => search({ page }),
    getLatest: ({ page = 1 }) => search({ page, selectedFilters: { sort: ['updated'] } }),
    search,
    loadDetails,
    loadPlaybackGroups: async (args) =>
      args.url ? [] : ((await loadDetails(args))?.playbackGroups ?? []),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
    resolveStream,
  };
}
