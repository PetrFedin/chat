import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createKnowledgeRepository } from '../src/knowledge/knowledge-repository.js';
import { createChatServer } from '../src/server.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL не задан';

async function sessionFor(store, userId, workspaceId) {
  const tokenHash = hashToken(`kb-${randomUUID()}`);
  await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
  return store.getSession(tokenHash);
}

async function company(store) {
  const pass = hashPassword('KnowledgePass2026xx');
  const created = await store.createCompany({
    companyName: `KB ${randomUUID().slice(0, 8)}`, ownerName: 'Owner', email: `kb-owner-${randomUUID()}@test.local`,
    passwordHash: pass.hash, passwordSalt: pass.salt,
  });
  const owner = await sessionFor(store, created.user.id, created.workspace.id);
  const join = async (role) => {
    const token = randomUUID();
    await store.createInvitation(owner, { email: `kb-${role}-${randomUUID()}@test.local`, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 864e5).toISOString() });
    const p = hashPassword('KnowledgePass2026xx');
    const accepted = await store.acceptInvitation({ tokenHash: hashToken(token), displayName: role, passwordHash: p.hash, passwordSalt: p.salt });
    return sessionFor(store, accepted.user.id, accepted.workspace.id);
  };
  return { owner, join };
}

test('репозиторий базы знаний: полнотекстовый поиск находит статью по словоформе, а бот честно молчит, если совпадений нет', { skip }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const knowledge = createKnowledgeRepository(pool);
  const { owner } = await company(store);

  const created = await knowledge.create(owner, { title: 'Отпуск', body: 'Ежегодный отпуск — 28 календарных дней, заявка подаётся за две недели до начала.', category: 'HR' });
  assert.equal(created.title, 'Отпуск');
  assert.equal(created.createdBy, owner.userId);

  const list = await knowledge.list(owner, {});
  assert.equal(list.length, 1);

  const found = await knowledge.list(owner, { query: 'отпуску' });
  assert.equal(found.length, 1, 'словоформа «отпуску» должна найти статью про «отпуск»');

  const asked = await knowledge.ask(owner, 'сколько дней отпуска мне положено');
  assert.equal(asked.matches.length, 1);
  assert.match(asked.matches[0].snippet, /<mark>/, 'фрагмент ответа подсвечивает совпавшие слова');
  assert.equal(asked.matches[0].title, 'Отпуск');

  const nothing = await knowledge.ask(owner, 'когда будет запущен спутник на Марс');
  assert.deepEqual(nothing.matches, [], 'бот не сочиняет ответ, если в базе ничего похожего нет');

  const updated = await knowledge.update(owner, created.id, { body: created.body + ' Неиспользованные дни переносятся один раз.' });
  assert.equal(updated.updatedBy, owner.userId);
  assert.notEqual(updated.updatedAt, created.updatedAt);

  await assert.rejects(() => knowledge.update(owner, created.id, {}), (err) => err.code === 'EMPTY_KNOWLEDGE_PATCH');
  await assert.rejects(() => knowledge.get(owner, randomUUID()), (err) => err.code === 'KNOWLEDGE_NOT_FOUND');

  await knowledge.remove(owner, created.id);
  await assert.rejects(() => knowledge.remove(owner, created.id), (err) => err.code === 'KNOWLEDGE_NOT_FOUND');
});

test('память без базы честно отвечает 503, а не подделывает базу знаний', async () => {
  const knowledge = createKnowledgeRepository(null);
  assert.equal(knowledge.enabled, false);
  assert.throws(() => knowledge.list({}, {}), (err) => err.code === 'KNOWLEDGE_UNAVAILABLE' && err.statusCode === 503);
});

test('доступ к базе знаний: сотрудник читает, но не пишет; гость не видит раздел вовсе', { skip }, async (t) => {
  const app = await createChatServer({ databaseUrl, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const request = async (path, { cookie, method = 'GET', body } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };

  const suffix = randomUUID().slice(0, 8);
  const owner = await request('/api/v1/auth/register-company', {
    method: 'POST', body: { companyName: `KB HTTP ${suffix}`, ownerName: 'Владелец', email: `kb-http-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  assert.equal(owner.status, 201);

  const created = await request('/api/v1/knowledge', { cookie: owner.cookie, method: 'POST', body: { title: 'Больничный', body: 'Лист нетрудоспособности сдаётся в HR в первый рабочий день после закрытия.' } });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const articleId = created.payload.article.id;

  const invite = await request('/api/v1/invitations', { cookie: owner.cookie, method: 'POST', body: { email: `kb-member-${suffix}@t.test`, role: 'member' } });
  assert.equal(invite.status, 201, JSON.stringify(invite.payload));
  const token = new URL(invite.payload.invitation.inviteUrl).searchParams.get('invite');
  const memberAccept = await request('/api/v1/invitations/accept', { method: 'POST', body: { token, displayName: 'Сотрудник', password: 'MemberPassword42' } });
  assert.equal(memberAccept.status, 201, JSON.stringify(memberAccept.payload));
  const memberCookie = memberAccept.cookie;

  const memberRead = await request('/api/v1/knowledge', { cookie: memberCookie });
  assert.equal(memberRead.status, 200);
  assert.equal(memberRead.payload.items.length, 1, 'сотрудник видит статьи компании');

  const memberAsk = await request('/api/v1/knowledge/ask', { cookie: memberCookie, method: 'POST', body: { question: 'когда сдавать лист нетрудоспособности' } });
  assert.equal(memberAsk.status, 200);
  assert.ok(memberAsk.payload.matches.length >= 1);

  const memberWrite = await request('/api/v1/knowledge', { cookie: memberCookie, method: 'POST', body: { title: 'Самоволка', body: 'Пробуем без права' } });
  assert.equal(memberWrite.status, 403);
  assert.equal(memberWrite.code, 'FORBIDDEN');

  const guestInvite = await request('/api/v1/invitations', { cookie: owner.cookie, method: 'POST', body: { email: `kb-guest-${suffix}@t.test`, role: 'guest' } });
  assert.equal(guestInvite.status, 201, JSON.stringify(guestInvite.payload));
  const guestToken = new URL(guestInvite.payload.invitation.inviteUrl).searchParams.get('invite');
  const guestAccept = await request('/api/v1/invitations/accept', { method: 'POST', body: { token: guestToken, displayName: 'Гость', password: 'GuestPassword42' } });
  assert.equal(guestAccept.status, 201, JSON.stringify(guestAccept.payload));

  const guestRead = await request('/api/v1/knowledge', { cookie: guestAccept.cookie });
  assert.equal(guestRead.status, 404, 'гостю раздел не должен подтверждать даже сам факт своего существования');
  assert.equal(guestRead.code, 'NOT_FOUND');

  const stillThere = await request(`/api/v1/knowledge/${articleId}`, { cookie: owner.cookie });
  assert.equal(stillThere.status, 200);
});
