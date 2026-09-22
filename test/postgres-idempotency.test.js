import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createIdempotencyGuard } from '../src/http/idempotency.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

test('idempotency and room ownership', { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const guard = createIdempotencyGuard(pool);

  const sessionFor = async (userId, workspaceId, label) => {
    const tokenHash = hashToken(`idem-${label}-${randomUUID()}`);
    await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
    return store.getSession(tokenHash);
  };
  const company = async () => {
    const pass = hashPassword('IdempotentPass26x');
    const created = await store.createCompany({
      companyName: `Co ${randomUUID().slice(0, 8)}`, ownerName: 'Owner', email: `idem-${randomUUID()}@test.local`,
      passwordHash: pass.hash, passwordSalt: pass.salt,
    });
    const owner = await sessionFor(created.user.id, created.workspace.id, 'owner');
    const join = async (role, name) => {
      const token = randomUUID();
      await store.createInvitation(owner, { email: `${role}-${randomUUID()}@test.local`, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 864e5).toISOString() });
      const p = hashPassword('IdempotentPass26x');
      const a = await store.acceptInvitation({ tokenHash: hashToken(token), displayName: name, passwordHash: p.hash, passwordSalt: p.salt });
      return sessionFor(a.user.id, a.workspace.id, name);
    };
    return { owner, join };
  };

  await t.test('a repeated command replays its first answer instead of doing the work twice', async () => {
    const { owner } = await company();
    const key = `key-${randomUUID()}`;
    const request = { method: 'POST', path: '/api/v1/tasks', rawBody: '{"title":"Once"}' };

    const first = await guard.begin(owner, key, request);
    assert.equal(first.replay, null);
    await first.finish(201, { task: { id: 'the-one' } });

    const second = await guard.begin(owner, key, request);
    assert.deepEqual(second.replay, { status: 201, body: { task: { id: 'the-one' } } });
  });

  await t.test('the same key with a different body is a client bug, not a replay', async () => {
    const { owner } = await company();
    const key = `key-${randomUUID()}`;
    const first = await guard.begin(owner, key, { method: 'POST', path: '/api/v1/tasks', rawBody: '{"title":"A"}' });
    await first.finish(201, { ok: true });
    await assert.rejects(
      () => guard.begin(owner, key, { method: 'POST', path: '/api/v1/tasks', rawBody: '{"title":"B"}' }),
      (e) => e.code === 'IDEMPOTENCY_KEY_REUSED',
    );
  });

  await t.test('a claimed but unfinished key answers in-progress rather than running twice', async () => {
    const { owner } = await company();
    const key = `key-${randomUUID()}`;
    const request = { method: 'POST', path: '/api/v1/tasks', rawBody: '{"title":"Slow"}' };
    await guard.begin(owner, key, request);
    await assert.rejects(() => guard.begin(owner, key, request), (e) => e.code === 'IDEMPOTENCY_IN_PROGRESS');
  });

  await t.test('a server failure releases the key so the caller can retry', async () => {
    const { owner } = await company();
    const key = `key-${randomUUID()}`;
    const request = { method: 'POST', path: '/api/v1/tasks', rawBody: '{"title":"Boom"}' };
    const first = await guard.begin(owner, key, request);
    await first.finish(500, { error: { code: 'STORAGE_ERROR' } });
    // Caching a 5xx would make a transient failure permanent for that key.
    const retry = await guard.begin(owner, key, request);
    assert.equal(retry.replay, null);
  });

  await t.test('one person cannot claim another person\'s key', async () => {
    const { owner, join } = await company();
    const colleague = await join('member', 'Colleague');
    const key = `shared-${randomUUID()}`;
    const request = { method: 'POST', path: '/api/v1/tasks', rawBody: '{"title":"Mine"}' };
    const mine = await guard.begin(owner, key, request);
    await mine.finish(201, { task: { id: 'mine' } });
    const theirs = await guard.begin(colleague, key, request);
    assert.equal(theirs.replay, null, 'the key is scoped to the actor');
  });

  await t.test('a guest cannot be handed a role that runs a room', async () => {
    const { owner, join } = await company();
    const guest = await join('guest', 'Outside client');
    const staff = await join('member', 'Staff');
    const room = await store.createConversation(owner, { kind: 'external', title: 'Client room', visibility: 'private', participantIds: [guest.userId, staff.userId] });

    // A guest owner could remove the workspace owner and lock the room to
    // everybody, with no override anywhere in the product.
    await assert.rejects(() => store.setConversationMemberRole(owner, room.id, guest.userId, 'owner'), (e) => e.code === 'GUEST_CANNOT_OWN_ROOM');
    await assert.rejects(() => store.setConversationMemberRole(owner, room.id, guest.userId, 'moderator'), (e) => e.code === 'GUEST_CANNOT_OWN_ROOM');
    const promoted = await store.setConversationMemberRole(owner, room.id, staff.userId, 'moderator');
    assert.ok(promoted.find((m) => m.userId === staff.userId).role === 'moderator', 'staff are unaffected');
  });

  await t.test('a room whose owners are all gone can be recovered, and only then', async () => {
    const { owner, join } = await company();
    const staff = await join('member', 'Staff');
    const room = await store.createConversation(staff, { kind: 'team', title: 'Orphan', visibility: 'private', participantIds: [] });

    // While an owner remains this is not a backdoor into a private room.
    await assert.rejects(() => store.claimOrphanedConversation(owner, room.id), (e) => e.code === 'CONVERSATION_HAS_OWNER');

    await pool.query("DELETE FROM conversation_members WHERE workspace_id=$1 AND conversation_id=$2 AND role='owner'", [owner.workspaceId, room.id]);
    const claimed = await store.claimOrphanedConversation(owner, room.id);
    assert.equal(claimed.claimed, true);
    assert.equal(await store.canAccessConversation(owner, room.id), true);

    // Taking a private room is exactly the act that belongs on the record.
    const { rowCount } = await pool.query(
      "SELECT 1 FROM audit_events WHERE workspace_id=$1 AND aggregate_id=$2 AND event_type='conversation.ownership_claimed'",
      [owner.workspaceId, room.id],
    );
    assert.equal(rowCount, 1);
  });
});
