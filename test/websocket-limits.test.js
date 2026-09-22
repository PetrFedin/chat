import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

/**
 * Сокет вместе с накопленными пакетами.
 *
 * Слушатель, повешенный после `open`, опаздывает: `session.ready`
 * сервер отправляет сразу, и он успевает прийти раньше. Копим с самого
 * начала — иначе тест ждёт того, что уже случилось.
 */
const open = (url, cookie) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url, { headers: { cookie } });
  const inbox = [];
  socket.on('message', (raw) => { inbox.push(JSON.parse(String(raw))); });
  socket.received = inbox;
  const timer = setTimeout(() => reject(new Error(`сокет не открылся за 5 с: ${url}`)), 5000);
  socket.once('open', () => { clearTimeout(timer); resolve(socket); });
  socket.once('error', (error) => { clearTimeout(timer); reject(error); });
});

const waitFor = async (socket, event, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = socket.received.find((packet) => packet.event === event);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`не дождались пакета ${event}`);
};

/**
 * Сокет открыт для всякого, кто вошёл, и стоит дорого.
 *
 * Пакет «печатает» — это два запроса к базе и рассылка всем в беседе.
 * Без счётчика свой же клиент, забуксовавший на повторной отправке,
 * кладёт базу десятками пакетов в секунду; и принимал сокет кадр
 * размером до ста мегабайт — столько `ws` разрешает по умолчанию.
 */
test('поток служебных пакетов не доходит до базы',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  let queries = 0;
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Сокет ${suffix}`, ownerName: 'Владелец', email: `ws-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];

  // Считаем обращения к базе, которые делает именно обработчик пакетов.
  const original = app.store.canAccessConversation.bind(app.store);
  app.store.canAccessConversation = async (...args) => { queries += 1; return original(...args); };

  const socket = await open(`ws://127.0.0.1:${app.server.address().port}/ws`, owner.cookie);
  t.after(() => socket.close());

  const packet = JSON.stringify({ event: 'typing.start', data: { conversationId: conversation.id } });
  for (let i = 0; i < 200; i += 1) socket.send(packet);
  await new Promise((resolve) => setTimeout(resolve, 400));

  assert.ok(queries > 0, 'обработчик пакетов не сработал ни разу — тест ничего не проверяет');
  assert.ok(queries <= 25, `до базы дошло ${queries} пакетов из двухсот — ограничение не работает`);

  // Соединение при этом живо: поток гасится, а не карается разрывом —
  // иначе забуксовавший клиент терял бы и обычные события.
  assert.equal(socket.readyState, WebSocket.OPEN);

  // А через секунду окно открывается заново, и честный клиент работает.
  await new Promise((resolve) => setTimeout(resolve, 900));
  const before = queries;
  socket.send(packet);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(queries, before + 1, 'после паузы пакеты снова должны проходить');
});

test('кадр больше разумного сокет не принимает',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Кадр ${suffix}`, ownerName: 'Владелец', email: `ws2-${suffix}@t.test`, password: 'OwnerPassword42' },
  });

  const socket = await open(`ws://127.0.0.1:${app.server.address().port}/ws`, owner.cookie);
  // `ws` сообщает о превышении и событием error, и закрытием. Нас
  // интересует второе; без обработчика первое роняет процесс.
  socket.on('error', () => {});
  const closed = new Promise((resolve) => socket.once('close', (code) => resolve(code)));
  socket.send(JSON.stringify({ event: 'typing.start', data: { note: 'x'.repeat(64 * 1024) } }));
  const code = await closed;
  // 1009 — «сообщение слишком велико»: сокет закрывается сам, а не
  // выделяет под кадр столько, сколько попросили.
  assert.equal(code, 1009);
});

/**
 * Испорченный кадр не должен ронять сервер.
 *
 * Ошибка протокола приходит событием `error` на сам сокет. Слушателя не
 * было, и она становилась необработанным исключением всего процесса: один
 * клиент с битым кадром выключал рабочее пространство всей компании.
 */
test('после разрыва одного сокета сервер продолжает работать',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Живучесть ${suffix}`, ownerName: 'Владелец', email: `ws3-${suffix}@t.test`, password: 'OwnerPassword42' },
  });

  const victim = await open(`ws://127.0.0.1:${port}/ws`, owner.cookie);
  victim.on('error', () => {});
  const dead = new Promise((resolve) => victim.once('close', resolve));
  victim.send(JSON.stringify({ event: 'typing.start', data: { note: 'x'.repeat(64 * 1024) } }));
  await dead;

  // Сервер жив и отвечает; и новый сокет открывается как ни в чём не бывало.
  assert.equal((await request(base, '/api/v1/me', { cookie: owner.cookie })).status, 200);
  const next = await open(`ws://${'127.0.0.1'}:${port}/ws`, owner.cookie);
  t.after(() => next.close());
  assert.ok(await waitFor(next, 'session.ready'), 'новый сокет не получил приветствия');
});
