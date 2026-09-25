import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createApiKeyRepository } from '../src/api-keys/api-key-repository.js';
import { createChatServer } from '../src/server.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL не задан';

async function sessionFor(store, userId, workspaceId) {
  const tokenHash = hashToken(`apikey-${randomUUID()}`);
  await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
  return store.getSession(tokenHash);
}

async function company(store, { email } = {}) {
  const pass = hashPassword('ApiKeyOwnerPass2026xx');
  const created = await store.createCompany({
    companyName: `API Keys ${randomUUID().slice(0, 8)}`, ownerName: 'Owner', email: email || `apikey-owner-${randomUUID()}@test.local`,
    passwordHash: pass.hash, passwordSalt: pass.salt,
  });
  return sessionFor(store, created.user.id, created.workspace.id);
}

test('ключ создаётся один раз показывает секрет, а resolve узнаёт его по хешу', { skip }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const owner = await company(store);
  const apiKeys = createApiKeyRepository(pool);

  const created = await apiKeys.create(owner, { name: 'Экспортный скрипт' });
  assert.equal(typeof created.key, 'string');
  assert.equal(created.key.startsWith('cxk_'), true);
  assert.equal(created.keyPrefix, created.key.slice(0, 12));

  const list = await apiKeys.list(owner);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Экспортный скрипт');
  assert.equal('key' in list[0], false, 'список не должен нести секрет');

  const resolved = await apiKeys.resolve(created.key);
  assert.equal(resolved.userId, owner.userId);
  assert.equal(resolved.workspaceId, owner.workspaceId);
  assert.equal(resolved.role, owner.role);
  assert.equal(resolved.readOnly, false);

  assert.equal(await apiKeys.resolve('cxk_' + 'garbage'.repeat(4)), null, 'случайная строка не должна опознаваться');
  assert.equal(await apiKeys.resolve('not-even-the-right-prefix'), null);
});

test('отозванный ключ больше не опознаётся', { skip }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const owner = await company(store);
  const apiKeys = createApiKeyRepository(pool);

  const created = await apiKeys.create(owner, { name: 'Временный доступ' });
  assert.notEqual(await apiKeys.resolve(created.key), null);

  await apiKeys.revoke(owner, created.id);
  assert.equal(await apiKeys.resolve(created.key), null, 'после отзыва ключ не должен работать');

  await assert.rejects(() => apiKeys.revoke(owner, created.id), (err) => err.code === 'NOT_FOUND', 'повторный отзыв уже отозванного — не найден');
});

test('чужой ключ отозвать нельзя, а пустое имя отклоняется', { skip }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const owner = await company(store);
  const stranger = await company(store);
  const apiKeys = createApiKeyRepository(pool);

  const created = await apiKeys.create(owner, { name: 'Владельца ключ' });
  await assert.rejects(() => apiKeys.revoke(stranger, created.id), (err) => err.code === 'NOT_FOUND');
  await assert.rejects(() => apiKeys.create(owner, { name: '  ' }), (err) => err.code === 'API_KEY_NAME_REQUIRED');
});

test('память без базы честно отвечает 503', async () => {
  const apiKeys = createApiKeyRepository(null);
  assert.equal(apiKeys.enabled, false);
  assert.throws(() => apiKeys.list({}), (err) => err.code === 'API_KEYS_UNAVAILABLE' && err.statusCode === 503);
  assert.equal(await apiKeys.resolve('cxk_anything'), null, 'без базы ключ просто не опознаётся, а не падает');
});

test('доступ по HTTP: Bearer-ключ входит вместо cookie, только-чтение блокирует запись, отзыв — немедленный', { skip }, async (t) => {
  const app = await createChatServer({ databaseUrl, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const request = async (path, { cookie, bearer, method = 'GET', body } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return response;
  };

  const suffix = randomUUID().slice(0, 8);
  const registerRes = await request('/api/v1/auth/register-company', {
    method: 'POST', body: { companyName: `API Keys HTTP ${suffix}`, ownerName: 'Владелец', email: `apikey-http-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  assert.equal(registerRes.status, 201);
  const cookie = registerRes.headers.get('set-cookie')?.split(';')[0];

  // Без cookie и без ключа список ключей недоступен.
  assert.equal((await request('/api/v1/api-keys')).status, 401);

  const created = await (await request('/api/v1/api-keys', { cookie, method: 'POST', body: { name: 'Полный доступ' } })).json();
  assert.equal(typeof created.key, 'string');

  const readOnly = await (await request('/api/v1/api-keys', { cookie, method: 'POST', body: { name: 'Только чтение', readOnly: true } })).json();

  // Полный ключ вместо cookie видит bootstrap так же, как сам владелец.
  const bootstrap = await request('/api/v1/bootstrap', { bearer: created.key });
  assert.equal(bootstrap.status, 200);

  // Полный ключ может создавать сущности — например, ещё один ключ от своего имени.
  const secondViaKey = await request('/api/v1/api-keys', { bearer: created.key, method: 'POST', body: { name: 'Выпущен по API' } });
  assert.equal(secondViaKey.status, 201);

  // Ключ «только чтение» видит bootstrap, но не может создавать.
  const readBootstrap = await request('/api/v1/bootstrap', { bearer: readOnly.key });
  assert.equal(readBootstrap.status, 200);
  const blocked = await request('/api/v1/api-keys', { bearer: readOnly.key, method: 'POST', body: { name: 'Не должно получиться' } });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, 'API_KEY_READ_ONLY');

  // Список ключей никогда не несёт секрет.
  const list = await (await request('/api/v1/api-keys', { cookie })).json();
  assert.equal(list.items.every((item) => !('key' in item)), true);
  const fullKeyRow = list.items.find((item) => item.name === 'Полный доступ');

  // Отзыв делает ключ немедленно недействительным.
  const revokeRes = await request(`/api/v1/api-keys/${fullKeyRow.id}`, { cookie, method: 'DELETE' });
  assert.equal(revokeRes.status, 200);
  const afterRevoke = await request('/api/v1/bootstrap', { bearer: created.key });
  assert.equal(afterRevoke.status, 401);

  // Чужой рабочий стол ключ не открывает.
  const otherSuffix = randomUUID().slice(0, 8);
  const otherRegister = await request('/api/v1/auth/register-company', {
    method: 'POST', body: { companyName: `API Keys Other ${otherSuffix}`, ownerName: 'Другой владелец', email: `apikey-other-${otherSuffix}@t.test`, password: 'OwnerPassword42' },
  });
  const otherCookie = otherRegister.headers.get('set-cookie')?.split(';')[0];
  const otherKeys = await (await request('/api/v1/api-keys', { cookie: otherCookie })).json();
  assert.equal(otherKeys.items.length, 0, 'у другой компании нет доступа к чужим ключам');
});
