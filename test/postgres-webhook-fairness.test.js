import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createWebhookRepository } from '../src/integrations/webhook-repository.js';
import { createDeliveryWorker } from '../src/integrations/delivery-worker.js';

const databaseUrl = process.env.DATABASE_URL;

const quiesce = async (pool) => {
  await pool.query("UPDATE webhook_deliveries SET status='delivered', delivered_at=now() WHERE status <> 'delivered'");
  await pool.query('UPDATE outbox_events SET published_at=now() WHERE published_at IS NULL');
};

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
  await quiesce(pool);
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
    send: async (url) => {
      if (url.includes('slow.')) await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      else fastDeliveredAfter ??= Date.now() - started;
      return new Response('', { status: 200 });
    },
    workspaceIds: [session.workspaceId],
  });
  worker.start();
  t.after(() => worker.stop());

  const deadline = Date.now() + 5000;
  while (fastDeliveredAfter === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.notEqual(fastDeliveredAfter, null, 'быстрая доставка вообще не дождалась очереди');
  assert.ok(
    fastDeliveredAfter < SLOW_MS * 2,
    `быстрая доставка ждала ${fastDeliveredAfter} мс — дольше, чем нужно медленному приёмнику (${SLOW_MS} мс)`,
  );

  // Медленные при этом не брошены: они доходят, просто в своём темпе.
  const slowDeadline = Date.now() + 8000;
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
