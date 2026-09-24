import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createChatServer } from '../src/server.js';
import { createVaultRepository, seal, open, readVaultKey } from '../src/vault/vault-repository.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const KEY = randomBytes(32).toString('base64');

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return {
    status: response.status, payload, code: payload?.error?.code,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
    cacheControl: response.headers.get('cache-control'),
  };
}

// Шифрование проверяется без базы: это чистая функция.
test('a sealed secret is not readable and not repeatable', () => {
  const key = randomBytes(32);
  const sealed = seal(key, 'Пароль-от-портала-2026');
  assert.ok(!sealed.includes(Buffer.from('Пароль', 'utf8')), 'открытый текст виден в шифртексте');
  assert.equal(open(key, sealed), 'Пароль-от-портала-2026');
  // Один и тот же пароль дважды даёт разный шифртекст: nonce случайный.
  assert.notDeepEqual(seal(key, 'один').toString('hex'), seal(key, 'один').toString('hex'));
  // Подделанный тег не проходит проверку подлинности.
  const tampered = Buffer.from(sealed); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => open(key, tampered));
  // Чужой ключ не открывает.
  assert.throws(() => open(randomBytes(32), sealed));
});

test('a key of the wrong size is not a key', () => {
  assert.equal(readVaultKey({ VAULT_KEY: Buffer.alloc(16).toString('base64') }), null);
  assert.equal(readVaultKey({}), null);
  assert.equal(readVaultKey({ VAULT_KEY: Buffer.alloc(32).toString('base64') })?.length, 32);
});

test('without a key the vault refuses instead of storing plaintext', () => {
  const repository = createVaultRepository({}, { key: null });
  assert.equal(repository.enabled, false);
  assert.equal(repository.reason, 'no-key');
  assert.rejects(async () => repository.list({}), (error) => error.code === 'VAULT_KEY_MISSING' && error.statusCode === 503);
});

test('a password is kept, revealed on demand and audited', { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  // Ключ приходит из окружения так же, как в развёртывании.
  process.env.VAULT_KEY = KEY;
  const server = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => server.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); delete process.env.VAULT_KEY; });
  const base = `http://127.0.0.1:${server.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 8);
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Хранилище ${suffix}`, ownerName: 'Владелец', email: `vault-${suffix}@granit.test`, password: 'OwnerPassword42' },
  });

  const empty = await request(base, '/api/v1/vault', {
    cookie: owner.cookie, method: 'POST', body: { title: 'Портал', secret: '' },
  });
  assert.equal(empty.code, 'INVALID_VAULT_SECRET');

  const created = await request(base, '/api/v1/vault', {
    cookie: owner.cookie, method: 'POST',
    body: { title: 'Портал подрядчика', login: 'zimin', url: 'https://portal.test', secret: 'Тайна-2026!' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.entry.secret, undefined, 'секрет вернулся в ответе на создание');

  const listed = await request(base, '/api/v1/vault', { cookie: owner.cookie });
  assert.equal(listed.payload.items.length, 1);
  assert.equal(listed.payload.items[0].secret, undefined, 'список раскрывает пароли');
  assert.equal(listed.payload.items[0].login, 'zimin');

  const revealed = await request(base, `/api/v1/vault/${created.payload.entry.id}/secret`, {
    cookie: owner.cookie, method: 'POST',
  });
  assert.equal(revealed.payload.entry.secret, 'Тайна-2026!');
  assert.equal(revealed.cacheControl, 'no-store', 'раскрытый пароль разрешено кешировать');

  // В базе пароля открытым текстом нет.
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const { rows } = await pool.query('SELECT secret FROM vault_entries WHERE id=$1', [created.payload.entry.id]);
    assert.ok(!rows[0].secret.toString('utf8').includes('Тайна'), 'пароль лежит в базе открытым текстом');
    const audit = await pool.query(
      "SELECT event_type FROM audit_events WHERE aggregate_id=$1 ORDER BY created_at", [created.payload.entry.id]);
    assert.deepEqual(audit.rows.map((r) => r.event_type), ['vault.created', 'vault.revealed']);
  } finally { await pool.end(); }

  // Чужой пароль не виден и не раскрывается.
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mate-${suffix}@granit.test`, role: 'member' },
  });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const mate = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Сотрудник', password: 'OwnerPassword42' },
  });
  const theirList = await request(base, '/api/v1/vault', { cookie: mate.cookie });
  assert.deepEqual(theirList.payload.items, []);
  const theirReveal = await request(base, `/api/v1/vault/${created.payload.entry.id}/secret`, {
    cookie: mate.cookie, method: 'POST',
  });
  assert.equal(theirReveal.code, 'VAULT_ENTRY_NOT_FOUND');

  const rotated = await request(base, `/api/v1/vault/${created.payload.entry.id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { secret: 'Новая-тайна-2027!' },
  });
  assert.equal(rotated.status, 200);
  const afterRotate = await request(base, `/api/v1/vault/${created.payload.entry.id}/secret`, {
    cookie: owner.cookie, method: 'POST',
  });
  assert.equal(afterRotate.payload.entry.secret, 'Новая-тайна-2027!');

  const removed = await request(base, `/api/v1/vault/${created.payload.entry.id}`, { cookie: owner.cookie, method: 'DELETE' });
  assert.equal(removed.status, 204);
  const afterDelete = await request(base, '/api/v1/vault', { cookie: owner.cookie });
  assert.deepEqual(afterDelete.payload.items, []);
});
