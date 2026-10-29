import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createSource, { catalogUrl } from '../sources/shikimori/src/index.mjs';
const title = {
  id: 52991,
  name: 'Sousou no Frieren',
  russian: 'Фрирен',
  url: '/animes/52991-frieren',
  kind: 'tv',
  image: { original: '/cover.jpg' },
  aired_on: '2023-09-29',
  score: '8.84',
  genres: [{ id: 10, name: 'Fantasy' }],
  studios: [{ id: 11, name: 'Studio' }],
  description_html: '<p>Story</p>',
  episodes: 12,
};
const options = (rows) => rows.map(([value, label]) => ({ value, label }));
// Recorded HTML projection shape. Selector behaviour is also checked against
// live pages with FilmoraX's SourceHtmlExtractor, independently of this fixture.
const filterPage = {
  order: options([
    ['ranked_shiki', 'по рейтингу'],
    ['popularity', 'по популярности'],
    ['name', 'по алфавиту'],
    ['aired_on', 'по дате выхода'],
    ['released_on', 'по дате завершения'],
    ['episodes', 'по числу серий'],
    ['ranked', 'по рейтингу MAL'],
    ['ranked_random', 'случайно'],
    ['id_desc', 'по ID'],
  ]),
  defaultOrder: 'ranked_shiki',
  fields: [
    [
      'status',
      'Статус',
      [
        ['anons', 'Анонс'],
        ['ongoing', 'Онгоинг'],
        ['released', 'Вышло'],
        ['latest', 'Недавно вышло'],
      ],
    ],
    [
      'kind',
      'Тип',
      [
        ['tv', 'TV Сериал'],
        ['tv_13', '— 12 серий'],
        ['tv_24', '— 24 серии'],
        ['tv_48', '— 48+ серий'],
        ['pv', 'Проморолик'],
        ['cm', 'Реклама'],
      ],
    ],
    [
      'genre',
      'Жанры',
      [
        ['10-Fantasy', 'Фэнтези'],
        ['12-Hentai', 'Hentai'],
      ],
    ],
    ['genre', 'Темы', [['23-Super-Power', 'Супер сила']]],
    [
      'season',
      'Сезон и год',
      [
        ['winter_2027', 'зима 2027'],
        ['2026', '2026'],
      ],
    ],
    [
      'duration',
      'Длительность серии',
      [
        ['S', 'Меньше 10 мин'],
        ['D', '10-30 мин'],
        ['F', 'Больше 30 мин'],
      ],
    ],
    [
      'rating',
      'Возрастной рейтинг',
      [
        ['pg_13', 'PG-13 — 13+'],
        ['rx', 'Hentai'],
      ],
    ],
    ['origin', 'Первоисточник', [['web_manga', 'Веб-манга']]],
    ['studio', 'Студия', [['11-Madhouse', 'Madhouse']]],
    ['licensor', 'Лицензиар', [['2x2', '2x2']]],
  ].map(([id, title, rows]) => ({ id, title, options: options(rows) })),
  scores: options([
    ['8-', 'Лучшее'],
    ['7-', 'Хорошее'],
    ['5-7', 'Средние'],
    ['-4', 'Слабые'],
  ]),
};
function fixture(config = {}) {
  const calls = [];
  const currentTitle = { ...title, ...config.title };
  const context = {
    baseUrl: 'https://shikimori.io',
    settings: { network: async () => config },
    html: {
      text: async () => ['Story'],
      extract: async (body) => JSON.parse(body),
    },
    http: {
      request: async (input) => {
        calls.push(input);
        const uri = new URL(input.url);
        const error = config.error?.(input);
        if (error) throw error;
        let body;
        if (uri.pathname === '/api/studios')
          body = [
            { id: 11, name: 'Madhouse' },
            { id: 999, name: 'Other studio' },
          ];
        else if (uri.pathname.endsWith('/similar')) body = [{ ...title, id: 33352 }];
        else if (uri.pathname === '/api/animes/' + currentTitle.id) body = currentTitle;
        else if (uri.pathname.endsWith('/watch')) {
          const canonical =
            new URL(currentTitle.url, uri.origin).pathname.replace(/\/+$/, '') + '/watch';
          assert.equal(uri.pathname, canonical, 'the player route must retain its canonical slug');
          body = JSON.stringify({
            title: String(currentTitle.id),
            publisher: '3058',
            aggregator: 'mali',
          });
        } else if (uri.pathname === new URL(currentTitle.url, uri.origin).pathname)
          body = JSON.stringify({
            image: '//shikimori.io/uploads/poster/current.jpeg',
            score: '8.91',
          });
        else if (uri.pathname.endsWith('/playlist'))
          body = {
            isSerial: config.isSerial ?? true,
            items: config.playlist ?? [
              { voiceStudio: 'Voice A', season: 1, episode: 2, vkId: '102' },
              { voiceStudio: 'Voice A', season: 1, episode: 1, vkId: '101' },
              { voiceStudio: 'Voice B', season: 1, episode: 1, vkId: '201' },
              { voiceStudio: 'Voice A', season: 1, episode: 1, vkId: '101' },
            ],
          };
        else if (uri.pathname.endsWith('/video/101'))
          body = {
            sources: {
              mpegHighUrl: 'https://cdn.vkuser.net/episode.mp4',
              hlsUrl: 'https://cdn.vkuser.net/master.m3u8',
            },
          };
        else if (/^\/animes(?:\/(?:page|kind|status|season|genre|studio)\/|$)/.test(uri.pathname)) {
          const page = Number(/\/page\/(\d+)/.exec(uri.pathname)?.[1]) || 1;
          body = JSON.stringify({
            ...filterPage,
            cards:
              config.cards ??
              Array.from({ length: 20 }, (_, i) => ({
                url: `/animes/z${page * 100 + i}-example`,
                russian: 'Пример',
                name: 'Example',
                image: '//shikimori.io/uploads/poster/card.jpeg',
                date: '2023-09-29',
                kind: 'TV Сериал',
                score: '★8.84',
              })),
            next: page < 3 ? `/animes/page/${page + 1}` : null,
          });
        } else throw Error(`Unexpected ${uri}`);
        return { body, url: uri.href };
      },
    },
  };
  return { source: createSource(context), calls };
}
test('non-NSFW Shikimori has an icon, catalogue and an explicitly permitted shared player', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../sources/shikimori/manifest.json', import.meta.url)),
  );
  assert.equal(manifest.sources[0].isNsfw, false);
  assert.deepEqual(manifest.sources[0].parameters, {});
  assert.ok(manifest.sources[0].network.origins.includes('https://plapi.cdnvideohub.com'));
  assert.ok(manifest.sources[0].network.origins.includes('https://player.cdnvideohub.com'));
  assert.equal(manifest.sources[0].presentation.icon, 'assets/icon.png');
  assert.equal(manifest.sources[0].network.userAgentProfile, 'browser');
  assert.equal(manifest.sources[0].presentation.imageHeaders.Referer, '{baseOrigin}/');
});
test('Shikimori catalogue paginates and sends filters to the configured mirror', async () => {
  const { source, calls } = fixture({ baseUrl: 'https://mirror.example' });
  const a = await source.search(),
    b = await source.search({
      page: 2,
      searchTerm: 'Frieren',
      selectedFilters: { genre: ['10'], studio: ['11'] },
    });
  assert.equal(a.items.length, 20);
  assert.equal(b.hasMore, true);
  assert.notEqual(a.items[0].id, b.items[0].id);
  const uri = new URL(calls.at(-1).url);
  assert.equal(uri.origin, 'https://mirror.example');
  assert.equal(decodeURIComponent(uri.pathname), '/animes/genre/10/studio/11/page/2');
  assert.equal(uri.searchParams.get('search'), 'Frieren');
  assert.equal(uri.searchParams.get('order'), 'ranked_shiki');
  assert.equal(calls.at(-1).responseType, 'text');
  assert.equal(b.items[0].isNsfw, false);
  assert.equal(b.items[0].rating, 8.84);
  assert.equal(b.items[0].posterUrl, 'https://shikimori.io/uploads/poster/card.jpeg');
  assert.equal(b.items[0].metadata.find((row) => row.kind === 'type').filterValue, 'tv');
  assert.equal((await source.search({ page: 3 })).hasMore, false);
});
test('filter inventories are reused per mirror and details expose actual sorted episodes/voices', async () => {
  const { source, calls } = fixture();
  const filters = await source.getFilters();
  await source.getFilters();
  assert.equal(calls.length, 2);
  assert.deepEqual(filters.find((row) => row.id === 'genre').options, [
    { value: '10-Fantasy', label: 'Фэнтези' },
  ]);
  assert.equal(filters.find((row) => row.id === 'genre').kind, 'triStateMultiSelect');
  assert.equal(filters.find((row) => row.id === 'theme').options[0].value, '23-Super-Power');
  assert.deepEqual(filters.find((row) => row.id === 'order').defaultValues, ['ranked_shiki']);
  assert.deepEqual(
    filters.find((row) => row.id === 'order').options.map((row) => row.value),
    filterPage.order.map((row) => row.value),
  );
  assert.equal(filters.find((row) => row.id === 'studio').options.length, 2);
  const entry = await source.loadDetails({ itemId: 'shikimori-52991' });
  assert.equal(entry.overview, 'Story');
  assert.equal(entry.relatedItems.length, 1);
  assert.equal(entry.posterUrl, 'https://shikimori.io/uploads/poster/current.jpeg');
  assert.equal(entry.rating, 8.91);
  assert.equal(entry.metadata.find((row) => row.kind === 'episodes').value, '12');
  assert.equal(entry.playbackGroups.length, 2);
  assert.deepEqual(
    entry.playbackGroups[0].episodes.map((episode) => episode.number),
    ['1', '2'],
  );
  assert.equal(
    entry.playbackGroups[0].episodes[0].url,
    'https://plapi.cdnvideohub.com/api/v1/player/sv/video/101',
  );
});
test('Shikimori separates site API headers from the actual player origin on native streams', async () => {
  const { source, calls } = fixture({ baseUrl: 'https://mirror.example' });
  const result = await source.resolveStream({
    url: 'https://plapi.cdnvideohub.com/api/v1/player/sv/video/101',
  });
  assert.equal(result.variants.length, 2);
  assert.equal(calls[0].headers.Origin, 'https://mirror.example');
  for (const variant of result.variants) {
    assert.equal(variant.headers.Origin, 'https://player.cdnvideohub.com');
    assert.equal(variant.headers.Referer, 'https://player.cdnvideohub.com/');
  }
  await assert.rejects(source.resolveStream({ url: 'https://evil.example/video/101' }));
});

test('Shikimori implements standalone declared methods without fetching unrelated detail data', async () => {
  const { source, calls } = fixture({ baseUrl: 'https://mirror.example' });
  const related = await source.getRecommendations({ itemId: 'shikimori-52991' });
  assert.equal(related[0].id, 'shikimori-33352');
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/api/animes/52991/similar');
  calls.length = 0;
  const groups = await source.loadPlaybackGroups({
    url: 'https://mirror.example/animes/52991-frieren',
  });
  assert.equal(groups.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).pathname, '/animes/52991-frieren/watch');
  assert.deepEqual(await source.getRecommendations({ itemId: 'invalid' }), []);
  assert.deepEqual(await source.loadPlaybackGroups({ itemId: 'invalid' }), []);
});

test('z-prefixed canonical title routes work from details, an item ID and a public URL', async () => {
  const { source, calls } = fixture({ title: { id: 30276, url: '/animes/z30276-one-punch-man' } });
  const details = await source.loadDetails({ itemId: 'shikimori-30276' });
  assert.equal(details.playbackGroups.length, 2);
  calls.length = 0;
  await source.loadPlaybackGroups({ itemId: 'shikimori-30276' });
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    ['/api/animes/30276', '/animes/z30276-one-punch-man/watch', '/api/v1/player/sv/playlist'],
  );
  calls.length = 0;
  await source.loadPlaybackGroups({ url: 'https://shikimori.io/animes/z30276-one-punch-man/' });
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).pathname, '/animes/z30276-one-punch-man/watch');
});

test('catalogue path order, exclusions, themes and rating range match the site protocol', () => {
  const url = new URL(
    catalogUrl('https://mirror.example', {
      page: 2,
      searchTerm: 'One Punch Man',
      selectedFilters: {
        order: ['released_on'],
        kind: ['include:tv_13'],
        status: ['released'],
        season: ['fall_2015'],
        genre: ['include:1-Action', 'exclude:14-Horror'],
        theme: ['23-Super-Power', '!60-Adult-Cast'],
        studio: ['11-Madhouse'],
        duration: ['D'],
        rating: ['exclude:pg_13'],
        origin: ['web_manga'],
        licensor: ['2x2'],
        score_from: ['7.5'],
        score_to: ['9'],
      },
    }),
  );
  assert.equal(
    decodeURIComponent(url.pathname),
    '/animes/kind/tv_13/status/released/season/fall_2015/genre/1-Action,!14-Horror,23-Super-Power,!60-Adult-Cast/studio/11-Madhouse/page/2',
  );
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    order: 'released_on',
    duration: 'D',
    rating: '!pg_13',
    origin: 'web_manga',
    licensor: '2x2',
    shiki_score: '7.5-9',
    search: 'One Punch Man',
  });
  for (const preset of ['8-', '-4', '5-7']) {
    assert.equal(
      new URL(
        catalogUrl('https://shikimori.io', { selectedFilters: { score: [preset] } }),
      ).searchParams.get('shiki_score'),
      preset,
    );
  }
  assert.equal(
    new URL(
      catalogUrl('https://shikimori.io', { selectedFilters: { score: ['8'] } }),
    ).searchParams.get('shiki_score'),
    '8-',
  );
});

test('invalid rating bounds fail before making a catalogue request', async () => {
  const { source, calls } = fixture();
  for (const selectedFilters of [
    { score_from: ['0'] },
    { score_to: ['11'] },
    { score_from: ['NaN'] },
    { score_from: ['9'], score_to: ['3'] },
    { score: ['-'] },
    { score: ['8-2'] },
  ])
    await assert.rejects(source.search({ selectedFilters }), { code: 'invalid_argument' });
  assert.equal(calls.length, 0);
});

test('filter refresh and changing mirrors do not reuse a stale catalogue inventory', async () => {
  const config = { baseUrl: 'https://first.example' };
  const { source, calls } = fixture(config);
  await source.getFilters();
  await source.getFilters();
  assert.equal(calls.length, 2);
  await source.getFilters({ refresh: true });
  assert.equal(calls.length, 4);
  config.baseUrl = 'https://second.example';
  const filters = await source.getFilters();
  assert.equal(calls.length, 6);
  assert.equal(new URL(calls[4].url).origin, config.baseUrl);
  assert(filters.find((row) => row.id === 'status').options.some((row) => row.value === 'latest'));
  assert(filters.find((row) => row.id === 'kind').options.some((row) => row.value === 'tv_48'));
  assert.equal(filters.find((row) => row.id === 'score_to').kind, 'text');
});

test('catalogue images skip inline placeholders, preserve CDN URLs and use page artwork', async () => {
  const { source } = fixture({
    cards: [
      {
        url: '/animes/z30276-one-punch-man',
        name: 'One Punch Man',
        image: 'data:image/gif;base64,AAAA',
        poster: '/uploads/poster/current.jpeg',
      },
      {
        url: '/animes/52991-frieren',
        name: 'Frieren',
        image: '/placeholder.jpeg',
        lazyImage: '//desu.shikimori.one/poster.jpeg',
      },
    ],
  });
  const page = await source.search();
  assert.deepEqual(
    page.items.map((row) => row.posterUrl),
    ['https://shikimori.io/uploads/poster/current.jpeg', 'https://desu.shikimori.one/poster.jpeg'],
  );
  assert.equal(page.items[0].webUrl, 'https://shikimori.io/animes/z30276-one-punch-man');
});

test('invalid serial episodes are skipped and dubbing/subtitles remain separate', async () => {
  const { source } = fixture({
    playlist: [
      { voiceStudio: 'Voice', voiceType: 'Дубляж', season: 1, episode: 1, vkId: '101' },
      { voiceStudio: 'Voice', voiceType: 'Субтитры', season: 1, episode: 1, vkId: '201' },
      { voiceStudio: 'Voice', season: 1, episode: 0, vkId: '301' },
      { voiceStudio: 'Voice', season: 1, episode: 1.5, vkId: '302' },
      { voiceStudio: 'Voice', season: 0, episode: 1, vkId: '303' },
      { voiceStudio: 'Voice', season: 1, episode: 2, vkId: 'bad/id' },
    ],
  });
  const groups = await source.loadPlaybackGroups({ itemId: 'shikimori-52991' });
  assert.deepEqual(
    groups.map((row) => row.title),
    ['Voice · Дубляж', 'Voice · Субтитры'],
  );
  assert.deepEqual(
    groups.map((row) => row.episodes.length),
    [1, 1],
  );
});

test('a movie playlist without serial numbering still exposes one playable entry', async () => {
  const { source } = fixture({
    isSerial: false,
    playlist: [{ voiceStudio: 'Voice', season: 0, episode: 0, vkId: '101' }],
  });
  const groups = await source.loadPlaybackGroups({ itemId: 'shikimori-52991' });
  assert.equal(groups[0].episodes[0].season, '1');
  assert.equal(groups[0].episodes[0].number, '1');
});

test('optional player outages retain metadata but cancellation and permission errors propagate', async () => {
  const failWatch = (code) => (input) =>
    new URL(input.url).pathname.endsWith('/watch')
      ? Object.assign(new Error('fixture failure'), { code })
      : null;
  const unavailable = fixture({ error: failWatch('http_error') });
  const entry = await unavailable.source.loadDetails({ itemId: 'shikimori-52991' });
  assert.equal(entry.title, 'Фрирен');
  assert.deepEqual(entry.playbackGroups, []);
  for (const code of ['cancelled', 'permission_denied', 'auth_session_changed', 'resource_limit']) {
    const { source } = fixture({ error: failWatch(code) });
    await assert.rejects(source.loadDetails({ itemId: 'shikimori-52991' }), { code });
  }
});
