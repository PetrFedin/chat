import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createWebhookRepository } from '../src/integrations/webhook-repository.js';
import { createDeliveryWorker } from '../src/integrations/delivery-worker.js';
import { verifySignature } from '../src/integrations/webhook-signature.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

async function fixture(pool) {
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  const userId = randomUUID();
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [organizationId, `Org ${organizationId.slice(0, 8)}`]);
  await pool.query('INSERT INTO workspaces(id,organization_id,name) VALUES($1,$2,$3)', [workspaceId, organizationId, 'Workspace']);
  await pool.query('INSERT INTO users(id,email) VALUES($1,$2)', [userId, `${userId}@example.test`]);
  await pool.query('INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES($1,$2,$3,$4)', [organizationId, workspaceId, userId, 'owner']);
  return { session: { organizationId, workspaceId, userId, role: 'owner' } };
}

// Публикация и рассылка по умолчанию обслуживают всю базу, поэтому каждый
// подтест работает со своим пространством и передаёт его работнику: соседние
// тесты в общей базе больше не мешают друг другу и ничего не приходится
// «глушить» всем подряд.

const emit = (pool, session, topic, payload = {}) => pool.query(
  'INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload) VALUES($1,$2,$3,$4,$5) RETURNING id',
  [session.organizationId, session.workspaceId, topic, randomUUID(), payload],
).then((r) => r.rows[0].id);

test('outbound webhook delivery', { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const repository = createWebhookRepository(pool);

  await t.test('an event fans out only to endpoints subscribed to its topic', async () => {
    const { session } = await fixture(pool);
    const meetings = await repository.createEndpoint(session, { label: 'Meetings', url: 'https://example.test/meetings', topics: ['meeting.*'] });
    await repository.createEndpoint(session, { label: 'Tasks only', url: 'https://example.test/tasks', topics: ['task.transitioned'] });

    await emit(pool, session, 'meeting.transcript.ready', { runId: 'r1' });
    const published = await repository.publishPending({ workspaceIds: [session.workspaceId] });
    assert.equal(published.events >= 1, true);

    const deliveries = await repository.listDeliveries(session);
    assert.equal(deliveries.length, 1, 'the tasks-only endpoint must not receive a meeting event');
    assert.equal(deliveries[0].endpointId, meetings.id);
    assert.equal(deliveries[0].topic, 'meeting.transcript.ready');
  });

  await t.test('the secret is returned once at creation and never listed again', async () => {
    const { session } = await fixture(pool);
    const created = await repository.createEndpoint(session, { label: 'Portal', url: 'https://example.test/hook', topics: [] });
    assert.match(created.secret, /^whsec_/);
    const listed = await repository.listEndpoints(session);
    assert.equal(listed.length, 1);
    assert.equal('secret' in listed[0], false, 'a leaked config read must not be able to forge signatures');
  });

  await t.test('publishing twice does not duplicate a delivery', async () => {
    const { session } = await fixture(pool);
    await repository.createEndpoint(session, { label: 'Everything', url: 'https://example.test/all', topics: [] });
    await emit(pool, session, 'task.transitioned', { taskId: 't1' });
    await repository.publishPending({ workspaceIds: [session.workspaceId] });
    await repository.publishPending({ workspaceIds: [session.workspaceId] });
    assert.equal((await repository.listDeliveries(session)).length, 1);
  });

  await t.test('a delivered event carries a signature the receiver can verify', async () => {
    const { session } = await fixture(pool);
    const endpoint = await repository.createEndpoint(session, { label: 'Receiver', url: 'https://example.test/ok', topics: [] });
    const eventId = await emit(pool, session, 'task.transitioned', { taskId: 't2', to: 'in_progress' });
    await repository.publishPending({ workspaceIds: [session.workspaceId] });

    const seen = [];
    const worker = createDeliveryWorker(repository, { WEBHOOK_WORKER_POLL_MS: '10' }, {
      checkTarget: async () => ({ ok: true }),
      workspaceIds: [session.workspaceId],
      send: async (url, init) => { seen.push({ url, init }); return new Response('', { status: 200 }); },
    });
    await worker.tick();

    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'https://example.test/ok');
    const { headers, body } = seen[0].init;
    assert.equal(headers['x-chat-topic'], 'task.transitioned');
    assert.equal(headers['x-chat-event-id'], eventId);
    assert.equal(verifySignature(endpoint.secret, body, headers['x-chat-signature']).valid, true);
    assert.deepEqual(JSON.parse(body).data, { taskId: 't2', to: 'in_progress' });

    const [delivery] = await repository.listDeliveries(session);
    assert.equal(delivery.status, 'delivered');
    assert.equal(delivery.responseStatus, 200);
  });

  await t.test('a 500 is retried later, a 404 dies immediately', async () => {
    const { session } = await fixture(pool);
    const flaky = await repository.createEndpoint(session, { label: 'Flaky', url: 'https://example.test/500', topics: ['a.b'] });
    const gone = await repository.createEndpoint(session, { label: 'Gone', url: 'https://example.test/404', topics: ['a.b'] });
    await emit(pool, session, 'a.b', {});
    await repository.publishPending({ workspaceIds: [session.workspaceId] });

    const worker = createDeliveryWorker(repository, {}, {
      checkTarget: async () => ({ ok: true }),
      workspaceIds: [session.workspaceId],
      send: async (url) => new Response('', { status: url.endsWith('/500') ? 500 : 404 }),
    });
    await worker.tick();

    const byEndpoint = Object.fromEntries((await repository.listDeliveries(session)).map((d) => [d.endpointId, d]));
    assert.equal(byEndpoint[flaky.id].status, 'failed', 'a 500 is the receiver being down, so it is retried');
    assert.ok(new Date(byEndpoint[flaky.id].nextAttemptAt) > new Date(), 'the retry is scheduled into the future');
    assert.equal(byEndpoint[gone.id].status, 'dead', 'a 404 is the receiver saying never again');
  });

  await t.test('a delivery dies once its attempt budget is spent', async () => {
    const { session } = await fixture(pool);
    await repository.createEndpoint(session, { label: 'Down', url: 'https://example.test/down', topics: [] });
    await emit(pool, session, 'c.d', {});
    await repository.publishPending({ workspaceIds: [session.workspaceId] });
    await pool.query("UPDATE webhook_deliveries SET max_attempts=2 WHERE workspace_id=$1", [session.workspaceId]);

    const worker = createDeliveryWorker(repository, {}, { checkTarget: async () => ({ ok: true }), workspaceIds: [session.workspaceId], send: async () => new Response('', { status: 503 }) });
    await worker.tick();
    await pool.query("UPDATE webhook_deliveries SET next_attempt_at=now() WHERE workspace_id=$1", [session.workspaceId]);
    await worker.tick();

    const [delivery] = await repository.listDeliveries(session);
    assert.equal(delivery.attempts, 2);
    assert.equal(delivery.status, 'dead');
  });

  await t.test('a disabled endpoint stops receiving new events', async () => {
    const { session } = await fixture(pool);
    const endpoint = await repository.createEndpoint(session, { label: 'Paused', url: 'https://example.test/paused', topics: [] });
    await repository.setEndpointEnabled(session, endpoint.id, false);
    await emit(pool, session, 'e.f', {});
    await repository.publishPending({ workspaceIds: [session.workspaceId] });
    assert.equal((await repository.listDeliveries(session)).length, 0);
  });

  await t.test('one workspace never receives another workspace events', async () => {
    const a = await fixture(pool);
    const b = await fixture(pool);
    await repository.createEndpoint(a.session, { label: 'A', url: 'https://example.test/a', topics: [] });
    await emit(pool, b.session, 'g.h', { secret: 'belongs to B' });
    await repository.publishPending({ workspaceIds: [a.session.workspaceId, b.session.workspaceId] });
    assert.equal((await repository.listDeliveries(a.session)).length, 0);
  });
});
