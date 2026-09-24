import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

/**
 * Переписку нельзя переписать задним числом.
 *
 * Текст сообщения перезаписывался молча: обещание «отправлю до пятницы»
 * превращалось в «посмотрю на неделе», и доказать обратное было нечем —
 * в продукте, чей журнал показывает, кто раскрыл пароль из сейфа.
 */
test('правка сообщения сохраняет прежний текст и попадает в журнал',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Правки ${suffix}`, ownerName: 'Владелец', email: `ed-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];
  const message = (await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: 'Отправлю смету до пятницы' } })).payload.message;

  await request(base, `/api/v1/messages/${message.id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { body: 'Посмотрю смету на неделе' } });
  await request(base, `/api/v1/messages/${message.id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { body: 'Посмотрю смету когда-нибудь' } });

  const versions = (await request(base, `/api/v1/messages/${message.id}/versions`, { cookie: owner.cookie })).payload.items;
  assert.equal(versions.length, 2);
  // Сверху — самая свежая из прежних редакций.
  assert.equal(versions[0].body, 'Посмотрю смету на неделе');
  assert.equal(versions[1].body, 'Отправлю смету до пятницы');
  assert.equal(versions[0].editedByName, 'Владелец');

  // Правка, ничего не меняющая, не плодит версий: иначе история
  // засоряется до нечитаемости повторными нажатиями.
  await request(base, `/api/v1/messages/${message.id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { body: 'Посмотрю смету когда-нибудь' } });
  assert.equal((await request(base, `/api/v1/messages/${message.id}/versions`, { cookie: owner.cookie })).payload.items.length, 2);

  const journal = (await request(base, '/api/v1/audit?type=message', { cookie: owner.cookie })).payload.items;
  const edits = journal.filter((x) => x.eventType === 'message.edited');
  assert.equal(edits.length, 2, 'правка не попала в журнал аудита');
  // В журнал — факт и размер, но не текст: журнал читают те, кому
  // переписка не адресована.
  assert.equal(edits[0].payload.body, undefined);
  assert.ok(Number.isInteger(edits[0].payload.wasLength));

  // Историю видит тот, кто видит беседу, и не видит посторонний.
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `guest-${suffix}@client.test`, role: 'guest' } });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const guest = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Заказчик', password: 'GuestPassword42' } });
  assert.equal((await request(base, `/api/v1/messages/${message.id}/versions`, { cookie: guest.cookie })).status, 404);
});

/**
 * Гость не должен оставаться в чужом пространстве навсегда.
 *
 * Проект закончился год назад, а доступ к перепискам и файлам остался —
 * руками его никто не вспомнит закрыть.
 */
test('срок доступа закрывает вход в тот же миг, а не по расписанию',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Срок ${suffix}`, ownerName: 'Владелец', email: `ac-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const until = new Date(Date.now() + 2 * 3600000).toISOString();
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST',
    body: { email: `guest-${suffix}@client.test`, role: 'guest', accessUntil: until } });
  assert.equal(invitation.payload.invitation.accessUntil, until, 'срок не сохранился в приглашении');

  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const guest = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Заказчик', password: 'GuestPassword42' } });
  const guestId = (await request(base, '/api/v1/me', { cookie: guest.cookie })).payload.userId;
  // Срок переехал с приглашения на членство: приглашение одноразовое, а
  // находиться внутри человек продолжает.
  assert.equal((await request(base, `/api/v1/people/${guestId}`, { cookie: owner.cookie })).payload.person.accessUntil, until);
  assert.equal((await request(base, '/api/v1/me', { cookie: guest.cookie })).status, 200);

  // Истёк — и вход закрыт немедленно, включая живую сессию: проверка
  // стоит на каждом обращении, а не в сборщике, который может не
  // запуститься.
  await request(base, `/api/v1/people/${guestId}/access`, {
    cookie: owner.cookie, method: 'PUT', body: { accessUntil: new Date(Date.now() - 60000).toISOString() } });
  assert.equal((await request(base, '/api/v1/me', { cookie: guest.cookie })).status, 401);
  assert.equal((await request(base, '/api/v1/auth/login', {
    method: 'POST', body: { email: `guest-${suffix}@client.test`, password: 'GuestPassword42' } })).status, 401);

  // Срок снимается — доступ возвращается.
  await request(base, `/api/v1/people/${guestId}/access`, { cookie: owner.cookie, method: 'PUT', body: { accessUntil: null } });
  assert.equal((await request(base, '/api/v1/auth/login', {
    method: 'POST', body: { email: `guest-${suffix}@client.test`, password: 'GuestPassword42' } })).status, 200);

  // Себе срок не ставят, и владельцу тоже: компания не должна однажды
  // остаться без того, кто ею распоряжается.
  const ownerId = (await request(base, '/api/v1/me', { cookie: owner.cookie })).payload.userId;
  assert.equal((await request(base, `/api/v1/people/${ownerId}/access`, {
    cookie: owner.cookie, method: 'PUT', body: { accessUntil: until } })).code, 'ACCESS_SELF_FORBIDDEN');

  // Срок в прошлом при приглашении — отказ: такое приглашение погасло бы
  // в ту же секунду, и человек не понял бы почему.
  assert.equal((await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST',
    body: { email: `late-${suffix}@client.test`, role: 'guest', accessUntil: new Date(Date.now() - 1000).toISOString() } })).code,
    'ACCESS_UNTIL_IN_PAST');
});

test('история правок и срок доступа есть в интерфейсе', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  // Пометка «изменено» была подсказкой на наведение мыши — на телефоне
  // её не увидеть вовсе.
  assert.match(app, /data-message-history="/);
  assert.match(app, /async function messageHistoryModal/);
  assert.match(app, /api\(`\/api\/v1\/messages\/\$\{id\}\/versions`\)/);
  // Срок спрашивается только у гостя.
  assert.match(app, /id="invite-until-field"/);
  assert.match(app, /f\.get\('role'\)==='guest'&&until/);
});
