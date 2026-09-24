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

// Уволенный сотрудник сохранял доступ навсегда: признак в схеме был,
// выставить его было нечем.
test('увольнение закрывает доступ в тот же миг, а возвращение открывает',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const PASSWORD = 'OwnerPassword42';

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Увольнение ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: PASSWORD },
  });
  const join = async (tag, role) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: `${tag}-${suffix}@t.test`, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const session = await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: tag, password: PASSWORD } });
    const person = (await request(base, '/api/v1/people', { cookie: owner.cookie }))
      .payload.items.find((p) => p.email === `${tag}-${suffix}@t.test`);
    return { ...session, userId: person.userId, email: person.email };
  };
  const chief = await join('chief', 'manager');
  const worker = await join('worker', 'member');

  // До увольнения человек работает.
  assert.equal((await request(base, '/api/v1/bootstrap', { cookie: worker.cookie })).status, 200);

  // Руководитель провожать не уполномочен — это дело владельца и админа.
  assert.equal((await request(base, `/api/v1/people/${worker.userId}/deactivate`, { cookie: chief.cookie, method: 'POST' })).status, 403);
  // Себя — тоже нельзя, компанию нельзя оставить без хозяина случайным нажатием.
  assert.equal((await request(base, `/api/v1/people/${owner.payload.session.userId}/deactivate`, { cookie: owner.cookie, method: 'POST' })).code, 'CANNOT_DEACTIVATE_SELF');

  const dismissed = await request(base, `/api/v1/people/${worker.userId}/deactivate`, { cookie: owner.cookie, method: 'POST' });
  assert.equal(dismissed.status, 200);
  assert.ok(dismissed.payload.person.disabledAt, 'дата увольнения проставлена');

  // Живая сессия обрывается сразу, а не «когда истечёт».
  assert.equal((await request(base, '/api/v1/bootstrap', { cookie: worker.cookie })).status, 401);
  // И войти заново не выйдет.
  const retry = await request(base, '/api/v1/auth/login', {
    method: 'POST', body: { email: worker.email, password: PASSWORD } });
  assert.notEqual(retry.status, 200);

  // В справочнике он остаётся, но помечен: иначе его не вернуть и его
  // прошлые задачи подписывать станет некем.
  const listed = (await request(base, '/api/v1/people', { cookie: owner.cookie }))
    .payload.items.find((p) => p.userId === worker.userId);
  assert.equal(listed.active, false);

  // Журнал знает, кто кого проводил.
  const journal = await request(base, '/api/v1/audit?type=membership', { cookie: owner.cookie });
  const record = journal.payload.items.find((item) => item.eventType === 'member.deactivated' && item.aggregateId === worker.userId);
  assert.ok(record, 'увольнение записано в журнал');
  assert.equal(record.actorId, owner.payload.session.userId);

  // Возвращение на работу открывает дверь обратно.
  assert.equal((await request(base, `/api/v1/people/${worker.userId}/reactivate`, { cookie: owner.cookie, method: 'POST' })).status, 200);
  const back = await request(base, '/api/v1/auth/login', {
    method: 'POST', body: { email: worker.email, password: PASSWORD } });
  assert.equal(back.status, 200);
});
