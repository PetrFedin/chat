import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
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
 * «В отпуске», «на обеде», «буду завтра в десять».
 *
 * Присутствие в продукте было техническим: в сети, отошёл — то, что
 * вычисляет само приложение по сокету. Но на работе спрашивают не
 * «онлайн ли Нина», а «когда она вернётся», и ответить на это может
 * только она сама.
 */
test('объявленная доступность видна коллегам и гаснет сама',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Отпуск ${suffix}`, ownerName: 'Нина', email: `av-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `oleg-${suffix}@t.test`, role: 'member' } });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const oleg = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Олег', password: 'OwnerPassword42' } });
  const ownerId = (await request(base, '/api/v1/me', { cookie: owner.cookie })).payload.userId;

  const backAt = new Date(Date.now() + 3600000).toISOString();
  const set = await request(base, '/api/v1/presence', {
    cookie: owner.cookie, method: 'POST',
    body: { state: 'away', availability: 'lunch', backAt, statusText: 'вернусь после обеда' } });
  assert.equal(set.status, 200);
  assert.equal(set.payload.presence.availability, 'lunch');
  assert.equal(set.payload.presence.backAt, backAt);

  // Коллега видит это в списке людей — там, где он и смотрит, с кем работает.
  const seen = (await request(base, '/api/v1/people', { cookie: oleg.cookie })).payload.items.find((p) => p.userId === ownerId);
  assert.equal(seen.presence.availability, 'lunch');
  assert.equal(seen.presence.backAt, backAt);
  // И в карточке человека.
  const card = (await request(base, `/api/v1/people/${ownerId}`, { cookie: oleg.cookie })).payload.person;
  assert.equal(card.availability, 'lunch');

  // Переподключение не стирает объявленное: закрытая крышка ноутбука не
  // отменяет отпуск. Приложение шлёт только состояние.
  await request(base, '/api/v1/presence', { cookie: owner.cookie, method: 'POST', body: { state: 'online' } });
  const afterTouch = (await request(base, '/api/v1/people', { cookie: oleg.cookie })).payload.items.find((p) => p.userId === ownerId);
  assert.equal(afterTouch.presence.availability, 'lunch', 'обычная отметка присутствия стёрла объявленный статус');
  assert.equal(afterTouch.presence.state, 'online');

  // «На обеде до 14:00» не должно висеть до вечера: момент прошёл —
  // статус погас, и никакой сборщик для этого не нужен.
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  t.after(() => pool.end());
  await pool.query('UPDATE user_presence SET back_at=now()-interval \'1 minute\' WHERE user_id=$1', [ownerId]);
  const expired = (await request(base, '/api/v1/people', { cookie: oleg.cookie })).payload.items.find((p) => p.userId === ownerId);
  assert.equal(expired.presence.availability, 'available', 'просроченный статус остался висеть');
  assert.equal(expired.presence.backAt, null);

  // Отказы.
  assert.equal((await request(base, '/api/v1/presence', {
    cookie: owner.cookie, method: 'POST', body: { state: 'online', availability: 'в бане' } })).code, 'INVALID_AVAILABILITY');
  assert.equal((await request(base, '/api/v1/presence', {
    cookie: owner.cookie, method: 'POST',
    body: { state: 'online', availability: 'vacation', backAt: new Date(Date.now() - 3600000).toISOString() } })).code, 'BACK_AT_IN_PAST');

  // Отпуск до числа — то же поле, просто дальний момент.
  const holiday = new Date(Date.now() + 7 * 86400000).toISOString();
  await request(base, '/api/v1/presence', {
    cookie: owner.cookie, method: 'POST', body: { state: 'offline', availability: 'vacation', backAt: holiday } });
  const away = (await request(base, '/api/v1/people', { cookie: oleg.cookie })).payload.items.find((p) => p.userId === ownerId);
  assert.equal(away.presence.availability, 'vacation');
  assert.equal(away.presence.backAt, holiday);
});

test('статус доступности есть в интерфейсе', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const AVAILABILITY=\[/);
  for (const kind of ['meeting', 'lunch', 'vacation', 'trip', 'sick']) {
    assert.ok(app.includes(`['${kind}'`), `в интерфейсе нет статуса ${kind}`);
  }
  // Рядом с доступным человеком значка быть не должно: «всё хорошо» у
  // каждого имени — это шум, из которого не выделяется важное.
  assert.match(app, /if\(!kind\|\|kind==='available'\)return ''/);
  // И подпись у каждого, с кем работаешь.
  assert.match(app, /availabilityNote\(p\.presence\)/);
  assert.match(app, /data-availability="/);
});
