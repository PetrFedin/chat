import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createWebhookRepository } from '../src/integrations/webhook-repository.js';
import { createDeliveryWorker } from '../src/integrations/delivery-worker.js';

const databaseUrl = process.env.DATABASE_URL;

async function fixture(pool) {
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  const userId = randomUUID();
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [organizationId, `Org ${organizationId.slice(0, 8)}`]);
  await pool.query('INSERT INTO workspaces(id,organization_id,name) VALUES($1,$2,$3)', [workspaceId, organizationId, 'Workspace']);
  await pool.query('INSERT INTO users(id,email) VALUES($1,$2)', [userId, `${userId}@example.test`]);
  await pool.query('INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES($1,$2,$3,$4)', [organizationId, workspaceId, userId, 'owner']);
  return { organizationId, workspaceId, userId, role: 'owner' };
}

const emit = (pool, session, topic) => pool.query(
  'INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload) VALUES($1,$2,$3,$4,$5)',
  [session.organizationId, session.workspaceId, topic, randomUUID(), {}],
);

const SLOW_MS = 400;

// Очередь на то и очередь, чтобы чужая медлительность не становилась нашей.
// Один заказчик поставил приёмник, который отвечает полсекунды, — и вся
// компания ждала его: доставки уходят пачками, а следующая пачка не
// начинается, пока не закончится предыдущая.
test('медленный приёмник не задерживает чужие доставки',
  { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const repository = createWebhookRepository(pool);
  const session = await fixture(pool);

  const slow = await repository.createEndpoint(session, { label: 'Медленный', url: 'https://slow.example.test/hook', topics: ['task.transitioned'] });
  const fast = await repository.createEndpoint(session, { label: 'Быстрый', url: 'https://fast.example.test/hook', topics: ['meeting.transcript.ready'] });

  // Восемь событий копятся у медленного — заведомо больше одной пачки.
  for (let i = 0; i < 8; i += 1) await emit(pool, session, 'task.transitioned');
  await repository.publishPending({ workspaceIds: [session.workspaceId] });
  // И только потом приходит событие быстрого: в общей очереди он последний.
  await emit(pool, session, 'meeting.transcript.ready');
  await repository.publishPending({ workspaceIds: [session.workspaceId] });

  const started = Date.now();
  let fastDeliveredAfter = null;
  const worker = createDeliveryWorker(repository, { WEBHOOK_WORKER_POLL_MS: '10', WEBHOOK_WORKER_BATCH: '4' }, {
    checkTarget: async () => ({ ok: true }),
    send: async (url) => {
      if (url.includes('slow.')) await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      else fastDeliveredAfter ??= Date.now() - started;
      return new Response('', { status: 200 });
    },
    workspaceIds: [session.workspaceId],
  });
  worker.start();
  t.after(() => worker.stop());

  const deadline = Date.now() + 15_000;
  while (fastDeliveredAfter === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.notEqual(fastDeliveredAfter, null, 'быстрая доставка вообще не дождалась очереди');
  assert.ok(
    fastDeliveredAfter < SLOW_MS * 2,
    `быстрая доставка ждала ${fastDeliveredAfter} мс — дольше, чем нужно медленному приёмнику (${SLOW_MS} мс)`,
  );

  // Медленные при этом не брошены: они доходят, просто в своём темпе.
  const slowDeadline = Date.now() + 25_000;
  let outstanding = 8;
  while (outstanding > 0 && Date.now() < slowDeadline) {
    outstanding = Number((await pool.query(
      "SELECT count(*) n FROM webhook_deliveries WHERE endpoint_id=$1 AND status <> 'delivered'", [slow.id])).rows[0].n);
    if (outstanding > 0) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(outstanding, 0, 'медленные доставки должны дойти все');
  assert.equal(Number((await pool.query(
    "SELECT count(*) n FROM webhook_deliveries WHERE endpoint_id=$1 AND status='delivered'", [fast.id])).rows[0].n), 1);
});

// Приёмник, которого больше нет, годами копил неудачные доставки: счётчик
// рос, а очередь продолжала стучаться в закрытую дверь.
test('приёмник, не отвечающий раз за разом, отключается сам',
  { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const repository = createWebhookRepository(pool, { env: { WEBHOOK_ENDPOINT_FAILURE_LIMIT: '3' } });
  const session = await fixture(pool);
  const endpoint = await repository.createEndpoint(session, { label: 'Мёртвый', url: 'https://dead.example.test/hook', topics: [] });

  for (let i = 0; i < 5; i += 1) await emit(pool, session, 'task.transitioned');
  await repository.publishPending({ workspaceIds: [session.workspaceId] });

  const worker = createDeliveryWorker(repository, { WEBHOOK_WORKER_BATCH: '1' }, {
    checkTarget: async () => ({ ok: true }),
    workspaceIds: [session.workspaceId],
    send: async () => new Response('', { status: 503 }),
  });
  for (let i = 0; i < 4; i += 1) await worker.tick();

  const [listed] = await repository.listEndpoints(session);
  assert.equal(listed.enabled, false, 'после череды неудач подписка отключается');
  assert.match(listed.lastFailureReason, /503/);
  const waiting = Number((await pool.query(
    "SELECT count(*) n FROM webhook_deliveries WHERE endpoint_id=$1 AND status IN ('pending','failed')", [endpoint.id])).rows[0].n);
  assert.equal(waiting, 0, 'и её доставки перестают занимать очередь');

  // Владелец включает обратно — счётчик начинается заново.
  const back = await repository.setEndpointEnabled(session, endpoint.id, true);
  assert.equal(back.enabled, true);
  assert.equal(back.consecutiveFailures, 0);
});

// Адрес принимали один раз, а ходим по нему годами: имя могло начать
// указывать внутрь нашей же сети.
test('адрес проверяется не только при заведении, но и перед каждой отправкой',
  { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const repository = createWebhookRepository(pool);
  const session = await fixture(pool);
  await repository.createEndpoint(session, { label: 'Подменённый', url: 'https://rebind.example.test/hook', topics: [] });
  await emit(pool, session, 'task.transitioned');
  await repository.publishPending({ workspaceIds: [session.workspaceId] });

  let sent = 0;
  const worker = createDeliveryWorker(repository, {}, {
    workspaceIds: [session.workspaceId],
    // Имя разрешилось в петлю — ровно то, ради чего проверка и делается.
    checkTarget: async () => ({ ok: false, reason: 'Имя в адресе указывает во внутреннюю сеть' }),
    send: async () => { sent += 1; return new Response('', { status: 200 }); },
  });
  await worker.tick();

  assert.equal(sent, 0, 'запрос во внутреннюю сеть не уходит');
  const delivery = (await repository.listDeliveries(session))[0];
  assert.equal(delivery.status, 'dead', 'и повторять такую доставку незачем');
  assert.match(delivery.error, /внутреннюю сеть/);
});
