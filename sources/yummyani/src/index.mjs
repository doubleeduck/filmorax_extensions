import { text, array, object, first, dedupe, queryUrl } from '../../../sdk/video.mjs';
import { createKodik, isKodik } from '../../../resolvers/kodik.mjs';
import { createCdnVideoHub, isCdnVideoHub } from '../../../resolvers/cdnvideohub.mjs';
import { createCollaps, isCollaps } from '../../../resolvers/collaps.mjs';
import { extractItems, item, option, slug } from './mapper.mjs';
const fallbackTypes = [
  { value: 'tv', label: 'TV' },
  { value: 'movie', label: 'source_filter.type.movie' },
  { value: 'ova', label: 'OVA' },
  { value: 'ona', label: 'ONA' },
  { value: 'special', label: 'source_filter.type.special' },
];
export default function createSource(context) {
  const base = context.parameters.siteOrigin,
    studios = new Map(),
    kodik = createKodik(context),
    cdn = createCdnVideoHub(context),
    collaps = createCollaps(context);
  async function get(path, params = {}, referer = `${base}/catalog`) {
    const config = await context.settings.network(),
      raw = (config.baseUrl || context.baseUrl).replace(/\/+$/, '');
    const api = raw.endsWith('/api') ? raw : raw + '/api';
    return (
      await context.http.request({
        method: 'GET',
        url: queryUrl(api + '/', path.replace(/^\//, ''), params),
        responseType: 'json',
        userAgentProfile: 'browser',
        headers: {
          Accept: 'application/json,image/webp,image/avif',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
          Lang: 'ru',
          Vary: 'json',
          Referer: referer,
        },
      })
    ).body;
  }
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
    const [genreData, typeData] = await Promise.all([
      soft(() => get('/anime/genres'), {}),
      soft(() => get('/anime/counts/types'), {}),
    ]);
    const genres = dedupe(
      array(genreData?.response?.genres ?? genreData?.genres)
        .map((row) => option(row, 'genre'))
        .filter(Boolean),
      (row) => row.value,
    );
    const types = dedupe(
      array(typeData?.response?.types ?? typeData?.types)
        .map((row) => option(row, 'type'))
        .filter(Boolean),
      (row) => row.value,
    );
    return [
      {
        id: 'sort',
        title: 'source_filter.sort',
        kind: 'sort',
        defaultValues: ['views:desc'],
        options: [
          ['views:desc', 'watching_now'],
          ['rating:desc', 'rating'],
          ['date_added:desc', 'new'],
          ['year:desc', 'year'],
          ['top:desc', 'top'],
        ].map(([value, key]) => ({ value, label: `source_filter.sort.${key}` })),
      },
      {
        id: 'types',
        title: 'source_filter.type',
        kind: 'multiSelect',
        options: types.length ? types : fallbackTypes,
      },
      ...(genres.length
        ? [{ id: 'genres', title: 'source_filter.genres', kind: 'multiSelect', options: genres }]
        : []),
      {
        id: 'status',
        title: 'source_filter.status',
        kind: 'singleSelect',
        options: [
          ['all', 'source_filter.any'],
          ['ongoing', 'source_filter.status.ongoing'],
          ['released', 'source_filter.status.completed'],
          ['anons', 'source_filter.status.announced'],
        ].map(([value, label]) => ({ value, label })),
      },
      {
        id: 'from_year',
        title: 'source_filter.year_from',
        kind: 'text',
        placeholder: 'source_filter.placeholder.2018',
      },
      {
        id: 'to_year',
        title: 'source_filter.year_to',
        kind: 'text',
        placeholder: 'source_filter.placeholder.2026',
      },
    ];
  }
  function apply(params, filters) {
    if (text(filters.sort?.[0])) {
      const [sort, direction] = filters.sort[0].split(':');
      params.sort = sort;
      if (direction) params.sort_forward = direction === 'asc';
    }
    for (const key of ['types', 'genres']) {
      const values = array(filters[key]).map(text).filter(Boolean);
      if (values.length) params[key] = values.join(',');
    }
    if (text(filters.status?.[0]) && filters.status[0] !== 'all') params.status = filters.status[0];
    for (const key of ['from_year', 'to_year'])
      if (text(filters[key]?.[0])) params[key] = filters[key][0];
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    const filters = selectedFilters,
      term = text(searchTerm),
      studio = text(filters.studio?.[0]),
      director = text(filters.director?.[0]);
    page = Math.max(1, page);
    let rows;
    if (!term && studio) {
      let studioId = /^\d+$/.test(studio) ? studio : studios.get(studio);
      if (!studioId) {
        studioId = text(
          object(
            object(await soft(() => get(`/anime/studio/${encodeURIComponent(studio)}`), {}))
              .response,
          ).id,
        );
        if (studioId) studios.set(studio, studioId);
      }
      if (!studioId) return { items: [], hasMore: false };
      const params = { limit: 24, offset: (page - 1) * 24, studio_ids: studioId };
      apply(params, filters);
      if (!text(filters.sort?.[0])) {
        params.sort = 'top';
        params.sort_forward = true;
      }
      rows = extractItems(
        await get('/anime', params, `${base}/catalog/studio/${encodeURIComponent(studio)}`),
      );
    } else if (!term && director) {
      if (page > 1) return { items: [], hasMore: false };
      const html = text(
        (
          await context.http.request({
            method: 'GET',
            url: `${base}/catalog/director/${encodeURIComponent(director)}`,
            responseType: 'text',
            userAgentProfile: 'browser',
            headers: { Referer: `${base}/catalog` },
          })
        ).body,
      );
      const match =
        /window\.__staticRouterHydrationData\s*=\s*JSON\.parse\("((?:\\.|[^"\\])*)"\)/.exec(html);
      rows = [];
      if (match) {
        try {
          const hydration = object(JSON.parse(JSON.parse('"' + match[1] + '"')));
          for (const loader of Object.values(object(hydration.loaderData)))
            if (array(loader?.animes).length) {
              rows = loader.animes;
              break;
            }
        } catch {}
      }
    } else {
      const params = { limit: 24, offset: (page - 1) * 24, ...(term ? { q: term } : {}) };
      apply(params, filters);
      const hasFilters = Object.values(filters).some((values) =>
        array(values).some((value) => text(value)),
      );
      rows = extractItems(await get(term && !hasFilters ? '/search' : '/anime', params));
    }
    const items = dedupe(rows.map((row) => item(row, base)).filter(Boolean), (row) => row.id);
    return { items, hasMore: !(!term && director) && items.length >= 24 };
  }
  async function loadDetails({ itemId }) {
    const value = slug(itemId.startsWith('yummyani-') ? itemId.slice(9) : itemId);
    if (!value) return null;
    const response = object(
        await get(`/anime/${encodeURIComponent(value)}`, {}, `${base}/catalog/item/${value}`),
      ),
      data = { ...object(response.response) };
    const animeId = text(data.anime_id);
    if (animeId) {
      const [videos, related] = await Promise.all([
        get(`/anime/${encodeURIComponent(animeId)}/videos`, {}, `${base}/catalog/item/${value}`),
        soft(
          () =>
            get(
              `/anime/${encodeURIComponent(animeId)}/recommendations`,
              { limit: 12, offset: 0 },
              `${base}/catalog/item/${value}`,
            ),
          {},
        ),
      ]);
      data.videos = array(videos?.response);
      data.relatedItems = extractItems(related);
    }
    return item(data, base, true);
  }
  return {
    getFilters,
    search,
    loadDetails,
    getPopular: ({ page = 1 }) => search({ page, selectedFilters: { sort: ['views:desc'] } }),
    getLatest: ({ page = 1 }) => search({ page, selectedFilters: { sort: ['date_added:desc'] } }),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
    loadPlaybackGroups: async (args) =>
      args.url
        ? isCollaps(args.url)
          ? collaps.groups(args.url)
          : []
        : ((await loadDetails(args))?.playbackGroups ?? []),
    resolveStream: ({ url }) =>
      isKodik(url) ? kodik(url) : isCdnVideoHub(url) ? cdn(url) : collaps.resolve(url),
  };
}
