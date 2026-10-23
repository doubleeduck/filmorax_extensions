import { text, array, object, first, dedupe, fail } from '../../../sdk/video.mjs';
import { createCollaps, isCollaps } from '../../../resolvers/collaps.mjs';
export const titlePath = (value) => {
  try {
    const path = new URL(value, 'https://go3.kinogo.cc').pathname;
    return /^\/\d+-[^/]+\.html$/.test(path) ? path.slice(1, -5) : '';
  } catch {
    return '';
  }
};
export const catalogPath = (value) => {
  try {
    const path = new URL(value, 'https://go3.kinogo.cc').pathname;
    return /^\/(?:filmy|serialy|multfilmy|multserialy|anime-multfilmy|anime-serialy|tv-shou)(?:\/[a-z0-9_-]+)?\/$|^\/collection-[a-z0-9_-]+\/$/.test(
      path,
    )
      ? path
      : '';
  } catch {
    return '';
  }
};
const title = (value) =>
  text(value)
    .replace(/\s+/g, ' ')
    .replace(/^(?:Фильм|Сериал|Аниме|Мультфильм)\s+/i, '')
    .replace(/\s+смотреть онлайн.*$/i, '')
    .replace(/\s+\d+\s+сезон.*$/i, '')
    .trim();
const kind = (value) =>
  /аниме/i.test(value) ? 'anime' : /сериал/i.test(value) ? 'series' : 'movie';
const year = (value) => Number(/\b(?:19|20)\d{2}\b/.exec(value)?.[0]) || null;
const rating = (value) => Number(/\d+(?:[.,]\d+)?/.exec(text(value))?.[0].replace(',', '.')) || 0;
const imageProjection = { fields: { lazy: { attr: 'data-src' }, src: { attr: 'src' } } };
const image = (value, base) => {
  const raw = first(value?.lazy, value?.src);
  return raw && !raw.startsWith('data:') ? new URL(raw, base).href : '';
};
const tags = (value) => text(value).split('/').map(text).filter(Boolean);
const field = (html, label) =>
  new RegExp(`<b>\\s*${label}\\s*:\\s*</b>(.*?)(?:<br\\s*/?>|</div>)`, 'is').exec(html)?.[1] ?? '';
export default function createSource(context) {
  const collaps = createCollaps(context);
  let cachedFilters;
  const origin = async () =>
    ((await context.settings.network()).baseUrl || context.baseUrl).replace(/\/+$/, '');
  async function get(url, params) {
    const result = text(
      (
        await context.http.request({
          method: params ? 'POST' : 'GET',
          url,
          responseType: 'text',
          userAgentProfile: 'browser',
          headers: {
            Accept: 'text/html',
            Referer: (await origin()) + '/',
            ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          },
          ...(params ? { body: new URLSearchParams(params).toString() } : {}),
        })
      ).body,
    );
    if (result.includes('cf-chl-') || result.includes('Just a moment...'))
      throw fail('Kinogo requires browser authorization', 'auth_required');
    return result;
  }
  async function getFilters({ refresh = false } = {}) {
    if (cachedFilters && !refresh) return cachedFilters;
    const base = await origin(),
      html = await get(base + '/'),
      anchors = array(
        await context.html.extract(html, {
          selector: 'a[href]',
          all: true,
          fields: { url: { attr: 'href' }, name: { text: true } },
        }),
      );
    const options = new Map([
      ['', 'Все'],
      ['/filmy/', 'Фильмы'],
      ['/serialy/', 'Сериалы'],
      ['/multfilmy/', 'Мультфильмы'],
      ['/multserialy/', 'Мультсериалы'],
      ['/anime-multfilmy/', 'Аниме'],
      ['/anime-serialy/', 'Аниме-сериалы'],
      ['/collection-marvel/', 'Marvel'],
    ]);
    for (const anchor of anchors) {
      const path = catalogPath(anchor.url);
      if (path && text(anchor.name) && !options.has(path)) options.set(path, text(anchor.name));
    }
    return (cachedFilters = [
      {
        id: 'path',
        title: 'Раздел, жанр, год или подборка',
        kind: 'singleSelect',
        isAvailableWithSearchTerm: false,
        options: [...options].map(([value, label]) => ({ value, label })),
      },
    ]);
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    const base = await origin(),
      path = catalogPath(selectedFilters.path?.[0]),
      term = text(searchTerm);
    page = Math.max(1, page);
    const html = await get(
      term ? base + '/' : `${base}${path || '/'}${page > 1 ? `page/${page}/` : ''}`,
      term
        ? {
            do: 'search',
            subaction: 'search',
            story: term,
            titleonly: '3',
            search_start: String(page),
            full_search: '0',
          }
        : null,
    );
    const data = object(
      await context.html.extract(html, {
        fields: {
          cards: {
            selector: '.shortstory',
            all: true,
            fields: {
              url: { selector: 'h2 a', attr: 'href' },
              title: { selector: 'h2 a', text: true },
              image: { selector: '.poster img, img', ...imageProjection },
              html: { html: true },
              rating: { selector: '.kps, .imdbs', text: true },
            },
          },
          next: {
            selector: '.navigation a, .nav_ext a',
            all: true,
            fields: { url: { attr: 'href' }, name: { text: true } },
          },
        },
      }),
    );
    const cards = array(data.cards).filter((row) => titlePath(row.url) && title(row.title)),
      fields = [];
    for (const row of cards)
      fields.push(
        field(row.html, 'Жанр'),
        field(row.html, 'Качество'),
        field(row.html, 'Год выпуска'),
      );
    const values = [];
    for (let i = 0; i < fields.length; i += 200)
      values.push(...(await context.html.text(fields.slice(i, i + 200))));
    const items = dedupe(
      cards.map((row, index) => {
        const [genre, quality, released] = values.slice(index * 3, index * 3 + 3),
          poster = image(row.image, base),
          name = title(row.title);
        return {
          id: 'kinogo-' + encodeURIComponent(titlePath(row.url)),
          webUrl: new URL('/' + titlePath(row.url) + '.html', base).href,
          title: name,
          subtitle: quality,
          kind: kind(genre),
          rating: rating(row.rating),
          year: year(released || name),
          posterUrl: poster,
          backdropUrl: poster,
          tags: tags(genre),
          isNsfw: /эротик/i.test(genre),
        };
      }),
      (row) => row.id,
    );
    const hasMore =
      array(data.next).some(
        (link) => new RegExp(`/page/${page + 1}/`).test(link.url) || Number(link.name) === page + 1,
      ) || items.length >= 20;
    return { items, hasMore };
  }
  async function loadDetails({ itemId }) {
    if (!itemId.startsWith('kinogo-')) return null;
    const path = titlePath('/' + decodeURIComponent(itemId.slice(7)) + '.html');
    if (!path) return null;
    const base = await origin(),
      referer = `${base}/${path}.html`,
      html = await get(referer),
      data = object(
        await context.html.extract(html, {
          fields: {
            title: { selector: 'h1 font, h1', text: true },
            full: {
              selector: '.fullstory, body',
              fields: {
                html: { html: true },
                image: { selector: '.poster img, img[itemprop="image"]', ...imageProjection },
                genre: { selector: '[itemprop="genre"]', text: true },
                original: { selector: '[title="Оригинальное название"]', text: true },
                description: { selector: 'div[itemprop="description"]', text: true },
                country: { selector: '[itemprop="contributor"]', text: true },
                director: { selector: '[itemprop="director"]', text: true },
                year: { selector: '[itemprop="copyrightYear"]', text: true },
                rating: { selector: '.kps, .imdbs', text: true },
                genres: {
                  selector: '[itemprop="genre"] a',
                  all: true,
                  fields: { name: { text: true }, url: { attr: 'href' } },
                },
              },
            },
            players: {
              selector: '.hikinogo_section iframe, .tabs__content iframe',
              all: true,
              fields: { lazy: { attr: 'data-src' }, src: { attr: 'src' } },
            },
            related: {
              selector: '.relatednews a',
              all: true,
              fields: {
                url: { attr: 'href' },
                name: { attr: 'title' },
                text: { text: true },
                alt: { selector: 'img', attr: 'alt' },
                image: { selector: 'img', ...imageProjection },
              },
            },
          },
        }),
      );
    const full = object(data.full),
      name = title(data.title);
    if (!name) return null;
    const fields = await context.html.text([
        field(full.html, 'Категория'),
        field(full.html, 'Качество'),
      ]),
      genre = first(full.genre, fields[0]),
      poster = image(full.image, base),
      groups = [];
    for (const player of dedupe(array(data.players), (v) => first(v.lazy, v.src))) {
      const raw = first(player.lazy, player.src);
      if (!raw) continue;
      const uri = new URL(raw, base);
      if (!isCollaps(uri.href)) continue;
      const url = new URL('collaps://embed');
      url.searchParams.set('url', uri.href);
      url.searchParams.set('referer', referer);
      try {
        const loaded = await collaps.groups(url.href);
        if (loaded.length) {
          groups.push(...loaded);
          continue;
        }
      } catch (error) {
        if (['cancelled', 'permission_denied', 'auth_session_changed'].includes(error?.code))
          throw error;
      }
      groups.push({
        id: `kinogo-player-${groups.length}`,
        playerId: 'collaps',
        playerLabel: 'Collaps',
        title: 'Collaps',
        subtitle: 'player.lazy_load_subtitle',
        episodes: [
          {
            id: `${itemId}-player-${groups.length}`,
            title: 'action.watch',
            number: '',
            url: url.href,
          },
        ],
      });
    }
    const metadata = [];
    for (const key of ['country', 'director', 'year'])
      if (text(full[key]))
        metadata.push({ kind: key, labelKey: `media.metadata.${key}`, value: text(full[key]) });
    for (const row of array(full.genres)) {
      const path = catalogPath(row.url);
      if (path && text(row.name))
        metadata.push({
          kind: 'genre',
          labelKey: 'media.metadata.genre',
          value: text(row.name),
          filterId: 'path',
          filterValue: path,
        });
    }
    const relatedItems = dedupe(
      array(data.related)
        .map((row) => {
          const path = titlePath(row.url),
            name = title(first(row.name, row.alt, row.text));
          if (!path || !name) return null;
          const poster = image(row.image, base);
          return {
            id: 'kinogo-' + encodeURIComponent(path),
            webUrl: new URL('/' + path + '.html', base).href,
            title: name,
            kind: kind(name),
            year: year(name),
            posterUrl: poster,
            backdropUrl: poster,
          };
        })
        .filter((row) => row && row.id !== itemId),
      (row) => row.id,
    ).slice(0, 48);
    return {
      id: itemId,
      webUrl: referer,
      title: name,
      originalTitle: text(full.original),
      subtitle: fields[1],
      overview: text(full.description),
      kind: kind(genre),
      rating: rating(full.rating),
      year: year(first(full.year, name)),
      posterUrl: poster,
      backdropUrl: poster,
      tags: tags(genre),
      metadata,
      isNsfw: /эротик/i.test(genre),
      playbackGroups: dedupe(groups, (g) => g.id),
      relatedItems,
    };
  }
  return {
    getFilters,
    search,
    getPopular: ({ page = 1 }) => search({ page }),
    getLatest: ({ page = 1 }) => search({ page }),
    loadDetails,
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
    loadPlaybackGroups: async (args) =>
      args.url ? collaps.groups(args.url) : ((await loadDetails(args))?.playbackGroups ?? []),
    resolveStream: ({ url }) => collaps.resolve(url),
  };
}
