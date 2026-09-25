import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createTimeEntryRepository } from '../src/time-tracking/time-entry-repository.js';
import { createChatServer } from '../src/server.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL не задан';

async function sessionFor(store, userId, workspaceId) {
  const tokenHash = hashToken(`time-${randomUUID()}`);
  await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
  return store.getSession(tokenHash);
}

async function company(store) {
  const pass = hashPassword('TimeOwnerPass2026xx');
  const created = await store.createCompany({
    companyName: `Time ${randomUUID().slice(0, 8)}`, ownerName: 'Owner', email: `time-owner-${randomUUID()}@test.local`,
    passwordHash: pass.hash, passwordSalt: pass.salt,
  });
  const owner = await sessionFor(store, created.user.id, created.workspace.id);
  const join = async (role) => {
    const token = randomUUID();
    await store.createInvitation(owner, { email: `time-${role}-${randomUUID()}@test.local`, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 864e5).toISOString() });
    const p = hashPassword('TimeMemberPass2026xx');
    const accepted = await store.acceptInvitation({ tokenHash: hashToken(token), displayName: role, passwordHash: p.hash, passwordSalt: p.salt });
    return sessionFor(store, accepted.user.id, accepted.workspace.id);
  };
  return { owner, join };
}

test('таймер: старт-стоп, одна бегущая запись на человека, длительность и история задачи', { skip }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const { owner } = await company(store);
  const timeEntries = createTimeEntryRepository(pool);

  const task = await store.createTask(owner, { title: 'Подготовить отчёт', ownerId: owner.userId, acceptorId: owner.userId });

  assert.equal(await timeEntries.current(owner), null);
  const started = await timeEntries.start(owner, task.id, { note: 'Собираю данные' });
  assert.equal(started.running, true);
  assert.equal(started.taskId, task.id);

  const current = await timeEntries.current(owner);
  assert.equal(current.id, started.id);
  assert.equal(current.taskTitle, 'Подготовить отчёт');

  await assert.rejects(
    () => timeEntries.start(owner, task.id, {}),
    (err) => err.code === 'TIME_ENTRY_ALREADY_RUNNING' && err.statusCode === 409,
    'второй таймер на того же человека должен быть отклонён базой, а не тихо перезапустить первый',
  );

  await new Promise((resolve) => setTimeout(resolve, 1100));
  const stopped = await timeEntries.stop(owner, started.id);
  assert.equal(stopped.running, false);
  assert.equal(stopped.durationSeconds >= 1, true, 'длительность должна расти по факту прошедшего времени');
  assert.equal(await timeEntries.current(owner), null, 'после остановки бегущего таймера быть не должно');

  await assert.rejects(() => timeEntries.stop(owner, started.id), (err) => err.code === 'TIME_ENTRY_NOT_FOUND', 'повторная остановка уже остановленного таймера — не найдено');

  const forTask = await timeEntries.listForTask(owner, task.id);
  assert.equal(forTask.items.length, 1);
  assert.equal(forTask.totalSeconds, stopped.durationSeconds);
});

test('видимость задачи решает, кто может трекать время; отчёт по команде честно скрывает чужие часы от рядового участника', { skip }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const { owner, join } = await company(store);
  const timeEntries = createTimeEntryRepository(pool);

  const member = await join('member');
  const stranger = await join('member');
  const manager = await join('manager');

  const task = await store.createTask(owner, { title: 'Задача владельца', ownerId: owner.userId, acceptorId: member.userId });

  await assert.rejects(
    () => timeEntries.start(stranger, task.id, {}),
    (err) => err.code === 'TASK_NOT_FOUND' && err.statusCode === 404,
    'посторонний не должен видеть задачу вовсе, а не получать отказ по правам',
  );

  const memberEntry = await timeEntries.start(member, task.id, {});
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await timeEntries.stop(member, memberEntry.id);

  const memberReport = await timeEntries.report(member, { scope: 'team' });
  assert.equal(memberReport.items.length, 1, 'у рядового участника scope=team должен молча свестись к своим часам');
  assert.equal(memberReport.items[0].userId, member.userId);

  const managerReport = await timeEntries.report(manager, { scope: 'team' });
  assert.equal(managerReport.items.some((row) => row.userId === member.userId), true, 'руководителю команды часы участника должны быть видны');
});

test('память без базы честно отвечает 503', async () => {
  const timeEntries = createTimeEntryRepository(null);
  assert.equal(timeEntries.enabled, false);
  assert.throws(() => timeEntries.current({}), (err) => err.code === 'TIME_TRACKING_UNAVAILABLE' && err.statusCode === 503);
});

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload };
}

test('доступ по HTTP: старт/стоп, 409 на второй таймер, and current/report сквозь реальный сервер', { skip }, async (t) => {
  const app = await createChatServer({ databaseUrl, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const suffix = randomUUID().slice(0, 8);
  const registerRes = await request(base, '/api/v1/auth/register-company', { method: 'POST', body: { companyName: `Time HTTP ${suffix}`, ownerName: 'Владелец', email: `time-http-${suffix}@t.test`, password: 'OwnerPassword42' } });
  assert.equal(registerRes.response.status, 201);
  const cookie = registerRes.response.headers.get('set-cookie')?.split(';')[0];

  const taskRes = await request(base, '/api/v1/tasks', { cookie, method: 'POST', body: { title: 'HTTP-задача', outcome: 'Готово' } });
  assert.equal(taskRes.response.status, 201);
  const taskId = taskRes.payload.task.id;

  const startRes = await request(base, `/api/v1/tasks/${taskId}/time-entries/start`, { cookie, method: 'POST', body: {} });
  assert.equal(startRes.response.status, 201);
  const entryId = startRes.payload.id;

  const conflictRes = await request(base, `/api/v1/tasks/${taskId}/time-entries/start`, { cookie, method: 'POST', body: {} });
  assert.equal(conflictRes.response.status, 409);
  assert.equal(conflictRes.payload.error.code, 'TIME_ENTRY_ALREADY_RUNNING');

  const currentRes = await request(base, '/api/v1/time-entries/current', { cookie });
  assert.equal(currentRes.payload.entry.id, entryId);

  const stopRes = await request(base, `/api/v1/time-entries/${entryId}/stop`, { cookie, method: 'POST' });
  assert.equal(stopRes.response.status, 200);
  assert.equal(stopRes.payload.running, false);

  const afterStop = await request(base, '/api/v1/time-entries/current', { cookie });
  assert.equal(afterStop.payload.entry, null);

  const listRes = await request(base, `/api/v1/tasks/${taskId}/time-entries`, { cookie });
  assert.equal(listRes.payload.items.length, 1);

  const reportRes = await request(base, '/api/v1/time-entries/report', { cookie });
  assert.equal(reportRes.response.status, 200);
  assert.equal(reportRes.payload.totalSeconds >= 0, true);

  const noSession = await request(base, '/api/v1/time-entries/current');
  assert.equal(noSession.response.status, 401);
});
