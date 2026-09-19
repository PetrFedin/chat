import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('browser collection bindings use querySelectorAll helper', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Function(source));
  const singleDollarCollectionCalls = [...source.matchAll(/(?<!\$)\$\([^)]*\)\.forEach/g)].map((match) => match[0]);
  assert.deepEqual(singleDollarCollectionCalls, []);
  assert.ok(source.includes("$$('[data-nav]').forEach"));
  assert.ok(source.includes("$$('[data-conversation],[data-open]').forEach"));
  assert.ok(source.includes("$$('[data-action]').forEach"));
  assert.ok(source.includes("$$('[data-react]').forEach"));
  assert.ok(source.includes("$$('[data-reply]').forEach"));
  assert.ok(source.includes("$$('[data-task-message]').forEach"));
  assert.ok(source.includes("$$('[data-task-open]').forEach"));
});
