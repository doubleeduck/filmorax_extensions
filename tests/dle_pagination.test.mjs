import test from 'node:test';
import assert from 'node:assert/strict';
import kinogo from '../sources/kinogo/src/index.mjs';
import hdrezka from '../sources/hdrezka/src/index.mjs';

for (const [name, factory, base, selector] of [
  ['Kinogo', kinogo, 'https://go3.kinogo.cc', '.bot-hikinogo_navigation a'],
  ['HDRezka', hdrezka, 'https://hdrezka.inc', '.pagiNation a'],
]) {
  test(`${name} follows current site pagination even when a page has fewer than 20 cards`, async () => {
    const requests = [];
    const row = {
      url: base + (name === 'Kinogo' ? '/42-film.html' : '/filmy/42-film.html'),
      title: 'Film',
      image: { src: '/poster.jpg' },
      html: '',
    };
    const source = factory({
      baseUrl: base,
      settings: { network: async () => ({}) },
      http: {
        request: async (input) => {
          requests.push(input);
          return { body: new URL(input.url).pathname.includes('/page/2/') ? 'last' : 'first' };
        },
      },
      html: {
        extract: async (body, query) => {
          if (query.fields.next) assert.ok(query.fields.next.selector.includes(selector));
          const next = body === 'first' ? [{ url: base + '/page/2/', name: '2', label: '2' }] : [];
          return name === 'Kinogo' ? { cards: [row], next } : { primary: { cards: [row] }, next };
        },
        text: async (bodies) => bodies.map(() => ''),
      },
    });
    const first = await source.getPopular({ page: 1 });
    assert.equal(first.items.length, 1);
    assert.equal(first.hasMore, true);
    const last = await source.getPopular({ page: 2 });
    assert.equal(last.hasMore, false);
    assert.ok(new URL(requests.at(-1).url).pathname.endsWith('/page/2/'));
    if (name === 'HDRezka') {
      await source.search({ page: 2, searchTerm: 'Film' });
      assert.equal(new URL(requests.at(-1).url).searchParams.get('search_start'), '2');
    }
  });
}
