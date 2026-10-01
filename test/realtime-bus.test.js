import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { RealtimeHub } from '../src/realtime.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const skip = !DATABASE_URL && 'нет базы';

const fakeSocket = () => {
  const received = [];
  return { readyState: 1, send: (text) => received.push(JSON.parse(text)), received };
};
const until = async (check, ms = 3000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { if (check()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return check();
};

/**
 * Две копии приложения (два хаба) на одной базе: человек подключён к первой, а событие рождается
 * на второй. Без шины до него оно не доходило.
 */
test('событие, рождённое на одной копии, доходит до сокета на другой', { skip }, async (t) => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const first = new RealtimeHub();
  const second = new RealtimeHub();
  t.after(async () => { await first.detachBus(); await second.detachBus(); await pool.end(); });
  await first.attachBus(pool);
  await second.attachBus(pool);

  const workspace = randomUUID();
  const alice = randomUUID();
  const bob = randomUUID();
  const onFirstAlice = fakeSocket();
  const onFirstBob = fakeSocket();
  const onSecondBob = fakeSocket();
  first.add(workspace, alice, onFirstAlice);
  first.add(workspace, bob, onFirstBob);
  second.add(workspace, bob, onSecondBob);

  // Адресное событие: только Алисе, рождено на второй копии.
  second.broadcastUsers(workspace, [alice], 'message.created', { text: 'привет' });
  assert.ok(await until(() => onFirstAlice.received.length === 1), 'Алиса на первой копии получила событие');
  assert.equal(onFirstAlice.received[0].event, 'message.created');
  assert.deepEqual(onFirstAlice.received[0].data, { text: 'привет' });
  assert.equal(onFirstBob.received.length, 0, 'Боб не адресат');
  assert.equal(onSecondBob.received.length, 0, 'Боб не адресат и на своей копии');

  // На пространство: получают все, а своя копия — ровно один раз (эхо от шины подавляется).
  second.broadcastWorkspace(workspace, 'presence.updated', { userId: bob });
  assert.ok(await until(() => onFirstAlice.received.length === 2 && onFirstBob.received.length === 1));
  assert.equal(onSecondBob.received.length, 1, 'на копии-источнике событие не задвоилось');

  // Большое событие (длиннее предела NOTIFY в 8 КБ) тоже проходит: по каналу идёт номер строки.
  const big = 'я'.repeat(20_000);
  first.broadcastUsers(workspace, [bob], 'message.created', { text: big });
  assert.ok(await until(() => onSecondBob.received.length === 2));
  assert.equal(onSecondBob.received[1].data.text.length, 20_000);
});

test('без шины хаб работает как раньше и ничего не пишет в базу', { skip }, async (t) => {
  const hub = new RealtimeHub();
  const socket = fakeSocket();
  const workspace = randomUUID();
  const user = randomUUID();
  hub.add(workspace, user, socket);
  hub.broadcastUsers(workspace, [user], 'x', { n: 1 });
  hub.broadcastWorkspace(workspace, 'y', { n: 2 });
  assert.equal(socket.received.length, 2);
  assert.equal(hub.bus, null);
});
