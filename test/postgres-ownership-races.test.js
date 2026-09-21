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

async function company(base, suffix) {
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Гонки ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const join = async (tag, role = 'member') => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: `${tag}-${suffix}@t.test`, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const session = await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: tag, password: 'OwnerPassword42' } });
    const person = (await request(base, '/api/v1/people', { cookie: owner.cookie }))
      .payload.items.find((p) => p.email === `${tag}-${suffix}@t.test`);
    return { ...session, userId: person.userId };
  };
  return { owner, join };
}

const owners = async (base, cookie) => (await request(base, '/api/v1/people', { cookie }))
  .payload.items.filter((p) => p.role === 'owner');

// Два одновременных «передать владение» проходили оба: в компании
// оказывалось два хозяина, а инициатор оставался администратором.
test('владелец у компании остаётся один, даже если передать её двоим разом',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 7);
    const { owner, join } = await company(base, suffix);
    const anna = await join('anna');
    const boris = await join('boris');

    const results = await Promise.all([anna, boris].map((mate) => request(base, '/api/v1/workspace/owner', {
      cookie: owner.cookie, method: 'POST', body: { userId: mate.userId } })));
    const ok = results.filter((r) => r.status === 200);
    assert.equal(ok.length, 1, `прошли обе передачи: ${results.map((r) => r.status).join('/')}`);
    // Проигравший получает внятный отказ, а не сбой базы: либо «вас
    // опередили», либо «вы больше не владелец» — смотря что успело
    // произойти раньше.
    const refused = results.find((r) => r.status !== 200);
    assert.ok([403, 409].includes(refused.status), `отказ должен быть внятным, а не ${refused.status}`);
    assert.ok(['NOT_OWNER_ANYMORE', 'ALREADY_OWNER', 'FORBIDDEN'].includes(refused.code), String(refused.code));

    const live = await owners(base, anna.cookie);
    assert.equal(live.length, 1, `владельцев в компании: ${live.length}`);
  }
});

// Передача владения и увольнение того же человека шли по устаревшему
// снимку: он становился владельцем и уволенным разом — войти не мог, а
// вернуть компанию было уже некому.
test('компания не остаётся без живого владельца',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 7);
    const { owner, join } = await company(base, suffix);
    const boris = await join('boris');

    await Promise.all([
      request(base, '/api/v1/workspace/owner', { cookie: owner.cookie, method: 'POST', body: { userId: boris.userId } }),
      request(base, `/api/v1/people/${boris.userId}/deactivate`, { cookie: owner.cookie, method: 'POST' }),
    ]);

    const people = (await request(base, '/api/v1/people', { cookie: owner.cookie })).payload.items
      ?? (await request(base, '/api/v1/people', { cookie: boris.cookie })).payload.items;
    const chief = people.find((p) => p.role === 'owner');
    assert.ok(chief, 'владелец в компании есть');
    assert.notEqual(chief.active, false, 'и он не уволен');
  }
});

// Повторная отправка с тем же clientRequestId должна вернуть то же
// сообщение — в этом весь смысл идентификатора запроса. При одновременном
// повторе второй получал сырой конфликт уникального индекса.
test('одновременный повтор отправки возвращает то же сообщение',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Повтор ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const clientRequestId = `req-${suffix}-${attempt}-${Math.random().toString(36).slice(2, 8)}`;
    const body = { body: `Одно и то же ${attempt}`, clientRequestId };
    const sent = await Promise.all([1, 2, 3].map(() => request(base,
      `/api/v1/conversations/${conversation.id}/messages`, { cookie: owner.cookie, method: 'POST', body })));
    const codes = sent.map((r) => r.status);
    assert.ok(sent.every((r) => r.status < 400), `повтор ответил отказом: ${codes.join('/')}`);
    const ids = new Set(sent.map((r) => r.payload.message.id));
    assert.equal(ids.size, 1, 'все три ответа про одно и то же сообщение');

    const stored = (await request(base, `/api/v1/conversations/${conversation.id}/messages`, { cookie: owner.cookie }))
      .payload.items.filter((m) => m.body === body.body);
    assert.equal(stored.length, 1, 'и в переписке оно одно');
  }
});
