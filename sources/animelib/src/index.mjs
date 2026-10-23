import { text, array, object, first, dedupe, fail } from '../../../sdk/video.mjs';
import { createKodik, isKodik } from '../../../resolvers/kodik.mjs';
import { createCdnVideoHub, isCdnVideoHub } from '../../../resolvers/cdnvideohub.mjs';
import {
  localized,
  join,
  slug,
  playerName,
  absolute,
  episode,
  item,
  extractItems,
} from './mapper.mjs';
const detailFields = [
  'background',
  'eng_name',
  'otherNames',
  'summary',
  'releaseDate',
  'type_id',
  'caution',
  'views',
  'close_view',
  'rate_avg',
  'rate',
  'genres',
  'tags',
  'teams',
  'user',
  'franchise',
  'authors',
  'publisher',
  'userRating',
  'moderated',
  'metadata',
  'metadata.count',
  'metadata.close_comments',
  'anime_status_id',
  'time',
  'episodes',
  'episodes_count',
  'episodesSchedule',
  'shiki_rate',
];
export default function createSource(context) {
  const kodik = createKodik(context),
    cdn = createCdnVideoHub(context);
  let seed = '';
  async function get(path, params = {}, override = '') {
    const settings = await context.settings.network(),
      base = (override || settings.baseUrl || context.baseUrl).replace(/\/+$/, ''),
      url = new URL((base.endsWith('/api') ? base : base + '/api') + path);
    for (const [key, value] of Object.entries(params))
      for (const part of Array.isArray(value) ? value : [value])
        url.searchParams.append(key, String(part));
    return (
      await context.http.request({
        method: 'GET',
        url: url.href,
        responseType: 'json',
        userAgentProfile: 'browser',
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
          Referer: 'https://animelib.org/',
          Origin: 'https://animelib.org',
          'Site-Id': '5',
          'Client-Time-Zone': 'Europe/Moscow',
        },
      })
    ).body;
  }
  const authorized = async () =>
    Boolean((await context.auth.getSession({ includeAccessToken: true })).accessToken);
  async function soft(operation, fallback) {
    try {
      return await operation();
    } catch (error) {
      if (
        ['cancelled', 'permission_denied', 'auth_session_changed', 'resource_limit'].includes(
          error?.code,
        )
      )
        throw error;
      return fallback;
    }
  }
  async function getFilters() {
    const constants = object(
      (
        await soft(
          () =>
            get('/constants', {
              'fields[]': [
                'genres',
                'tags',
                'types',
                'scanlateStatus',
                'status',
                'format',
                'ageRestriction',
                'ageRestrictionAnime',
              ],
            }),
          {},
        )
      ).data,
    );
    const option = (values) =>
      dedupe(
        array(values)
          .filter((v) => !array(v.site_ids).length || v.site_ids.some((id) => text(id) === '5'))
          .map((v) => ({ value: text(v.id), label: localized(v.name ?? v.title ?? v.label) }))
          .filter((v) => v.value && v.label),
        (v) => v.value,
      );
    return [
      {
        id: 'sort',
        title: 'source_filter.sort',
        kind: 'sort',
        defaultValues: ['rating_score'],
        options: [
          ['rating_score', 'popularity'],
          ['rate_avg', 'rating'],
          ['views', 'views'],
          ['episodes_count', 'episode_count'],
          ['releaseDate', 'release_date'],
          ['last_episode_at', 'update_date'],
          ['created_at', 'created_at'],
          ['name', 'name_latin'],
          ['rus_name', 'name_cyrillic'],
        ].map(([value, key]) => ({ value, label: `source_filter.sort.${key}` })),
      },
      {
        id: 'sort_type',
        title: 'source_filter.direction',
        kind: 'singleSelect',
        defaultValues: ['desc'],
        options: ['desc', 'asc'].map((value) => ({
          value,
          label: `source_filter.direction.${value}`,
        })),
      },
      ...[
        ['types', 'type', constants.types],
        ['status', 'title_status', constants.status],
        [
          'caution',
          'age_rating',
          array(constants.ageRestrictionAnime).length
            ? constants.ageRestrictionAnime
            : constants.ageRestriction,
        ],
        ['genres', 'genres', constants.genres],
        ['tags', 'tags', constants.tags],
      ]
        .map(([id, key, values]) => ({
          id,
          title: `source_filter.${key}`,
          kind: 'multiSelect',
          options: option(values),
        }))
        .filter((v) => v.options.length),
      ...[
        ['episodes_min', 'episodes_from', '12'],
        ['episodes_max', 'episodes_to', '24'],
        ['year_min', 'release_year_from', '2018'],
        ['year_max', 'release_year_to', '2026'],
        ['rate_min', 'score_from', 'score'],
        ['rate_max', 'score_to', 'score'],
        ['rating_min', 'rates_from', '100'],
        ['rating_max', 'rates_to', '10000'],
      ].map(([id, key, hint]) => ({
        id,
        title: `source_filter.${key}`,
        kind: 'text',
        placeholder: `source_filter.placeholder.${hint}`,
      })),
      { id: 'licensed', title: 'source_filter.publisher_content', kind: 'toggle' },
    ];
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    page = Math.max(1, page);
    const filters = selectedFilters,
      params = {
        'fields[]': ['rate', 'rate_avg', 'userBookmark'],
        'site_id[]': ['5'],
        ...(page > 1 ? { page } : {}),
        ...(seed ? { seed } : {}),
        ...(text(searchTerm) ? { q: text(searchTerm) } : {}),
      };
    if (text(filters.sort?.[0])) {
      const [sort, direction] = filters.sort[0].split(':');
      params.sort_by = sort;
      if (direction) params.sort_type = direction;
    }
    if (['asc', 'desc'].includes(filters.sort_type?.[0])) params.sort_type = filters.sort_type[0];
    if (params.sort_by === 'rate_avg' && !text(filters.rate_min?.[0])) params.rate_min = '50';
    for (const key of ['types', 'caution', 'status', 'genres', 'tags'])
      if (array(filters[key]).some(text)) params[`${key}[]`] = filters[key].filter(text);
    for (const key of [
      'episodes_min',
      'episodes_max',
      'year_min',
      'year_max',
      'rating_min',
      'rating_max',
      'rate_min',
      'rate_max',
    ])
      if (text(filters[key]?.[0])) {
        const raw = text(filters[key][0]).replace(',', '.');
        params[key] =
          key.startsWith('rate_') && Number.isFinite(Number(raw))
            ? String(Number(raw) <= 10 ? Number(raw) * 10 : Number(raw))
            : raw;
      }
    if (array(filters.licensed).includes('true')) params.licensed = true;
    const response = await get('/anime', params);
    if (page === 1) seed = text(response?.meta?.seed);
    const items = dedupe(
      extractItems(response)
        .map((v) => item(v))
        .filter(Boolean),
      (v) => v.id,
    ).slice(0, 60);
    return { items, hasMore: items.length >= 60 };
  }
  async function loadDetails({ itemId }) {
    const id = slug(itemId);
    if (!id) return null;
    const data = {
      ...object((await get(`/anime/${encodeURIComponent(id)}`, { 'fields[]': detailFields })).data),
    };
    data.episodes = [];
    for (const lookup of new Set(
      [data.slug_url, data.slug, id, data.id].map(text).filter(Boolean),
    )) {
      const episodes = array((await soft(() => get('/episodes', { anime_id: lookup }), {})).data);
      if (episodes.length) {
        data.episodes = episodes;
        break;
      }
    }
    data.relatedItems = extractItems(
      await soft(() => get(`/anime/${encodeURIComponent(id)}/similar`, { 'site_id[]': ['5'] }), {}),
    );
    return item(data, await authorized());
  }
  async function loadEpisode(id) {
    let last;
    for (const base of [context.baseUrl, 'https://api.cdnlibs.org/api']) {
      try {
        const data = object((await get(`/episodes/${encodeURIComponent(id)}`, {}, base)).data);
        if (Object.keys(data).length) return data;
      } catch (error) {
        if (['permission_denied', 'auth_session_changed', 'cancelled'].includes(error?.code))
          throw error;
        last = error;
      }
    }
    throw last ?? fail('AniLib episode request failed');
  }
  async function loadPlaybackGroups(args) {
    if (!args.url) return (await loadDetails(args))?.playbackGroups ?? [];
    const uri = new URL(args.url);
    if (
      uri.protocol !== 'animelib:' ||
      uri.hostname !== 'episode' ||
      uri.searchParams.has('player_id') ||
      uri.searchParams.has('team')
    )
      return [];
    const row = await loadEpisode(uri.pathname.split('/').at(-1)),
      canUse = await authorized(),
      requested = playerName(uri.searchParams.get('player'));
    return array(row.players)
      .filter((player) => {
        const name = playerName(player.player);
        return (
          (!requested || requested === name) &&
          (name === 'animelib'
            ? canUse
            : isKodik(absolute(player.src)) || isCdnVideoHub(absolute(player.src)))
        );
      })
      .map((player) => {
        const team = object(player.team),
          translation = object(player.translation_type),
          name = playerName(player.player),
          suffix = join([player.id, team.id, translation.id, name]),
          url = new URL(`animelib://episode/${encodeURIComponent(row.id)}`);
        for (const [key, value] of Object.entries({
          player: name,
          player_id: text(player.id),
          team: text(team.id),
          translation_type: text(translation.id),
        }))
          if (value) url.searchParams.set(key, value);
        return {
          id: `animelib-${suffix}`,
          title: first(localized(team.name ?? team.label), player.player, 'Voice'),
          subtitle: join([player.player, localized(translation.label ?? translation.name)]),
          episodes: [episode(row, suffix, url.href)],
        };
      });
  }
  async function resolveStream({ url }) {
    if (isKodik(url)) return kodik(url);
    if (isCdnVideoHub(url)) return cdn(url);
    const uri = new URL(url),
      canUse = await authorized(),
      headers = { Referer: 'https://v3.animelib.org/' };
    if (
      uri.protocol === 'https:' &&
      uri.hostname.endsWith('.cdnlibs.org') &&
      uri.pathname.toLowerCase().includes('/.%d0%b0s/')
    ) {
      if (!canUse) throw fail('AniLib player requires authorization', 'auth_required');
      return {
        variants: [
          {
            url,
            quality: /\d{3,4}/.exec(uri.pathname)?.[0] ?? 'source',
            mimeType: 'video/mp4',
            headers,
          },
        ],
      };
    }
    if (uri.protocol !== 'animelib:' || uri.hostname !== 'episode')
      throw fail('Unsupported AniLib URL');
    const row = await loadEpisode(uri.pathname.split('/').at(-1)),
      requested = playerName(uri.searchParams.get('player')),
      direct = [],
      fallback = [];
    if (requested === 'animelib' && !canUse)
      throw fail('AniLib player requires authorization', 'auth_required');
    for (const player of array(row.players)) {
      const name = playerName(player.player);
      if (requested && requested !== name) continue;
      if (
        [
          ['player_id', player.id],
          ['team', player.team?.id],
          ['translation_type', player.translation_type?.id],
        ].some(
          ([key, value]) =>
            text(uri.searchParams.get(key)) && text(uri.searchParams.get(key)) !== text(value),
        )
      )
        continue;
      if (name === 'animelib' && canUse) {
        for (const quality of array(player.video?.quality))
          if (text(quality.href))
            direct.push({
              url: /^https:\/\//.test(quality.href)
                ? quality.href
                : `https://video1.cdnlibs.org/.%D0%B0s/${quality.href.replace(/^\//, '')}`,
              quality: text(quality.quality) || 'source',
              mimeType: 'video/mp4',
              headers,
            });
      } else if (isKodik(absolute(player.src)) || isCdnVideoHub(absolute(player.src))) {
        const resolved = await soft(
          () =>
            isKodik(absolute(player.src)) ? kodik(absolute(player.src)) : cdn(absolute(player.src)),
          { variants: [] },
        );
        fallback.push(...resolved.variants);
      }
    }
    const variants = dedupe(
      [...direct, ...(requested || !direct.length ? fallback : [])],
      (v) => `${v.quality}:${v.url}`,
    );
    if (!variants.length) throw fail('AniLib episode response has no supported players');
    return { variants };
  }
  return {
    getFilters,
    search,
    loadDetails,
    loadPlaybackGroups,
    resolveStream,
    getPopular: ({ page = 1 }) =>
      search({ page, selectedFilters: { sort: ['rating_score'], sort_type: ['desc'] } }),
    getLatest: ({ page = 1 }) =>
      search({ page, selectedFilters: { sort: ['created_at'], sort_type: ['desc'] } }),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
  };
}
