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

// Право organization.manage было единственным отличием владельца от
// администратора — и не проверялось нигде, то есть отличия не было.
test('компанию переименовывает и передаёт только хозяин',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const PASSWORD = 'OwnerPassword42';

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Гранит ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: PASSWORD },
  });
  const join = async (tag, role) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: `${tag}-${suffix}@t.test`, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const session = await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: tag, password: PASSWORD } });
    const person = (await request(base, '/api/v1/people', { cookie: owner.cookie }))
      .payload.items.find((p) => p.email === `${tag}-${suffix}@t.test`);
    return { ...session, userId: person.userId };
  };
  const deputy = await join('deputy', 'admin');
  const guest = await join('client', 'guest');

  // Администратор ведёт всё, кроме самой компании.
  assert.equal((await request(base, '/api/v1/workspace', {
    cookie: deputy.cookie, method: 'PATCH', body: { companyName: 'Захват' } })).status, 403);

  const renamed = await request(base, '/api/v1/workspace', {
    cookie: owner.cookie, method: 'PATCH', body: { companyName: `Алмаз ${suffix}` } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.payload.workspace.organizationName, `Алмаз ${suffix}`);
  // Новое имя видно сразу, без перезахода.
  assert.equal((await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.session.organizationName, `Алмаз ${suffix}`);
  assert.equal((await request(base, '/api/v1/workspace', { cookie: owner.cookie, method: 'PATCH', body: {} })).code, 'EMPTY_WORKSPACE_PATCH');

  // Компанию не передают внешнему участнику и себе.
  assert.equal((await request(base, '/api/v1/workspace/owner', {
    cookie: owner.cookie, method: 'POST', body: { userId: guest.userId } })).code, 'CANNOT_TRANSFER_TO_GUEST');
  assert.equal((await request(base, '/api/v1/workspace/owner', {
    cookie: owner.cookie, method: 'POST', body: { userId: owner.payload.session.userId } })).code, 'ALREADY_OWNER');

  // Передача: новый владелец распоряжается компанией, прежний остаётся
  // работать администратором и больше её не переименовывает.
  const handover = await request(base, '/api/v1/workspace/owner', {
    cookie: owner.cookie, method: 'POST', body: { userId: deputy.userId } });
  assert.equal(handover.status, 200);
  assert.equal((await request(base, '/api/v1/bootstrap', { cookie: deputy.cookie })).payload.session.role, 'owner');
  assert.equal((await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.session.role, 'admin');
  assert.equal((await request(base, '/api/v1/workspace', {
    cookie: owner.cookie, method: 'PATCH', body: { companyName: 'Обратно' } })).status, 403);
  assert.equal((await request(base, '/api/v1/workspace', {
    cookie: deputy.cookie, method: 'PATCH', body: { workspaceName: 'Главный офис' } })).status, 200);

  // И передача, и переименование остались в журнале.
  const journal = await request(base, '/api/v1/audit', { cookie: deputy.cookie });
  const kinds = journal.payload.items.map((item) => item.eventType);
  assert.ok(kinds.includes('ownership.transferred'));
  assert.ok(kinds.includes('workspace.renamed'));
});
