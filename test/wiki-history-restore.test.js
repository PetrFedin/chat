import test from 'node:test';
import assert from 'node:assert/strict';
import {createWikiRepository} from '../src/wiki/wiki-repository.js';

test('Page restore API is unavailable without durable PostgreSQL', () => {
  const wiki=createWikiRepository(null);
  assert.throws(() => wiki.restore({},'invalid',{version:1,expectedVersion:1}),error=>error.code==='WIKI_UNAVAILABLE');
});
