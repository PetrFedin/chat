import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

/**
 * Экран задач был плоским списком: закрытые, отменённые и предложенные
 * вперемешку. «Сколько сделано за месяц» приходилось считать глазами,
 * прокручивая всю историю компании, — притом что отбор по состоянию всё
 * это время делался в SQL и его просто некому было передать.
 */
test('задачи отбираются по состоянию и считаются по вкладкам',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Вкладки ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const cookie = owner.cookie;
  const me = owner.payload.session.userId;

  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const make = (title, promisedAt) => request(base, '/api/v1/tasks', {
    cookie, method: 'POST', body: { title, outcome: 'готово', ownerId: me, acceptorId: me, promisedAt } });

  const late = await make('Просроченная', yesterday);
  const soon = await make('Будущая', tomorrow);
  const closing = await make('Закрытая', tomorrow);

  // Доводим одну до закрытия: принять → в работу → доказательство →
  // на проверку → принять результат → закрыть.
  const move = async (task, to, extra = {}) => {
    const current = (await request(base, `/api/v1/tasks/${task}`, { cookie })).payload.task;
    const moved = await request(base, `/api/v1/tasks/${task}/transitions`, {
      cookie, method: 'POST', body: { to, expectedVersion: current.version, ...extra } });
    assert.ok(moved.status < 400, `переход в ${to} не прошёл: ${moved.status} ${moved.code}`);
    return moved;
  };
  const id = closing.payload.task.id;
  await move(id, 'accepted');
  await move(id, 'in_progress');
  const beforeEvidence = (await request(base, `/api/v1/tasks/${id}`, { cookie })).payload.task;
  const evidence = await request(base, `/api/v1/tasks/${id}/evidence`, {
    cookie, method: 'POST', body: { type: 'note', value: 'сделано', expectedVersion: beforeEvidence.version } });
  assert.ok(evidence.status < 400, `доказательство не приложилось: ${evidence.status} ${evidence.code}`);
  await move(id, 'in_review');
  await move(id, 'accepted_result');
  await move(id, 'closed');

  const page = async (query) => (await request(base, `/api/v1/tasks?${query}`, { cookie })).payload;

  const active = await page('status=active&counts=1');
  const titles = active.items.map((task) => task.title).sort();
  assert.deepEqual(titles, ['Будущая', 'Просроченная'], 'во вкладке «в работе» не то');
  assert.equal(active.counts.total, 3);
  assert.equal(active.counts.active, 2);
  assert.equal(active.counts.overdue, 1);
  assert.equal(active.counts.done, 1);

  const overdue = await page('status=overdue');
  assert.deepEqual(overdue.items.map((task) => task.title), ['Просроченная']);

  const done = await page('status=closed,accepted_result');
  assert.deepEqual(done.items.map((task) => task.title), ['Закрытая']);

  const all = await page('');
  assert.equal(all.items.length, 3, 'без отбора должны быть все');

  // Выдуманное состояние не роняет запрос и ничего не находит.
  assert.equal((await page('status=выдумка')).items.length, 0);
  void late; void soon;
});
