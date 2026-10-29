import { text, array, object, first, dedupe, queryUrl } from '../../../sdk/video.mjs';
const movieGenres = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
};
const tvGenres = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  10762: 'Kids',
  9648: 'Mystery',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
  37: 'Western',
};
const genreOptions = [
  ['16', 'animation'],
  ['35', 'comedy'],
  ['80', 'crime'],
  ['99', 'documentary'],
  ['18', 'drama'],
  ['10751', 'family'],
  ['9648', 'mystery'],
  ['37', 'western'],
];
const select = (id, title, values, defaults = [], search = false) => ({
  id,
  title,
  kind: 'singleSelect',
  defaultValues: defaults,
  isAvailableWithSearchTerm: search,
  options: values.map(([value, label]) => ({ value, label })),
});
const filters = () => [
  select(
    'section',
    'source_filter.section',
    [
      ['all', 'source_filter.section.all'],
      ['movie', 'source_filter.section.films'],
      ['tv', 'source_filter.section.series'],
    ],
    ['movie'],
    true,
  ),
  select(
    'collection',
    'source_filter.collection',
    [
      ['trending', 'source_filter.collection.trending'],
      ['popular', 'source_filter.sort.popular'],
      ['top_rated', 'source_filter.collection.top_rated'],
      ['newest', 'source_filter.sort.new'],
    ],
    ['trending'],
  ),
  select(
    'genre',
    'source_filter.genre',
    genreOptions.map(([id, name]) => [id, `source_filter.genre.${name}`]),
  ),
  {
    ...select('sort', 'source_filter.sort', [
      ['popular', 'source_filter.sort.popular'],
      ['least_popular', 'source_filter.sort.least_popular'],
      ['rating', 'source_filter.sort.rating'],
      ['lowest_rated', 'source_filter.sort.lowest_rated'],
      ['new', 'source_filter.sort.new'],
      ['old', 'source_filter.sort.oldest'],
      ['name_asc', 'source_filter.sort.name_latin'],
      ['name_desc', 'source_filter.sort.name_desc'],
    ]),
    kind: 'sort',
  },
  select(
    'year',
    'source_filter.year',
    Array.from({ length: new Date().getFullYear() - 1899 }, (_, i) => {
      const year = String(new Date().getFullYear() - i);
      return [year, year];
    }),
  ),
  {
    id: 'actor',
    title: 'source_filter.actor',
    kind: 'text',
    placeholder: 'source_filter.actor.placeholder',
    isAvailableWithSearchTerm: true,
  },
  ...['director', 'studio'].map((id) => ({
    id,
    title: `source_filter.${id}`,
    kind: 'text',
    placeholder: `source_filter.${id}.placeholder`,
    isAvailableWithSearchTerm: id === 'director',
  })),
];
const cleanBase = (value) => text(value).replace(/\/+$/, '');
const validMirror = (value) => {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
};
function route(mode, mirror, official, path) {
  if (mode === 'directMirror' && validMirror(mirror)) return `${cleanBase(mirror)}${path}`;
  if (mode === 'lampaProxy' && validMirror(mirror))
    return `${cleanBase(mirror)}/${official}${path}`;
  return `${official}${path}`;
}
function routing(config, params) {
  const options = config.options ?? {},
    legacy = cleanBase(config.baseUrl),
    api = params.apiOrigin,
    image = params.imageOrigin;
  const apiMode = options['tmdb.api_mirror_mode'] ?? (legacy ? 'directMirror' : 'official');
  const imageMode = options['tmdb.image_mirror_mode'] ?? 'publicImageRelay';
  const apiMirror = options['tmdb.api_mirror_url'] ?? legacy,
    imageMirror = options['tmdb.image_mirror_url'] ?? '';
  return {
    api: (path) => route(apiMode, apiMirror, api, path),
    image: (path, width) => {
      path = text(path);
      if (!path) return '';
      if (!path.startsWith('/')) path = `/${path}`;
      const original = `${image}/t/p/w${width}${path}`;
      return imageMode === 'publicImageRelay'
        ? queryUrl(params.imageRelay, '/', { url: original })
        : route(imageMode, imageMirror, image, `/t/p/w${width}${path}`);
    },
  };
}
const names = (rows) => [
  ...new Set(
    array(rows)
      .map((row) => (typeof row === 'string' ? row : first(row?.name, row?.iso_3166_1)))
      .filter(Boolean),
  ),
];
function mapItem(data, type, routes, details = false) {
  const id = Number(data.id);
  if (!Number.isSafeInteger(id) || id < 0 || !['movie', 'tv'].includes(type)) return null;
  const tv = type === 'tv',
    title = first(data[tv ? 'name' : 'title'], data[tv ? 'original_name' : 'original_title']);
  if (!title) return null;
  const original = text(data[tv ? 'original_name' : 'original_title']);
  const year =
    Number(/^\d{4}/.exec(text(data[tv ? 'first_air_date' : 'release_date']))?.[0]) || null;
  const genres = (
    array(data.genres).length ? array(data.genres) : array(data.genre_ids).map((id) => ({ id }))
  )
    .map((row) => ({
      id: Number(row.id),
      name: first(row.name, (tv ? tvGenres : movieGenres)[row.id]),
    }))
    .filter((row) => Number.isInteger(row.id) && row.name);
  const poster = routes.image(data.poster_path, 342),
    backdrop = routes.image(data.backdrop_path, 780) || poster;
  const metadata = (kind, value, filterId, filterValue) => ({
    kind,
    labelKey: `media.metadata.${kind}`,
    value,
    ...(filterId ? { filterId, filterValue: filterValue ?? value } : {}),
  });
  const runtime = tv
    ? [
        Number(data.number_of_seasons) > 0 && `${data.number_of_seasons} seasons`,
        Number(data.number_of_episodes) > 0 && `${data.number_of_episodes} episodes`,
      ]
        .filter(Boolean)
        .join(' / ')
    : Number(data.runtime) > 0
      ? `${data.runtime} min`
      : '';
  return {
    id: `tmdb-${type}-${id}`,
    webUrl: `https://www.themoviedb.org/${type}/${id}`,
    title,
    originalTitle: original === title ? '' : original,
    subtitle: [
      year && String(year),
      tv ? 'TV' : 'Movie',
      ...genres.map((row) => row.name).slice(0, 2),
    ]
      .filter(Boolean)
      .join(' / '),
    overview: text(data.overview),
    kind: tv ? 'series' : 'movie',
    rating: Math.min(10, Math.max(0, Number(data.vote_average) || 0)),
    year,
    posterUrl: poster,
    backdropUrl: backdrop,
    tags: genres.map((row) => row.name).slice(0, 8),
    metadata: details
      ? [
          ...(year ? [metadata('year', String(year), 'year')] : []),
          ...names(
            array(data.production_countries).length
              ? data.production_countries
              : data.origin_country,
          )
            .slice(0, 3)
            .map((name) => metadata('country', name)),
          ...array(data.production_companies)
            .filter((company) => company && text(company.name))
            .slice(0, 3)
            .map((company) =>
              metadata(
                'studio',
                text(company.name),
                company.id > 0 ? 'studio' : '',
                String(company.id),
              ),
            ),
          ...dedupe(
            array(data.credits?.crew).filter(
              (person) => person.job === 'Director' && text(person.name),
            ),
            (person) => person.id,
          )
            .slice(0, 3)
            .map((person) =>
              metadata(
                'director',
                text(person.name),
                person.id > 0 ? 'director' : '',
                String(person.id),
              ),
            ),
          ...(runtime ? [metadata(tv ? 'episodes' : 'type', runtime)] : []),
          ...genres.map((row) => metadata('genre', row.name, 'genre', String(row.id))),
        ]
      : [],
    cast: details
      ? dedupe(
          (array(data.aggregate_credits?.cast).length
            ? data.aggregate_credits.cast
            : array(data.credits?.cast)
          )
            .filter(
              (person) => Number.isSafeInteger(person.id) && person.id > 0 && text(person.name),
            )
            .map((person) => ({
              id: String(person.id),
              name: text(person.name),
              character: first(
                person.character,
                names(array(person.roles).map((role) => role.character)).join(', '),
              ),
              imageUrl: routes.image(person.profile_path, 185),
              catalogFilters: { actor: [String(person.id)], section: ['all'] },
            })),
          (person) => person.id,
        ).slice(0, 300)
      : [],
    playbackGroups: [],
    relatedItems: details
      ? dedupe(
          [...array(data.recommendations?.results), ...array(data.similar?.results)]
            .map((row) => mapItem(object(row), type, routes))
            .filter(Boolean),
          (row) => row.id,
        ).slice(0, 24)
      : [],
  };
}
function catalogueRequest(filters, type) {
  const genre = text(filters.genre?.[0]),
    year = text(filters.year?.[0]),
    studio = text(filters.studio?.[0]),
    sort = text(filters.sort?.[0]),
    collection = text(filters.collection?.[0]).toLowerCase();
  const sortBy = {
    popular: 'popularity.desc',
    least_popular: 'popularity.asc',
    rating: 'vote_average.desc',
    lowest_rated: 'vote_average.asc',
    new: type === 'tv' ? 'first_air_date.desc' : 'primary_release_date.desc',
    old: type === 'tv' ? 'first_air_date.asc' : 'primary_release_date.asc',
    name_asc: type === 'tv' ? 'original_name.asc' : 'original_title.asc',
    name_desc: type === 'tv' ? 'original_name.desc' : 'original_title.desc',
  }[sort];
  if (genre || year || studio || sortBy)
    return {
      path: `/3/discover/${type}`,
      params: {
        include_adult: false,
        include_video: false,
        sort_by:
          sortBy ??
          (collection === 'top_rated'
            ? 'vote_average.desc'
            : collection === 'newest'
              ? type === 'tv'
                ? 'first_air_date.desc'
                : 'primary_release_date.desc'
              : 'popularity.desc'),
        with_genres: genre,
        with_companies: studio,
        [type === 'tv' ? 'first_air_date_year' : 'primary_release_year']: year,
        ...(collection === 'top_rated' || ['rating', 'lowest_rated'].includes(sort)
          ? { 'vote_count.gte': 100 }
          : {}),
      },
    };
  return {
    path:
      collection === 'popular' || collection === 'top_rated'
        ? `/3/${type}/${collection}`
        : collection === 'newest'
          ? type === 'tv'
            ? '/3/tv/on_the_air'
            : '/3/movie/now_playing'
          : `/3/trending/${type}/week`,
    params: {},
  };
}

export default function createSource(context) {
  // Completed responses only: concurrent calls retain independent cancellation.
  const filmographies = new Map(),
    companies = new Map();
  async function configuration() {
    return routing(await context.settings.network(), context.parameters);
  }
  async function credential() {
    const session = await context.auth.getSession({ includeAccessToken: true });
    return text(session.accessToken).replace(/^(?:Bearer\s+)+/i, '');
  }
  async function get(path, params, routes, accessToken) {
    accessToken ??= await credential();
    const headers = { Accept: 'application/json' };
    params = {
      language: context.parameters.language,
      region: context.parameters.region,
      ...params,
    };
    if (!accessToken || /^[a-fA-F0-9]{32}$/.test(accessToken))
      params.api_key = accessToken || context.parameters.defaultApiKey;
    else headers.Authorization = `Bearer ${accessToken}`;
    const url = new URL(routes.api(path));
    for (const [key, value] of Object.entries(params))
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    // Explicit credential errors are not silently retried with the shared key.
    return object(
      (await context.http.request({ method: 'GET', url: url.href, responseType: 'json', headers }))
        .body,
    );
  }
  function order(rows, collection, sort = '') {
    const date = (row) => Date.parse(row.release_date ?? row.first_air_date ?? '') || 0;
    sort ||= collection === 'newest' ? 'new' : collection === 'top_rated' ? 'rating' : 'popular';
    return rows.sort(
      (a, b) =>
        (sort === 'name_asc' || sort === 'name_desc'
          ? text(a.original_title ?? a.original_name ?? a.title ?? a.name).localeCompare(
              text(b.original_title ?? b.original_name ?? b.title ?? b.name),
            ) * (sort === 'name_desc' ? -1 : 1)
          : sort === 'old'
            ? date(a) - date(b)
            : sort === 'new'
              ? date(b) - date(a)
              : sort === 'lowest_rated'
                ? (Number(a.vote_average) || 0) - (Number(b.vote_average) || 0)
                : sort === 'rating'
                  ? (Number(b.vote_average) || 0) - (Number(a.vote_average) || 0)
                  : sort === 'least_popular'
                    ? (Number(a.popularity) || 0) - (Number(b.popularity) || 0)
                    : (Number(b.popularity) || 0) - (Number(a.popularity) || 0)) ||
        `${a.media_type}-${a.id}`.localeCompare(`${b.media_type}-${b.id}`),
    );
  }
  async function cachedCredits(person, routes, accessToken) {
    const path = `/3/person/${person}/combined_credits`;
    const key = JSON.stringify([
      routes.api(path),
      context.parameters.language,
      context.parameters.region,
      accessToken,
    ]);
    const cached = filmographies.get(key);
    if (cached?.expires > Date.now()) return cached.data;
    const data = await get(path, {}, routes, accessToken);
    if (filmographies.size >= 8) filmographies.delete(filmographies.keys().next().value);
    filmographies.set(key, { data, expires: Date.now() + 120_000 });
    return data;
  }
  async function personCatalogue(actor, director, filters, term, page, routes) {
    const valid = (id) => !id || /^[1-9]\d{0,9}$/.test(id);
    const studio = text(filters.studio?.[0]);
    if (![actor, director, studio].every(valid)) return { items: [], hasMore: false };
    const accessToken = await credential();
    const [acting, directing] = await Promise.all([
      actor ? cachedCredits(actor, routes, accessToken) : null,
      director && director !== actor ? cachedCredits(director, routes, accessToken) : null,
    ]);
    const directed = director
      ? array((directing ?? acting)?.crew).filter((row) => row.job === 'Director')
      : null;
    const actingIds =
      actor && director
        ? new Set(array(acting.cast).map((row) => `${row.media_type}-${row.id}`))
        : null;
    const section = text(filters.section?.[0]),
      year = text(filters.year?.[0]),
      genre = text(filters.genre?.[0]);
    const query = term.toLocaleLowerCase();
    const rows = order(
      dedupe(
        (directed ?? array(acting.cast)).filter(
          (row) =>
            row &&
            ['movie', 'tv'].includes(row.media_type) &&
            row.adult !== true &&
            (!actingIds || actingIds.has(`${row.media_type}-${row.id}`)) &&
            (!['movie', 'tv'].includes(section) || row.media_type === section) &&
            (!year || text(row.release_date ?? row.first_air_date).startsWith(`${year}-`)) &&
            (!genre || array(row.genre_ids).some((id) => String(id) === genre)) &&
            (!query ||
              [row.title, row.name, row.original_title, row.original_name].some((name) =>
                text(name).toLocaleLowerCase().includes(query),
              )),
        ),
        (row) => `${row.media_type}-${row.id}`,
      ),
      text(filters.collection?.[0]),
      text(filters.sort?.[0]),
    );
    const start = (page - 1) * 20;
    let matches = rows;
    if (studio) {
      matches = [];
      // Credits don't contain production companies. Inspect only enough titles
      // to fill this page plus one, and retain small company-ID lists for reuse.
      for (let at = 0; at < rows.length && matches.length <= start + 20; at += 4) {
        const batch = await Promise.all(
          rows.slice(at, at + 4).map(async (row) => {
            const path = `/3/${row.media_type}/${row.id}`;
            const key = JSON.stringify([routes.api(path), accessToken]);
            let cached = companies.get(key);
            if (!cached || cached.expires <= Date.now()) {
              const data = await get(path, {}, routes, accessToken);
              cached = {
                ids: array(data.production_companies).map((company) => String(company.id)),
                expires: Date.now() + 120_000,
              };
              if (companies.size >= 2048) companies.delete(companies.keys().next().value);
              companies.set(key, cached);
            }
            return cached.ids.includes(studio) ? row : null;
          }),
        );
        matches.push(...batch.filter(Boolean));
      }
    }
    const items = matches.map((row) => mapItem(row, row.media_type, routes)).filter(Boolean);
    return { items: items.slice(start, start + 20), hasMore: start + 20 < items.length };
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    const section = text(selectedFilters.section?.[0]).toLowerCase();
    const type = section === 'tv' ? 'tv' : 'movie';
    const currentPage = Math.min(500, Math.max(1, Math.trunc(Number(page)) || 1)),
      term = text(searchTerm),
      routes = await configuration();
    const actor = text(selectedFilters.actor?.[0]);
    const director = text(selectedFilters.director?.[0]),
      studio = text(selectedFilters.studio?.[0]);
    if (actor || director)
      return personCatalogue(actor, director, selectedFilters, term, currentPage, routes);
    if (studio && !/^[1-9]\d{0,9}$/.test(studio)) return { items: [], hasMore: false };
    if (section === 'all') {
      const data = term
        ? [
            await get(
              '/3/search/multi',
              { query: term, include_adult: false, page: currentPage },
              routes,
            ),
          ]
        : await Promise.all(
            ['movie', 'tv'].map(async (kind) => {
              const request = catalogueRequest(selectedFilters, kind);
              const response = await get(
                request.path,
                { ...request.params, page: currentPage },
                routes,
              );
              return {
                ...response,
                results: array(response.results).map((row) => ({ ...row, media_type: kind })),
              };
            }),
          );
      return {
        items: dedupe(
          order(
            data
              .flatMap((response) => array(response.results))
              .filter(
                (row) => row && ['movie', 'tv'].includes(row.media_type) && row.adult !== true,
              ),
            text(selectedFilters.collection?.[0]),
            text(selectedFilters.sort?.[0]),
          )
            .map((row) => mapItem(row, row.media_type, routes))
            .filter(Boolean),
          (row) => row.id,
        ),
        hasMore:
          currentPage < 500 && data.some((response) => Number(response.total_pages) > currentPage),
      };
    }
    const request = term
      ? { path: `/3/search/${type}`, params: { query: term, include_adult: false } }
      : catalogueRequest(selectedFilters, type);
    const data = await get(request.path, { ...request.params, page: currentPage }, routes);
    const actualPage = Number(data.page) || currentPage,
      total = Number(data.total_pages) || actualPage;
    return {
      items: array(data.results)
        .map((row) => mapItem(object(row), type, routes))
        .filter(Boolean),
      hasMore: actualPage < total && actualPage < 500,
    };
  }
  async function loadDetails({ itemId }) {
    const match = /^(?:tmdb-)?(movie|tv)-(\d+)$/.exec(itemId);
    if (!match) return null;
    const routes = await configuration();
    return mapItem(
      await get(
        `/3/${match[1]}/${match[2]}`,
        {
          append_to_response: `${match[1] === 'tv' ? 'aggregate_credits,' : ''}credits,recommendations,similar,external_ids,videos`,
          include_image_language: 'ru,en,null',
        },
        routes,
      ),
      match[1],
      routes,
      true,
    );
  }
  return {
    getFilters: filters,
    search,
    loadDetails,
    getPopular: ({ page = 1 }) =>
      search({ page, selectedFilters: { section: ['movie'], collection: ['popular'] } }),
    getLatest: ({ page = 1 }) =>
      search({ page, selectedFilters: { section: ['movie'], collection: ['newest'] } }),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
  };
}
