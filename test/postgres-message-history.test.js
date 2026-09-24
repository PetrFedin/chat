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

/**
 * Окно вокруг найденного сообщения.
 *
 * Переход из поиска к реплике трёхмесячной давности подгружал последние
 * сто сообщений, не находил её среди них и молча оставлял человека внизу
 * ленты. Первая версия окна к тому же уехала в продукт с лишним SELECT в
 * запросе — потому что этот путь не выполнялся ни в одном тесте.
 */
test('ленту можно открыть окном вокруг старого сообщения',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Окно ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];

  const send = async (body) => (await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body } })).payload.message;

  const old = await send('Договор подряда СГ-114 подписан');
  for (let i = 1; i <= 150; i += 1) await send(`Потом ${i}`);

  const page = await request(base, `/api/v1/conversations/${conversation.id}/messages`, { cookie: owner.cookie });
  assert.equal(page.payload.items.some((m) => m.id === old.id), false,
    'сообщение должно уйти за пределы первой страницы, иначе проверка ничего не проверяет');

  const window = await request(base,
    `/api/v1/conversations/${conversation.id}/messages?around=${old.id}`, { cookie: owner.cookie });
  assert.equal(window.status, 200);
  const index = window.payload.items.findIndex((m) => m.id === old.id);
  assert.ok(index >= 0, 'искомого сообщения нет в окне вокруг него самого');
  assert.ok(window.payload.items.length > index + 1, 'после найденного сообщения должен быть виден разговор');
  const times = window.payload.items.map((m) => Date.parse(m.createdAt));
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'окно пришло не по порядку');
  assert.equal(new Set(window.payload.items.map((m) => m.id)).size, window.payload.items.length,
    'половинки окна перекрылись');

  // Тело и вложенные поля должны быть теми же, что на обычной странице.
  const sample = window.payload.items[index];
  assert.equal(sample.body, 'Договор подряда СГ-114 подписан');
  assert.deepEqual(sample.reactions, []);
  assert.equal(sample.pinned, false);

  const missing = await request(base,
    `/api/v1/conversations/${conversation.id}/messages?around=${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`,
    { cookie: owner.cookie });
  assert.equal(missing.code, 'MESSAGE_NOT_FOUND', 'исчезнувшее сообщение должно называться своим отказом');
  const broken = await request(base,
    `/api/v1/conversations/${conversation.id}/messages?around=не-идентификатор`, { cookie: owner.cookie });
  assert.equal(broken.status, 400);
});

// Личная переписка называлась «Диалог» — все сразу. С двумя собеседниками
// список превращался в загадку.
test('личная переписка зовётся именем собеседника',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Диалоги ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const join = async (tag, name) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: `${tag}-${suffix}@t.test`, role: 'member' } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const session = await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: name, password: 'OwnerPassword42' } });
    const person = (await request(base, '/api/v1/people', { cookie: owner.cookie }))
      .payload.items.find((p) => p.email === `${tag}-${suffix}@t.test`);
    return { ...session, userId: person.userId };
  };
  const nina = await join('nina', 'Нина Бухгалтер');
  const oleg = await join('oleg', 'Олег Прораб');

  for (const mate of [nina, oleg]) {
    await request(base, '/api/v1/conversations', {
      cookie: owner.cookie, method: 'POST', body: { kind: 'direct', participantIds: [mate.userId] } });
  }

  const mine = (await request(base, '/api/v1/conversations', { cookie: owner.cookie })).payload.items
    .filter((c) => c.kind === 'direct').map((c) => c.title).sort();
  assert.deepEqual(mine, ['Нина Бухгалтер', 'Олег Прораб']);

  // С той стороны переписка зовётся владельцем — имя всегда чужое, не своё.
  const hers = (await request(base, '/api/v1/conversations', { cookie: nina.cookie })).payload.items
    .filter((c) => c.kind === 'direct').map((c) => c.title);
  assert.deepEqual(hers, ['Владелец']);
});
