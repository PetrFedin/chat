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
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0],
    requestId: response.headers.get('x-request-id') };
}

/**
 * Подбор паролей не оставлял следа: девять одинаковых строк в журнале без
 * адреса, почты и времени, и ни одного события входа в журнале аудита —
 * хотя именно за этим к нему и приходят.
 */
test('вход и неудачная попытка остаются в журнале рабочего пространства',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const email = `own-${suffix}@t.test`;

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Вход ${suffix}`, ownerName: 'Владелец', email, password: 'OwnerPassword42' },
  });
  assert.ok(owner.requestId, 'у ответа нет признака запроса — цепочку в журнале не собрать');

  // Три неудачные попытки и один успешный вход.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await request(base, '/api/v1/auth/login', {
      method: 'POST', body: { email, password: 'НеТотПароль1' } })).status, 401);
  }
  assert.equal((await request(base, '/api/v1/auth/login', {
    method: 'POST', body: { email, password: 'OwnerPassword42' } })).status, 200);

  const journal = await request(base, '/api/v1/audit?type=membership', { cookie: owner.cookie });
  const kinds = journal.payload.items.map((item) => item.eventType);
  assert.equal(kinds.filter((kind) => kind === 'auth.login.failed').length, 3, 'неудачные попытки не записаны');
  assert.ok(kinds.includes('auth.login.succeeded'), 'успешный вход не записан');

  const failed = journal.payload.items.find((item) => item.eventType === 'auth.login.failed');
  assert.equal(failed.payload.reason, 'bad_password');
  assert.ok(failed.payload.ip, 'не записано, откуда пришли');

  // Неизвестная почта писать в чужое пространство не должна: его просто нет.
  const before = journal.payload.items.length;
  await request(base, '/api/v1/auth/login', { method: 'POST', body: { email: `ghost-${suffix}@t.test`, password: 'ЧтоУгодно1234' } });
  const after = await request(base, '/api/v1/audit?type=membership', { cookie: owner.cookie });
  assert.equal(after.payload.items.length, before, 'попытка с чужой почтой попала в чужой журнал');
});

test('/readyz отвечает за готовность, а не только за жизнь',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const ready = await request(base, '/readyz');
  assert.equal(ready.status, 200);
  assert.equal(ready.payload.ready, true);
  // База спрашивается на деле, а не по конфигурации.
  assert.equal(ready.payload.checks.database.ok, true);
  assert.ok(Number.isFinite(ready.payload.checks.database.latencyMs));
  // Хранилище тоже: «enabled:true» было константой и ничего не значило.
  assert.equal(ready.payload.checks.objects.ok, true);
  // Исчерпанный пул — вторая по частоте причина «всё висит».
  assert.ok(Number.isInteger(ready.payload.pool.total));
  assert.ok(Number.isInteger(ready.payload.pool.waiting));
  assert.ok(Number.isInteger(ready.payload.process.rssMb));
  assert.ok(Number.isInteger(ready.payload.realtime.sockets));
});
