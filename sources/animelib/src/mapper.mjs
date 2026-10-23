import { text, array, object, first, dedupe } from '../../../sdk/video.mjs';
import { isKodik } from '../../../resolvers/kodik.mjs';
import { isCdnVideoHub } from '../../../resolvers/cdnvideohub.mjs';
export const localized = (value) =>
  value && typeof value === 'object'
    ? first(value.ru, value.rus, value.en, Object.values(value)[0])
    : text(value);
export const join = (values) => values.map(text).filter(Boolean).join(' / ');
export const slug = (id) => (id.startsWith('animelib-') ? id.slice(9) : id);
export const playerName = (value) =>
  text(value).toLowerCase() === 'anilib' ? 'animelib' : text(value).toLowerCase();
export const absolute = (value, base = 'https://animelib.org') =>
  text(value) ? new URL(text(value), base).href : '';
export function richText(value) {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return value.map(richText).filter(Boolean).join('\n\n');
  if (!value || typeof value !== 'object') return text(value);
  if ('text' in value) return text(value.text);
  return array(value.content).length
    ? value.content
        .map(richText)
        .filter(Boolean)
        .join(value.type === 'paragraph' ? '' : '\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : localized(value);
}
export function extractItems(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  for (const key of ['items', 'list', 'anime', 'popular'])
    if (array(payload?.data?.[key]).length) return payload.data[key];
  for (const key of ['items', 'results', 'anime'])
    if (array(payload?.[key]).length) return payload[key];
  return [];
}
export function episode(row, suffix, url) {
  const number = first(row.number, row.number_secondary, row.item_number);
  const uri = new URL(url);
  const lazy = uri.protocol === 'animelib:';
  const provider = lazy
    ? first(uri.searchParams.get('player'), 'animelib')
    : isKodik(url)
      ? 'kodik'
      : isCdnVideoHub(url)
        ? 'cdnVideoHub'
        : 'animelib';
  return {
    playerId: lazy ? 'animelib:' + provider : provider,
    playerLabel: provider === 'kodik' ? 'Kodik' : provider === 'cdnVideoHub' ? 'OKCDN' : 'AniLib',
    id: join([row.id, suffix]),
    title: localized(row.name) || (number ? `episodes.fallback ${number}` : 'episodes.fallback'),
    number,
    season: text(row.season),
    subtitle: localized(row.status?.label),
    url,
  };
}
function supported(player, authorized) {
  const name = playerName(player.player),
    url = absolute(player.src);
  return name === 'animelib'
    ? authorized && url.includes('cdnlibs.org/')
    : isKodik(url) || isCdnVideoHub(url);
}
function groups(data, authorized) {
  const episodes = array(data.episodes),
    groups = new Map();
  const lazy = [...(authorized ? ['animelib'] : []), 'kodik'].map((name) => ({
    id: `animelib-${name}`,
    title: name === 'animelib' ? 'AniLib' : 'Kodik',
    subtitle: 'player.lazy_load_subtitle',
    episodes: episodes
      .filter((e) => text(e.id))
      .map((e) =>
        episode(e, name, `animelib://episode/${encodeURIComponent(e.id)}?player=${name}`),
      ),
  }));
  for (const row of episodes)
    for (const player of array(row.players)) {
      if (!supported(player, authorized)) continue;
      const team = object(player.team),
        title = first(localized(team.name ?? team.label), player.player, 'player.voice'),
        key = join([first(team.id, team.slug_url, team.slug, title), player.player]);
      if (!groups.has(key))
        groups.set(key, {
          id: `animelib-${key}`,
          title,
          subtitle: join([player.player, localized(player.translation_type?.label)]),
          episodes: [],
        });
      groups.get(key).episodes.push(episode(row, text(player.id), absolute(player.src)));
    }
  const result = groups.size ? [...groups.values()] : lazy.filter((g) => g.episodes.length);
  for (const group of result) {
    group.episodes = dedupe(group.episodes, (e) => join([e.season, e.number]) || e.id).sort(
      (a, b) =>
        (Number(a.season) || 0) - (Number(b.season) || 0) ||
        (Number(a.number) || 0) - (Number(b.number) || 0),
    );
    group.subtitle = join([group.subtitle, `${group.episodes.length} ep.`]);
  }
  return result.sort(
    (a, b) => b.episodes.length - a.episodes.length || a.title.localeCompare(b.title),
  );
}
export function item(data, authorized = false, related = true) {
  data = object(data);
  const title = localized(data.rus_name ?? data.name ?? data.eng_name ?? data.title),
    id = first(data.slug_url, data.slug, data.id);
  if (!title || !id) return null;
  const release = first(data.releaseDate, data.releaseDateString, data.release_date),
    count =
      Number(
        data.episodes_count ??
          data.items_count?.total ??
          data.items_count?.uploaded ??
          array(data.episodes).length,
      ) || 0;
  const poster = absolute(
    first(data.cover?.md, data.cover?.default, data.cover?.thumbnail, data.cover?.url),
  );
  const backdrop = absolute(
    first(
      data.background?.md,
      data.background?.default,
      data.background?.thumbnail,
      data.background?.url,
    ),
  );
  const metadata = [],
    names = (value) =>
      array(value)
        .filter((v) => !v.adult && !v.alert)
        .map((v) => localized(v.name ?? v.label ?? v))
        .filter(Boolean);
  const add = (kind, value, filterId = '', filterValue = '') => {
    if (text(value))
      metadata.push({
        kind,
        value: text(value),
        labelKey: `media.metadata.${kind}`,
        ...(filterId ? { filterId, filterValue: text(filterValue) } : {}),
      });
  };
  for (const [key, kind, filterId] of [
    ['type', 'type', 'types'],
    ['status', 'status', 'status'],
  ])
    add(kind, localized(data[key]?.label ?? data[key]?.name), filterId, data[key]?.id);
  if (count) add('episodes', count);
  const person = (value) =>
    first(
      localized(value?.rus_name),
      localized(value?.name),
      localized(value?.eng_name),
      localized(value?.label),
    );
  add('publisher', person(data.publisher));
  for (const author of array(data.authors)) add('author', person(author));
  for (const [key, kind] of [
    ['genres', 'genre'],
    ['tags', 'tag'],
  ])
    for (const row of array(data[key]).filter((v) => !v.adult && !v.alert))
      add(kind, localized(row.name ?? row.label), key, row.id);
  const rating =
    Number(
      data.rating?.average ??
        data.rating?.score ??
        data.rate_avg ??
        data.rate ??
        data.rating ??
        data.shiki_rate,
    ) || 0;
  return {
    id: `animelib-${id}`,
    webUrl: 'https://animelib.org/ru/anime/' + encodeURIComponent(id),
    title,
    kind: 'anime',
    subtitle: join([
      localized(data.type?.label ?? data.type?.name),
      release,
      localized(data.status?.label ?? data.status?.name),
      count ? `${count} ep.` : '',
      first(data.time?.formated, data.time?.formatted, data.time?.label),
    ]),
    overview: first(richText(data.summary), richText(data.description), richText(data.annotation)),
    rating: rating > 10 ? rating / 10 : rating,
    year: Number(/\b(18|19|20|21)\d{2}\b/.exec(release)?.[0]) || null,
    posterUrl: poster,
    backdropUrl: backdrop || poster,
    tags: dedupe([...names(data.genres), ...names(data.tags)], (v) => v.toLowerCase()).slice(0, 8),
    metadata: dedupe(metadata, (v) => `${v.kind}:${v.value.toLowerCase()}`),
    playbackGroups: groups(data, authorized),
    relatedItems: related
      ? array(data.relatedItems)
          .map((v) => item(v.media ?? v, authorized, false))
          .filter(Boolean)
      : [],
  };
}
