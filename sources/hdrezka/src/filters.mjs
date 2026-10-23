import { text, array } from '../../../sdk/video.mjs';
export const section = (value) =>
  ({
    serialy: 'serialy',
    series: 'serialy',
    multfilmy: 'multfilmy',
    cartoons: 'multfilmy',
    anime: 'anime',
    animation: 'anime',
  })[text(value).toLowerCase()] || 'filmy';
export function menuRows(rows) {
  return rows
    .map((row) => {
      let path;
      try {
        path = new URL(row.url, 'https://hdrezka.inc').pathname;
      } catch {
        return null;
      }
      const match = /^\/(filmy|serialy|multfilmy|anime)\/([a-z-]+)\/$/.exec(path);
      return match && text(row.name)
        ? {
            section: match[1],
            genre: match[2].replace(/^(?:serialy|serial|multfilmy|anime)-/, ''),
            path,
            label: text(row.name),
          }
        : null;
    })
    .filter(Boolean);
}
export function buildFilters(menu) {
  const genres = new Map();
  for (const row of menu) if (!genres.has(row.genre)) genres.set(row.genre, row.label);
  return [
    {
      id: 'section',
      title: 'source_filter.section',
      kind: 'singleSelect',
      defaultValues: ['filmy'],
      isAvailableWithSearchTerm: false,
      options: [
        ['filmy', 'films'],
        ['serialy', 'series'],
        ['multfilmy', 'cartoons'],
        ['anime', 'anime'],
      ].map(([value, key]) => ({ value, label: `source_filter.section.${key}` })),
    },
    {
      id: 'genre',
      title: 'source_filter.genre',
      kind: 'singleSelect',
      isAvailableWithSearchTerm: false,
      options: genres.size
        ? [...genres].map(([value, label]) => ({ value, label }))
        : [
            ['boevik', 'action'],
            ['komedija', 'comedy'],
            ['drama', 'drama'],
            ['mjuzikl', 'musical'],
            ['prikljuchenija', 'adventure'],
          ].map(([value, key]) => ({ value, label: `source_filter.hdrezka.films_${key}` })),
    },
    {
      id: 'sort',
      title: 'source_filter.sort',
      kind: 'sort',
      defaultValues: ['date'],
      isAvailableWithSearchTerm: false,
      options: [
        ['date', 'source_filter.sort.new'],
        ['top', 'Горячее'],
        ['best', 'Лучшее'],
        ['commented', 'Обсуждаемое'],
        ['popular', 'source_filter.sort.popular'],
      ].map(([value, label]) => ({ value, label })),
    },
  ];
}
const legacyPaths = {
  'films/action': 'filmy/boevik',
  'films/comedies': 'filmy/komedija',
  'films/drama': 'filmy/drama',
  'films/fantasy': '',
  'series/drama': 'filmy/drama',
  'series/comedies': 'filmy/komedija',
  'series/fantasy': '',
  'cartoons/adventures': 'filmy/prikljuchenija',
  'cartoons/comedies': 'filmy/komedija',
  'animation/adventures': 'filmy/prikljuchenija',
  'animation/fiction': 'filmy/fantastika',
  'animation/drama': 'filmy/drama',
};
export function catalogPath(filters, page, menu) {
  const direct = text(filters.path?.[0]);
  if (direct) {
    const uri = new URL(direct, 'https://hdrezka.inc'),
      path = uri.pathname;
    return path.replace(/\/?$/, '/') + (page > 1 ? `page/${page}/` : '');
  }
  const selected = section(filters.section?.[0]),
    raw = text(filters.genre?.[0])
      .toLowerCase()
      .replace(/^\/+|\/+$/g, ''),
    normalized = Object.hasOwn(legacyPaths, raw) ? legacyPaths[raw] : raw,
    slug = normalized
      .split('/')
      .at(-1)
      .replace(/^(?:serialy|serial|multfilmy|anime)-/, '');
  const genre = /^[a-z][a-z-]*$/.test(slug)
    ? menu.find((row) => row.section === selected && row.genre === slug)?.path ||
      `/${selected}/${selected === 'filmy' ? '' : selected + '-'}${slug}/`
    : '';
  return (genre || `/${selected}/`) + (page > 1 ? `page/${page}/` : '');
}
export function sortForm(filters) {
  const value = text(filters.sort?.[0]),
    sort = value === 'last' ? 'date' : value;
  return ['date', 'top', 'best', 'popular', 'commented'].includes(sort) ? { sortix: sort } : null;
}
