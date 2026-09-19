import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('task lifecycle browser surface parses and exposes execution controls',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/data-task-open/);
  assert.match(source,/function openTask\(/);
  assert.match(source,/function taskDetailModal\(/);
  assert.match(source,/expectedVersion:task\.version/);
  assert.match(source,/\/api\/v1\/tasks\/\$\{task\.id\}\/transitions/);
  assert.match(source,/\/api\/v1\/tasks\/\$\{task\.id\}\/evidence/);
  assert.match(source,/\/api\/v1\/tasks\/\$\{task\.id\}\/schedule/);
  assert.match(source,/Ответственность → выполнение → доказательство → проверка → закрытие/);
  assert.match(source,/task\.updated/);
});
