import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createWikiRepository } from '../src/wiki/wiki-repository.js';
import { createChatServer } from '../src/server.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL не задан';

async function sessionFor(store, userId, workspaceId) {
  const tokenHash = hashToken(`wiki-${randomUUID()}`);
  await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
  return store.getSession(tokenHash);
}

async function company(store) {
  const pass = hashPassword('WikiOwnerPass2026xx');
  const created = await store.createCompany({
    companyName: `Wiki ${randomUUID().slice(0, 8)}`, ownerName: 'Owner', email: `wiki-owner-${randomUUID()}@test.local`,
    passwordHash: pass.hash, passwordSalt: pass.salt,
  });
  const owner = await sessionFor(store, created.user.id, created.workspace.id);
  const join = async (role) => {
    const token = randomUUID();
    await store.createInvitation(owner, { email: `wiki-${role}-${randomUUID()}@test.local`, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 864e5).toISOString() });
    const p = hashPassword('WikiMemberPass2026xx');
    const accepted = await store.acceptInvitation({ tokenHash: hashToken(token), displayName: role, passwordHash: p.hash, passwordSalt: p.salt });
    return sessionFor(store, accepted.user.id, accepted.workspace.id);
  };
  return { owner, join };
}

test('дерево страниц: создание, дочерние страницы и полнотекстовый поиск по словоформе', { skip }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const { owner } = await company(store);
  const wiki = createWikiRepository(pool);

  const root = await wiki.create(owner, { title: 'Онбординг' });
  assert.equal(root.version, 1);
  assert.equal(root.parentId, null);

  const child = await wiki.create(owner, { title: 'Первая неделя', parentId: root.id, content: 'Настройте доступ к почте и календарю.' });
  assert.equal(child.parentId, root.id);

  const roots = await wiki.list(owner, {});
  assert.equal(roots.some((p) => p.id === root.id), true);
  assert.equal(roots.some((p) => p.id === child.id), false, 'дочерняя страница не должна попадать в список верхнего уровня');

  const children = await wiki.list(owner, { parentId: root.id });
  assert.deepEqual(children.map((p) => p.id), [child.id]);

  const detail = await wiki.get(owner, root.id);
  assert.equal(detail.children.length, 1);
  assert.equal(detail.children[0].id, child.id);

  const found = await wiki.search(owner, { query: 'календарю' });
  assert.equal(found.some((p) => p.id === child.id), true, 'поиск должен находить словоформу «календарю» по корню «календар»');
  assert.match(found.find((p) => p.id === child.id).snippet, /календар/i);

  await assert.rejects(() => wiki.create(owner, { title: 'Сирота', parentId: randomUUID() }), (err) => err.code === 'WIKI_PARENT_NOT_FOUND');
});

test('правка страницы: снимок «как было» уходит в историю, а версия защищает от тихой перезаписи', { skip }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const { owner } = await company(store);
  const wiki = createWikiRepository(pool);

  const page = await wiki.create(owner, { title: 'Регламент отпусков', content: 'Черновик.' });
  const updated = await wiki.update(owner, page.id, { content: 'Заявление подаётся за две недели.', expectedVersion: page.version });
  assert.equal(updated.version, 2);
  assert.equal(updated.content, 'Заявление подаётся за две недели.');
  assert.equal(updated.title, 'Регламент отпусков', 'заголовок не должен теряться при правке одного лишь текста');

  const history = await wiki.history(owner, page.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].content, 'Черновик.', 'в истории должен остаться текст ДО правки, а не после');
  assert.equal(history[0].version, 1);

  await assert.rejects(
    () => wiki.update(owner, page.id, { content: 'Кто-то не видел эту правку.', expectedVersion: page.version }),
    (err) => err.code === 'STALE_VERSION' && err.statusCode === 409,
    'сохранение по устаревшей версии должно быть отклонено, а не тихо перезаписать чужую правку',
  );

  const stillCurrent = await wiki.get(owner, page.id);
  assert.equal(stillCurrent.content, 'Заявление подаётся за две недели.', 'отклонённая правка не должна была применяться');

  await wiki.archive(owner, page.id);
  const archived = await wiki.get(owner, page.id);
  assert.notEqual(archived.archivedAt, null);
  const rootsAfterArchive = await wiki.list(owner, {});
  assert.equal(rootsAfterArchive.some((p) => p.id === page.id), false, 'архивная страница не должна оставаться в дереве');
});

test('память без базы честно отвечает 503', async () => {
  const wiki = createWikiRepository(null);
  assert.equal(wiki.enabled, false);
  assert.throws(() => wiki.list({}), (err) => err.code === 'WIKI_UNAVAILABLE' && err.statusCode === 503);
});

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload };
}

test('доступ по HTTP: гость получает честное «не найдено», а не «в вики отказано»; версия защищает правку и там', { skip }, async (t) => {
  const app = await createChatServer({ databaseUrl, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const suffix = randomUUID().slice(0, 8);
  const registerRes = await request(base, '/api/v1/auth/register-company', { method: 'POST', body: { companyName: `Wiki HTTP ${suffix}`, ownerName: 'Владелец', email: `wiki-http-${suffix}@t.test`, password: 'OwnerPassword42' } });
  assert.equal(registerRes.response.status, 201);
  const cookie = registerRes.response.headers.get('set-cookie')?.split(';')[0];

  const created = await request(base, '/api/v1/wiki/pages', { cookie, method: 'POST', body: { title: 'Проектные заметки', content: 'Первая версия.' } });
  assert.equal(created.response.status, 201);
  const pageId = created.payload.id;

  const listed = await request(base, '/api/v1/wiki/pages', { cookie });
  assert.equal(listed.payload.items.some((p) => p.id === pageId), true);

  const noVersion = await request(base, `/api/v1/wiki/pages/${pageId}`, { cookie, method: 'PATCH', body: { content: 'Без версии' } });
  assert.equal(noVersion.response.status, 400);
  assert.equal(noVersion.payload.error.code, 'EXPECTED_VERSION_REQUIRED');

  const patched = await request(base, `/api/v1/wiki/pages/${pageId}`, { cookie, method: 'PATCH', body: { content: 'Вторая версия.', expectedVersion: 1 } });
  assert.equal(patched.response.status, 200);
  assert.equal(patched.payload.version, 2);

  const stale = await request(base, `/api/v1/wiki/pages/${pageId}`, { cookie, method: 'PATCH', body: { content: 'Устаревшая правка.', expectedVersion: 1 } });
  assert.equal(stale.response.status, 409);

  const history = await request(base, `/api/v1/wiki/pages/${pageId}/history`, { cookie });
  assert.equal(history.payload.items.length, 1);
  assert.equal(history.payload.items[0].content, 'Первая версия.');

  const noSession = await request(base, '/api/v1/wiki/pages');
  assert.equal(noSession.response.status, 401);

  // Гость не имеет права wiki.use — отказ должен быть «не найдено», а не «доступ запрещён»,
  // тем же правилом, что и у остальных внутренних разделов продукта.
  const invited = await request(base, '/api/v1/invitations', { cookie, method: 'POST', body: { email: `wiki-guest-${suffix}@t.test`, role: 'guest' } });
  assert.equal(invited.response.status, 201);
  const guestToken = new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted = await request(base, '/api/v1/invitations/accept', { method: 'POST', body: { token: guestToken, displayName: 'Гость', password: 'GuestPassword42' } });
  assert.equal(accepted.response.status, 201);
  const guestCookie = accepted.response.headers.get('set-cookie')?.split(';')[0];
  const guestAttempt = await request(base, '/api/v1/wiki/pages', { cookie: guestCookie });
  assert.equal(guestAttempt.response.status, 404, 'гостю вики должна выглядеть как несуществующий раздел, а не как запрещённый');
});
