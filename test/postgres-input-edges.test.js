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

/**
 * Края ввода, на которых сервер отвечал «внутренней ошибкой» или молча
 * додумывал за человека. Пятисотка на обычную вставку из внешней системы
 * выглядит как авария, а тихая подмена даты хуже отказа: человек уверен,
 * что назначил встречу на 29 февраля, и приходит не в тот день.
 */
test('край ввода отвечает внятно, а не пятисоткой',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Края ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const cookie = owner.cookie;
  const me = owner.payload.session.userId;
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie })).payload.conversations[0];

  // Нулевой байт: в базу он не лезет, и запрос падал пятисоткой.
  const withNul = await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie, method: 'POST', body: { body: `до\u0000после` } });
  assert.equal(withNul.status, 201, 'сообщение с управляющим символом уронило сервер');
  assert.equal(withNul.payload.message.body, 'допосле', 'управляющий символ должен быть вычищен');

  // Невидимый пробел — не сообщение.
  assert.equal((await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie, method: 'POST', body: { body: '\u200b' } })).code, 'INVALID_MESSAGE_BODY');

  const nulTitle = await request(base, '/api/v1/tasks', {
    cookie, method: 'POST', body: { title: `смета\u0000`, outcome: 'готово' } });
  assert.equal(nulTitle.status, 201);
  assert.equal(nulTitle.payload.task.title, 'смета');

  // Имя человека стереть нельзя: колонка не пустеет, а ответ был пятисоткой.
  assert.equal((await request(base, `/api/v1/people/${me}`, {
    cookie, method: 'PATCH', body: { displayName: '' } })).code, 'INVALID_TEXT');
  assert.equal((await request(base, `/api/v1/people/${me}`, {
    cookie, method: 'PATCH', body: { displayName: '   ' } })).code, 'INVALID_TEXT');

  // Несуществующие даты: сервер отвечал «создано» и сдвигал день.
  for (const startAt of ['2027-02-29T10:00:00.000Z', '2026-11-31T10:00:00.000Z']) {
    const created = await request(base, '/api/v1/calendar-events', {
      cookie, method: 'POST', body: { title: 'Несуществующий день', kind: 'meeting', startAt,
        endAt: new Date(Date.parse(startAt) + 3600000).toISOString() } });
    assert.equal(created.code, 'INVALID_DATE', `дата ${startAt} принята как ${created.payload?.event?.startAt}`);
  }
  // Високосный год — настоящий, его принимаем.
  const leap = await request(base, '/api/v1/calendar-events', {
    cookie, method: 'POST', body: { title: 'Високосный', kind: 'meeting', startAt: '2028-02-29T10:00:00.000Z',
      endAt: '2028-02-29T11:00:00.000Z' } });
  assert.equal(leap.status, 201);

  // Пустая дата — отказ, а не первое января 1970-го.
  assert.equal((await request(base, '/api/v1/calendar-events', {
    cookie, method: 'POST', body: { title: 'Без даты', kind: 'meeting', startAt: null } })).code, 'INVALID_DATE');
  // И дата за пределами разумного — отказ, а не пятисотка из базы.
  assert.equal((await request(base, '/api/v1/tasks', {
    cookie, method: 'POST', body: { title: 'Далёкий срок', promisedAt: '+275760-09-13T00:00:00.000Z' } })).code, 'INVALID_DATE');

  // Порядковый номер личной записи вне int4 — отказ на обоих путях.
  assert.equal((await request(base, '/api/v1/personal-items', {
    cookie, method: 'POST', body: { title: 'Дело', position: 2147483648 } })).code, 'INVALID_POSITION');
  const item = await request(base, '/api/v1/personal-items', { cookie, method: 'POST', body: { title: 'Дело' } });
  assert.equal((await request(base, `/api/v1/personal-items/${item.payload.item.id}`, {
    cookie, method: 'PATCH', body: { position: 1e18 } })).code, 'INVALID_POSITION');

  // Дробный размер страницы доходил до базы и возвращался отказом формата.
  for (const path of ['/api/v1/tasks?limit=1.5', `/api/v1/conversations/${conversation.id}/messages?limit=1.5`,
    '/api/v1/notifications?limit=1.5', '/api/v1/reminders?limit=1.5']) {
    assert.equal((await request(base, path, { cookie })).status, 200, `${path} ответил отказом`);
  }

  // Заметка длиннее предела отказывает, а не обрезается молча.
  const message = await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie, method: 'POST', body: { body: 'О чём заметка' } });
  assert.equal((await request(base, '/api/v1/message-notes', {
    cookie, method: 'POST', body: { messageId: message.payload.message.id, conversationId: conversation.id,
      kind: 'note', body: 'я'.repeat(2001) } })).code, 'INVALID_NOTE');

  // Поиск по проценту ищет процент, а не всё подряд.
  const everything = await request(base, `/api/v1/search?q=${encodeURIComponent('%%')}`, { cookie });
  assert.equal(everything.status, 200);
  assert.equal(everything.payload.items.length, 0, 'поиск по шаблону выдал всю ленту');
});
