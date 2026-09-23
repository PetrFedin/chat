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

/**
 * Реквизиты и места — работа администратора, а не хозяина.
 *
 * Всё, что лежит в карточке компании, стояло за одним правом
 * `organization.manage`, которого у администратора нет. Получалось так:
 * звать людей он вправе, но на сороковом приглашении упирался в
 * «свободных мест нет» — и это же сообщение отправляло его в «Ещё →
 * Компания», где его ждал отказ. Совет, который нельзя выполнить, хуже
 * молчания.
 *
 * Вывеску на двери он при этом не меняет и компанию не передаёт.
 */
test('администратор ведёт реквизиты и места, но не вывеску и не владение',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Опора ${suffix}`, ownerName: 'Владелец', email: `so-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const join = async (role, mail, displayName) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: mail, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    return request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName, password: 'MemberPassword42' } });
  };
  const admin = await join('admin', `sa-${suffix}@t.test`, 'Администратор');
  const chief = await join('manager', `sm-${suffix}@t.test`, 'Руководитель');

  // Реквизиты, число мест и самостоятельный вход — его работа.
  const details = await request(base, '/api/v1/workspace', {
    cookie: admin.cookie, method: 'PATCH',
    body: { legalName: 'ООО «Опора»', taxId: '7701234567', seatLimit: 25, emailDomain: 'opora.test' },
  });
  assert.equal(details.status, 200, `администратор не смог завести реквизиты: ${details.code}`);

  // А вывеску — нет: это решение хозяина, и отказ говорит именно о нём.
  const rename = await request(base, '/api/v1/workspace', {
    cookie: admin.cookie, method: 'PATCH', body: { companyName: 'Не опора' } });
  assert.equal(rename.status, 403);
  assert.match(rename.payload.error.message, /organization\.manage/);
  assert.equal((await request(base, '/api/v1/workspace/owner', {
    cookie: admin.cookie, method: 'POST', body: { userId: chief.payload.session?.userId ?? null } })).status, 403);
  // Выгрузка всего пространства тоже осталась хозяйской.
  assert.equal((await request(base, '/api/v1/export', { cookie: admin.cookie })).status, 403);

  // Руководитель зовёт людей, но карточки компании ему не открывают.
  assert.equal((await request(base, '/api/v1/workspace', {
    cookie: chief.cookie, method: 'PATCH', body: { seatLimit: 99 } })).status, 403);
});

/**
 * Отказ в списке приглашений говорит человеческим языком.
 *
 * Повтор адреса, приглашённого прошлым разом, приходил не кодом, а
 * нарушением единственности в базе: строка получала «failed», а причиной
 * — имя ограничения PostgreSQL. Приславший список из сорока адресов
 * читал про workspace_pending_invite_email_uq и не мог понять, звать ли
 * этого человека заново.
 */
test('повторно приглашённый адрес отмечается, а не падает с именем ограничения',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Повтор ${suffix}`, ownerName: 'Владелец', email: `rp-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const email = `again-${suffix}@granit.test`;
  const first = await request(base, '/api/v1/invitations/bulk', {
    cookie: owner.cookie, method: 'POST', body: { items: [{ email, role: 'member' }] } });
  assert.equal(first.payload.results[0].status, 'invited');

  const second = await request(base, '/api/v1/invitations/bulk', {
    cookie: owner.cookie, method: 'POST', body: { items: [{ email, role: 'member' }] } });
  const row = second.payload.results[0];
  assert.equal(row.status, 'already', 'повтор объявлен провалом');
  assert.doesNotMatch(row.reason, /constraint|_uq|duplicate key|violates/i,
    `наружу вышло сообщение драйвера: ${row.reason}`);
  assert.match(row.reason, /уже позвали/);
});
