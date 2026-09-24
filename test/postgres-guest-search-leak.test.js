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
 * Правило «кто видит встречу» было написано в пяти местах, и в поиске из
 * него выпало условие про гостя. Внешний подрядчик не видел встречу
 * руководства в календаре и получал 404 по прямой ссылке — а поиском по
 * названию находил её без труда. Одна забытая строчка обходит всю
 * изоляцию гостя.
 */
test('гость не находит поиском то, чего не видит в календаре',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const SECRET = `Совет директоров ${suffix}`;

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Утечка ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `guest-${suffix}@t.test`, role: 'guest' } });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const guest = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Подрядчик', password: 'OwnerPassword42' } });

  const start = new Date(Date.now() + 86400000).toISOString();
  const event = await request(base, '/api/v1/calendar-events', {
    cookie: owner.cookie, method: 'POST',
    body: { title: SECRET, kind: 'meeting', startAt: start, endAt: new Date(Date.parse(start) + 3600000).toISOString(), visibility: 'workspace' } });
  assert.equal(event.status, 201);

  // Три двери в одну комнату: календарь, прямая ссылка и поиск. Все три
  // должны отвечать одинаково.
  const inGrid = (await request(base, `/api/v1/calendar-events?from=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 3 * 86400000).toISOString())}`,
    { cookie: guest.cookie })).payload.items ?? [];
  assert.equal(inGrid.some((item) => item.title === SECRET), false, 'встреча видна гостю в календаре');

  assert.equal((await request(base, `/api/v1/calendar-events/${event.payload.event.id}`, { cookie: guest.cookie })).status, 404);

  const found = (await request(base, `/api/v1/search?q=${encodeURIComponent('Совет директоров')}`, { cookie: guest.cookie }))
    .payload.items ?? [];
  assert.equal(found.some((item) => item.title === SECRET), false,
    `гость нашёл поиском закрытую встречу: ${JSON.stringify(found.map((i) => [i.type, i.title]))}`);

  // А сотруднику она видна всеми тремя путями — иначе проверка
  // доказывала бы лишь то, что поиск сломан.
  const staffFound = (await request(base, `/api/v1/search?q=${encodeURIComponent('Совет директоров')}`, { cookie: owner.cookie }))
    .payload.items ?? [];
  assert.equal(staffFound.some((item) => item.title === SECRET), true, 'сотрудник не находит свою же встречу');
});
