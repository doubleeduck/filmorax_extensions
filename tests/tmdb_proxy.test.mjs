import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import createSource from '../sources/tmdb/src/index.mjs';

const definition = JSON.parse(
  await readFile(new URL('../sources/tmdb/manifest.json', import.meta.url), 'utf8'),
).sources[0];
const gateways = ['https://apitmdb.cub.black', 'https://apitmdb.cubnotrip.top'];
const movie = {
  id: 42,
  title: 'Fixture',
  poster_path: '/poster.jpg',
  credits: { cast: [{ id: 7, name: 'Actor', profile_path: '/actor.jpg' }] },
};
function fixture({ options = {}, baseUrl = '', token = '', respond } = {}) {
  const calls = [];
  let sessionReads = 0;
  const source = createSource({
    parameters: definition.parameters,
    settings: { network: async () => ({ baseUrl, options }) },
    auth: {
      getSession: async () => {
        sessionReads++;
        return { accessToken: token };
      },
    },
    http: {
      request: async (input) => {
        calls.push(input);
        return respond
          ? respond(input)
          : { body: { ...movie, results: [movie], page: 2, total_pages: 3 } };
      },
    },
  });
  return { source, calls, sessionReads: () => sessionReads };
}
const error = (code, httpStatus) => Object.assign(new Error('Fixture'), { code, httpStatus });

test('TMDB exposes three API modes and source-owned Lampa server selection without auth grants', () => {
  const fields = definition.networkSettings;
  assert.deepEqual(
    fields.find((row) => row.id === 'tmdb.api_mirror_mode').options.map((row) => row.value),
    ['official', 'directMirror', 'lampaProxy'],
  );
  const server = fields.find((row) => row.id === 'tmdb.api_lampa_server');
  assert.deepEqual(server.visibleWhen, { id: 'tmdb.api_mirror_mode', values: ['lampaProxy'] });
  assert.equal(server.defaultValue, 'auto');
  assert.deepEqual(
    server.options.map((row) => row.value),
    ['auto', 'cub.black', 'cubnotrip.top'],
  );
  assert.equal(fields.find((row) => row.id === 'tmdb.api_mirror_url').required, false);
  for (const gateway of gateways) {
    assert.ok(definition.network.origins.includes(gateway));
    assert.ok(!definition.network.authOrigins.includes(gateway));
  }
  assert.deepEqual(definition.network.authOrigins, ['https://api.themoviedb.org']);
  assert.ok(definition.network.imageOrigins.includes('https://nl.imagetmdb.com'));
});

for (const server of ['auto', 'cub.black', 'cubnotrip.top'])
  test(`Lampa ${server} builds native TMDB paths, preserves query/page and never reads personal credentials`, async () => {
    for (const token of ['personal.jwt.token', '0123456789abcdef0123456789abcdef']) {
      const { source, calls, sessionReads } = fixture({
        token,
        options: {
          'tmdb.api_mirror_mode': 'lampaProxy',
          'tmdb.api_lampa_server': server,
        },
      });
      const result = await source.search({
        page: 2,
        searchTerm: 'Поиск + &',
        selectedFilters: { section: ['tv'] },
      });
      const url = new URL(calls[0].url);
      assert.equal(url.origin, server === 'cubnotrip.top' ? gateways[1] : gateways[0]);
      assert.equal(url.pathname, '/3/search/tv');
      assert.equal(url.searchParams.get('query'), 'Поиск + &');
      assert.equal(url.searchParams.get('page'), '2');
      assert.equal(url.searchParams.get('language'), 'ru-RU');
      assert.equal(url.searchParams.get('api_key'), definition.parameters.defaultApiKey);
      assert.equal(calls[0].headers.Authorization, undefined);
      assert.equal(sessionReads(), 0);
      assert.equal(result.hasMore, true);
    }
  });

for (const failure of [error('network'), error('timeout'), error('invalid_response', 503)])
  test(`automatic Lampa retries ${failure.code}/${failure.httpStatus ?? 'transport'} and remembers the working server`, async () => {
    const { source, calls } = fixture({
      options: { 'tmdb.api_mirror_mode': 'lampaProxy' },
      respond: (input) => {
        if (new URL(input.url).origin === gateways[0]) throw failure;
        return { body: { ...movie, results: [movie] } };
      },
    });
    await source.search({ page: 2, selectedFilters: { section: ['movie'], genre: ['16'] } });
    await source.loadDetails({ itemId: 'tmdb-movie-42' });
    assert.deepEqual(
      calls.map((row) => new URL(row.url).origin),
      [gateways[0], gateways[1], gateways[1]],
    );
    for (const row of calls) assert.equal(row.timeoutMs, 4000);
    assert.equal(new URL(calls[1].url).pathname, '/3/discover/movie');
    assert.equal(new URL(calls[1].url).searchParams.get('with_genres'), '16');
    assert.equal(new URL(calls[1].url).searchParams.get('page'), '2');
  });

test('automatic Lampa surfaces the final failure when all gateways are unavailable', async () => {
  const failures = [error('network'), error('invalid_response', 502)];
  const { source, calls } = fixture({
    options: { 'tmdb.api_mirror_mode': 'lampaProxy' },
    respond: () => {
      throw failures[calls.length - 1];
    },
  });
  await assert.rejects(source.getPopular({}), (value) => value === failures[1]);
  assert.equal(calls.length, 2);
});

test('automatic Lampa does not retry cancellation, authorization, permission, rate limit or missing-title errors', async () => {
  for (const failure of [
    error('cancelled'),
    error('auth_session_changed'),
    error('permission_denied'),
    error('auth_required', 401),
    error('access_denied', 403),
    error('not_found', 404),
    error('rate_limited', 429),
    error('invalid_response', 400),
  ]) {
    const { source, calls } = fixture({
      options: { 'tmdb.api_mirror_mode': 'lampaProxy' },
      respond: () => {
        throw failure;
      },
    });
    await assert.rejects(source.getPopular({}), (value) => value === failure);
    assert.equal(calls.length, 1);
  }
});

test('explicit servers and custom forwarding proxies do not silently switch servers', async () => {
  for (const options of [
    { 'tmdb.api_mirror_mode': 'official' },
    { 'tmdb.api_mirror_mode': 'lampaProxy', 'tmdb.api_lampa_server': 'cubnotrip.top' },
    {
      'tmdb.api_mirror_mode': 'lampaProxy',
      'tmdb.api_mirror_url': 'https://proxy.example.org/prefix',
    },
    {
      'tmdb.api_mirror_mode': 'directMirror',
      'tmdb.api_mirror_url': 'http://mirror.example.org/prefix',
    },
  ]) {
    const failure = error('network');
    const { source, calls } = fixture({
      options,
      respond: () => {
        throw failure;
      },
    });
    await assert.rejects(source.getPopular({}), (value) => value === failure);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].timeoutMs, undefined);
  }
});

test('official/direct mirror and legacy custom forwarding configurations keep their credentials and path prefixes', async () => {
  for (const [mode, base, path] of [
    ['official', 'https://api.themoviedb.org', '/3/trending/movie/week'],
    ['directMirror', 'http://mirror.example.org:8080/prefix', '/prefix/3/trending/movie/week'],
    [
      'lampaProxy',
      'https://proxy.example.org/prefix',
      '/prefix/https://api.themoviedb.org/3/trending/movie/week',
    ],
  ]) {
    const { source, calls } = fixture({
      token: 'personal.jwt.token',
      options: { 'tmdb.api_mirror_mode': mode, 'tmdb.api_mirror_url': base },
    });
    await source.search();
    assert.equal(new URL(calls[0].url).origin, new URL(base).origin);
    assert.equal(new URL(calls[0].url).pathname, path);
    assert.equal(calls[0].headers.Authorization, 'Bearer personal.jwt.token');
    assert.equal(new URL(calls[0].url).searchParams.has('api_key'), false);
  }
});

test('known Lampa URLs support an optional /3 suffix without exposing personal credentials', async () => {
  for (const suffix of ['', '/', '/3', '/3/']) {
    const { source, calls, sessionReads } = fixture({
      token: 'private',
      options: {
        'tmdb.api_mirror_mode': 'lampaProxy',
        'tmdb.api_mirror_url': `${gateways[1]}${suffix}`,
      },
    });
    await source.search();
    assert.equal(new URL(calls[0].url).pathname, '/3/trending/movie/week');
    assert.equal(calls[0].headers.Authorization, undefined);
    assert.equal(sessionReads(), 0);
  }
});

test('selected Lampa server overrides a stale custom URL and unknown server values use the default pool', async () => {
  for (const [server, expected] of [
    ['cubnotrip.top', gateways[1]],
    ['obsolete', gateways[0]],
    ['toString', gateways[0]],
  ]) {
    const { source, calls } = fixture({
      options: {
        'tmdb.api_mirror_mode': 'lampaProxy',
        'tmdb.api_lampa_server': server,
        ...(server === 'cubnotrip.top' ? { 'tmdb.api_mirror_url': 'https://old.example.org' } : {}),
      },
    });
    await source.search();
    assert.equal(new URL(calls[0].url).origin, expected);
  }
});

test('Lampa artwork works without a custom URL and retains custom proxy formats', async () => {
  for (const [mirror, expected] of [
    ['', 'https://nl.imagetmdb.com'],
    ['https://nl.imagetmdb.com/', 'https://nl.imagetmdb.com'],
    ['https://lampa.byskaz.ru/tmdb/img', 'https://lampa.byskaz.ru/tmdb/img'],
    ['https://proxy.example.org/prefix', 'https://proxy.example.org/prefix/https://image.tmdb.org'],
  ]) {
    const { source } = fixture({
      options: { 'tmdb.image_mirror_mode': 'lampaProxy', 'tmdb.image_mirror_url': mirror },
    });
    const item = await source.loadDetails({ itemId: 'tmdb-movie-42' });
    assert.equal(item.posterUrl, `${expected}/t/p/w342/poster.jpg`);
    assert.equal(item.cast[0].imageUrl, `${expected}/t/p/w185/actor.jpg`);
  }
});
