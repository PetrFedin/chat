import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.DATABASE_URL;

test('register fixes', { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);

  const sessionFor = async (userId, workspaceId, label) => {
    const tokenHash = hashToken(`reg-${label}-${randomUUID()}`);
    await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
    return store.getSession(tokenHash);
  };
  const company = async () => {
    const pass = hashPassword('RegisterPass2026x');
    const created = await store.createCompany({
      companyName: `Co ${randomUUID().slice(0, 8)}`, ownerName: 'Owner', email: `reg-${randomUUID()}@test.local`,
      passwordHash: pass.hash, passwordSalt: pass.salt,
    });
    const owner = await sessionFor(created.user.id, created.workspace.id, 'owner');
    const join = async (role, name) => {
      const token = randomUUID();
      await store.createInvitation(owner, { email: `${role}-${randomUUID()}@test.local`, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 864e5).toISOString() });
      const p = hashPassword('RegisterPass2026x');
      const a = await store.acceptInvitation({ tokenHash: hashToken(token), displayName: name, passwordHash: p.hash, passwordSalt: p.salt });
      return sessionFor(a.user.id, a.workspace.id, name);
    };
    return { owner, join };
  };

  await t.test('every commitment change leaves the building through the outbox', async () => {
    const { owner, join } = await company();
    const worker = await join('member', 'Worker');
    const task = await store.createTask(owner, { title: 'Outbox subject', ownerId: worker.userId, acceptorId: owner.userId, promisedAt: new Date(Date.now() + 864e5).toISOString() });
    await store.transitionTask(worker, task.id, { to: 'accepted', expectedVersion: task.version });
    await store.rescheduleTask(owner, task.id, { promisedAt: new Date(Date.now() + 2 * 864e5).toISOString(), reason: 'Сдвиг', expectedVersion: task.version + 1 });
    await store.addTaskEvidence(worker, task.id, { type: 'note', value: 'готово', expectedVersion: task.version + 2 });

    const { rows } = await pool.query('SELECT topic FROM outbox_events WHERE workspace_id=$1 AND aggregate_id=$2 ORDER BY created_at', [owner.workspaceId, task.id]);
    // docs/INTEGRATIONS.md advertises task.transitioned and the endpoint
    // accepts a subscription to it; before this it could never fire.
    assert.deepEqual(rows.map((r) => r.topic), ['task.created', 'task.transitioned', 'task.rescheduled', 'task.evidence.added']);

    const { rows: payload } = await pool.query("SELECT payload FROM outbox_events WHERE workspace_id=$1 AND aggregate_id=$2 AND topic='task.transitioned'", [owner.workspaceId, task.id]);
    assert.equal(payload[0].payload.from, 'proposed');
    assert.equal(payload[0].payload.to, 'accepted');
  });

  await t.test('a falsy date is a date, not an instruction to delete the promise', async () => {
    const { owner, join } = await company();
    const worker = await join('member', 'Worker');
    const promised = new Date(Date.now() + 864e5).toISOString();
    const task = await store.createTask(owner, { title: 'Dated', ownerId: worker.userId, acceptorId: owner.userId, promisedAt: promised });
    // Only undefined leaves it and only null clears it; 0 used to destroy the
    // commitment date behind a 200.
    const zeroed = await store.rescheduleTask(owner, task.id, { promisedAt: new Date(0).toISOString(), reason: 'epoch', expectedVersion: task.version });
    assert.equal(new Date(zeroed.promisedAt).getTime(), 0);
    const cleared = await store.rescheduleTask(owner, task.id, { promisedAt: null, reason: 'снимаем', expectedVersion: zeroed.version });
    assert.equal(cleared.promisedAt, null);
  });

  await t.test('a guest is outside the accountability chain entirely', async () => {
    const { owner, join } = await company();
    const guest = await join('guest', 'Outside client');
    const task = await store.createTask(owner, { title: 'Internal work', ownerId: owner.userId, acceptorId: owner.userId });
    // A guest could be made the accountable owner of a commitment and then
    // execute its transitions.
    assert.equal(await store.getTask(guest, task.id), null);
    assert.deepEqual(await store.listTasks(guest), []);
    await assert.rejects(() => store.transitionTask(guest, task.id, { to: 'accepted', expectedVersion: 1 }), (e) => e.code === 'TASK_NOT_FOUND');
  });

  await t.test('a commitment always has an exit, even if the acceptor leaves', async () => {
    const { owner, join } = await company();
    const worker = await join('member', 'Worker');
    const acceptor = await join('member', 'Acceptor');
    const task = await store.createTask(owner, { title: 'Stuck', ownerId: worker.userId, acceptorId: acceptor.userId });
    let v = task.version;
    for (const to of ['accepted', 'in_progress']) { v = (await store.transitionTask(worker, task.id, { to, expectedVersion: v })).version; }
    v = (await store.addTaskEvidence(worker, task.id, { type: 'note', value: 'done', expectedVersion: v })).task.version;
    v = (await store.transitionTask(worker, task.id, { to: 'in_review', expectedVersion: v })).version;

    // The acceptor is the only reviewer, as designed — but before this the
    // commitment froze for everybody if they were gone.
    const cancelled = await store.transitionTask(owner, task.id, { to: 'cancelled', reason: 'Приёмщик уволился', expectedVersion: v });
    assert.equal(cancelled.status, 'cancelled');
  });

  await t.test('a retried send replays the message instead of failing', async () => {
    const { owner, join } = await company();
    const colleague = await join('member', 'Colleague');
    const room = await store.createConversation(owner, { kind: 'team', title: 'Retries', visibility: 'private', participantIds: [colleague.userId] });
    const key = `retry-${randomUUID()}`;

    const first = await store.createMessage(owner, room.id, { kind: 'text', body: 'Once', clientRequestId: key });
    const again = await store.createMessage(owner, room.id, { kind: 'text', body: 'Once', clientRequestId: key });
    assert.equal(again.id, first.id, 'a retry after a timeout must replay, not 409');

    // The key used to be unique per workspace, so one person's string blocked
    // another person's send in another room.
    const theirs = await store.createMessage(colleague, room.id, { kind: 'text', body: 'Mine', clientRequestId: key });
    assert.notEqual(theirs.id, first.id);
  });

  await t.test('history past the first page is reachable', async () => {
    const { owner } = await company();
    const room = await store.createConversation(owner, { kind: 'team', title: 'Long', visibility: 'private', participantIds: [] });
    for (let i = 0; i < 12; i += 1) {
      await store.createMessage(owner, room.id, { kind: 'text', body: `message ${i}`, clientRequestId: randomUUID() });
    }
    const page1 = await store.listMessages(owner, room.id, 5);
    assert.equal(page1.length, 5);
    const oldest = page1[0];
    const page2 = await store.listMessages(owner, room.id, 5, { at: oldest.createdAt, id: oldest.id });
    assert.equal(page2.length, 5);
    const seen = new Set(page1.map((m) => m.id));
    assert.ok(page2.every((m) => !seen.has(m.id)), 'pages must not overlap');
    assert.ok(new Date(page2.at(-1).createdAt) <= new Date(oldest.createdAt), 'and the second page is older');
  });
});
