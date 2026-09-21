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

// Общий словарь компании принадлежал всем и никому: гость заводил в нём
// метку, а любой сотрудник переименовывал и удалял чужую. Вчерашняя
// «Важно» назавтра оказывалась «Не важно» у всех сразу.
test('the shared vocabulary has an owner, personal labels stay personal',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Метки ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const join = async (tag, role) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: `${tag}-${suffix}@t.test`, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    return request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: tag, password: 'OwnerPassword42' } });
  };
  const chief = await join('chief', 'manager');
  const worker = await join('worker', 'member');
  const guest = await join('client', 'guest');

  const shared = await request(base, '/api/v1/labels', {
    cookie: owner.cookie, method: 'POST', body: { kind: 'priority', name: 'Важно', colour: 'red' } });
  assert.equal(shared.status, 201);
  assert.equal(shared.payload.label.personal, false);

  // Гость общий словарь не трогает — он сотрудник другой компании.
  const guestShared = await request(base, '/api/v1/labels', {
    cookie: guest.cookie, method: 'POST', body: { kind: 'tag', name: 'Гостевая общая' } });
  assert.equal(guestShared.code, 'GUEST_LABEL_SHARED');

  // Но личные метки у него свои.
  const guestOwn = await request(base, '/api/v1/labels', {
    cookie: guest.cookie, method: 'POST', body: { kind: 'tag', name: 'Моя', personal: true } });
  assert.equal(guestOwn.status, 201);
  assert.equal(guestOwn.payload.label.personal, true);

  // Рядовой сотрудник не переименовывает и не удаляет общую метку.
  const renamed = await request(base, `/api/v1/labels/${shared.payload.label.id}`, {
    cookie: worker.cookie, method: 'PATCH', body: { name: 'Не важно' } });
  assert.equal(renamed.code, 'LABEL_SHARED_FORBIDDEN');
  const dropped = await request(base, `/api/v1/labels/${shared.payload.label.id}`, {
    cookie: worker.cookie, method: 'DELETE' });
  assert.equal(dropped.code, 'LABEL_SHARED_FORBIDDEN');

  // Тот, кто распоряжается каналами, ведёт и словарь.
  const chiefRename = await request(base, `/api/v1/labels/${shared.payload.label.id}`, {
    cookie: chief.cookie, method: 'PATCH', body: { name: 'Срочно' } });
  assert.equal(chiefRename.status, 200);
  assert.equal(chiefRename.payload.label.name, 'Срочно');

  // Чужая личная метка для всех остальных просто не существует.
  const mine = await request(base, '/api/v1/labels', {
    cookie: worker.cookie, method: 'POST', body: { kind: 'tag', name: 'Личная сотрудника', personal: true } });
  const peek = await request(base, `/api/v1/labels/${mine.payload.label.id}`, {
    cookie: chief.cookie, method: 'PATCH', body: { name: 'Чужая' } });
  assert.equal(peek.code, 'LABEL_NOT_FOUND');
  assert.equal(peek.status, 404);

  // И свою личную человек ведёт сам.
  const own = await request(base, `/api/v1/labels/${mine.payload.label.id}`, {
    cookie: worker.cookie, method: 'PATCH', body: { name: 'Моя, переименована' } });
  assert.equal(own.status, 200);
});
