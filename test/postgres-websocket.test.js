import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
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

/** Открывает сокет и собирает всё, что по нему приходит. */
function listen(url, cookie) {
  const socket = new WebSocket(url, { headers: cookie ? { cookie } : {} });
  const events = [];
  socket.on('message', (raw) => { try { events.push(JSON.parse(String(raw))); } catch { /* не наше */ } });
  const opened = new Promise((resolve, reject) => {
    socket.once('open', () => resolve(true));
    socket.once('error', reject);
    socket.once('unexpected-response', (_req, res) => reject(Object.assign(new Error('отказ'), { status: res.statusCode })));
  });
  const waitFor = async (type, ms = 3000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const found = events.find((event) => event.event === type || event.type === type);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  };
  return { socket, events, opened, waitFor, close: () => socket.close() };
}

/**
 * Живой слой приложения, за которым не наблюдал ни один тест.
 *
 * Без сокета чат перестаёт быть чатом: сообщения появляются только после
 * перезагрузки страницы. А худшее, что здесь может сломаться, — проверка
 * рабочего пространства при рассылке: тогда сообщения одной компании
 * полетят в открытые вкладки другой.
 */
test('живой канал: свои получают, чужие — нет',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const ws = `ws://127.0.0.1:${port}/ws`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Сокет ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mate-${suffix}@t.test`, role: 'member' } });
  const inviteToken = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const mate = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token: inviteToken, displayName: 'Коллега', password: 'OwnerPassword42' } });
  // Соседняя компания на том же сервере.
  const stranger = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Соседи ${suffix}`, ownerName: 'Сосед', email: `nb-${suffix}@t.test`, password: 'OwnerPassword42' },
  });

  // Без cookie апгрейд не проходит.
  await assert.rejects(listen(ws, null).opened, (error) => error.status === 401 || /401|отказ/.test(String(error.message)));

  const theirs = listen(ws, stranger.cookie);
  const mine = listen(ws, mate.cookie);
  await Promise.all([theirs.opened, mine.opened]);
  t.after(() => { theirs.close(); mine.close(); });

  assert.ok(await mine.waitFor('session.ready'), 'сокет не поздоровался');

  // Сообщение в общий канал долетает по живому каналу.
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations
    .find((c) => c.kind === 'channel');
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: `Живое сообщение ${suffix}` } });

  const delivered = await mine.waitFor('message.created');
  assert.ok(delivered, 'сообщение не пришло в открытую вкладку коллеги');
  assert.equal(delivered.data?.message?.body ?? delivered.message?.body, `Живое сообщение ${suffix}`);

  // И не пришло соседней компании — ни одним событием.
  const leaked = theirs.events.filter((event) => JSON.stringify(event).includes(suffix)
    && !JSON.stringify(event).includes('session.ready'));
  assert.deepEqual(leaked, [], 'события утекли в соседнюю компанию');
});

test('«печатает…» доходит до собеседника и только по доступной беседе',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const ws = `ws://127.0.0.1:${port}/ws`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Печатает ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mate-${suffix}@t.test`, role: 'member' } });
  const inviteToken = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const mate = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token: inviteToken, displayName: 'Коллега', password: 'OwnerPassword42' } });
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations
    .find((c) => c.kind === 'channel');

  const mineSocket = listen(ws, mate.cookie);
  const ownerSocket = listen(ws, owner.cookie);
  await Promise.all([mineSocket.opened, ownerSocket.opened]);
  t.after(() => { mineSocket.close(); ownerSocket.close(); });
  await mineSocket.waitFor('session.ready');

  // Без паузы: пакет, отправленный сразу после подключения, не должен
  // пропадать, пока сервер ходит в базу за присутствием.
  await ownerSocket.waitFor('session.ready');
  ownerSocket.socket.send(JSON.stringify({ event: 'typing.start', data: { conversationId: conversation.id } }));
  const typed = await mineSocket.waitFor('typing.start');
  assert.ok(typed, `«печатает…» не дошло из «${conversation.title}» (${conversation.id}); пришло: ${JSON.stringify(mineSocket.events.map((e) => e.event ?? e.type))}`);

  // Беседа, к которой отправитель не имеет доступа, ничего не рассылает:
  // иначе по идентификатору можно было бы прощупывать чужие комнаты.
  const outsider = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Чужие ${suffix}`, ownerName: 'Чужой', email: `out-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const outsiderSocket = listen(ws, outsider.cookie);
  await outsiderSocket.opened;
  t.after(() => outsiderSocket.close());
  const before = mineSocket.events.length;
  outsiderSocket.socket.send(JSON.stringify({ event: 'typing.start', data: { conversationId: conversation.id } }));
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(mineSocket.events.length, before, 'чужой сумел разослать «печатает…» в закрытую для него беседу');
});
