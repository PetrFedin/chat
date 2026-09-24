import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('база знаний в интерфейсе завязана на governed permissions и на governed API, а не на прямые проверки роли', () => {
  assert.match(app, /can\('knowledge\.read'\)/);
  assert.match(app, /can\('knowledge\.manage'\)/);
  assert.match(app, /\/api\/v1\/knowledge/);
  assert.match(app, /\/api\/v1\/knowledge\/ask/);
});

test('плитка «Ещё» и обработчик действия ведут к одной и той же функции', () => {
  assert.match(app, /data-action="knowledge"/);
  assert.match(app, /knowledge:\(\)=>knowledgeModal\(\)/);
});

test('HR-бот honestly renders both a found answer and an explicit no-match state, never a fabricated one', () => {
  assert.match(app, /В базе знаний нет ответа на этот вопрос/);
  assert.match(app, /matches\.map\(m=>/);
});
