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

async function fixture(t) {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 8);
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Пробелы ${suffix}`, ownerName: 'Владелец', email: `gap-${suffix}@test.test`, password: 'OwnerPassword42' },
  });
  const join = async (email, displayName, role) => {
    const invitation = await request(base, '/api/v1/invitations', { cookie: owner.cookie, method: 'POST', body: { email, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const accepted = await request(base, '/api/v1/invitations/accept', { method: 'POST', body: { token, displayName, password: 'OwnerPassword42' } });
    const boot = await request(base, '/api/v1/bootstrap', { cookie: accepted.cookie });
    return { cookie: accepted.cookie, userId: boot.payload.session.userId };
  };
  return { base, owner, join, suffix };
}

// Справочник жил только внутри /bootstrap: клиент, которому нужны коллеги,
// спрашивал /people и получал 404.
test('the staff directory has an address of its own', { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const { base, owner, join } = await fixture(t);
  const mate = await join(`mate-${Math.random().toString(36).slice(2, 7)}@test.test`, 'Сотрудник', 'member');
  const guest = await join(`client-${Math.random().toString(36).slice(2, 7)}@test.test`, 'Заказчик', 'guest');

  const listed = await request(base, '/api/v1/people', { cookie: owner.cookie });
  assert.equal(listed.status, 200);
  const names = listed.payload.items.map((p) => p.displayName).sort();
  assert.deepEqual(names, ['Владелец', 'Заказчик', 'Сотрудник']);

  // Тот же список, что в /bootstrap, — не второй источник правды.
  const boot = await request(base, '/api/v1/bootstrap', { cookie: owner.cookie });
  assert.deepEqual(listed.payload.items, boot.payload.people);

  // Гость видит только тех, с кем он в одной комнате: ни с кем.
  const theirs = await request(base, '/api/v1/people', { cookie: guest.cookie });
  assert.deepEqual(theirs.payload.items.map((p) => p.displayName), ['Заказчик']);
  assert.ok(mate.userId);
});

// Поле participantIds при создании встречи молча игнорировалось.
test('a meeting created with participants actually invites them', { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const { base, owner, join } = await fixture(t);
  const mate = await join(`peer-${Math.random().toString(36).slice(2, 7)}@test.test`, 'Коллега', 'member');

  const at = new Date(Date.now() + 2 * 24 * 3600e3).toISOString();
  const created = await request(base, '/api/v1/calendar-events', {
    cookie: owner.cookie, method: 'POST',
    body: { kind: 'meeting', title: 'Планёрка', startAt: at, endAt: new Date(Date.parse(at) + 3600e3).toISOString(),
      participantIds: [mate.userId] },
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.invited, 1, 'приглашённые не записаны');

  const from = new Date(Date.now() - 864e5).toISOString(), to = new Date(Date.now() + 7 * 864e5).toISOString();
  const theirs = await request(base, `/api/v1/calendar-events?from=${from}&to=${to}`, { cookie: mate.cookie });
  const mine = theirs.payload.items.find((e) => e.id === created.payload.event.id);
  assert.ok(mine, 'приглашённый не видит встречу');
  assert.equal(mine.needsMyAnswer, true);
});

// Роль в подразделении меняется повторным POST; разработчик берётся за
// PATCH и получал 404.
test('a unit member role changes through the verb people reach for', { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const { base, owner, join } = await fixture(t);
  const mate = await join(`unit-${Math.random().toString(36).slice(2, 7)}@test.test`, 'Инженер', 'member');
  const unit = (await request(base, '/api/v1/org/units', {
    cookie: owner.cookie, method: 'POST', body: { name: 'Отдел изысканий', kind: 'division' },
  })).payload.unit;
  await request(base, `/api/v1/org/units/${unit.id}/members`, {
    cookie: owner.cookie, method: 'POST', body: { userId: mate.userId, role: 'member' },
  });

  const empty = await request(base, `/api/v1/org/units/${unit.id}/members/${mate.userId}`, {
    cookie: owner.cookie, method: 'PATCH', body: {},
  });
  assert.equal(empty.code, 'EMPTY_UNIT_MEMBER_PATCH');

  const promoted = await request(base, `/api/v1/org/units/${unit.id}/members/${mate.userId}`, {
    cookie: owner.cookie, method: 'PATCH', body: { role: 'head' },
  });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.payload.member.role, 'head');

  const members = await request(base, `/api/v1/org/units/${unit.id}/members`, { cookie: owner.cookie });
  assert.equal(members.payload.items.find((m) => m.userId === mate.userId).role, 'head');
  const tree = await request(base, '/api/v1/org/units', { cookie: owner.cookie });
  assert.equal(tree.payload.items.find((u) => u.id === unit.id).headUserId, mate.userId,
    'руководитель подразделения не обновился');
});
