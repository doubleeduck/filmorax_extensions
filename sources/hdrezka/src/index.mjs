import { text, array, object, first, dedupe } from '../../../sdk/video.mjs';
import { menuRows, buildFilters, catalogPath, sortForm, section } from './filters.mjs';
import { createPlayer, embedSupported } from './player.mjs';
import { isCollaps } from '../../../resolvers/collaps.mjs';
export function titlePath(value) {
  if (!text(value)) return '';
  try {
    const path = new URL(value, 'https://hdrezka.inc').pathname
      .replace(/^\/+/, '')
      .replace(/\.html$/, '');
    return /^(?:filmy|serialy|multfilmy|anime|films|series|cartoons|animation)\/[A-Za-z0-9_/-]+$/.test(
      path,
    ) && !path.includes('..')
      ? path
      : '';
  } catch {
    return '';
  }
}
const kind = (path) =>
  /^(serialy|series)\//i.test(path)
    ? 'series'
    : /^(anime|multfilmy|animation|cartoons)\//i.test(path)
      ? 'anime'
      : 'movie';
const year = (value) => Number(/\b(?:19|20)\d{2}\b/.exec(text(value))?.[0]) || null;
const rating = (value) =>
  Math.max(
    0,
    Math.min(10, Number(/\d+(?:[.,]\d+)?/.exec(text(value))?.[0].replace(',', '.')) || 0),
  );
const subtitleTags = (value) =>
  text(value)
    .split(/[,/|]/)
    .map(text)
    .filter((v) => v.length > 2 && !/^\d+$/.test(v))
    .slice(0, 6);
const imageFields = {
  fields: { lazy: { attr: 'data-src' }, src: { attr: 'src' }, alt: { attr: 'alt' } },
};
const cardFields = {
  url: { attr: 'data-url' },
  link: { attr: 'data-link' },
  nestedLink: { selector: '[data-link]', attr: 'data-link' },
  anchor: { selector: 'a[href]', attr: 'href' },
  title: { selector: '.b-content__inline_item-link a, .postTitle a', text: true },
  image: { selector: 'img', ...imageFields },
  subtitle: { selector: 'span[class*="info"],span[class*="misc"]', text: true },
  rating: { selector: 'i.entity, span[class*="rating"]', text: true },
};
const cardSelector = '.postItem, .relatedItem, .b-content__inline_item';
const absolute = (value, base) => (text(value) ? new URL(value, base).href : '');
function card(row, base) {
  const path = titlePath(first(row.url, row.link, row.nestedLink, row.anchor)),
    title = first(row.title, row.image?.alt);
  if (!path || !title) return null;
  const poster = absolute(first(row.image?.lazy, row.image?.src), base),
    subtitle = text(row.subtitle);
  return {
    id: 'hdrezka-' + encodeURIComponent(path),
    webUrl: new URL('/' + path + '.html', base).href,
    title,
    kind: kind(path),
    subtitle,
    rating: rating(row.rating),
    year: year(title + ' ' + subtitle),
    posterUrl: poster,
    backdropUrl: poster,
    tags: subtitleTags(subtitle),
  };
}
const critical = (error) =>
  ['cancelled', 'permission_denied', 'auth_session_changed', 'resource_limit'].includes(
    error?.code,
  );
export default function createSource(context) {
  let menu = [],
    filters;
  const player = createPlayer(context),
    origin = async () =>
      ((await context.settings.network()).baseUrl || context.baseUrl).replace(/\/+$/, '');
  async function get(path, { params = {}, body, referer } = {}) {
    const base = await origin(),
      url = new URL(base + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await context.http.request({
      method: body ? 'POST' : 'GET',
      url: url.href,
      responseType: 'text',
      userAgentProfile: 'browser',
      headers: {
        Accept: 'text/html',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        Origin: new URL(base).origin,
        Referer: referer || base + '/',
        ...(body
          ? {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
            }
          : {}),
      },
      ...(body ? { body: new URLSearchParams(body).toString() } : {}),
    });
    return { base: response.url || url.href, html: text(response.body) };
  }
  async function getFilters({ refresh = false } = {}) {
    if (filters && !refresh) return filters;
    const { html } = await get('/');
    menu = menuRows(
      array(
        await context.html.extract(html, {
          selector: 'a[href]',
          all: true,
          fields: { url: { attr: 'href' }, name: { text: true } },
        }),
      ),
    );
    return (filters = buildFilters(menu));
  }
  async function search({ page = 1, searchTerm = '', selectedFilters = {} } = {}) {
    page = Math.max(1, page);
    const term = text(searchTerm),
      f = selectedFilters,
      path = term ? '/search/' : catalogPath(f, page, menu),
      { base, html } = await get(
        path,
        term
          ? { params: { do: 'search', subaction: 'search', q: term, search_start: String(page) } }
          : { body: sortForm(f) },
      ),
      data = object(
        await context.html.extract(html, {
          fields: {
            primary: {
              selector: '#dle-content',
              fields: { cards: { selector: cardSelector, all: true, fields: cardFields } },
            },
            all: { selector: cardSelector, all: true, fields: cardFields },
            next: {
              selector: '.navigation a, .pagination a, .pagiNation a',
              all: true,
              fields: { label: { text: true }, url: { attr: 'href' } },
            },
          },
        }),
      );
    const items = dedupe(
      (data.primary ? array(data.primary.cards) : array(data.all))
        .map((row) => card(row, base))
        .filter(
          (v) =>
            v &&
            (term ||
              text(f.path?.[0]) ||
              titlePath('/' + decodeURIComponent(v.id.slice(8))).startsWith(
                section(f.section?.[0]) + '/',
              )),
        ),
      (v) => v.id,
    ).slice(0, 32);
    return {
      items,
      hasMore:
        array(data.next).some(
          (v) => Number(v.label) === page + 1 || new RegExp(`/page/${page + 1}/`).test(v.url),
        ) || items.length >= 32,
    };
  }
  async function loadDetails({ itemId }) {
    const path = titlePath(
      '/' + decodeURIComponent(itemId.startsWith('hdrezka-') ? itemId.slice(8) : itemId),
    );
    if (!path) return null;
    const configuredBase = await origin(),
      { html, base } = await get('/' + path + '.html', {
        referer: `${configuredBase}/${section(path.split('/')[0])}/`,
      }),
      referer = base,
      data = object(
        await context.html.extract(html, {
          fields: {
            title: { selector: '.b-post__title h1, h1', text: true },
            description: { selector: '.b-post__description_text, .postText', text: true },
            rating: { selector: '.b-post__rating,.ratingScore', text: true },
            json: {
              selector: 'script[type="application/ld+json"]',
              all: true,
              text: true,
              normalizeWhitespace: false,
            },
            image: { selector: '.posterBlock img,img[data-caption-title]', ...imageFields },
            info: {
              selector: 'table.b-post__info tr,table.post__info tr',
              all: true,
              fields: {
                label: { selector: 'td:first-child', text: true },
                cell: {
                  selector: 'td:first-child',
                  nextSibling: true,
                  fields: {
                    value: { text: true },
                    links: {
                      selector: 'a',
                      all: true,
                      fields: { name: { text: true }, url: { attr: 'href' } },
                    },
                  },
                },
              },
            },
            favs: { selector: 'input#ctrl_favs', attr: 'value' },
            translators: {
              selector: 'li.b-translator__item',
              all: true,
              fields: {
                id: { attr: 'data-translator_id' },
                title: { attr: 'title' },
                name: { text: true },
              },
            },
            episodes: {
              selector: 'li.b-simple_episode__item, span.b-simple_episode__item',
              all: true,
              fields: {
                id: { attr: 'data-id' },
                season: { attr: 'data-season_id' },
                episode: { attr: 'data-episode_id' },
                title: { text: true },
              },
            },
            embeds: {
              selector: 'li[data-src]',
              all: true,
              fields: { url: { attr: 'data-src' }, title: { text: true } },
            },
            iframe: {
              selector: 'iframe',
              fields: { lazy: { attr: 'data-src' }, src: { attr: 'src' } },
            },
            related: {
              selector:
                '.b-sidelist__holder .postItem,.b-sidelist__holder .relatedItem,.b-sidelist__holder .b-content__inline_item,.relatedPosts .postItem,.relatedPosts .relatedItem,.relatedPosts .b-content__inline_item',
              all: true,
              fields: cardFields,
            },
          },
        }),
      );
    const title = text(data.title);
    if (!title) return null;
    const info = array(data.info).map((row) => ({ label: row.label, ...object(row.cell) })),
      metadata = [];
    function add(kind, value, url = '') {
      value = text(value);
      if (!value) return;
      let path = '';
      try {
        if (url) path = new URL(url, base).pathname;
      } catch {}
      metadata.push({
        kind,
        labelKey: `media.metadata.${kind}`,
        value,
        ...(path ? { filterId: 'path', filterValue: path } : {}),
      });
    }
    for (const row of info) {
      const label = text(row.label).toLowerCase();
      if (label.includes('дата выхода')) {
        const released = year(row.value);
        if (released) add('year', released, array(row.links).find((v) => year(v.name))?.url);
        continue;
      }
      const type = label.includes('страна')
        ? 'country'
        : /режисс[её]р/.test(label)
          ? 'director'
          : label.includes('жанр')
            ? 'genre'
            : label.includes('в качестве')
              ? 'quality'
              : label.includes('в переводе')
                ? 'translation'
                : label.includes('из серии')
                  ? 'tag'
                  : '';
      if (!type) continue;
      if (['quality', 'translation'].includes(type)) add(type, row.value);
      else if (array(row.links).length)
        for (const link of row.links) add(type, link.name, link.url);
      else if (type === 'country')
        for (const value of text(row.value).split(/[,/]/)) add(type, value);
    }
    let structured = '';
    for (const raw of array(data.json)) {
      try {
        const decoded = JSON.parse(raw),
          pending = [decoded];
        let count = 0;
        while (pending.length && !structured && count++ < 256) {
          const row = pending.pop();
          if (Array.isArray(row)) {
            pending.push(...row);
            continue;
          }
          if (!row || typeof row !== 'object') continue;
          structured =
            typeof row.image === 'string'
              ? row.image
              : first(row.image?.url, row.image?.contentUrl);
          pending.push(...array(row['@graph']));
        }
      } catch {}
      if (structured) break;
    }
    const poster = absolute(first(structured, data.image?.src, data.image?.lazy), base),
      released = year(title + ' ' + info.map((v) => v.value).join(' ')),
      tags = dedupe(
        [
          ...info.flatMap((v) => array(v.links).map((link) => text(link.name))),
          ...subtitleTags(info.map((v) => v.value).join(' ')),
        ].filter(Boolean),
        (v) => v,
      ).slice(0, 10),
      ids = /initCDN(?:Series|Movies)Events\(\s*(\d+)\s*,\s*(\d+)/i.exec(html),
      contentId = ids?.[1] ?? '',
      translationId = ids?.[2] ?? '',
      groups = [];
    const episodes = array(data.episodes).filter((v) => first(v.id, contentId) && text(v.episode)),
      rows = episodes.length
        ? episodes
        : [{ id: contentId, season: '', episode: '', title: 'player.movie' }];
    if (contentId || episodes.length)
      for (const translator of array(data.translators).filter((v) => text(v.id)).length
        ? data.translators.filter((v) => text(v.id))
        : [{ id: translationId, title: 'HDRezka' }]) {
        const id = first(translator.id, 'default'),
          voice = first(translator.title, translator.name, 'HDRezka');
        groups.push({
          id: 'hdrezka-' + id,
          playerId: 'hdrezka',
          playerLabel: 'HDRezka',
          title: 'HDRezka',
          subtitle: voice,
          episodes: dedupe(
            rows.map((row) => {
              const url = new URL(
                'hdrezka://stream/' + encodeURIComponent(first(row.id, contentId)),
              );
              for (const [key, value] of Object.entries({
                base,
                translator_id: first(translator.id, translationId),
                season: text(row.season),
                episode: text(row.episode),
                favs: text(data.favs),
                action: episodes.length ? 'get_stream' : 'get_movie',
                referer,
              }))
                if (value || key === 'favs') url.searchParams.set(key, value);
              return {
                id: `hdrezka-${id}-${first(row.season, '0')}-${first(row.episode, '0')}`,
                title: first(row.title, `episodes.fallback ${first(row.episode, '1')}`),
                number: first(row.episode, '1'),
                season: text(row.season),
                subtitle: voice,
                url: url.href,
              };
            }),
            (v) => v.id,
          ),
        });
      }
    let embeds = dedupe(
      array(data.embeds).filter((v) => embedSupported(v.url)),
      (v) => v.url,
    );
    if (!embeds.length) {
      const url = first(data.iframe?.lazy, data.iframe?.src);
      if (embedSupported(url)) embeds = [{ url, title: 'HDRezka' }];
    }
    const hydrated = await Promise.all(
      embeds.map(async (row, index) => {
        const uri = new URL('hdrezka://embed');
        uri.searchParams.set('url', row.url);
        uri.searchParams.set('referer', referer);
        const fallback = {
          id: `hdrezka-embed-${index}`,
          playerId: 'hdrezka',
          playerLabel: 'HDRezka',
          title: 'HDRezka',
          subtitle: first(row.title, 'HDRezka'),
          episodes: [
            {
              id: `hdrezka-embed-${index}-video`,
              title: 'player.movie',
              number: '1',
              subtitle: first(row.title, 'HDRezka'),
              url: uri.href,
            },
          ],
        };
        try {
          const loaded = await player.groups({ url: uri.href });
          return {
            groups: loaded.length ? loaded : isCollaps(row.url) ? [fallback] : [],
            unresolved: false,
          };
        } catch (error) {
          if (critical(error)) throw error;
          return { groups: [fallback], unresolved: true };
        }
      }),
    );
    groups.push(
      ...hydrated.filter((v) => !v.unresolved).flatMap((v) => v.groups),
      ...hydrated.filter((v) => v.unresolved).flatMap((v) => v.groups),
    );
    return {
      id: 'hdrezka-' + encodeURIComponent(path),
      webUrl: new URL('/' + path + '.html', base).href,
      title,
      kind: kind(path),
      subtitle: [released ? String(released) : '', ...tags.slice(0, 2)].filter(Boolean).join(' / '),
      overview: text(data.description).replace(/^Про что .+?:\s*/, ''),
      rating: rating(data.rating),
      year: released,
      posterUrl: poster,
      backdropUrl: poster,
      tags,
      metadata: dedupe(metadata, (v) => `${v.kind}:${v.value.toLowerCase()}`).slice(0, 16),
      playbackGroups: dedupe(groups, (v) => v.id),
      relatedItems: dedupe(
        array(data.related)
          .map((row) => card(row, base))
          .filter((v) => v && v.id !== itemId),
        (v) => v.id,
      ).slice(0, 12),
    };
  }
  return {
    getFilters,
    search,
    loadDetails,
    resolveStream: player.resolve,
    loadPlaybackGroups: async (args) =>
      args.url ? player.groups(args) : ((await loadDetails(args))?.playbackGroups ?? []),
    getPopular: ({ page = 1 }) =>
      search({ page, selectedFilters: { section: ['filmy'], sort: ['popular'] } }),
    getLatest: ({ page = 1 }) =>
      search({ page, selectedFilters: { section: ['filmy'], sort: ['date'] } }),
    getRecommendations: async (args) => (await loadDetails(args))?.relatedItems ?? [],
  };
}
