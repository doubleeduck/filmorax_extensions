import test from 'node:test';
import assert from 'node:assert/strict';
import { titlePath, catalogPath } from '../sources/kinogo/src/index.mjs';
test('Kinogo identifiers and filter paths cannot escape their site routes', () => {
  assert.equal(titlePath('/104087-title.html'), '104087-title');
  assert.equal(titlePath('/../../secret.html'), '');
  assert.equal(catalogPath('/filmy/genre-filmy-komediya/'), '/filmy/genre-filmy-komediya/');
  assert.equal(catalogPath('/ads/'), '');
});
