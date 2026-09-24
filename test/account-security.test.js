import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

async function request(base, path, { cookie, method = 'GET', body, agent } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(agent ? { 'user-agent': agent } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

/**
 * Две вещи, которых у учётной записи не было вовсе.
 *
 * Сменить пароль изнутри было нельзя: единственным способом оставалось
 * «я забыл пароль» — выйти, просить письмо, ждать. А утёкший сеанс
 * отозвать было нечем: список входов не показывался нигде, и «Выйти»
 * закрывал ровно тот сеанс, из которого нажали. Украденный ноутбук
 * оставался внутри рабочего пространства до истечения срока.
 */
test('свои входы видно, и лишние можно закрыть',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const email = `sec-${suffix}@t.test`;

  const laptop = await request(base, '/api/v1/auth/register-company', {
    method: 'POST', agent: 'Laptop Safari',
    body: { companyName: `Замок ${suffix}`, ownerName: 'Владелец', email, password: 'OwnerPassword42' },
  });
  const phone = await request(base, '/api/v1/auth/login', {
    method: 'POST', agent: 'Phone iOS', body: { email, password: 'OwnerPassword42' } });
  const stranger = await request(base, '/api/v1/auth/login', {
    method: 'POST', agent: 'Stranger PC', body: { email, password: 'OwnerPassword42' } });

  const list = (await request(base, '/api/v1/auth/sessions', { cookie: laptop.cookie })).payload.items;
  assert.equal(list.length, 3);
  assert.equal(list.filter((x) => x.current).length, 1, 'ровно один вход — текущий');
  assert.equal(list.find((x) => x.current).userAgent, 'Laptop Safari');
  assert.ok(list.every((x) => x.ipAddress), 'без адреса человек не отличит свой вход от чужого');

  const alien = list.find((x) => x.userAgent === 'Stranger PC');
  assert.equal((await request(base, `/api/v1/auth/sessions/${alien.id}`, {
    cookie: laptop.cookie, method: 'DELETE' })).status, 200);
  assert.equal((await request(base, '/api/v1/me', { cookie: stranger.cookie })).status, 401, 'закрытый вход продолжает работать');
  assert.equal((await request(base, '/api/v1/me', { cookie: laptop.cookie })).status, 200, 'закрыли не тот вход');

  // Чужой сеанс закрыть нельзя даже зная его признак.
  const other = await (async () => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: laptop.cookie, method: 'POST', body: { email: `nina-${suffix}@t.test`, role: 'member' } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    return request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: 'Нина', password: 'OwnerPassword42' } });
  })();
  const mine = (await request(base, '/api/v1/auth/sessions', { cookie: laptop.cookie })).payload.items[0];
  assert.equal((await request(base, `/api/v1/auth/sessions/${mine.id}`, {
    cookie: other.cookie, method: 'DELETE' })).status, 404, 'чужой сеанс удалось закрыть со стороны');

  // «Выйти везде» оставляет текущее место: человек, у которого украли
  // телефон, не должен вылететь сам и остаться без доступа к компании.
  const swept = await request(base, '/api/v1/auth/sessions/revoke-others', { cookie: laptop.cookie, method: 'POST' });
  assert.equal(swept.payload.revoked, 1, 'закрыть следовало ровно один оставшийся чужой вход');
  assert.equal((await request(base, '/api/v1/me', { cookie: phone.cookie })).status, 401);
  assert.equal((await request(base, '/api/v1/me', { cookie: laptop.cookie })).status, 200);
});

test('пароль меняется изнутри и закрывает остальные входы',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const email = `pw-${suffix}@t.test`;

  const here = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Пароль ${suffix}`, ownerName: 'Владелец', email, password: 'OwnerPassword42' },
  });
  const elsewhere = await request(base, '/api/v1/auth/login', {
    method: 'POST', body: { email, password: 'OwnerPassword42' } });

  // Без старого пароля всякий, кто дошёл до незапертого ноутбука, запер
  // бы хозяина снаружи.
  const wrong = await request(base, '/api/v1/auth/password', {
    cookie: here.cookie, method: 'POST', body: { currentPassword: 'НеТотПароль1', password: 'BrandNewPassword42' } });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.code, 'WRONG_PASSWORD');
  assert.equal((await request(base, '/api/v1/auth/login', {
    method: 'POST', body: { email, password: 'OwnerPassword42' } })).status, 200, 'неудачная попытка не должна менять пароль');

  // Слабый пароль здесь отвергается так же, как при регистрации.
  assert.equal((await request(base, '/api/v1/auth/password', {
    cookie: here.cookie, method: 'POST', body: { currentPassword: 'OwnerPassword42', password: 'короткий' } })).status, 400);

  const changed = await request(base, '/api/v1/auth/password', {
    cookie: here.cookie, method: 'POST', body: { currentPassword: 'OwnerPassword42', password: 'BrandNewPassword42' } });
  assert.equal(changed.status, 200);
  assert.ok(changed.payload.sessionsRevoked >= 1, 'смена пароля обязана закрыть остальные входы');

  assert.equal((await request(base, '/api/v1/me', { cookie: here.cookie })).status, 200, 'себя выкидывать не надо');
  assert.equal((await request(base, '/api/v1/me', { cookie: elsewhere.cookie })).status, 401, 'чужой вход пережил смену пароля');
  assert.equal((await request(base, '/api/v1/auth/login', {
    method: 'POST', body: { email, password: 'OwnerPassword42' } })).status, 401);
  assert.equal((await request(base, '/api/v1/auth/login', {
    method: 'POST', body: { email, password: 'BrandNewPassword42' } })).status, 200);

  // И то и другое остаётся в журнале: смена пароля — событие, о котором
  // владелец компании должен узнать не от злоумышленника.
  const journal = (await request(base, '/api/v1/audit?type=membership', { cookie: here.cookie })).payload;
  assert.ok((journal.items ?? []).some((x) => x.eventType === 'password.changed'), 'смены пароля нет в журнале');
});

test('смена пароля и входы доступны из интерфейса', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /id="password-form"/);
  assert.match(app, /api\('\/api\/v1\/auth\/password'/);
  assert.match(app, /api\('\/api\/v1\/auth\/sessions'\)/);
  assert.match(app, /data-revoke-others/);
  // Экран «Профиль и безопасность» был определён и не вызывался ниоткуда.
  assert.match(app, /settings:\(\)=>profileModal\(\)/, 'экран настроек снова недостижим');
  assert.match(app, /data-action="settings"/);
});
