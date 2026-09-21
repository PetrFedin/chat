import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// Клиент выбрасывал курсор следующей страницы, и переписка глубже первой
// сотни сообщений была недостижима ни прокруткой, ни поиском по ленте.
test('переписку можно дочитать до самого начала',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Лента ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];

  const TOTAL = 130;
  for (let i = 1; i <= TOTAL; i += 1) {
    await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
      cookie: owner.cookie, method: 'POST', body: { body: `Сообщение ${i}` } });
  }

  const first = await request(base, `/api/v1/conversations/${conversation.id}/messages`, { cookie: owner.cookie });
  assert.equal(first.payload.items.length, 100);
  assert.ok(first.payload.nextCursor, 'сервер обещает продолжение');
  assert.equal(first.payload.items.at(-1).body, `Сообщение ${TOTAL}`, 'первая страница — самые свежие');

  const older = await request(base,
    `/api/v1/conversations/${conversation.id}/messages?before=${encodeURIComponent(first.payload.nextCursor)}`,
    { cookie: owner.cookie });
  assert.equal(older.payload.items.length, 30);
  assert.equal(older.payload.items[0].body, 'Сообщение 1', 'и продолжение доходит до самого начала');
  assert.equal(older.payload.nextCursor, null, 'дальше листать нечего');

  const seen = new Set([...first.payload.items, ...older.payload.items].map((m) => m.id));
  assert.equal(seen.size, TOTAL, 'страницы не перекрываются и ничего не теряют');

  // И клиент этим пользуется, а не выбрасывает курсор.
  const client = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(client, /messages\?before=/);
  assert.match(client, /loadOlderMessages/);
});
