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

// Право calendar.manage.team было объявлено ролью и не проверялось нигде.
// Встречу организатора, который уволился, не мог ни перенести, ни
// отменить, ни доукомплектовать никто — включая владельца компании.
test('a meeting outlives its organiser', { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Встречи ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const join = async (tag, role) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: `${tag}-${suffix}@t.test`, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const accepted = await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: tag, password: 'OwnerPassword42' } });
    const boot = await request(base, '/api/v1/bootstrap', { cookie: accepted.cookie });
    return { cookie: accepted.cookie, userId: boot.payload.session.userId };
  };
  const leaver = await join('ushel', 'member');
  const chief = await join('chief', 'manager');
  const bystander = await join('member', 'member');

  const at = new Date(Date.now() + 3 * 24 * 3600e3).toISOString();
  const event = await request(base, '/api/v1/calendar-events', {
    cookie: leaver.cookie, method: 'POST',
    body: { kind: 'meeting', title: 'Планёрка уволившегося', startAt: at, endAt: new Date(Date.parse(at) + 3600e3).toISOString() },
  });
  const id = event.payload.event.id;

  // Посторонний сотрудник не видит её и не может тронуть — и не узнаёт,
  // что она вообще есть.
  const denied = await request(base, `/api/v1/calendar-events/${id}`, {
    cookie: bystander.cookie, method: 'PATCH', body: { title: 'моё' } });
  assert.equal(denied.status, 404, 'посторонний дотянулся до чужой встречи');

  // Тот, кому доверены чужие встречи, переносит и отменяет.
  const moved = await request(base, `/api/v1/calendar-events/${id}`, {
    cookie: chief.cookie, method: 'PATCH',
    body: { startAt: new Date(Date.parse(at) + 7200e3).toISOString(),
            endAt: new Date(Date.parse(at) + 10800e3).toISOString() } });
  assert.equal(moved.status, 200, 'руководитель не может перенести встречу уволившегося');

  const invited = await request(base, `/api/v1/calendar-events/${id}/participants`, {
    cookie: chief.cookie, method: 'POST', body: { userIds: [bystander.userId] } });
  assert.equal(invited.status, 201, 'руководитель не может доукомплектовать встречу');

  const cancelled = await request(base, `/api/v1/calendar-events/${id}`, { cookie: chief.cookie, method: 'DELETE' });
  assert.ok([200, 204].includes(cancelled.status), 'руководитель не может отменить встречу уволившегося');

  // Доступ для ведения — не доступ для чтения: чужая закрытая встреча не
  // появляется в собственном календаре руководителя.
  const second = await request(base, '/api/v1/calendar-events', {
    cookie: leaver.cookie, method: 'POST',
    body: { kind: 'meeting', title: 'Закрытая', startAt: at, endAt: new Date(Date.parse(at) + 1800e3).toISOString() } });
  assert.equal(second.status, 201);
  const from = new Date(Date.now() - 864e5).toISOString(), to = new Date(Date.now() + 30 * 864e5).toISOString();
  const chiefCalendar = await request(base, `/api/v1/calendar-events?from=${from}&to=${to}`, { cookie: chief.cookie });
  assert.ok(!chiefCalendar.payload.items.some((e) => e.title === 'Закрытая'),
    'чужая закрытая встреча попала в календарь руководителя');
});
