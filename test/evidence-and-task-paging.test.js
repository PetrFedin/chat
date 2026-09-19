import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/persistence/store.js';
import { hashPassword, hashToken } from '../src/security.js';
import { compareTasks, encodeTaskCursor, decodeTaskCursor, taskPageSize } from '../src/task/task-page.js';
import { createChatServer } from '../src/server.js';

const password = hashPassword('WorkspacePass42');

async function sessionFor(store, userId, workspaceId, label) {
  const tokenHash = hashToken(`session-${label}-${Math.random()}`);
  await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  return store.getSession(tokenHash);
}

async function fixture() {
  const store = new MemoryStore();
  const created = await store.createCompany({
    companyName: 'Northstar', ownerName: 'Owner', email: 'owner@example.com',
    passwordHash: password.hash, passwordSalt: password.salt,
  });
  const owner = await sessionFor(store, created.user.id, created.workspace.id, 'owner');
  return { store, owner };
}

test('the task page cursor round-trips, including an undated task', () => {
  const dated = { promisedAt: '2026-01-02T03:04:05.000Z', createdAt: '2026-01-01T00:00:00.000Z', id: 'a' };
  assert.deepEqual(decodeTaskCursor(encodeTaskCursor(dated)), {
    promisedAt: dated.promisedAt, createdAt: dated.createdAt, id: 'a',
  });

  const undated = { promisedAt: null, createdAt: '2026-01-01T00:00:00.000Z', id: 'b' };
  assert.match(encodeTaskCursor(undated), /^-\|/);
  assert.equal(decodeTaskCursor(encodeTaskCursor(undated)).promisedAt, null);

  for (const bad of ['nonsense', 'a|b|c', '2026-01-01T00:00:00Z|nope|id']) {
    assert.throws(() => decodeTaskCursor(bad), (error) => error.code === 'INVALID_CURSOR', `принят мусор: ${bad}`);
  }
  assert.equal(decodeTaskCursor(null), null);
});

test('undated work sorts after every dated task, newest first within a tie', () => {
  const rows = [
    { id: 'no-date', promisedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'later', promisedAt: '2026-03-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'sooner', promisedAt: '2026-02-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'tie-new', promisedAt: '2026-02-01T00:00:00.000Z', createdAt: '2026-01-05T00:00:00.000Z' },
  ];
  assert.deepEqual([...rows].sort(compareTasks).map((r) => r.id), ['tie-new', 'sooner', 'later', 'no-date']);
});

test('the page size is clamped rather than trusted', () => {
  assert.equal(taskPageSize(undefined), 50);
  assert.equal(taskPageSize(0), 50);
  assert.equal(taskPageSize(-5), 1);
  assert.equal(taskPageSize(10_000), 200);
  assert.equal(taskPageSize('25'), 25);
});

// The list used to return a workspace's whole backlog in a single answer.
test('the task list is paged and the cursor walks every task exactly once', async () => {
  const { store, owner } = await fixture();
  const created = [];
  for (let i = 0; i < 7; i += 1) {
    created.push(await store.createTask(owner, {
      title: `Задача ${i}`,
      ownerId: owner.userId,
      requesterId: owner.userId,
      acceptorId: owner.userId,
      // a mix of dated and undated so the cursor crosses the NULL boundary
      promisedAt: i % 3 === 0 ? null : new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    }));
  }

  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = await store.listTasksPage(owner, { limit: 3, cursor });
    pages += 1;
    assert.ok(page.items.length <= 3, 'страница больше лимита');
    seen.push(...page.items.map((t) => t.id));
    cursor = page.nextCursor;
    assert.ok(pages < 10, 'курсор не сходится');
  } while (cursor);

  assert.equal(seen.length, created.length, 'страницы не покрыли весь список');
  assert.equal(new Set(seen).size, created.length, 'задача попала на две страницы');
  assert.deepEqual(new Set(seen), new Set(created.map((t) => t.id)));

  // The paged walk has to agree with the order the whole list uses.
  const all = await store.listTasksPage(owner, { limit: 200 });
  assert.deepEqual(seen, all.items.map((t) => t.id), 'порядок страниц разошёлся с общим порядком');
  assert.equal(all.nextCursor, null, 'последняя страница вернула курсор');
});

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

// The evidence type was checked but its value never was, so a «url» could hold
// prose and a «file» could name an id that does not exist.
test('evidence values are checked against the type they claim', async (t) => {
  const app = await createChatServer({ store: new MemoryStore() });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: 'Evidence Co', ownerName: 'Owner', email: 'owner@evidence.test', password: 'OwnerPassword42' },
  });
  assert.equal(owner.response.status, 201);
  const cookie = owner.cookie;

  const created = await request(base, '/api/v1/tasks', {
    cookie, method: 'POST', body: { title: 'Проверка доказательств', outcome: 'Доказательства проверяются' },
  });
  assert.equal(created.response.status, 201);
  const taskId = created.payload.task.id;

  const version = async () => (await request(base, `/api/v1/tasks/${taskId}`, { cookie })).payload.task.version;
  const post = async (type, value) => request(base, `/api/v1/tasks/${taskId}/evidence`, {
    cookie, method: 'POST', body: { type, value, expectedVersion: await version() },
  });

  for (const [type, value] of [
    ['url', 'просто текст'],
    ['url', 'javascript:alert(1)'],
    ['metric', 'выросло'],
    ['file', '00000000-0000-4000-8000-000000000000'],
    ['message', '00000000-0000-4000-8000-000000000000'],
  ]) {
    const { response, payload } = await post(type, value);
    assert.equal(response.status, 400, `${type}=${value} принято`);
    assert.equal(payload.error?.code, 'INVALID_EVIDENCE_VALUE');
  }

  // A note is free text; a well-formed URL and a metric still go through.
  assert.equal((await post('note', 'Готово, см. вложение')).response.status, 201);
  assert.equal((await post('url', 'https://example.com/report')).response.status, 201);
  assert.equal((await post('metric', '42 ms p95')).response.status, 201);
});

// The endpoint used to answer with the workspace's whole backlog.
test('GET /api/v1/tasks answers a bounded page with a cursor', async (t) => {
  const app = await createChatServer({ store: new MemoryStore() });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: 'Paging Co', ownerName: 'Owner', email: 'owner@paging.test', password: 'OwnerPassword42' },
  });
  const cookie = owner.cookie;

  const ids = [];
  for (let i = 0; i < 7; i += 1) {
    const created = await request(base, '/api/v1/tasks', {
      cookie, method: 'POST',
      body: { title: `Задача ${i}`, promisedAt: i % 3 === 0 ? null : new Date(Date.UTC(2026, 0, i + 1)).toISOString() },
    });
    assert.equal(created.response.status, 201);
    ids.push(created.payload.task.id);
  }

  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const query = `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const { response, payload } = await request(base, `/api/v1/tasks${query}`, { cookie });
    assert.equal(response.status, 200);
    assert.ok(payload.items.length <= 3, 'страница больше лимита');
    seen.push(...payload.items.map((t2) => t2.id));
    cursor = payload.nextCursor;
    pages += 1;
    assert.ok(pages < 10, 'курсор не сходится');
  } while (cursor);

  assert.equal(new Set(seen).size, ids.length, 'страницы не покрыли список ровно один раз');
  assert.deepEqual(new Set(seen), new Set(ids));

  const bad = await request(base, '/api/v1/tasks?cursor=мусор', { cookie });
  assert.equal(bad.response.status, 400);
  assert.equal(bad.payload.error.code, 'INVALID_CURSOR');
});
