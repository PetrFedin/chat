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
 * Восстановление пароля по ссылке — единственный сценарий, который человек
 * не может обойти повтором: не сработало, значит не вошёл. Хранилище было
 * покрыто тестами, сам маршрут — нет: ни хеширование нового пароля, ни
 * разбор токена, ни отказ на погашенной ссылке.
 */
test('ссылка восстановления работает один раз и выдаёт вход по новому паролю',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const OLD = 'OwnerPassword42';
  const NEW = 'НовыйПароль2026';

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Восстановление ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: OLD },
  });
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `lost-${suffix}@t.test`, role: 'member' } });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const mate = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Забывчивый', password: OLD } });
  const mateId = (await request(base, '/api/v1/people', { cookie: owner.cookie }))
    .payload.items.find((p) => p.email === `lost-${suffix}@t.test`).userId;

  // Администратор выписывает ссылку и передаёт её лично.
  const issued = await request(base, '/api/v1/password-resets', {
    cookie: owner.cookie, method: 'POST', body: { userId: mateId } });
  assert.equal(issued.status, 201);
  const resetToken = new URL(issued.payload.reset.resetUrl).searchParams.get('reset');
  assert.ok(resetToken);

  // Мусорный токен не годится.
  assert.notEqual((await request(base, '/api/v1/password-resets/redeem', {
    method: 'POST', body: { token: 'не-токен', password: NEW } })).status, 204);

  // Слабый пароль не проходит и по ссылке тоже.
  assert.equal((await request(base, '/api/v1/password-resets/redeem', {
    method: 'POST', body: { token: resetToken, password: '1' } })).code, 'WEAK_PASSWORD');

  const redeemed = await request(base, '/api/v1/password-resets/redeem', {
    method: 'POST', body: { token: resetToken, password: NEW } });
  assert.equal(redeemed.status, 204, 'ссылка не сработала');
  assert.equal(redeemed.cookie, undefined, 'погашение ссылки не должно само выдавать сессию');

  // Новый пароль работает, старый — нет.
  assert.equal((await request(base, '/api/v1/auth/login', {
    method: 'POST', body: { email: `lost-${suffix}@t.test`, password: NEW } })).status, 200);
  assert.notEqual((await request(base, '/api/v1/auth/login', {
    method: 'POST', body: { email: `lost-${suffix}@t.test`, password: OLD } })).status, 200);

  // Ссылка срабатывает один раз.
  assert.notEqual((await request(base, '/api/v1/password-resets/redeem', {
    method: 'POST', body: { token: resetToken, password: 'ЕщёОдин2026Пароль' } })).status, 204);

  // И старые сессии этого человека оборваны: ссылку мог использовать тот,
  // кто увёл доступ.
  assert.equal((await request(base, '/api/v1/bootstrap', { cookie: mate.cookie })).status, 401);
});
