import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
process.env.VAULT_KEY ||= randomBytes(32).toString('base64');

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'idempotency-key': crypto.randomUUID(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function company(t, suffix) {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Штат ${suffix}`, ownerName: 'Владелец', email: `bi-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  return { base, owner };
}

/**
 * Штат списком.
 *
 * Компания приходит не по одному человеку: у неё уже есть сорок
 * сотрудников в таблице, и заводить их по одной форме — час работы и
 * десяток опечаток. Разбор построчный: одна кривая строка не должна
 * отменять остальные, иначе из-за опечатки в сороковой пришлось бы
 * звать заново все сорок.
 */
test('приглашения списком: разбор построчный, одна кривая строка не рушит остальные',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner } = await company(t, suffix);

  const sent = await request(base, '/api/v1/invitations/bulk', {
    cookie: owner.cookie, method: 'POST',
    body: { items: [
      { email: `k1-${suffix}@granit.test`, role: 'member' },
      { email: `k2-${suffix}@granit.test`, role: 'manager' },
      { email: `K1-${suffix}@granit.test`, role: 'member' },
      { email: 'без-собаки', role: 'member' },
      { email: `k3-${suffix}@granit.test`, role: 'owner' },
      { email: `bi-${suffix}@t.test`, role: 'member' },
    ] },
  });

  assert.equal(sent.status, 201);
  assert.equal(sent.payload.total, 6);
  assert.equal(sent.payload.invited, 2);
  // Порядок строк ответа — порядок строк списка: человек сверяет их
  // глазами со своей таблицей, а не ищет по адресу.
  const status = sent.payload.results.map((r) => r.status);
  assert.deepEqual(status, ['invited', 'invited', 'duplicate', 'invalid_email', 'invalid_role', 'already'],
    'разбор строки не совпал с тем, что в ней написано');
  // Повтор в самом списке — обычное дело для выгрузки из таблицы, и
  // приглашать дважды по нему нельзя, в том числе в другом регистре:
  // третья строка отличается от первой только заглавной буквой.

  // Ссылка возвращается сразу: почта в компании может быть не настроена,
  // и тогда пригласивший разошлёт их руками.
  const invited = sent.payload.results.find((r) => r.status === 'invited');
  assert.match(invited.inviteUrl, /\?invite=/);

  // И по этой ссылке человек действительно входит.
  const token = new URL(invited.inviteUrl).searchParams.get('invite');
  const accepted = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Новичок', password: 'MemberPassword42' },
  });
  assert.equal(accepted.status, 201);
});

/** Нельзя раздать списком права выше своих — это обход лестницы ролей. */
test('списком нельзя пригласить человека с правами выше своих',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner } = await company(t, suffix);

  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mg-${suffix}@t.test`, role: 'manager' },
  });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const manager = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Руководитель', password: 'MemberPassword42' },
  });

  const sent = await request(base, '/api/v1/invitations/bulk', {
    cookie: manager.cookie, method: 'POST',
    body: { items: [
      { email: `low-${suffix}@granit.test`, role: 'member' },
      { email: `high-${suffix}@granit.test`, role: 'admin' },
    ] },
  });
  const by = Object.fromEntries(sent.payload.results.map((r) => [r.email, r.status]));
  assert.equal(by[`low-${suffix}@granit.test`], 'invited');
  assert.equal(by[`high-${suffix}@granit.test`], 'role_too_high');
});

/** Границы: пустой список и слишком длинный — отказ, а не молчание. */
test('пустой и слишком длинный список отклоняются с объяснением',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner } = await company(t, suffix);

  const empty = await request(base, '/api/v1/invitations/bulk', { cookie: owner.cookie, method: 'POST', body: { items: [] } });
  assert.equal(empty.status, 400);
  assert.equal(empty.code, 'EMPTY_INVITE_LIST');

  const long = await request(base, '/api/v1/invitations/bulk', {
    cookie: owner.cookie, method: 'POST',
    body: { items: Array.from({ length: 201 }, (unused, i) => ({ email: `x${i}-${suffix}@t.test`, role: 'member' })) },
  });
  assert.equal(long.status, 400);
  assert.equal(long.code, 'INVITE_LIST_TOO_LONG');
});

/**
 * Приглашение сразу в подразделение.
 *
 * Человека звали в компанию, а по отделам раскладывали вторым проходом
 * по тому же списку — и делался он через неделю, когда уже неважно.
 * Теперь отдел указывается в самой строке.
 */
test('список раскладывает людей по подразделениям, а в чужие не пускает',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner } = await company(t, suffix);

  // Открытый отдел — владелец им управляет. И закрытый, заведённый
  // руководителем: в него владельцу хода нет.
  const open = (await request(base, '/api/v1/org/units', {
    cookie: owner.cookie, method: 'POST', body: { kind: 'division', name: 'Снабжение' },
  })).payload.unit;

  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mgr-${suffix}@t.test`, role: 'manager' },
  });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const manager = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Руководитель', password: 'MemberPassword42' },
  });
  await request(base, '/api/v1/org/units', {
    cookie: manager.cookie, method: 'POST', body: { kind: 'division', name: 'Комиссия', visibility: 'closed' },
  });

  const sent = await request(base, '/api/v1/invitations/bulk', {
    cookie: owner.cookie, method: 'POST',
    body: { items: [
      { email: `u1-${suffix}@granit.test`, role: 'member', unit: 'Снабжение' },
      { email: `u2-${suffix}@granit.test`, role: 'member', unit: 'комиссия' },
      { email: `u3-${suffix}@granit.test`, role: 'member', unit: 'Отдел которого нет' },
    ] },
  });
  assert.deepEqual(sent.payload.results.map((r) => r.status),
    ['invited', 'unit_forbidden', 'unknown_unit'],
    'приглашение не должно быть обходом: в закрытый отдел письмом не заводят');

  // Принявший приглашение оказывается в отделе и в его комнате сразу.
  const link = sent.payload.results[0].inviteUrl;
  const joined = await request(base, '/api/v1/invitations/accept', {
    method: 'POST',
    body: { token: new URL(link).searchParams.get('invite'), displayName: 'Новиков', password: 'MemberPassword42' },
  });
  const boot = await request(base, '/api/v1/bootstrap', { cookie: joined.cookie });
  const chain = await request(base, `/api/v1/org/people/${boot.payload.session.userId}/chain`, { cookie: joined.cookie });
  assert.deepEqual(chain.payload.units.map((u) => u.name), ['Снабжение']);
  assert.ok(boot.payload.conversations.some((c) => c.title === 'Снабжение'),
    'новичок не попал в комнату своего подразделения');
  void open;
});

/**
 * Адрес не на домене компании — повод присмотреться, а не отказ:
 * подрядчика зовут гостем именно с чужого адреса.
 */
test('чужой домен в списке отмечается, но приглашению не мешает',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner } = await company(t, suffix);
  await request(base, '/api/v1/workspace', {
    cookie: owner.cookie, method: 'PATCH', body: { emailDomain: `granit-${suffix}.test` },
  });

  const sent = await request(base, '/api/v1/invitations/bulk', {
    cookie: owner.cookie, method: 'POST',
    body: { items: [
      { email: `svoy-${suffix}@granit-${suffix}.test`, role: 'member' },
      { email: `chuzhoy-${suffix}@gmail.com`, role: 'member' },
      { email: `podryad-${suffix}@gmail.com`, role: 'guest' },
    ] },
  });
  const rows = sent.payload.results;
  assert.equal(rows.every((r) => r.status === 'invited'), true, 'чужой домен не должен мешать приглашению');
  assert.equal(rows[0].foreignDomain, undefined, 'свой адрес отмечен как чужой');
  assert.equal(rows[1].foreignDomain, true, 'чужой адрес не отмечен');
  assert.equal(rows[2].foreignDomain, undefined, 'у гостя адрес чужой по определению — отмечать нечего');
});

/**
 * Кого позвали и кто ещё не пришёл.
 *
 * Позвав сорок человек списком, узнать, кто дошёл, было неоткуда:
 * приглашения жили только в письмах. Через неделю пригласивший не
 * помнит, кому слать повторно, и зовёт заново всех — а человек получает
 * второе письмо и думает, что первое было подделкой.
 */
test('список ожидающих виден, приглашение отзывается, и ссылка перестаёт работать',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner } = await company(t, suffix);

  const sent = await request(base, '/api/v1/invitations/bulk', {
    cookie: owner.cookie, method: 'POST',
    body: { items: [
      { email: `p1-${suffix}@granit.test`, role: 'member' },
      { email: `p2-${suffix}@granit.test`, role: 'manager' },
    ] },
  });
  const link = sent.payload.results[0].inviteUrl;

  const pending = await request(base, '/api/v1/invitations', { cookie: owner.cookie });
  assert.equal(pending.status, 200);
  assert.equal(pending.payload.items.length, 2);
  const row = pending.payload.items.find((i) => i.email === `p1-${suffix}@granit.test`);
  assert.equal(row.role, 'member');
  assert.equal(row.expired, false);
  assert.equal(row.invitedByName, 'Владелец', 'не видно, кто позвал');

  // Отзыв закрывает именно эту ссылку.
  const revoked = await request(base, `/api/v1/invitations/${row.id}`, { cookie: owner.cookie, method: 'DELETE' });
  assert.equal(revoked.status, 204);
  const left = await request(base, '/api/v1/invitations', { cookie: owner.cookie });
  assert.equal(left.payload.items.length, 1);

  const tried = await request(base, '/api/v1/invitations/accept', {
    method: 'POST',
    body: { token: new URL(link).searchParams.get('invite'), displayName: 'Поздний', password: 'MemberPassword42' },
  });
  assert.equal(tried.status, 404, 'отозванная ссылка всё ещё пускает');
});

/** Отзывает тот, кто позвал, или тот, кто распоряжается составом. */
test('чужое приглашение руководитель отозвать не может',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner } = await company(t, suffix);

  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mm-${suffix}@t.test`, role: 'manager' },
  });
  const manager = await request(base, '/api/v1/invitations/accept', {
    method: 'POST',
    body: { token: new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite'),
      displayName: 'Руководитель', password: 'MemberPassword42' },
  });

  const byOwner = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `own-${suffix}@granit.test`, role: 'member' },
  });
  const byManager = await request(base, '/api/v1/invitations', {
    cookie: manager.cookie, method: 'POST', body: { email: `mgr-${suffix}@granit.test`, role: 'member' },
  });

  const list = (await request(base, '/api/v1/invitations', { cookie: manager.cookie })).payload.items;
  const foreign = list.find((i) => i.email === `own-${suffix}@granit.test`);
  const own = list.find((i) => i.email === `mgr-${suffix}@granit.test`);

  const denied = await request(base, `/api/v1/invitations/${foreign.id}`, { cookie: manager.cookie, method: 'DELETE' });
  assert.equal(denied.status, 403);
  assert.equal(denied.code, 'NOT_YOUR_INVITATION');

  const allowed = await request(base, `/api/v1/invitations/${own.id}`, { cookie: manager.cookie, method: 'DELETE' });
  assert.equal(allowed.status, 204, 'своё приглашение отозвать не дали');
  void byOwner; void byManager;
});

/**
 * Место занимает и неотвеченное приглашение.
 *
 * Иначе в компанию на десять мест зовут пятьдесят человек, все получают
 * ссылку — и сорок упираются в стену на входе, когда отказываться уже
 * поздно и неловко.
 */
test('приглашения считаются занятыми местами, а гости мест не занимают',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner } = await company(t, suffix);
  // Владелец уже занимает место: ставим предел в три — два свободных.
  await request(base, '/api/v1/workspace', { cookie: owner.cookie, method: 'PATCH', body: { seatLimit: 3 } });

  const sent = await request(base, '/api/v1/invitations/bulk', {
    cookie: owner.cookie, method: 'POST',
    body: { items: [
      { email: `s1-${suffix}@granit.test`, role: 'member' },
      { email: `s2-${suffix}@granit.test`, role: 'member' },
      { email: `s3-${suffix}@granit.test`, role: 'member' },
      { email: `s4-${suffix}@granit.test`, role: 'guest' },
    ] },
  });
  assert.deepEqual(sent.payload.results.map((r) => r.status),
    ['invited', 'invited', 'no_seats', 'invited'],
    'список должен упереться в предел и не остановиться на этом');

  // Поштучно — тот же предел и внятный отказ.
  const single = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `s5-${suffix}@granit.test`, role: 'member' },
  });
  assert.equal(single.status, 409);
  assert.equal(single.code, 'NO_FREE_SEATS');
  assert.match(single.payload.error.message, /неотвеченных приглашени/,
    'отказ должен объяснять, куда делись места');

  // Отозвали приглашение сотрудника — место вернулось. Именно
  // сотрудника: гостевое места и не занимало, и отзывать его бесполезно.
  const pending = (await request(base, '/api/v1/invitations', { cookie: owner.cookie })).payload.items;
  const seatTaker = pending.find((i) => i.role === 'member');
  await request(base, `/api/v1/invitations/${seatTaker.id}`, { cookie: owner.cookie, method: 'DELETE' });
  const again = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `s6-${suffix}@granit.test`, role: 'member' },
  });
  assert.equal(again.status, 201, 'отозванное приглашение не освободило место');
});

/**
 * Позвать заново: письмо не дошло, попало в спам или вышла неделя.
 * Старая ссылка при этом закрывается — две живые ссылки на один адрес
 * это два входа, и закрывать потом придётся обе.
 */
test('повторный зов даёт новую ссылку и закрывает старую',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner } = await company(t, suffix);

  const first = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `rs-${suffix}@granit.test`, role: 'member' },
  });
  const oldLink = first.payload.invitation.inviteUrl;
  const pending = (await request(base, '/api/v1/invitations', { cookie: owner.cookie })).payload.items;
  assert.equal(pending.length, 1);

  const again = await request(base, `/api/v1/invitations/${pending[0].id}/resend`, {
    cookie: owner.cookie, method: 'POST', body: {},
  });
  assert.equal(again.status, 201);
  const newLink = again.payload.invitation.inviteUrl;
  assert.notEqual(newLink, oldLink, 'ссылка должна смениться');

  // Ожидающее по-прежнему одно: повторный зов не плодит приглашений и
  // не расходует второе место.
  const after = (await request(base, '/api/v1/invitations', { cookie: owner.cookie })).payload.items;
  assert.equal(after.length, 1);

  // Старая ссылка закрыта, новая работает.
  const stale = await request(base, '/api/v1/invitations/accept', {
    method: 'POST',
    body: { token: new URL(oldLink).searchParams.get('invite'), displayName: 'Старый', password: 'MemberPassword42' },
  });
  assert.equal(stale.status, 404, 'прежняя ссылка всё ещё пускает');
  const fresh = await request(base, '/api/v1/invitations/accept', {
    method: 'POST',
    body: { token: new URL(newLink).searchParams.get('invite'), displayName: 'Новый', password: 'MemberPassword42' },
  });
  assert.equal(fresh.status, 201);
});
