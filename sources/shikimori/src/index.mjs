import { text, array, object, first, dedupe, queryUrl, fail } from '../../../sdk/video.mjs';
import { createCdnVideoHub } from '../../../resolvers/cdnvideohub.mjs';

const api = 'https://plapi.cdnvideohub.com/api/v1/player/sv';
const playerOrigin = 'https://player.cdnvideohub.com';
const positive = (id) => /^[1-9]\d*$/.test(String(id));
const siteUrl = (site, path, params = {}) => {
  const prefix = new URL(site).pathname.replace(/\/+$/, '');
  path = text(path);
  if (prefix && path.startsWith(prefix + '/')) path = path.slice(prefix.length);
  return queryUrl(site.replace(/\/+$/, '') + '/', path.replace(/^\/+/, ''), params);
};
const imageUrl = (site, ...values) => {
  for (const value of values) {
    if (!text(value)) continue;
    try {
      const uri = new URL(text(value), site);
      if (['http:', 'https:'].includes(uri.protocol) && !uri.username && !uri.password)
        return uri.href;
    } catch {
      /* Try the next image supplied by the page. */
    }
  }
  return '';
};
const ratingRange = (from, to) => {
  for (const bound of [from, to])
    if (bound && (!/^\d+(?:\.\d+)?$/.test(bound) || Number(bound) < 1 || Number(bound) > 10))
      throw fail('Rating must be between 1 and 10', 'invalid_argument');
  if ((!from && !to) || (from && to && Number(from) > Number(to)))
    throw fail('Invalid rating range', 'invalid_argument');
  return `${from}-${to}`;
};
const animeId = (value) => {
  try {
    return /(?:^|\/)animes\/[a-z]?([1-9]\d*)(?:-|\/?$)/.exec(
      new URL(text(value), 'https://shikimori.io').pathname,
    )?.[1];
  } catch {
    return '';
  }
};
const filterValues = (filters, id) =>
  array(filters[id])
    .map(text)
    .filter(Boolean)
    .map((value) =>
      value.startsWith('exclude:') ? '!' + value.slice(8) : value.replace(/^include:/, ''),
    );
export function catalogUrl(site, { page = 1, searchTerm = '', selectedFilters = {} } = {}) {
  const parts = ['/animes'];
  for (const id of ['kind', 'status', 'season', 'genre', 'studio']) {
    const values = filterValues(selectedFilters, id);
    if (id === 'genre') values.push(...filterValues(selectedFilters, 'theme'));
    if (values.length) parts.push(id, encodeURIComponent([...new Set(values)].join(',')));
  }
  page = Math.max(1, Math.trunc(Number(page)) || 1);
  if (page > 1) parts.push('page', String(page));
  const params = { order: first(selectedFilters.order?.[0], 'ranked_shiki') };
  for (const id of ['duration', 'rating', 'origin', 'licensor']) {
    const values = filterValues(selectedFilters, id);
    if (values.length) params[id] = values.join(',');
  }
  const from = text(selectedFilters.score_from?.[0]),
    to = text(selectedFilters.score_to?.[0]);
  if (from || to) {
    params.shiki_score = ratingRange(from, to);
  } else if (text(selectedFilters.score?.[0])) {
    const score = text(selectedFilters.score[0]);
    const bounds = /^(\d+(?:\.\d+)?)?-(\d+(?:\.\d+)?)?$/.exec(
      score.includes('-') ? score : score + '-',
    );
    if (!bounds) throw fail('Invalid rating range', 'invalid_argument');
    params.shiki_score = ratingRange(bounds[1] || '', bounds[2] || '');
  }
  if (text(searchTerm)) params.search = text(searchTerm);
  return siteUrl(site, parts.join('/'), params);
}
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
const kindValue = (value) =>
  ({
    'TV Сериал': 'tv',
    Фильм: 'movie',
    OVA: 'ova',
    ONA: 'ona',
    Спецвыпуск: 'special',
    'TV Спецвыпуск': 'tv_special',
    Клип: 'music',
    Проморолик: 'pv',
    Реклама: 'cm',
  })[value] || value;

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
    const image = imageUrl(site, row.poster?.originalUrl, row.image?.original, row.image?.preview);
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
    if (Number(row.episodes) > 0) add('episodes', row.episodes);
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
      posterUrl: image,
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
    const response = await request(siteUrl(site, '/animes'), 'text');
    const data = object(
      await context.html.extract(
        text(response.body),
        {
          fields: {
            order: {
              selector: 'select[data-field="order"] option',
              all: true,
              fields: {
                value: { attr: 'value' },
                label: { text: true },
              },
            },
            defaultOrder: {
              selector: 'select[data-field="order"] option[selected]',
              attr: 'value',
            },
            fields: {
              selector: '.c-ms-field',
              all: true,
              fields: {
                title: { selector: '.c-ms-title', text: true },
                id: { selector: '.c-ms[data-field]', attr: 'data-field' },
                options: {
                  selector: '.c-ms-option',
                  all: true,
                  fields: {
                    value: { attr: 'data-value' },
                    label: { text: true },
                  },
                },
              },
            },
            scores: {
              selector: '.c-score-preset',
              all: true,
              fields: {
                value: { attr: 'data-range' },
                label: { text: true },
              },
            },
          },
        },
        response.url || site,
      ),
    );
    const pairs = (rows) =>
      dedupe(
        array(rows).filter((row) => text(row.value) && text(row.label)),
        (row) => row.value,
      ).map((row) => [text(row.value), text(row.label)]);
    const orders = pairs(data.order);
    if (!orders.length) throw fail('Shikimori catalogue filters were not found');
    const filters = [
      {
        ...select('order', 'Сортировка', orders, 'sort'),
        defaultValues: [first(data.defaultOrder, orders[0][0])],
      },
    ];
    let genre = false;
    for (const field of array(data.fields)) {
      let id = text(field.id);
      if (
        ![
          'status',
          'kind',
          'genre',
          'season',
          'duration',
          'rating',
          'origin',
          'studio',
          'licensor',
        ].includes(id)
      )
        continue;
      if (id === 'genre') {
        if (genre) id = 'theme';
        genre = true;
      }
      const rows = pairs(field.options).filter(
        ([value, label]) => value !== 'rx' && !/hentai|эротика/i.test(label),
      );
      if (rows.length) filters.push(select(id, text(field.title), rows, 'triStateMultiSelect'));
    }
    // Only popular studios are embedded in the HTML; include the searchable inventory too.
    const studio = filters.find((row) => row.id === 'studio');
    if (studio) {
      const inventory = await get('/api/studios', {}, new URL(response.url || site).origin).catch(
        (error) => {
          if (critical(error)) throw error;
          return { body: [] };
        },
      );
      const ids = new Set(studio.options.map((row) => row.value.split('-')[0]));
      for (const row of array(inventory.body)) {
        if (positive(row.id) && text(row.name) && !ids.has(String(row.id))) {
          studio.options.push({ value: String(row.id), label: text(row.name) });
          ids.add(String(row.id));
        }
      }
    }
    const scores = pairs(data.scores);
    if (scores.length) filters.push(select('score', 'Рейтинг', scores));
    for (const [id, title] of [
      ['score_from', 'Рейтинг от'],
      ['score_to', 'Рейтинг до'],
    ])
      filters.push({
        id,
        title,
        kind: 'text',
        placeholder: '1–10',
        isAvailableWithSearchTerm: true,
      });
    filterCache = { site, filters };
    return filters;
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    const site = await base();
    const response = await request(catalogUrl(site, { page, searchTerm, selectedFilters }), 'text');
    const mirror = new URL(site),
      finalUrl = new URL(response.url || site);
    mirror.protocol = finalUrl.protocol;
    mirror.host = finalUrl.host;
    const target = mirror.href.replace(/\/+$/, '');
    const data = object(
      await context.html.extract(
        text(response.body),
        {
          fields: {
            cards: {
              selector: 'article.b-catalog_entry',
              all: true,
              fields: {
                url: { selector: 'a.title', attr: 'href' },
                russian: { selector: '.name-ru', text: true },
                name: { selector: '.name-en', text: true },
                title: { selector: 'a.title', attr: 'title' },
                image: { selector: 'picture img, img', attr: 'src' },
                lazyImage: { selector: 'img[data-src]', attr: 'data-src' },
                poster: { selector: 'meta[itemprop="image"]', attr: 'content' },
                date: { selector: 'meta[itemprop="dateCreated"]', attr: 'content' },
                kind: { selector: '.misc span', text: true },
                score: { selector: '.collection_score', text: true },
              },
            },
            next: { selector: '.pagination a.link-next[href]:not(.disabled)', attr: 'href' },
          },
        },
        response.url || site,
      ),
    );
    const rows = array(data.cards).map((row) => ({
      id: animeId(row.url),
      url: row.url,
      russian: row.russian,
      name: first(row.name, row.title),
      image: { original: imageUrl(response.url || target, row.lazyImage, row.image, row.poster) },
      aired_on: row.date,
      kind: kindValue(row.kind),
      score: /\d+(?:[.,]\d+)?/.exec(text(row.score))?.[0]?.replace(',', '.'),
    }));
    return {
      items: dedupe(rows.map((row) => item(row, target)).filter(Boolean), (row) => row.id),
      hasMore: !!text(data.next),
    };
  }
  async function playbackGroups(entry, site) {
    const watch = await request(
      new URL(new URL(entry.webUrl).pathname.replace(/\/+$/, '') + '/watch', site).href,
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
      if (!/^[\w-]+$/.test(text(row.vkId))) continue;
      const voice = first(row.voiceStudio, 'Original'),
        season = data.isSerial === false ? 1 : Number(row.season ?? 1),
        episode = data.isSerial === false ? 1 : Number(row.episode ?? 1);
      if (!Number.isInteger(season) || !Number.isInteger(episode) || season < 1 || episode < 1)
        continue;
      const key = voice + (text(row.voiceType) ? ` · ${text(row.voiceType)}` : '');
      if (!groups.has(key))
        groups.set(key, {
          id: `shikimori-cdnvh-${encodeURIComponent(key)}`,
          title: key,
          playerId: 'cdnVideoHub',
          playerLabel: 'CDNVideoHub',
          episodes: [],
        });
      groups.get(key).episodes.push({
        id: `shikimori-${tag.title}-${season}-${episode}-${row.vkId}`,
        title: `Серия ${episode}`,
        season: String(season),
        number: String(episode),
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
  async function recommendations(id, site) {
    const response = await get('/api/animes/' + id + '/similar', {}, site);
    return dedupe(
      array(response.body)
        .map((row) => item(row, response.site))
        .filter(Boolean),
      (row) => row.id,
    ).slice(0, 24);
  }
  async function getRecommendations({ itemId } = {}) {
    const id = /^shikimori-([1-9]\d*)$/.exec(itemId)?.[1];
    return id ? recommendations(id) : [];
  }
  async function loadPlaybackGroups({ itemId, url } = {}) {
    const site = await base();
    const id = /^shikimori-([1-9]\d*)$/.exec(itemId)?.[1] || animeId(url);
    if (!id) return [];
    let path = '';
    if (
      animeId(url) === id &&
      /(?:^|\/)animes\/[a-z]?\d+-[^/]+\/?$/.test(new URL(url, site).pathname)
    )
      path = new URL(url, site).pathname;
    else path = text(object((await get('/api/animes/' + id, {}, site)).body).url);
    return path ? playbackGroups({ webUrl: siteUrl(site, path) }, site) : [];
  }
  async function loadDetails({ itemId }) {
    const id = /^shikimori-([1-9]\d*)$/.exec(itemId)?.[1];
    if (!id) return null;
    const response = await get(`/api/animes/${id}`),
      entry = item(response.body, response.site);
    if (!entry) return null;
    const [similar, groups, page] = await Promise.all([
      recommendations(id, response.site).catch((error) => {
        if (critical(error)) throw error;
        return [];
      }),
      playbackGroups(entry, response.site).catch((error) => {
        if (critical(error)) throw error;
        return [];
      }),
      request(entry.webUrl, 'text').catch((error) => {
        if (critical(error)) throw error;
        return null;
      }),
    ]);
    if (page) {
      const artwork = object(
        await context.html.extract(
          text(page.body),
          {
            fields: {
              image: { selector: '.c-poster picture img, .c-image picture img', attr: 'src' },
              meta: { selector: 'meta[property="og:image"]', attr: 'content' },
              score: { selector: '.b-rate .score-value', text: true },
            },
          },
          page.url || entry.webUrl,
        ),
      );
      const image = imageUrl(page.url || entry.webUrl, artwork.image, artwork.meta);
      if (image) entry.posterUrl = image;
      const score = Number(text(artwork.score).replace(',', '.'));
      if (text(artwork.score) && Number.isFinite(score) && score >= 0 && score <= 10)
        entry.rating = score;
    }
    const description = text(response.body.description_html);
    entry.overview = description
      ? text((await context.html.text([description]))[0])
      : text(response.body.description).replace(/\[\/?[^\]]+\]/g, '');
    entry.relatedItems = similar;
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
        // The API runs in the site document, but media requests originate from
        // CDNVideoHub's iframe. OK CDN rejects the catalogue's Origin with 400.
        headers: { ...variant.headers, Origin: playerOrigin, Referer: playerOrigin + '/' },
      })),
    };
  }
  return {
    getFilters,
    search,
    loadDetails,
    loadPlaybackGroups,
    getRecommendations,
    resolveStream,
    getPopular: ({ page = 1 } = {}) => search({ page, selectedFilters: { order: ['popularity'] } }),
    getLatest: ({ page = 1 } = {}) => search({ page, selectedFilters: { order: ['aired_on'] } }),
  };
}
