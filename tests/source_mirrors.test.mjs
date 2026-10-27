import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const mirror = 'http://mirror.example.org:8080/prefix';

for (const name of await readdir(new URL('../sources/', import.meta.url))) {
  const definition = JSON.parse(
    await readFile(new URL(`../sources/${name}/manifest.json`, import.meta.url), 'utf8'),
  ).sources[0];
  const { default: createSource } = await import(`../sources/${name}/src/index.mjs`);
  test(`${name} uses a configured HTTP mirror without losing its route prefix`, async () => {
    const requests = [];
    const source = createSource({
      sourceId: definition.id,
      baseUrl: definition.baseUrl,
      parameters: definition.parameters,
      settings: { network: async () => ({ baseUrl: mirror, options: {} }) },
      auth: {
        getSession: async () => ({ accessToken: '' }),
        status: async () => ({ authorized: false }),
      },
      http: {
        request: async (input) => {
          requests.push(input);
          return { body: input.responseType === 'json' ? {} : '', url: input.url };
        },
      },
      html: {
        extract: async (_, query) => (query.all ? [] : {}),
        text: async (values) => values.map(() => ''),
        extractMany: async (values) => values.map(() => ({})),
      },
    });
    const result = await source.getPopular({ page: 1 });
    assert.deepEqual(result.items, []);
    assert.ok(requests.length > 0);
    const first = requests[0],
      url = new URL(first.url);
    if (name === 'flixbaba') {
      assert.equal(url.origin, new URL(definition.parameters.apiOrigin).origin);
      assert.equal(first.headers.Origin, new URL(mirror).origin);
    } else {
      assert.equal(url.origin, new URL(mirror).origin);
      assert.ok(url.pathname.startsWith('/prefix/'), url.href);
    }
    const grant = definition.network;
    assert.equal(grant.allowUserBaseUrl, true);
    if (definition.capabilities.includes('auth'))
      assert.ok(grant.userBaseUrlUses.includes('httpAndAuth'));
  });
}

test('FlixBaba separates the API mirror from its site mirror', async () => {
  const { default: createSource } = await import('../sources/flixbaba/src/index.mjs');
  let request;
  const source = createSource({
    baseUrl: 'https://site.example.org',
    parameters: { apiOrigin: 'https://api.example.org', apiKey: 'fixture' },
    settings: {
      network: async () => ({
        baseUrl: mirror,
        options: { 'flixbaba.api_url': 'http://api-mirror.example.org/api' },
      }),
    },
    http: {
      request: async (input) => {
        request = input;
        return { body: {} };
      },
    },
  });
  await source.getPopular({ page: 1 });
  assert.ok(request.url.startsWith('http://api-mirror.example.org/api/3/'));
  assert.equal(request.headers.Origin, new URL(mirror).origin);
});

for (const name of ['kinogo', 'hdrezka', 'twodhive', 'anitokyo']) {
  test(`${name} resolves catalogue images against the final redirected page`, async () => {
    const definition = JSON.parse(
      await readFile(new URL(`../sources/${name}/manifest.json`, import.meta.url), 'utf8'),
    ).sources[0];
    const { default: createSource } = await import(`../sources/${name}/src/index.mjs`);
    const finalUrl = 'http://redirected.example.org/catalog/page/2';
    const row = {
      href: '/anime/fixture.html',
      url: name === 'hdrezka' ? '/filmy/123-fixture.html' : '/123-fixture.html',
      title: 'Fixture',
      image: { src: 'poster.jpg' },
      poster: { src: 'poster.jpg' },
      facts: [],
      html: '',
    };
    const source = createSource({
      sourceId: definition.id,
      baseUrl: definition.baseUrl,
      parameters: definition.parameters,
      settings: { network: async () => ({ baseUrl: mirror, options: {} }) },
      http: { request: async () => ({ body: '<html>Fixture</html>', url: finalUrl }) },
      html: {
        extract: async () => ({
          cards: [
            name === 'twodhive'
              ? { href: '/anime?anime=1', title: 'Fixture', image: 'poster.jpg' }
              : row,
          ],
          all: [row],
          links: [],
          next: [],
        }),
        text: async (values) => values.map(() => ''),
      },
    });
    const result = await source.getPopular({ page: 1 });
    assert.equal(result.items.length, 1);
    assert.equal(
      result.items[0].posterUrl,
      'http://redirected.example.org/catalog/page/poster.jpg',
    );
    if (result.items[0].webUrl)
      assert.equal(new URL(result.items[0].webUrl).origin, new URL(finalUrl).origin);
  });
}

test('the shared site engine retains episode parsing after a redirected details response', async () => {
  const { default: createSource } = await import('../engines/anitokyo.mjs');
  const page = 'http://redirected.example.org/anime/fixture.html';
  const source = createSource({
    sourceId: 'anitokyo',
    baseUrl: 'https://site.example.org',
    parameters: { isNsfw: 'false' },
    settings: { network: async () => ({ baseUrl: mirror }) },
    http: {
      request: async () => ({
        url: page,
        body:
          'RalodePlayer.init(' +
          JSON.stringify({
            voice: {
              name: 'Voice',
              items: {
                one: {
                  id: 1,
                  aname: 'Episode 1',
                  scode: '<iframe src="/video.php?id=1"></iframe>',
                },
              },
            },
          }) +
          ');',
      }),
    },
    html: {
      extract: async () => ({
        title: 'Fixture',
        poster: { src: 'poster.jpg' },
        facts: [],
        related: [],
      }),
      extractMany: async (rows) => rows.map(() => '/video.php?id=1'),
    },
  });
  const details = await source.loadDetails({ itemId: 'anitokyo-anime%2Ffixture' });
  assert.equal(details.playbackGroups.length, 1);
  const episode = new URL(details.playbackGroups[0].episodes[0].url);
  assert.equal(new URL(episode.searchParams.get('url')).origin, new URL(page).origin);
});
