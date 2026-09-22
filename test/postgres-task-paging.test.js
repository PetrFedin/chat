import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { hashPassword, hashToken } from '../src/security.js';

const url = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const password = hashPassword('WorkspacePass42');

const run = (name, fn) => test(name, { skip: url ? false : 'DATABASE_URL is not set' }, fn);

async function fixture(pool) {
  const store = new PostgresStore(pool);
  const suffix = Math.random().toString(36).slice(2, 8);
  const created = await store.createCompany({
    companyName: `Paging ${suffix}`, ownerName: 'Owner', email: `owner-${suffix}@paging.test`,
    passwordHash: password.hash, passwordSalt: password.salt,
  });
  const tokenHash = hashToken(`paging-${suffix}`);
  await store.createSession({
    userId: created.user.id, workspaceId: created.workspace.id, tokenHash,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  return { store, owner: await store.getSession(tokenHash) };
}

// The SQL keyset has to cross the NULLS LAST boundary: dated tasks come first
// in ascending order, then every undated one. A page that resumes at that
// boundary is the case a hand-written predicate gets wrong.
run('the Postgres task page walks every task exactly once across the NULL boundary', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  try {
    const { store, owner } = await fixture(pool);
    const ids = [];
    for (let i = 0; i < 9; i += 1) {
      const task = await store.createTask(owner, {
        title: `Задача ${i}`,
        ownerId: owner.userId, requesterId: owner.userId, acceptorId: owner.userId,
        promisedAt: i % 3 === 0 ? null : new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      });
      ids.push(task.id);
    }

    const whole = await store.listTasksPage(owner, { limit: 200 });
    assert.equal(whole.items.length, ids.length);
    assert.equal(whole.nextCursor, null, 'полная страница вернула курсор');

    for (const size of [1, 2, 4]) {
      const seen = [];
      let cursor = null;
      let pages = 0;
      do {
        const page = await store.listTasksPage(owner, { limit: size, cursor });
        assert.ok(page.items.length <= size, `страница больше лимита ${size}`);
        seen.push(...page.items.map((t) => t.id));
        cursor = page.nextCursor;
        assert.ok((pages += 1) < 30, 'курсор не сходится');
      } while (cursor);
      assert.deepEqual(seen, whole.items.map((t) => t.id), `шаг ${size}: порядок или состав разошлись`);
    }
  } finally {
    await pool.end();
  }
});

// The page pushes the visibility rule into SQL so LIMIT counts rows the caller
// can see. A member who owns nothing must get an empty page, not a short one.
run('the Postgres task page applies visibility in SQL', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  try {
    const { store, owner } = await fixture(pool);
    const suffix = Math.random().toString(36).slice(2, 8);
    const inviteHash = hashToken(`invite-${suffix}`);
    await store.createInvitation(owner, {
      email: `member-${suffix}@paging.test`, role: 'member', tokenHash: inviteHash,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const accepted = await store.acceptInvitation({
      tokenHash: inviteHash, displayName: 'Member',
      passwordHash: password.hash, passwordSalt: password.salt,
    });
    const memberToken = hashToken(`member-session-${suffix}`);
    await store.createSession({
      userId: accepted.user.id, workspaceId: owner.workspaceId, tokenHash: memberToken,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const member = await store.getSession(memberToken);

    for (let i = 0; i < 5; i += 1) {
      await store.createTask(owner, {
        title: `Чужая задача ${i}`,
        ownerId: owner.userId, requesterId: owner.userId, acceptorId: owner.userId,
        promisedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      });
    }

    const theirs = await store.listTasksPage(member, { limit: 50 });
    assert.deepEqual(theirs.items, [], 'участник увидел чужие задачи');
    assert.equal(theirs.nextCursor, null);

    const own = await store.createTask(owner, {
      title: 'Своя задача', ownerId: member.userId,
      requesterId: owner.userId, acceptorId: owner.userId, promisedAt: null,
    });
    const now = await store.listTasksPage(member, { limit: 50 });
    assert.deepEqual(now.items.map((t) => t.id), [own.id]);
  } finally {
    await pool.end();
  }
});
