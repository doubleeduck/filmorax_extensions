import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Source API v1: these declarations are checked by the host before activation.
const requiredMethods = {
  catalog: ['getPopular', 'getLatest'],
  search: ['search'],
  filters: ['getFilters'],
  playbackGroups: ['loadPlaybackGroups'],
  streams: ['resolveStream'],
  recommendations: ['getRecommendations'],
};
const offline = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error('Source factories cannot call host APIs during installation');
    },
  },
);

test('every published source implements its declared offline startup contract', async (t) => {
  const config = JSON.parse(await readFile(new URL('../repository.json', import.meta.url)));
  for (const id of config.sourceIds) {
    await t.test(id, async () => {
      const directory = new URL(`../sources/${id}/`, import.meta.url);
      const manifest = JSON.parse(await readFile(new URL('manifest.json', directory)));
      const { default: createSource } = await import(new URL(manifest.entrypoint, directory));
      for (const source of manifest.sources) {
        const instance = createSource(
          Object.freeze({
            sourceId: source.id,
            baseUrl: source.baseUrl,
            parameters: source.parameters ?? {},
            http: offline,
            html: offline,
            settings: offline,
            auth: offline,
            crypto: offline,
            log: offline,
          }),
        );
        assert.ok(
          instance && typeof instance === 'object' && typeof instance.then !== 'function',
          `${id}: source factory must return a synchronous object`,
        );
        const methods = [
          'loadDetails',
          ...source.capabilities.flatMap((capability) => requiredMethods[capability] ?? []),
        ];
        for (const method of methods) {
          assert.equal(
            typeof instance[method],
            'function',
            `${source.id}: missing declared method ${method}`,
          );
        }
      }
    });
  }
});
