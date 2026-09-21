import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/persistence/daily-work-store.js', import.meta.url), 'utf8');

/**
 * «Что сегодня горит» — главный вопрос к первому экрану, и продукт на него
 * не отвечал: слова «просрочено» не было во всём интерфейсе, а счётчики
 * внимания считали только задачи, которыми человек владеет, — руководитель
 * видел вечные нули, пока в компании горели шесть просроченных.
 */
test('просрочка видна в строке задачи', () => {
  const overdue = app.slice(app.indexOf('const taskOverdue='));
  const body = overdue.slice(0, overdue.indexOf('\nfunction taskRow'));
  const fn = new Function(`${body}; return { taskOverdue, taskDueSoon };`)();

  const day = 24 * 3600 * 1000;
  assert.equal(fn.taskOverdue({ promisedAt: new Date(Date.now() - day).toISOString(), status: 'in_progress' }), true);
  assert.equal(fn.taskOverdue({ promisedAt: new Date(Date.now() + day).toISOString(), status: 'in_progress' }), false);
  // Закрытая задача не горит, сколько бы ни прошло.
  assert.equal(fn.taskOverdue({ promisedAt: new Date(Date.now() - day).toISOString(), status: 'closed' }), false);
  assert.equal(fn.taskOverdue({ status: 'in_progress' }), false, 'задача без срока не может быть просрочена');
  assert.equal(fn.taskDueSoon({ promisedAt: new Date(Date.now() + 3600e3).toISOString(), status: 'accepted' }), true);
  assert.equal(fn.taskDueSoon({ promisedAt: new Date(Date.now() - day).toISOString(), status: 'accepted' }), false);

  assert.match(app, /просрочено — /, 'слово «просрочено» снова исчезло из интерфейса');
  assert.match(app, /class="task-card pressable\$\{late\?' overdue':''\}/);
});

test('счётчики внимания считают обязательство целиком, а не только своё владение', () => {
  assert.match(store, /owner_id=\$2 OR requester_id=\$2 OR acceptor_id=\$2/,
    'руководитель снова видит нули: считается только то, чем он владеет');
  assert.match(store, /\[t\.ownerId, t\.requesterId, t\.acceptorId\]\.includes\(session\.userId\)/);
});

test('задачу, которая ждёт решения, видно и можно принять из строки', () => {
  assert.match(app, /function answerNeededSection\(\)/);
  assert.match(app, /\$\{answerNeededSection\(\)\}/, 'блок не вставлен на экран');
  assert.match(app, /data-answer-task="\$\{esc\(t\.id\)\}" data-answer-to="accepted"/);
  assert.match(app, /expectedVersion:task\.version/, 'переход уходит без версии — потеряется на гонке');
});
