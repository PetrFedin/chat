import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createTelegramBridgeRepository } from '../src/integrations/telegram-bridge-repository.js';
import { createChatServer } from '../src/server.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL не задан';
const VAULT_KEY = 'a'.repeat(43) + '='; // 32 случайных байт в base64, для теста подойдёт фиксированный

/**
 * Настоящего токена бота взять неоткуда — Telegram не выдаёт его для
 * теста. Подменяем весь HTTP к api.telegram.org одной функцией и
 * записываем, что ей передали: это проверяет форму запроса и то, что
 * репозиторий действительно обращается к Telegram, а не что где-то в
 * интернете есть настоящий бот.
 */
function fakeTelegram({ username = 'partner_bot', failMethod = null } = {}) {
  const calls = [];
  const request = async (url, opts) => {
    const method = url.split('/').pop();
    const body = JSON.parse(opts.body);
    calls.push({ method, body });
    if (method === failMethod) return { ok: false, json: async () => ({ ok: false, description: 'Telegram отказал' }) };
    const result = {
      getMe: { username, id: 123 },
      setWebhook: true,
      deleteWebhook: true,
      sendMessage: { message_id: 1 },
    }[method];
    return { ok: true, json: async () => ({ ok: true, result }) };
  };
  return { request, calls };
}

async function sessionFor(store, userId, workspaceId) {
  const tokenHash = hashToken(`tg-${randomUUID()}`);
  await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
  return store.getSession(tokenHash);
}

async function company(store) {
  const pass = hashPassword('TelegramPass2026xx');
  const created = await store.createCompany({
    companyName: `TG ${randomUUID().slice(0, 8)}`, ownerName: 'Owner', email: `tg-owner-${randomUUID()}@test.local`,
    passwordHash: pass.hash, passwordSalt: pass.salt,
  });
  const owner = await sessionFor(store, created.user.id, created.workspace.id);
  const room = await store.createConversation(owner, { kind: 'team', title: 'Partners', visibility: 'private', participantIds: [] });
  return { owner, room };
}

test('репозиторий моста: токен проверяется настоящим вызовом, шифруется в базе, и мост честно доставляет и принимает сообщения', { skip }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const { owner, room } = await company(store);
  const tg = fakeTelegram();
  const telegram = createTelegramBridgeRepository(pool, store, { request: tg.request, env: { VAULT_KEY } });

  const bridge = await telegram.create(owner, { conversationId: room.id, botToken: '123:FAKE', chatId: '-1009', publicBaseUrl: 'https://chat.example' });
  assert.equal(bridge.botUsername, 'partner_bot');
  assert.equal(bridge.telegramChatId, '-1009');
  assert.deepEqual(tg.calls.map((c) => c.method), ['getMe', 'setWebhook']);
  assert.equal(tg.calls[1].body.secret_token.length > 20, true, 'секрет для вебхука не тривиален');

  const { rows } = await pool.query('SELECT bot_token_sealed FROM telegram_bridges WHERE id=$1', [bridge.id]);
  assert.notEqual(rows[0].bot_token_sealed.toString('utf8'), '123:FAKE', 'токен не должен лежать в базе открытым текстом');

  const list = await telegram.list(owner);
  assert.equal(list.length, 1);
  assert.equal(list[0].botUsername, 'partner_bot');
  assert.ok(!('bot_token_sealed' in list[0]), 'список не должен содержать сырой запечатанный токен');

  // Второй мост на ту же беседу отклоняется, и Telegram-вебхук первого не трогает.
  await assert.rejects(
    () => telegram.create(owner, { conversationId: room.id, botToken: '456:OTHER', chatId: '-2000', publicBaseUrl: 'https://chat.example' }),
    (err) => err.code === 'TELEGRAM_BRIDGE_EXISTS',
  );
  assert.deepEqual(tg.calls.map((c) => c.method), ['getMe', 'setWebhook', 'getMe', 'setWebhook', 'deleteWebhook'],
    'отклонённый дубликат должен сам отвязать зарегистрированный им вебхук');
});

test('входящее сообщение из Telegram становится сообщением с честной атрибуцией источника, исходящее — доходит до бота', { skip }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const { owner, room } = await company(store);
  const tg = fakeTelegram();
  const telegram = createTelegramBridgeRepository(pool, store, { request: tg.request, env: { VAULT_KEY } });
  const bridge = await telegram.create(owner, { conversationId: room.id, botToken: '123:FAKE', chatId: '-1009', publicBaseUrl: 'https://chat.example' });
  const webhookSecret = tg.calls[1].body.url.split('/').pop();

  await assert.rejects(
    () => telegram.receiveUpdate(webhookSecret, 'wrong-header', { message: { text: 'Здравствуйте' } }),
    (err) => err.code === 'TELEGRAM_BRIDGE_NOT_FOUND' && err.statusCode === 404,
  );

  await telegram.receiveUpdate(webhookSecret, tg.calls[1].body.secret_token, {
    message: { text: 'Когда встреча?', from: { first_name: 'Иван', last_name: 'Партнёров' }, date: Math.floor(Date.now() / 1000) },
  });
  const messages = await store.listMessages(owner, room.id);
  const incoming = messages.find((m) => m.body === 'Когда встреча?');
  assert.ok(incoming, 'входящее сообщение должно появиться в беседе');
  assert.equal(incoming.externalOrigin.source, 'telegram');
  assert.equal(incoming.externalOrigin.authorName, 'Иван Партнёров');

  const outgoing = await store.createMessage(owner, room.id, { kind: 'text', body: 'Завтра в 15:00', clientRequestId: randomUUID() });
  await telegram.deliverOutbound(owner, room.id, outgoing);
  const sent = tg.calls.find((c) => c.method === 'sendMessage');
  assert.ok(sent, 'исходящее сообщение должно быть отправлено в Telegram');
  assert.equal(sent.body.chat_id, '-1009');
  assert.match(sent.body.text, /Завтра в 15:00/);

  // Провал доставки не должен уронить беседу — только осесть в last_error моста.
  const failingTg = fakeTelegram({ failMethod: 'sendMessage' });
  const failingTelegram = createTelegramBridgeRepository(pool, store, { request: failingTg.request, env: { VAULT_KEY } });
  await failingTelegram.deliverOutbound(owner, room.id, outgoing);
  const { rows } = await pool.query('SELECT last_error FROM telegram_bridges WHERE id=$1', [bridge.id]);
  assert.ok(rows[0].last_error, 'ошибка доставки должна быть записана');
});

test('память без базы честно отвечает 503, а не подделывает мост', async () => {
  const telegram = createTelegramBridgeRepository(null, null);
  assert.equal(telegram.enabled, false);
  assert.throws(() => telegram.list({}), (err) => err.code === 'TELEGRAM_UNAVAILABLE' && err.statusCode === 503);
});

test('доступ по HTTP: интеграции требуют governed права, вебхук требует секретный заголовок, а не сессию', { skip }, async (t) => {
  const tg = fakeTelegram();
  const app = await createChatServer({
    databaseUrl, startMeetingWorker: false,
    telegram: createTelegramBridgeRepository(new pg.Pool({ connectionString: databaseUrl }), new PostgresStore(new pg.Pool({ connectionString: databaseUrl })), { request: tg.request, env: { VAULT_KEY } }),
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const request = async (path, { cookie, method = 'GET', body, headers } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(headers ?? {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };

  const suffix = randomUUID().slice(0, 8);
  const owner = await request('/api/v1/auth/register-company', {
    method: 'POST', body: { companyName: `TG HTTP ${suffix}`, ownerName: 'Владелец', email: `tg-http-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  assert.equal(owner.status, 201);

  const invite = await request('/api/v1/invitations', { cookie: owner.cookie, method: 'POST', body: { email: `tg-member-${suffix}@t.test`, role: 'member' } });
  const token = new URL(invite.payload.invitation.inviteUrl).searchParams.get('invite');
  const memberAccept = await request('/api/v1/invitations/accept', { method: 'POST', body: { token, displayName: 'Сотрудник', password: 'MemberPassword42' } });
  const memberDenied = await request('/api/v1/integrations/telegram', { cookie: memberAccept.cookie });
  assert.equal(memberDenied.status, 403, 'обычный сотрудник не управляет интеграциями компании');

  const list = await request('/api/v1/integrations/telegram', { cookie: owner.cookie });
  assert.equal(list.status, 200);
  assert.deepEqual(list.payload.items, []);

  const badWebhook = await request('/api/v1/integrations/telegram/webhook/does-not-exist', {
    method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'whatever' }, body: { message: { text: 'hi' } },
  });
  assert.equal(badWebhook.status, 404, 'вебхук на несуществующий секрет не подтверждает, что мост где-то есть');
});
