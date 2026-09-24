import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
process.env.VAULT_KEY ||= randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

async function call(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'idempotency-key': randomUUID(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

/**
 * Повышение и понижение сотрудника.
 *
 * Сменить роль было нечем: ни маршрута, ни кнопки. Повысить человека до
 * руководителя можно было единственным способом — пригласить его заново
 * с нужной ролью, потеряв всё, что за ним числится. В живой компании
 * роли меняются чаще, чем люди.
 */
test('сотрудника повышают и понижают, а владение передают отдельно',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = randomUUID().slice(0, 8);

  const owner = await call(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Лестница ${suffix}`, ownerName: 'Владелец', email: `rl-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const ownerId = (await call(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.session.userId;
  const join = async (role, mail, displayName) => {
    const invitation = await call(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: mail, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const accepted = await call(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName, password: 'MemberPassword42' } });
    const boot = await call(base, '/api/v1/bootstrap', { cookie: accepted.cookie });
    return { cookie: accepted.cookie, id: boot.payload.session.userId };
  };
  const worker = await join('member', `rw-${suffix}@t.test`, 'Сотрудник');
  const chief = await join('manager', `rc-${suffix}@t.test`, 'Руководитель');

  // Задача, заведённая до повышения, остаётся при человеке.
  const task = (await call(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST', body: { title: 'Свести смету', ownerId: worker.id },
  })).payload.task;

  const promoted = await call(base, `/api/v1/people/${worker.id}/role`, {
    cookie: owner.cookie, method: 'PUT', body: { role: 'manager' } });
  assert.equal(promoted.status, 200, `повысить не вышло: ${promoted.code}`);
  assert.equal(promoted.payload.person.workspaceRole, 'manager');

  // Сеанс со старыми правами закрыт: иначе человек доработал бы день с
  // прежними, а на экране у него были бы новые кнопки.
  assert.equal((await call(base, '/api/v1/me', { cookie: worker.cookie })).status, 401);
  const again = await call(base, '/api/v1/auth/login', {
    method: 'POST', body: { email: `rw-${suffix}@t.test`, password: 'MemberPassword42' } });
  assert.equal(again.payload.session.role, 'manager');
  assert.ok(again.payload.session.permissions.includes('task.manage.team'));

  // Задача никуда не делась.
  assert.equal((await call(base, `/api/v1/tasks/${task.id}`, { cookie: again.cookie })).payload.task.title, 'Свести смету');

  // И обратно.
  assert.equal((await call(base, `/api/v1/people/${worker.id}/role`, {
    cookie: owner.cookie, method: 'PUT', body: { role: 'member' } })).payload.person.workspaceRole, 'member');

  // Границы: владение передаётся отдельно, свою роль не меняют, выше
  // себя не назначают, равного не трогают.
  assert.equal((await call(base, `/api/v1/people/${worker.id}/role`, {
    cookie: owner.cookie, method: 'PUT', body: { role: 'owner' } })).code, 'INVALID_ROLE');
  assert.equal((await call(base, `/api/v1/people/${ownerId}/role`, {
    cookie: owner.cookie, method: 'PUT', body: { role: 'admin' } })).code, 'CANNOT_CHANGE_OWN_ROLE');
  assert.equal((await call(base, `/api/v1/people/${worker.id}/role`, {
    cookie: chief.cookie, method: 'PUT', body: { role: 'admin' } })).status, 403);

  // Смена роли попадает в журнал — по ней видно, кто кого поднял.
  const journal = (await call(base, '/api/v1/audit', { cookie: owner.cookie })).payload.items;
  const row = journal.find((item) => item.eventType === 'member.role_changed');
  assert.ok(row, 'смена роли не отмечена в журнале');
  assert.equal(row.payload.to, 'member');
  assert.equal(row.payload.from, 'manager');
});
