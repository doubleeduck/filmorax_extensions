import { text, array, object, first, dedupe } from '../../../sdk/video.mjs';
const genres = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  27: 'Horror',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
};
export function filters() {
  const year = new Date().getFullYear();
  return [
    {
      id: 'section',
      title: 'source_filter.section',
      kind: 'singleSelect',
      defaultValues: ['movie'],
      options: [
        { value: 'movie', label: 'source_filter.section.films' },
        { value: 'tv', label: 'source_filter.section.tv' },
      ],
    },
    {
      id: 'genre',
      title: 'source_filter.genre',
      kind: 'singleSelect',
      options: Object.entries(genres).map(([value, label]) => ({ value, label })),
    },
    {
      id: 'sort',
      title: 'source_filter.sort',
      kind: 'sort',
      defaultValues: ['popular'],
      options: [
        ['popular', 'source_filter.sort.popular'],
        ['rating', 'source_filter.sort.rating'],
        ['newest', 'source_filter.sort.new'],
        ['oldest', 'Oldest'],
      ].map(([value, label]) => ({ value, label })),
    },
    {
      id: 'year',
      title: 'source_filter.year',
      kind: 'singleSelect',
      options: Array.from({ length: year - 1979 }, (_, index) => ({
        value: String(year - index),
        label: String(year - index),
      })),
    },
  ];
}
const slug = (value) =>
  value
    .trim()
    .toLowerCase()
    .replaceAll('&', 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
export const idParts = (value) => /^(?:flixbaba-)?(movie|tv)-(\d+)/.exec(value);
const providers = [
  ['vidy', 'Vidy'],
  ['vsembed', 'VSEmbed'],
  ['framextv', 'FrameXTV'],
  ['videasy', 'Videasy'],
];
function groups(data, type, title, year) {
  const seasons = array(data.seasons)
      .filter(
        (row) =>
          Number.isInteger(row.season_number) &&
          row.season_number > 0 &&
          Number.isInteger(row.episode_count) &&
          row.episode_count > 0,
      )
      .slice(0, 12),
    episodes = [];
  if (type === 'tv' && seasons.length)
    for (const season of seasons)
      for (let episode = 1; episode <= season.episode_count && episodes.length < 10000; episode++)
        episodes.push({ season: season.season_number, episode });
  else episodes.push({ season: 1, episode: 1 });
  return providers.map(([provider, label]) => ({
    id: 'flixbaba-' + provider,
    playerId: {
      vsembed: 'flixBabaVsembed',
      vidy: 'flixBabaVidy',
      framextv: 'flixBabaFrameXtv',
      videasy: 'flixBabaVideasy',
    }[provider],
    playerLabel: label,
    title: label,
    subtitle: 'FlixBaba',
    episodes: episodes.map((row) => {
      const url = new URL('flixbaba://stream');
      for (const [key, value] of Object.entries({
        provider,
        mediaType: type,
        tmdbId: String(data.id),
        title,
        ...(year ? { year: String(year) } : {}),
        ...(text(data.external_ids?.imdb_id) ? { imdbId: data.external_ids.imdb_id } : {}),
        season: String(row.season),
        episode: String(row.episode),
      }))
        url.searchParams.set(key, value);
      return {
        id: `flixbaba-${provider}-${row.season}-${row.episode}`,
        title: type === 'tv' ? `S${row.season} / E${row.episode}` : 'source_filter.type.movie',
        number: String(row.episode),
        season: String(row.season),
        subtitle: label,
        url: url.href,
      };
    }),
  }));
}
export function item(data, type, details = false) {
  data = object(data);
  const id = Number(data.id),
    tv = type === 'tv',
    title = first(data[tv ? 'name' : 'title'], data[tv ? 'original_name' : 'original_title']);
  if (!Number.isSafeInteger(id) || id < 0 || !title) return null;
  const year =
      Number(/\b(?:19|20)\d{2}\b/.exec(text(data[tv ? 'first_air_date' : 'release_date']))?.[0]) ||
      null,
    rows = (array(data.genres).length ? data.genres : array(data.genre_ids).map((id) => ({ id })))
      .map((row) => ({ id: Number(row.id), name: first(row.name, genres[row.id]) }))
      .filter((row) => Number.isInteger(row.id) && row.name),
    image = (path, width) => (text(path) ? `https://image.tmdb.org/t/p/w${width}${path}` : ''),
    poster = image(data.poster_path, 342),
    runtime =
      Number(data.runtime) > 0
        ? `${data.runtime} min`
        : Number(data.number_of_episodes) > 0
          ? `${data.number_of_episodes} episodes`
          : '',
    metadata = [];
  const add = (kind, value, filterId = '', filterValue = '') => {
    if (text(value))
      metadata.push({
        kind,
        labelKey: `media.metadata.${kind}`,
        value: text(value),
        ...(filterId ? { filterId, filterValue: text(filterValue || value) } : {}),
      });
  };
  if (year) add('year', year, 'year');
  add('status', data.status);
  add(tv ? 'episodes' : 'type', runtime);
  for (const row of rows) add('genre', row.name, 'genre', String(row.id));
  return {
    id: `flixbaba-${type}-${id}-${slug(title)}`,
    title,
    kind: tv ? 'series' : 'movie',
    subtitle: [
      year ? String(year) : '',
      tv ? 'TV' : 'Movie',
      ...rows.slice(0, 2).map((v) => v.name),
    ]
      .filter(Boolean)
      .join(' / '),
    overview: text(data.overview),
    rating: Math.max(0, Math.min(10, Number(data.vote_average) || 0)),
    year,
    posterUrl: poster,
    backdropUrl: image(data.backdrop_path, 780) || poster,
    tags: rows.slice(0, 8).map((v) => v.name),
    metadata,
    playbackGroups: details ? groups(data, type, title, year) : [],
    relatedItems: details
      ? dedupe(
          [...array(data.recommendations?.results), ...array(data.similar?.results)]
            .map((row) => item(row, type))
            .filter(Boolean),
          (v) => v.id,
        ).slice(0, 24)
      : [],
  };
}
