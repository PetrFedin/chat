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

async function company(t, suffix) {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const owner = await call(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Тупик ${suffix}`, ownerName: 'Владелец', email: `dead-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const ownerId = (await call(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.session.userId;
  const invitation = await call(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mate-${suffix}@t.test`, role: 'member' } });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const mate = await call(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Коллега', password: 'MemberPassword42' } });
  const mateId = (await call(base, '/api/v1/bootstrap', { cookie: mate.cookie })).payload.session.userId;
  return { base, owner, ownerId, mate, mateId };
}

/**
 * Завёдшего беседу из неё не выставляют.
 *
 * Владелец компании создал группу, дал коллеге права в комнате — и тот
 * его оттуда убрал. Дальше выхода не было: закрытой беседы без членства
 * не видно ниоткуда, вернуть себя нельзя (комнаты для тебя нет), а
 * «принять беседу без владельца» отказывает, потому что владелец у неё
 * есть. Чинилось только правкой базы.
 */
test('того, кто завёл беседу, нельзя выставить из неё чужими руками',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const { base, owner, ownerId, mate, mateId } = await company(t, suffix);

  const room = (await call(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST',
    body: { kind: 'group', title: `Комната ${suffix}`, participantIds: [mateId] },
  })).payload.conversation;
  assert.equal((await call(base, `/api/v1/conversations/${room.id}/members/${mateId}`, {
    cookie: owner.cookie, method: 'PATCH', body: { role: 'owner' } })).status, 200);

  const kick = await call(base, `/api/v1/conversations/${room.id}/members/${ownerId}`, {
    cookie: mate.cookie, method: 'DELETE' });
  assert.equal(kick.code, 'CANNOT_REMOVE_CREATOR', `заводившего выставили: ${kick.status} ${kick.code}`);
  assert.match(kick.payload.error.message, /уйти сам/);

  // Своя беседа осталась при нём.
  assert.equal((await call(base, `/api/v1/conversations/${room.id}/messages`, { cookie: owner.cookie })).status, 200);

  // Уйти самому он по-прежнему может: это его решение.
  assert.equal((await call(base, `/api/v1/conversations/${room.id}/leave`, {
    cookie: owner.cookie, method: 'POST', body: {} })).status, 200);
});

/**
 * Удалённое сообщение удалено везде.
 *
 * Тело затиралось в ленте, а в избранном и в заметках оставалось
 * процитированным: человек отозвал ошибочную фразу, а у коллеги она
 * по-прежнему на виду — и ведёт в никуда.
 */
test('удалённое сообщение не цитируется ни в избранном, ни в заметках',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const { base, owner, mate } = await company(t, suffix);
  const general = (await call(base, '/api/v1/conversations', { cookie: owner.cookie }))
    .payload.items.find((item) => item.slug === 'general');

  const secret = `Ошибочная строка про зарплаты ${suffix}`;
  const message = (await call(base, `/api/v1/conversations/${general.id}/messages`, {
    cookie: mate.cookie, method: 'POST', body: { kind: 'text', body: secret },
  })).payload.message;

  assert.equal((await call(base, `/api/v1/favourites/message/${message.id}`, {
    cookie: owner.cookie, method: 'PUT', body: {} })).status < 300, true);
  assert.equal((await call(base, '/api/v1/message-notes', {
    cookie: owner.cookie, method: 'POST',
    body: { conversationId: general.id, messageId: message.id, kind: 'important', body: 'спросить про это' },
  })).status, 201);

  assert.equal((await call(base, `/api/v1/messages/${message.id}`, { cookie: mate.cookie, method: 'DELETE' })).status, 200);

  const favourite = (await call(base, '/api/v1/favourites', { cookie: owner.cookie }))
    .payload.items.find((item) => item.targetId === message.id);
  assert.ok(favourite, 'строка избранного исчезла — а она про сообщение, которое было');
  assert.equal(favourite.title, 'Сообщение удалено', `текст удалённого остался в избранном: ${favourite.title}`);

  const note = (await call(base, '/api/v1/message-notes', { cookie: owner.cookie }))
    .payload.items.find((item) => item.messageId === message.id);
  assert.equal(note.messagePreview, 'Сообщение удалено');
  assert.equal(note.body, 'спросить про это', 'своя заметка должна остаться');
});

/**
 * Еженедельная планёрка не перестаёт ждать ответа.
 *
 * Отбор шёл по времени начала самой строки события — то есть первой
 * встречи серии. Планёрка, заведённая месяц назад, через неделю
 * исчезала из всех напоминалок навсегда, и ответа от людей никто уже не
 * ждал, хотя встречи шли.
 */
test('приглашение на повторяющуюся встречу ждёт ответа и через месяц',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const { base, owner, mate, mateId } = await company(t, suffix);

  const monthAgo = new Date(Date.now() - 30 * 86400000);
  monthAgo.setUTCHours(6, 0, 0, 0);
  const series = await call(base, '/api/v1/calendar-events', {
    cookie: owner.cookie, method: 'POST',
    body: {
      title: 'Планёрка снабжения',
      startAt: monthAgo.toISOString(),
      endAt: new Date(monthAgo.getTime() + 1800000).toISOString(),
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      participantIds: [mateId],
    },
  });
  assert.equal(series.status, 201);

  const waiting = (await call(base, '/api/v1/calendar-invitations', { cookie: mate.cookie })).payload.items;
  const row = waiting.find((item) => item.title === 'Планёрка снабжения');
  assert.ok(row, 'серия, начатая месяц назад, перестала ждать ответа');
  // Показывается ближайшая встреча, а не та, что была месяц назад.
  assert.ok(new Date(row.startAt).getTime() > Date.now() - 86400000,
    `в приглашении дата первой встречи серии: ${row.startAt}`);

  // Ответил — и приглашение ушло.
  assert.equal((await call(base, `/api/v1/calendar-events/${series.payload.event.id}/respond`, {
    cookie: mate.cookie, method: 'POST', body: { response: 'accepted' } })).status, 200);
  assert.equal((await call(base, '/api/v1/calendar-invitations', { cookie: mate.cookie }))
    .payload.items.some((item) => item.title === 'Планёрка снабжения'), false);
});
