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
  return { status: response.status, payload, cookie: response.headers.get('set-cookie')?.split(';')[0], code: payload?.error?.code };
}

async function fixture(t) {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 8);
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Напоминания ${suffix}`, ownerName: 'Владелец', email: `rem-${suffix}@granit.test`, password: 'OwnerPassword42' },
  });
  return { app, base, owner };
}

test('a reminder waits for its hour and then comes to the attention center', { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const { app, base, owner } = await fixture(t);

  // Прошлое дальше суток — это не напоминание, а запись задним числом.
  const stale = await request(base, '/api/v1/reminders', {
    cookie: owner.cookie, method: 'POST',
    body: { title: 'Позвонить вчера', remindAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString() },
  });
  assert.equal(stale.code, 'REMIND_AT_TOO_OLD');

  const empty = await request(base, '/api/v1/reminders', {
    cookie: owner.cookie, method: 'POST', body: { title: '   ', remindAt: new Date().toISOString() },
  });
  assert.equal(empty.code, 'INVALID_REMINDER_TITLE');

  const soon = new Date(Date.now() - 60_000).toISOString();
  const created = await request(base, '/api/v1/reminders', {
    cookie: owner.cookie, method: 'POST',
    body: { title: 'Позвонить подрядчику', note: 'Уточнить сроки по свае', remindAt: soon },
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.reminder.status, 'pending');

  const listed = await request(base, '/api/v1/reminders', { cookie: owner.cookie });
  assert.equal(listed.payload.items.length, 1);

  // Час пришёл: работник будит напоминание ровно один раз.
  const first = await app.reminderWorker.tick();
  assert.equal(first.fired, 1);
  const second = await app.reminderWorker.tick();
  assert.equal(second.fired, 0, 'второй проход разбудил то же напоминание ещё раз');

  const afterFire = await request(base, '/api/v1/reminders', { cookie: owner.cookie });
  assert.equal(afterFire.payload.items[0].status, 'fired');

  const bare = await request(base, '/api/v1/reminders', {
    cookie: owner.cookie, method: 'POST',
    body: { title: 'Без заметки', remindAt: new Date(Date.now() - 30_000).toISOString() },
  });
  assert.equal(bare.status, 201);
  assert.equal(await app.reminderWorker.tick().then((r) => r.fired), 1, 'напоминание без заметки не сработало');

  const notifications = await request(base, '/api/v1/notifications?limit=20', { cookie: owner.cookie });
  const mine = (notifications.payload.items || []).find((n) => n.title === 'Позвонить подрядчику');
  assert.ok(mine, 'напоминание не дошло до центра внимания');
  assert.equal(mine.body, 'Уточнить сроки по свае');

  // Отложить — значит снова ждать часа.
  const later = new Date(Date.now() + 3600_000).toISOString();
  const snoozed = await request(base, `/api/v1/reminders/${created.payload.reminder.id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { remindAt: later },
  });
  assert.equal(snoozed.payload.reminder.status, 'pending');
  assert.equal(await app.reminderWorker.tick().then((r) => r.fired), 0, 'отложенное разбудили раньше часа');

  const done = await request(base, `/api/v1/reminders/${created.payload.reminder.id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { status: 'done' },
  });
  assert.equal(done.payload.reminder.status, 'done');
  assert.ok(done.payload.reminder.completedAt);
  const open = await request(base, '/api/v1/reminders', { cookie: owner.cookie });
  assert.deepEqual(open.payload.items.map((r) => r.title), ['Без заметки'], 'сделанное осталось в открытых');
  const finished = await request(base, '/api/v1/reminders?status=done', { cookie: owner.cookie });
  assert.deepEqual(finished.payload.items.map((r) => r.title), ['Позвонить подрядчику']);
});

test('a reminder belongs to the person who set it', { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const { base, owner } = await fixture(t);
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mate-${Math.random().toString(36).slice(2, 8)}@granit.test`, role: 'member' },
  });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const mate = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Сотрудник', password: 'OwnerPassword42' },
  });

  const mine = await request(base, '/api/v1/reminders', {
    cookie: owner.cookie, method: 'POST',
    body: { title: 'Моё напоминание', remindAt: new Date(Date.now() + 3600_000).toISOString() },
  });
  assert.equal(mine.status, 201);

  const theirList = await request(base, '/api/v1/reminders', { cookie: mate.cookie });
  assert.deepEqual(theirList.payload.items, [], 'чужое напоминание видно');

  const theirPatch = await request(base, `/api/v1/reminders/${mine.payload.reminder.id}`, {
    cookie: mate.cookie, method: 'PATCH', body: { status: 'done' },
  });
  assert.equal(theirPatch.code, 'REMINDER_NOT_FOUND', 'чужое напоминание можно закрыть');

  const theirDelete = await request(base, `/api/v1/reminders/${mine.payload.reminder.id}`, {
    cookie: mate.cookie, method: 'DELETE',
  });
  assert.equal(theirDelete.code, 'REMINDER_NOT_FOUND', 'чужое напоминание можно удалить');
});
