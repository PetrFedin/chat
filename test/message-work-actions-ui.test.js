import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('message work action browser surface parses and preserves collection bindings',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.doesNotThrow(()=>new Function(source));
  const singleDollarCollections=[...source.matchAll(/(?<!\$)\$\([^)]*\)\.forEach/g)].map(match=>match[0]);
  assert.deepEqual(singleDollarCollections,[]);
  for(const token of [
    'data-message-save',
    'data-message-pin',
    'data-message-forward',
    'data-message-edit',
    'data-message-delete',
    'function pinsModal(',
    'function savedModal(',
    'function toggleMute(',
    'function archiveCurrent(',
    'function archivedModal(',
    'function openChatAtMessage(',
    "params.get('message')",
    'data-forward-origin-conversation',
    'Пересланное сообщение',
  ]) assert.ok(source.includes(token),`missing browser contract: ${token}`);
});
