import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';
import { MemoryStore } from '../src/persistence/store.js';

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
 * Дашборд не третий источник правды: тоталы должны буквально совпасть
 * с тем, что отдают /api/v1/tasks/report и /api/v1/time-entries/report
 * по тем же границам — иначе два экрана в приложении рано или поздно
 * покажут разные числа за один и тот же период.
 */
test('дашборд отдаёт дневной ряд и совпадает по тоталам с отдельными отчётами',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Дашборд ${suffix}`, ownerName: 'Директор', email: `dash-own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });

  const task = (await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST', body: { title: 'Задача для дашборда' },
  })).payload.task;

  const start = await request(base, `/api/v1/tasks/${task.id}/time-entries/start`, { cookie: owner.cookie, method: 'POST', body: {} });
  assert.equal(start.status, 201);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await request(base, `/api/v1/time-entries/${start.payload.id}/stop`, { cookie: owner.cookie, method: 'POST' });

  const dashboard = await request(base, '/api/v1/dashboard', { cookie: owner.cookie });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.payload.scope, 'team');
  assert.ok(Array.isArray(dashboard.payload.tasks.daily), 'должен быть дневной ряд по задачам');
  assert.ok(dashboard.payload.tasks.daily.length >= 28, 'ряд за 30 дней по умолчанию должен покрывать весь диапазон, включая пустые дни');
  const today = dashboard.payload.tasks.daily.at(-1);
  assert.equal(today.created, 1, 'сегодняшняя задача должна попасть в ряд созданных');

  assert.ok(Array.isArray(dashboard.payload.time.daily), 'должен быть дневной ряд по времени');
  assert.ok(dashboard.payload.time.totalSeconds >= 1);
  const todayTime = dashboard.payload.time.daily.at(-1);
  assert.ok(todayTime.totalSeconds >= 1, 'трекнутая сегодня секунда должна попасть в дневной ряд времени');

  const taskReport = await request(base, '/api/v1/tasks/report', { cookie: owner.cookie });
  assert.equal(dashboard.payload.tasks.totals.created, taskReport.payload.totals.created, 'тоталы дашборда обязаны совпасть с отдельным отчётом по задачам');

  const timeReport = await request(base, '/api/v1/time-entries/report', { cookie: owner.cookie });
  assert.equal(dashboard.payload.time.totalSeconds, timeReport.payload.totalSeconds, 'тоталы дашборда обязаны совпасть с отдельным отчётом по времени');

  const mine = await request(base, '/api/v1/dashboard?scope=mine', { cookie: owner.cookie });
  assert.equal(mine.payload.scope, 'mine');
});

test('без базы дашборд честно отвечает 503, а не тихо молчит', async (t) => {
  const app = await createChatServer({ startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST', body: { companyName: 'Без базы', ownerName: 'Владелец', email: `nodash-${Math.random().toString(36).slice(2, 7)}@t.test`, password: 'OwnerPassword42' },
  });
  const res = await request(base, '/api/v1/dashboard', { cookie: owner.cookie });
  assert.equal(res.status, 503);
  assert.equal(res.code, 'REPORT_UNAVAILABLE');
});
