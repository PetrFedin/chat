import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
process.env.VAULT_KEY ||= randomBytes(32).toString('base64');

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'idempotency-key': crypto.randomUUID(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function company(t, suffix, patch = {}) {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Домен ${suffix}`, ownerName: 'Владелец', email: `dj-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  if (Object.keys(patch).length) {
    const saved = await request(base, '/api/v1/workspace', { cookie: owner.cookie, method: 'PATCH', body: patch });
    assert.equal(saved.status, 200, `настройки компании не сохранились: ${saved.code}`);
  }
  return { base, owner };
}

/** Что легло в очередь писем — по нему и видно, ушла ссылка или нет. */
async function lettersTo(email) {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
  pool.on('error', () => {});
  try {
    const { rows } = await pool.query('SELECT kind, subject FROM mail_messages WHERE lower(to_email)=lower($1)', [email]);
    return rows;
  } finally { await pool.end(); }
}

/**
 * Заведись сам по рабочей почте.
 *
 * Попасть в компанию можно было одним способом: кто-то заводит именно
 * тебя и присылает ссылку. Для сорока человек это сорок действий
 * администратора, и каждый ждёт своей очереди.
 */
test('человек с адресом на домене компании заводится сам',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const domain = `granit-${suffix}.test`;
  const { base } = await company(t, suffix, { emailDomain: domain, domainJoin: true, seatLimit: 10 });

  const asked = await request(base, '/api/v1/auth/join', { method: 'POST', body: { email: `novikov@${domain}` } });
  assert.equal(asked.status, 202);

  const letters = await lettersTo(`novikov@${domain}`);
  assert.equal(letters.length, 1, 'ссылка-подтверждение не ушла');
  assert.equal(letters[0].kind, 'invitation');

  // И по этой ссылке человек действительно входит — код принятия тот же,
  // что у обычного приглашения.
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
  pool.on('error', () => {});
  const { rows } = await pool.query(
    "SELECT role, status FROM workspace_invitations WHERE lower(email)=lower($1)", [`novikov@${domain}`]);
  await pool.end();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'member', 'самостоятельный вход не должен давать больше прав, чем у сотрудника');
  assert.equal(rows[0].status, 'pending');
});

/**
 * Ответ всегда одинаковый. Иначе этот адрес превращается в справочник
 * «а пользуется ли ChatX компания такая-то» — вопрос, на который
 * посторонним отвечать нечего.
 */
test('чужому домену отвечают ровно то же, что своему, и письма не шлют',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const domain = `granit-${suffix}.test`;
  const { base } = await company(t, suffix, { emailDomain: domain, domainJoin: true });

  const own = await request(base, '/api/v1/auth/join', { method: 'POST', body: { email: `svoy@${domain}` } });
  const alien = await request(base, '/api/v1/auth/join', { method: 'POST', body: { email: `chuzhoy@nobody-${suffix}.test` } });
  const broken = await request(base, '/api/v1/auth/join', { method: 'POST', body: { email: 'без-собаки' } });

  assert.equal(own.status, 202);
  assert.equal(alien.status, 202);
  assert.equal(broken.status, 202);
  assert.equal(alien.payload.message, own.payload.message, 'по ответу видно, есть ли такая компания');
  assert.equal(broken.payload.message, own.payload.message);
  assert.equal((await lettersTo(`chuzhoy@nobody-${suffix}.test`)).length, 0, 'письмо ушло на чужой домен');
});

/** Домен объявлен, но самостоятельный вход выключен — значит выключен. */
test('без разрешения по домену никто сам не заводится',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const domain = `granit-${suffix}.test`;
  const { base } = await company(t, suffix, { emailDomain: domain });

  await request(base, '/api/v1/auth/join', { method: 'POST', body: { email: `tihiy@${domain}` } });
  assert.equal((await lettersTo(`tihiy@${domain}`)).length, 0, 'завёлся при выключенном разрешении');
});

/**
 * Мест нет — человеку писать нечего, а владельцу есть: он один может их
 * добавить, и без письма о запросе не узнает.
 */
test('когда места кончились, письмо уходит владельцу, а не просящему',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const domain = `granit-${suffix}.test`;
  // В компании уже есть владелец — одного места хватает ровно на него.
  const { base } = await company(t, suffix, { emailDomain: domain, domainJoin: true, seatLimit: 1 });

  const asked = await request(base, '/api/v1/auth/join', { method: 'POST', body: { email: `pozdniy@${domain}` } });
  assert.equal(asked.status, 202);
  assert.equal((await lettersTo(`pozdniy@${domain}`)).length, 0, 'позвали в переполненную компанию');

  const toOwner = await lettersTo(`dj-${suffix}@t.test`);
  assert.equal(toOwner.length, 1, 'владелец не узнал, что мест не хватило');
  assert.match(toOwner[0].subject, /нет свободных мест/);
});

/** Пускать по домену, не объявив домена, нельзя: пускать будет некуда. */
test('разрешение по домену без домена отклоняется',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner } = await company(t, suffix);
  const saved = await request(base, '/api/v1/workspace', {
    cookie: owner.cookie, method: 'PATCH', body: { emailDomain: '', domainJoin: true },
  });
  assert.equal(saved.status, 400);
  assert.equal(saved.code, 'DOMAIN_REQUIRED');
});
