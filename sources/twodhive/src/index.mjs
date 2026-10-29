import { text, array, object, first, dedupe, queryUrl } from '../../../sdk/video.mjs';
import { createBabaStream } from './babastream.mjs';
const positive = (value) => /^[1-9]\d*$/.test(text(value));
const absolute = (value, base) => {
  try {
    return value ? new URL(value, base).href : '';
  } catch {
    return '';
  }
};
const cardFields = {
  href: { attr: 'href' },
  link: { selector: 'a[href*="/anime?"]', attr: 'href' },
  title: { selector: 'h2, h3, strong', text: true },
  alt: { selector: 'img', attr: 'alt' },
  image: { selector: 'img', attr: 'src' },
  lazyImage: { selector: 'img', attr: 'data-src' },
  subtitle: { selector: '.card-ep', text: true },
  text: { text: true },
};
const cardsQuery = {
  selector: 'article.lazy-card, a.connection-card',
  all: true,
  fields: cardFields,
};
function cards(rows, base) {
  return dedupe(
    array(rows)
      .map((row) => {
        let id;
        try {
          id = new URL(first(row.href, row.link), base).searchParams.get('anime');
        } catch {
          return null;
        }
        const title = first(row.title, row.alt);
        if (!positive(id) || !title) return null;
        return {
          id: `twodhive-${id}`,
          webUrl: new URL('/anime?anime=' + encodeURIComponent(id), base).href,
          title,
          subtitle: text(row.subtitle),
          overview: '',
          kind: 'anime',
          rating: Number(/★\s*(\d+(?:\.\d+)?)/.exec(text(row.text))?.[1]) || 0,
          posterUrl: absolute(first(row.image, row.lazyImage), base),
          backdropUrl: '',
          isNsfw: false,
        };
      })
      .filter(Boolean),
    (row) => row.id,
  );
}
const optionFilter = (id, title, values, kind = 'singleSelect') => ({
  id,
  title,
  kind,
  options: values,
  isAvailableWithSearchTerm: false,
});
export default function createSource(context) {
  let cachedFilters;
  const get = async (path, params = {}, responseType = 'text') => {
    const config = await context.settings.network();
    const url = queryUrl(
      (config.baseUrl || context.baseUrl).replace(/\/+$/, '') + '/',
      path.replace(/^\//, ''),
      params,
    );
    const response = await context.http.request({
      method: 'GET',
      url,
      responseType,
      userAgentProfile: 'browser',
      headers: { Accept: 'text/html,application/json', Referer: new URL(url).origin + '/' },
    });
    return { body: response.body, url: response.url || url };
  };
  const project = (response, query) =>
    context.html.extract(text(response.body), query, response.url);
  async function getFilters({ refresh = false } = {}) {
    if (!refresh && cachedFilters) return cachedFilters;
    const data = object(
      await project(await get('/', { list: 'latest' }), {
        fields: {
          islands: { selector: 'astro-island[props]', all: true, attr: 'props' },
          genres: { selector: 'a.genre-card[href]', all: true, attr: 'href' },
          format: {
            selector: 'select[name="format"] option[value]',
            all: true,
            fields: { value: { attr: 'value' }, label: { text: true } },
          },
          score: {
            selector: 'select[name="score"] option[value]',
            all: true,
            fields: { value: { attr: 'value' }, label: { text: true } },
          },
          sort: {
            selector: 'select[name="sort"] option[value]',
            all: true,
            fields: { value: { attr: 'value' }, label: { text: true } },
          },
        },
      }),
    );
    const genres = new Map();
    for (const raw of array(data.islands)) {
      if (typeof raw !== 'string' || raw.length > 1000000) continue;
      try {
        const encoded = JSON.parse(raw).genres;
        if (!Array.isArray(encoded) || encoded.length !== 2 || encoded[0] !== 1) continue;
        for (const row of array(encoded[1])) {
          const entry = object(array(row).at(-1)),
            value = text(array(entry.id).at(-1)),
            label = text(array(entry.name).at(-1));
          const count = Number(array(entry.count).at(-1));
          if (positive(value) && label)
            genres.set(value, {
              value,
              label,
              ...(Number.isInteger(count) && count >= 0 ? { count } : {}),
            });
        }
      } catch {
        /* Non-genre islands do not hide valid menu links. */
      }
    }
    for (const href of array(data.genres)) {
      try {
        const url = new URL(href, context.baseUrl),
          value = text(url.searchParams.get('id')),
          label = text(url.searchParams.get('name'));
        if (positive(value) && label && !genres.has(value)) genres.set(value, { value, label });
      } catch {}
    }
    cachedFilters = [
      {
        ...optionFilter('list', 'source_filter.collection', [
          { value: 'latest', label: 'source_filter.sort.new' },
          { value: 'top', label: 'source_filter.sort.top' },
          { value: 'ongoing', label: 'source_filter.status.ongoing' },
        ]),
        defaultValues: ['top'],
      },
      ...(genres.size
        ? [
            {
              ...optionFilter('genre', 'source_filter.genre', [...genres.values()]),
              description: 'source_filter.genre_collection_hint',
            },
          ]
        : []),
      ...['format', 'score', 'sort']
        .filter((key) => array(data[key]).some((row) => text(row.value)))
        .map((key) =>
          optionFilter(
            key,
            key === 'format'
              ? 'source_filter.type'
              : key === 'score'
                ? 'source_filter.score_from'
                : 'source_filter.sort',
            array(data[key])
              .filter((row) => text(row.value))
              .map((row) => ({ value: text(row.value), label: text(row.label) })),
            key === 'sort' ? 'sort' : 'singleSelect',
          ),
        ),
    ];
    return cachedFilters;
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    page = Math.max(1, page);
    const term = text(searchTerm),
      genre = term ? '' : text(selectedFilters.genre?.[0]),
      browsingGenre = positive(genre);
    const params = { page, ...(term ? { q: term } : {}) };
    if (browsingGenre) {
      params.id = genre;
      const name = (await getFilters())
        .find((filter) => filter.id === 'genre')
        ?.options.find((option) => option.value === genre)?.label;
      if (name) params.name = name;
    } else {
      if (!term) params.list = first(selectedFilters.list?.[0], 'top');
      for (const key of ['format', 'score', 'sort'])
        if (text(selectedFilters[key]?.[0])) params[key] = selectedFilters[key][0];
    }
    const response = await get(browsingGenre ? '/genre' : '/', params);
    const data = object(
      await project(response, {
        fields: {
          cards: cardsQuery,
          links: { selector: 'a[href*="page="]', all: true, attr: 'href' },
        },
      }),
    );
    return {
      items: cards(data.cards, response.url),
      hasMore: array(data.links).some((href) => {
        try {
          return Number(new URL(href, response.url).searchParams.get('page')) === page + 1;
        } catch {
          return false;
        }
      }),
    };
  }
  async function loadDetails({ itemId }) {
    const id = /^twodhive-([1-9]\d*)$/.exec(itemId)?.[1];
    if (!id) return null;
    const response = await get('/anime', { anime: id });
    const data = object(
      await project(response, {
        fields: {
          schemas: { selector: 'script[type="application/ld+json"]', all: true, text: true },
          facts: {
            selector: 'dl dt',
            all: true,
            fields: { label: { text: true }, value: { nextSibling: true, text: true } },
          },
          completed: { selector: '[data-ep-chip]', attr: 'data-completed' },
          rating: { selector: '.detail-hero .lucide-star', ascend: 1, text: true },
          cards: cardsQuery,
        },
      }),
    );
    let schema;
    for (const raw of array(data.schemas)) {
      try {
        const value = object(JSON.parse(raw));
        if (['TVSeries', 'Movie'].includes(value['@type'])) {
          schema = value;
          break;
        }
      } catch {}
    }
    if (!text(schema?.name)) return null;
    const facts = Object.fromEntries(
      array(data.facts).map((row) => [text(row.label), text(row.value)]),
    );
    let count = Number(schema.numberOfEpisodes) || (schema['@type'] === 'Movie' ? 1 : 0);
    if (data.completed === 'false')
      count =
        Number(object((await get('/api/anime/episodes', { id }, 'json')).body).episodes) || count;
    count = Math.min(10000, Math.max(0, Math.trunc(count)));
    const year = Number(/\d{4}/.exec(text(schema.datePublished))?.[0]) || null,
      genres = array(schema.genre).map(text).filter(Boolean);
    const metadata = (kind, value) => ({ kind, labelKey: `media.metadata.${kind}`, value });
    return {
      id: itemId,
      webUrl: new URL('/anime?anime=' + encodeURIComponent(id), response.url).href,
      title: text(schema.name),
      originalTitle: text(facts.Japanese),
      subtitle: [year && String(year), facts.Type].filter(Boolean).join(' · '),
      overview: text(await context.html.extract(text(schema.description), { text: true })),
      kind: schema['@type'] === 'Movie' ? 'movie' : 'anime',
      rating: Math.min(
        10,
        Math.max(0, Number(/\d+(?:\.\d+)?/.exec(first(data.rating, facts.Score))?.[0]) || 0),
      ),
      year,
      posterUrl: absolute(text(schema.image), response.url),
      backdropUrl: absolute(text(schema.image), response.url),
      isNsfw: false,
      tags: genres,
      metadata: [
        ...(year ? [metadata('year', String(year))] : []),
        ...['Type', 'Status', 'Studios']
          .filter((key) => facts[key])
          .map((key) =>
            metadata(key === 'Type' ? 'type' : key === 'Status' ? 'status' : 'studio', facts[key]),
          ),
        ...genres.map((genre) => metadata('genre', genre)),
      ],
      playbackGroups: count
        ? ['sub', 'dub'].map((lang) => ({
            id: `twodhive-${lang}`,
            playerId: 'twoDhive',
            playerLabel: 'BabaStream',
            title: lang.toUpperCase(),
            subtitle: 'BabaStream',
            episodes: Array.from({ length: count }, (_, i) => ({
              id: `twodhive-${id}-${i + 1}`,
              title: `episodes.fallback ${i + 1}`,
              number: String(i + 1),
              url: `twodhive://episode/${id}/${i + 1}?lang=${lang}`,
            })),
          }))
        : [],
      relatedItems: cards(data.cards, response.url)
        .filter((row) => row.id !== itemId)
        .slice(0, 24),
    };
  }
  return {
    getFilters,
    search,
    loadDetails,
    getPopular: ({ page = 1 }) => search({ page, selectedFilters: { list: ['top'] } }),
    getLatest: ({ page = 1 }) => search({ page }),
    loadPlaybackGroups: async (args) =>
      args.url ? [] : ((await loadDetails(args))?.playbackGroups ?? []),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
    resolveStream: createBabaStream(context),
  };
}
