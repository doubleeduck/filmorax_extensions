import { text, array, object, first, dedupe } from '../../../sdk/video.mjs';
import { isKodik } from '../../../resolvers/kodik.mjs';
import { isCdnVideoHub } from '../../../resolvers/cdnvideohub.mjs';
import { isCollaps } from '../../../resolvers/collaps.mjs';
const pick = (row, keys) => first(...keys.map((key) => row?.[key]));
const join = (values) => values.filter((value) => text(value)).join(' / ');
export function slug(value, base = 'https://ru.yummyani.me') {
  value = text(value);
  if (!value) return '';
  try {
    return new URL(value, base).pathname.split('/').filter(Boolean).at(-1) ?? '';
  } catch {
    return '';
  }
}
export function extractItems(value) {
  const root = object(value);
  if (Array.isArray(root.response)) return root.response;
  for (const parent of [object(root.response), root])
    for (const key of ['data', 'items', 'anime', 'results'])
      if (array(parent[key]).length) return parent[key];
  return [];
}
export function option(row, kind) {
  const label = pick(row, ['title', 'name', 'label']);
  let value = pick(
    row,
    kind === 'genre' ? ['alias', 'slug', 'url', 'href', 'id'] : ['alias', 'slug', 'value', 'id'],
  );
  if (kind === 'genre' && value.includes('/'))
    value = value.split('/').filter(Boolean).at(-1) ?? '';
  if (!value || !label) return null;
  const count = Number(row.count);
  return {
    value,
    label,
    ...(row.count != null && Number.isInteger(count) && count >= 0 ? { count } : {}),
  };
}
const objectRows = (value) =>
  Array.isArray(value)
    ? value.map(object).filter((row) => Object.keys(row).length)
    : Object.keys(object(value)).length
      ? [value]
      : [];
const filterValue = (row) =>
  first(
    pick(row, ['alias', 'slug', 'value']),
    pick(row, ['url', 'href']).split('/').filter(Boolean).at(-1),
    row.id,
  );
function metadata(data) {
  const result = [];
  function add(kind, value, filterId, filterValue) {
    value = text(value);
    if (value)
      result.push({
        kind,
        labelKey: `media.metadata.${kind}`,
        value,
        ...(filterId && filterValue ? { filterId, filterValue } : {}),
      });
  }
  for (const [key, kind, filter] of [
    ['type', 'type', 'types'],
    ['anime_status', 'status', 'status'],
  ]) {
    const row = object(data[key] ?? (key === 'anime_status' ? data.status : null));
    add(
      kind,
      pick(row, ['title', 'name', 'label', 'shortname']),
      filter,
      pick(row, ['alias', 'slug', 'value', 'id']),
    );
  }
  const count = Number(data.episodes?.count ?? data.episodes?.aired ?? data.episodes_count);
  if (Number.isInteger(count) && count > 0) add('episodes', String(count));
  for (const [key, kind, filter] of [
    ['studios', 'studio', 'studio'],
    ['creators', 'director', 'director'],
    ['genres', 'genre', 'genres'],
  ])
    for (const row of objectRows(data[key]))
      add(kind, pick(row, ['title', 'name', 'label']), filter, filterValue(row));
  return dedupe(result, (row) => `${row.kind}:${row.value}`.toLowerCase());
}
function groups(data, base, slugId) {
  const groups = new Map();
  for (const video of array(data.videos)) {
    const info = object(video.data),
      player = pick(info, ['player', 'source']),
      raw = pick(video, ['iframe_url', 'url']);
    let url;
    try {
      url = new URL(raw, base).href;
    } catch {
      continue;
    }
    if (!raw || ![isKodik, isCdnVideoHub, isCollaps].some((test) => test(url))) continue;
    const dubbing = first(pick(info, ['dubbing', 'voice', 'translation']), 'player.voice'),
      playerId = first(info.player_id, player, dubbing),
      key = join([dubbing, playerId]);
    if (!groups.has(key))
      groups.set(key, {
        id: `yummyani-${key}`,
        title: dubbing,
        subtitle: player,
        episodes: [],
        playerId: isKodik(url) ? 'kodik' : isCollaps(url) ? 'collaps' : 'cdnVideoHub',
        playerLabel: isKodik(url) ? 'Kodik' : isCollaps(url) ? 'Collaps' : 'OKCDN',
      });
    const number = first(video.number, video.index),
      duration = Number(video.duration),
      durationLabel =
        Number.isFinite(duration) && duration > 0
          ? `${Math.floor(duration / 60)}:${Math.floor(duration % 60)
              .toString()
              .padStart(2, '0')}`
          : '';
    groups.get(key).episodes.push({
      id: first(video.video_id, `${slugId}-${number || groups.get(key).episodes.length}`),
      title: number ? `episodes.fallback ${number}` : 'episodes.fallback',
      number,
      subtitle: durationLabel,
      url,
      ...(video.duration != null && Number.isInteger(duration) && duration >= 0
        ? { durationSeconds: duration }
        : {}),
    });
  }
  const numeric = (value) => {
    const raw = text(value).replace(/,/g, '.'),
      number = Number(raw);
    return raw && Number.isFinite(number) ? number : Number.MAX_VALUE;
  };
  return [...groups.values()]
    .map((group) => {
      group.episodes = dedupe(group.episodes, (row) => join([row.number, row.id])).sort(
        (a, b) => numeric(a.number) - numeric(b.number),
      );
      return { ...group, subtitle: join([group.subtitle, `${group.episodes.length} ep.`]) };
    })
    .sort(
      (a, b) =>
        b.episodes.length - a.episodes.length ||
        a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
    );
}
export function item(value, base, details = false) {
  const data = object(value),
    title = pick(data, ['title', 'name', 'rus_name', 'eng_name']),
    id = slug(pick(data, ['anime_url', 'url', 'slug', 'id', 'anime_id']), base);
  if (!title || !id) return null;
  const poster =
    typeof data.poster === 'string'
      ? text(data.poster)
      : pick(object(data.poster), ['big', 'large', 'medium', 'fullsize', 'small', 'url']);
  let posterUrl = '';
  try {
    if (poster) posterUrl = new URL(poster, base).href;
  } catch {}
  const year =
    Number(data.year) || Number(/(?:19|20)\d{2}/.exec(text(data.release_date))?.[0]) || null;
  return {
    id: `yummyani-${id}`,
    webUrl: new URL('/catalog/item/' + encodeURIComponent(id), base).href,
    title,
    subtitle: join([
      pick(data.type, ['title', 'name', 'label']),
      year ? String(year) : '',
      pick(data.anime_status ?? data.status, ['title', 'name', 'label']),
    ]),
    overview: pick(data, ['description', 'synopsis', 'short_desc']),
    kind: 'anime',
    rating: Math.min(10, Math.max(0, Number(data.rating?.average ?? data.rating) || 0)),
    year,
    posterUrl,
    backdropUrl: posterUrl,
    tags: dedupe(
      array(data.genres)
        .map((genre) =>
          typeof genre === 'string' ? genre : pick(genre, ['title', 'name', 'label']),
        )
        .filter(Boolean),
      (v) => v,
    ).slice(0, 4),
    metadata: metadata(data),
    playbackGroups: groups(data, base, id),
    relatedItems: details
      ? dedupe(
          array(data.relatedItems)
            .map((row) => item(row, base))
            .filter(Boolean),
          (row) => row.id,
        ).slice(0, 24)
      : [],
  };
}
