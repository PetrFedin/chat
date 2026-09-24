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
 * Еженедельная планёрка.
 *
 * Колонка `recurrence_rule` лежала в схеме с самого начала, и кода за ней
 * не было ни строки: самую частую встречу вообще заводили руками каждую
 * неделю.
 */
test('серия раскрывается, и одну встречу из неё можно отменить и перенести',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Планёрка ${suffix}`, ownerName: 'Владелец', email: `rec-${suffix}@t.test`, password: 'OwnerPassword42' },
  });

  const monday = new Date();
  monday.setUTCHours(7, 0, 0, 0);
  while (monday.getUTCDay() !== 1) monday.setUTCDate(monday.getUTCDate() + 1);
  const ends = new Date(monday.getTime() + 30 * 60000);

  const created = await request(base, '/api/v1/calendar-events', {
    cookie: owner.cookie, method: 'POST',
    body: { kind: 'meeting', title: 'Планёрка', startAt: monday.toISOString(), endAt: ends.toISOString(),
      timezone: 'Europe/Moscow', recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.event.recurrenceRule, 'FREQ=WEEKLY;BYDAY=MO', 'правило не сохранилось');
  const id = created.payload.event.id;

  const from = new Date(monday.getTime() - 86400000).toISOString();
  const to = new Date(monday.getTime() + 35 * 86400000).toISOString();
  const list = async () => (await request(base, `/api/v1/calendar-events?from=${from}&to=${to}`, { cookie: owner.cookie })).payload.items;

  let items = await list();
  assert.equal(items.length, 6, `за пять недель ожидалось шесть планёрок, пришло ${items.length}`);
  // Первая встреча серии — такое же вхождение, как остальные, и приходить
  // должна один раз: строка события сама по себе в список не попадает.
  assert.equal(new Set(items.map((x) => x.startAt)).size, items.length, 'вхождение задвоилось');
  assert.ok(items.every((x) => x.seriesId === id));
  assert.ok(items.every((x) => x.occurrenceAt), 'без момента вхождения его не отменить');
  assert.equal(items[0].recurrenceText, 'каждую неделю по пн');

  // Отмена одной встречи не трогает остальную серию.
  const skipped = items[1];
  assert.equal((await request(base, `/api/v1/calendar-events/${id}/occurrences/${encodeURIComponent(skipped.occurrenceAt)}`, {
    cookie: owner.cookie, method: 'POST', body: { cancelled: true } })).status, 200);
  items = await list();
  assert.equal(items.length, 5);
  assert.equal(items.some((x) => x.occurrenceAt === skipped.occurrenceAt), false, 'отменённая встреча осталась в календаре');

  // Перенос одной — тоже.
  const shifted = items[1];
  const movedTo = new Date(Date.parse(shifted.startAt) + 3600000).toISOString();
  assert.equal((await request(base, `/api/v1/calendar-events/${id}/occurrences/${encodeURIComponent(shifted.occurrenceAt)}`, {
    cookie: owner.cookie, method: 'POST',
    body: { startAt: movedTo, endAt: new Date(Date.parse(movedTo) + 1800000).toISOString() } })).status, 200);
  items = await list();
  assert.equal(items.length, 5, 'перенос не должен менять число встреч');
  const now = items.find((x) => x.occurrenceAt === shifted.occurrenceAt);
  assert.equal(now.startAt, movedTo);
  assert.equal(now.moved, true);
  // Остальные остались на месте.
  assert.equal(items.filter((x) => x.moved).length, 1);

  // И то и другое отменяется возвратом.
  assert.equal((await request(base, `/api/v1/calendar-events/${id}/occurrences/${encodeURIComponent(shifted.occurrenceAt)}`, {
    cookie: owner.cookie, method: 'DELETE' })).status, 200);
  items = await list();
  assert.equal(items.find((x) => x.occurrenceAt === shifted.occurrenceAt).startAt, shifted.startAt);

  // Момента, которого в серии нет, отменить нельзя — иначе в таблице
  // исключений копятся записи о встречах, которых не было.
  const wrong = await request(base, `/api/v1/calendar-events/${id}/occurrences/${encodeURIComponent(new Date(Date.parse(shifted.occurrenceAt) + 3600000).toISOString())}`, {
    cookie: owner.cookie, method: 'POST', body: { cancelled: true } });
  assert.equal(wrong.status, 404);
  assert.equal(wrong.code, 'OCCURRENCE_NOT_FOUND');
  assert.equal((await request(base, `/api/v1/calendar-events/${id}/occurrences/позавчера`, {
    cookie: owner.cookie, method: 'POST', body: { cancelled: true } })).status, 400);

  // Негодное правило не доезжает до базы ни при создании, ни при правке.
  assert.equal((await request(base, '/api/v1/calendar-events', {
    cookie: owner.cookie, method: 'POST',
    body: { kind: 'meeting', title: 'Ерунда', startAt: monday.toISOString(), endAt: ends.toISOString(), recurrenceRule: 'FREQ=HOURLY' } })).code,
    'INVALID_RECURRENCE');
  assert.equal((await request(base, `/api/v1/calendar-events/${id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { recurrenceRule: 'КАЖДУЮ НЕДЕЛЮ' } })).code, 'INVALID_RECURRENCE');

  // Серию можно превратить в одиночную встречу и обратно.
  assert.equal((await request(base, `/api/v1/calendar-events/${id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { recurrenceRule: '' } })).status, 200);
  items = await list();
  assert.equal(items.length, 1, 'после снятия правила должна остаться одна встреча');
  assert.equal(items[0].id, id, 'одиночная встреча адресуется своим идентификатором');

  // И отмена серии убирает её целиком.
  assert.equal((await request(base, `/api/v1/calendar-events/${id}`, { cookie: owner.cookie, method: 'DELETE' })).status, 204);
  assert.equal((await list()).length, 0);
});

test('одиночная встреча по-прежнему одна',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Одна ${suffix}`, ownerName: 'Владелец', email: `one-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const at = new Date(Date.now() + 86400000);
  const created = await request(base, '/api/v1/calendar-events', {
    cookie: owner.cookie, method: 'POST',
    body: { kind: 'meeting', title: 'Разговор', startAt: at.toISOString(), endAt: new Date(at.getTime() + 3600000).toISOString() },
  });
  assert.equal(created.status, 201);
  const items = (await request(base,
    `/api/v1/calendar-events?from=${new Date(Date.now() - 86400000).toISOString()}&to=${new Date(Date.now() + 10 * 86400000).toISOString()}`,
    { cookie: owner.cookie })).payload.items;
  const mine = items.filter((x) => x.title === 'Разговор');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].seriesId, undefined, 'у одиночной встречи серии нет');
  // Отменять «вхождение» у неповторяющейся встречи бессмысленно.
  assert.equal((await request(base, `/api/v1/calendar-events/${created.payload.event.id}/occurrences/${encodeURIComponent(at.toISOString())}`, {
    cookie: owner.cookie, method: 'POST', body: { cancelled: true } })).code, 'NOT_RECURRING');
});
