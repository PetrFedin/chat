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

// Право звать людей — это не право раздавать полномочия выше своих.
// Руководитель выписывал приглашение администратора, принимал его сам и
// получал двадцать три права вместо шестнадцати; ссылка возвращается
// прямо в теле ответа, так что второй человек для этого не нужен.
test('an invitation cannot hand out more than the inviter has', { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Лестница ${suffix}`, ownerName: 'Владелец', email: `owner-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invite = (cookie, role, tag) => request(base, '/api/v1/invitations', {
    cookie, method: 'POST', body: { email: `${tag}-${suffix}@t.test`, role } });

  const chiefInvite = await invite(owner.cookie, 'manager', 'chief');
  const token = new URL(chiefInvite.payload.invitation.inviteUrl).searchParams.get('invite');
  const chief = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Руководитель', password: 'OwnerPassword42' } });

  // Выше своей ступени — отказ.
  const asAdmin = await invite(chief.cookie, 'admin', 'a1');
  assert.equal(asAdmin.status, 403, 'руководитель выписал приглашение администратора');
  assert.equal(asAdmin.code, 'INVITE_ROLE_TOO_HIGH');

  // Своя ступень и ниже — можно.
  for (const [role, tag] of [['manager', 'm1'], ['member', 'e1'], ['guest', 'g1']]) {
    const allowed = await invite(chief.cookie, role, tag);
    assert.equal(allowed.status, 201, `руководителю не дали позвать «${role}»`);
  }

  // Владельца приглашением не заводят: передача компании — отдельная
  // осознанная операция, а не ссылка на семь дней.
  const asOwner = await invite(owner.cookie, 'owner', 'o1');
  assert.equal(asOwner.code, 'INVALID_INVITE_ROLE');
  const nonsense = await invite(owner.cookie, 'король', 'k1');
  assert.equal(nonsense.code, 'INVALID_INVITE_ROLE');

  // Владелец по-прежнему может звать администратора.
  const ownerInvitesAdmin = await invite(owner.cookie, 'admin', 'a2');
  assert.equal(ownerInvitesAdmin.status, 201);
});
