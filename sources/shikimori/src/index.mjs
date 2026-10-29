import { text, array, object, first, dedupe, queryUrl, fail } from '../../../sdk/video.mjs';
import { createCdnVideoHub } from '../../../resolvers/cdnvideohub.mjs';

const api = 'https://plapi.cdnvideohub.com/api/v1/player/sv';
const positive = (id) => /^[1-9]\d*$/.test(String(id));
const siteUrl = (site, path, params = {}) =>
  queryUrl(site.replace(/\/+$/, '') + '/', text(path).replace(/^\/+/, ''), params);
const select = (id, title, options, kind = 'singleSelect') => ({
  id,
  title,
  kind,
  options: options.map(([value, label]) => ({ value, label })),
  isAvailableWithSearchTerm: true,
});
const critical = (error) =>
  ['cancelled', 'permission_denied', 'auth_session_changed', 'resource_limit'].includes(
    error?.code,
  );

export default function createSource(context) {
  let filterCache;
  const base = async () => (await context.settings.network()).baseUrl || context.baseUrl;
  const request = async (url, responseType = 'json', origin = '') => {
    const response = await context.http.request({
      method: 'GET',
      url,
      responseType,
      userAgentProfile: 'browser',
      headers: {
        Accept: responseType === 'json' ? 'application/json' : 'text/html',
        ...(origin ? { Origin: origin, Referer: origin + '/' } : {}),
      },
    });
    return response;
  };
  async function get(path, params = {}, site) {
    site ||= await base();
    const response = await request(siteUrl(site, path, params));
    const target = new URL(site);
    if (response.url) {
      const finalUrl = new URL(response.url);
      target.protocol = finalUrl.protocol;
      target.host = finalUrl.host;
    }
    return { body: response.body, site: target.href.replace(/\/+$/, '') };
  }
  function item(row, site) {
    row = object(row);
    if (!positive(row.id) || !first(row.russian, row.name) || row.rating === 'rx') return null;
    const image = first(row.image?.original, row.image?.preview);
    const metadata = [];
    const add = (kind, value, filterId = '', filterValue = '') => {
      if (text(value))
        metadata.push({
          kind,
          labelKey: `media.metadata.${kind}`,
          value: text(value),
          ...(filterId ? { filterId, filterValue: text(filterValue) } : {}),
        });
    };
    const year = Number(text(row.aired_on).slice(0, 4)) || null;
    if (year) add('year', year, 'season', String(year));
    add('status', row.status, 'status', row.status);
    add('type', row.kind, 'kind', row.kind);
    for (const genre of array(row.genres))
      add('genre', first(genre.russian, genre.name), 'genre', String(genre.id));
    for (const studio of array(row.studios))
      add('studio', studio.name, 'studio', String(studio.id));
    return {
      id: `shikimori-${row.id}`,
      webUrl: siteUrl(site, row.url || `/animes/${row.id}`),
      title: first(row.russian, row.name),
      originalTitle: text(row.name),
      subtitle: [year, row.kind].filter(Boolean).join(' · '),
      overview: '',
      kind: 'anime',
      year,
      rating: Math.min(10, Math.max(0, Number(row.score) || 0)),
      posterUrl: image ? siteUrl(site, image) : '',
      backdropUrl: '',
      isNsfw: false,
      metadata,
      tags: array(row.genres).map((genre) => first(genre.russian, genre.name)),
      playbackGroups: [],
      relatedItems: [],
    };
  }
  async function getFilters({ refresh = false } = {}) {
    const site = await base();
    if (!refresh && filterCache?.site === site) return filterCache.filters;
    const [genres, studios] = await Promise.all([
      get('/api/genres', {}, site),
      get('/api/studios', {}, site),
    ]);
    const filters = [
      select(
        'order',
        'source_filter.sort',
        [
          ['ranked', 'source_filter.sort.top'],
          ['popularity', 'source_filter.sort.popular'],
          ['aired_on', 'source_filter.sort.new'],
          ['name', 'source_filter.sort.name_latin'],
        ],
        'sort',
      ),
      select('kind', 'source_filter.type', [
        ['tv', 'TV'],
        ['movie', 'Movie'],
        ['ova', 'OVA'],
        ['ona', 'ONA'],
        ['special', 'Special'],
        ['tv_special', 'TV Special'],
        ['music', 'Music'],
      ]),
      select('status', 'source_filter.status', [
        ['anons', 'source_filter.status.announced'],
        ['ongoing', 'source_filter.status.ongoing'],
        ['released', 'source_filter.status.completed'],
      ]),
      select(
        'genre',
        'source_filter.genre',
        array(genres.body)
          .filter((row) => !row.entry_type || text(row.entry_type).toLowerCase() === 'anime')
          .filter(
            (row) => positive(row.id) && !/hentai|эротика/i.test(first(row.russian, row.name)),
          )
          .map((row) => [String(row.id), first(row.russian, row.name)]),
        'multiSelect',
      ),
      select(
        'studio',
        'source_filter.studio',
        array(studios.body)
          .filter((row) => positive(row.id) && text(row.name))
          .map((row) => [String(row.id), text(row.name)]),
      ),
      select(
        'season',
        'source_filter.year',
        Array.from({ length: new Date().getFullYear() - 1959 }, (_, i) => {
          const year = String(new Date().getFullYear() + 1 - i);
          return [year, year];
        }),
      ),
      select(
        'score',
        'source_filter.score_from',
        Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)]),
      ),
    ];
    filterCache = { site, filters };
    return filters;
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    page = Math.max(1, Math.trunc(Number(page)) || 1);
    const params = {
      page,
      limit: 20,
      order: first(selectedFilters.order?.[0], 'ranked'),
      censored: true,
    };
    if (text(searchTerm)) params.search = text(searchTerm);
    for (const id of ['kind', 'status', 'genre', 'studio', 'season', 'score']) {
      const values = array(selectedFilters[id]).map(text).filter(Boolean);
      if (values.length) params[id] = values.join(',');
    }
    const response = await get('/api/animes', params);
    const rows = array(response.body);
    return {
      items: dedupe(rows.map((row) => item(row, response.site)).filter(Boolean), (row) => row.id),
      hasMore: rows.length === 20,
    };
  }
  async function playbackGroups(entry, site) {
    const watch = await request(
      new URL(new URL(entry.webUrl).pathname + '/watch', site).href,
      'text',
    );
    const origin = new URL(watch.url || site).origin;
    const tag = object(
      await context.html.extract(
        text(watch.body),
        {
          selector: 'video-player',
          fields: {
            title: { attr: 'data-title-id' },
            publisher: { attr: 'data-publisher-id' },
            aggregator: { attr: 'data-aggregator' },
          },
        },
        watch.url || site,
      ),
    );
    if (!positive(tag.title) || !positive(tag.publisher) || !text(tag.aggregator)) return [];
    const data = object(
      (
        await request(
          queryUrl(api + '/', api + '/playlist', {
            pub: tag.publisher,
            aggr: tag.aggregator,
            id: tag.title,
          }),
          'json',
          origin,
        )
      ).body,
    );
    const groups = new Map();
    for (const row of array(data.items)) {
      if (!text(row.vkId)) continue;
      const voice = first(row.voiceStudio, 'Original'),
        season = Number(row.season) || 1,
        episode = Number(row.episode) || 1;
      if (season < 1 || episode < 1) continue;
      const key = voice;
      if (!groups.has(key))
        groups.set(key, {
          id: `shikimori-cdnvh-${encodeURIComponent(key)}`,
          title: voice,
          playerId: 'cdnVideoHub',
          playerLabel: 'CDNVideoHub',
          episodes: [],
        });
      groups.get(key).episodes.push({
        id: `shikimori-${tag.title}-${season}-${episode}-${row.vkId}`,
        title: `Episode ${episode}`,
        season,
        number: episode,
        url: `${api}/video/${encodeURIComponent(row.vkId)}`,
      });
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        episodes: dedupe(group.episodes, (row) => `${row.season}-${row.number}`).sort(
          (a, b) => a.season - b.season || a.number - b.number,
        ),
      }))
      .sort((a, b) => b.episodes.length - a.episodes.length);
  }
  async function loadDetails({ itemId }) {
    const id = /^shikimori-([1-9]\d*)$/.exec(itemId)?.[1];
    if (!id) return null;
    const response = await get(`/api/animes/${id}`),
      entry = item(response.body, response.site);
    if (!entry) return null;
    const [similar, groups] = await Promise.all([
      get(`/api/animes/${id}/similar`, {}, response.site).catch((error) => {
        if (critical(error)) throw error;
        return { body: [] };
      }),
      playbackGroups(entry, response.site).catch((error) => {
        if (critical(error)) throw error;
        return [];
      }),
    ]);
    const description = text(response.body.description_html);
    entry.overview = description
      ? text((await context.html.text([description]))[0])
      : text(response.body.description).replace(/\[\/?[^\]]+\]/g, '');
    entry.relatedItems = dedupe(
      array(similar.body)
        .map((row) => item(row, response.site))
        .filter(Boolean),
      (row) => row.id,
    ).slice(0, 24);
    entry.playbackGroups = groups;
    return entry;
  }
  async function resolveStream({ url }) {
    const uri = new URL(url);
    if (
      uri.origin !== 'https://plapi.cdnvideohub.com' ||
      !/^\/api\/v1\/player\/sv\/video\/[\w-]+$/.test(uri.pathname)
    )
      throw fail('Unsupported Shikimori player URL');
    const origin = new URL(await base()).origin;
    const result = await createCdnVideoHub(context, origin)(uri.href);
    return {
      ...result,
      variants: result.variants.map((variant) => ({
        ...variant,
        headers: { ...variant.headers, Origin: origin, Referer: origin + '/' },
      })),
    };
  }
  return {
    getFilters,
    search,
    loadDetails,
    resolveStream,
    getPopular: ({ page = 1 } = {}) => search({ page, selectedFilters: { order: ['popularity'] } }),
    getLatest: ({ page = 1 } = {}) => search({ page, selectedFilters: { order: ['aired_on'] } }),
  };
}
