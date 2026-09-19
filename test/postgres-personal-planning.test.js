import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createLabelRepository } from '../src/labels/label-repository.js';
import { createPersonalRepository } from '../src/personal/personal-repository.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.DATABASE_URL;
const soon = (h) => new Date(Date.now() + h * 36e5).toISOString();

test('personal planning', { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const labels = createLabelRepository(pool, store);
  const personal = createPersonalRepository(pool, store, labels);

  const sessionFor = async (userId, workspaceId, label) => {
    const tokenHash = hashToken(`pers-${label}-${randomUUID()}`);
    await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
    return store.getSession(tokenHash);
  };

  const company = async () => {
    const pass = hashPassword('PersonalPass2026x');
    const created = await store.createCompany({
      companyName: `Co ${randomUUID().slice(0, 8)}`, ownerName: 'Owner', email: `per-${randomUUID()}@test.local`,
      passwordHash: pass.hash, passwordSalt: pass.salt,
    });
    const owner = await sessionFor(created.user.id, created.workspace.id, 'owner');
    const join = async (name) => {
      const token = randomUUID();
      await store.createInvitation(owner, { email: `m-${randomUUID()}@test.local`, role: 'member', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 864e5).toISOString() });
      const p = hashPassword('PersonalPass2026x');
      const a = await store.acceptInvitation({ tokenHash: hashToken(token), displayName: name, passwordHash: p.hash, passwordSalt: p.salt });
      return sessionFor(a.user.id, a.workspace.id, name);
    };
    return { owner, join };
  };

  await t.test('notes, to-dos and screenshots share one list', async () => {
    const { owner } = await company();
    for (const kind of ['todo', 'note', 'screenshot', 'link']) {
      await personal.create(owner, { kind, title: `A ${kind}` });
    }
    await assert.rejects(() => personal.create(owner, { kind: 'invoice', title: 'x' }), (e) => e.code === 'INVALID_ITEM_KIND');
    await assert.rejects(() => personal.create(owner, { title: '   ' }), (e) => e.code === 'INVALID_ITEM_TITLE');
    assert.equal((await personal.list(owner, { status: 'all' })).length, 4);
    assert.equal((await personal.list(owner, { status: 'all', kind: 'note' })).length, 1);
  });

  await t.test('done records when, and reopening takes it back', async () => {
    const { owner } = await company();
    const item = await personal.create(owner, { title: 'Забрать согласование' });
    assert.equal(item.completedAt, null);

    const done = await personal.update(owner, item.id, { status: 'done' });
    assert.equal(done.status, 'done');
    assert.ok(done.completedAt, 'the schema refuses done without a completion time');

    const reopened = await personal.update(owner, item.id, { status: 'open' });
    assert.equal(reopened.completedAt, null, 'reopening must not leave a stale completion time');

    const dropped = await personal.update(owner, item.id, { status: 'dropped' });
    assert.equal(dropped.completedAt, null, 'abandoned is not finished');
    await assert.rejects(() => personal.update(owner, item.id, { status: 'someday' }), (e) => e.code === 'INVALID_STATUS');
  });

  await t.test('a planned window must be a window', async () => {
    const { owner } = await company();
    await assert.rejects(() => personal.create(owner, { title: 'x', plannedEnd: soon(2) }), (e) => e.code === 'INVALID_TIME_RANGE');
    await assert.rejects(() => personal.create(owner, { title: 'x', plannedStart: soon(3), plannedEnd: soon(1) }), (e) => e.code === 'INVALID_TIME_RANGE');
    const item = await personal.create(owner, { title: 'Read the standard', plannedStart: soon(1), plannedEnd: soon(3) });
    await assert.rejects(() => personal.update(owner, item.id, { plannedEnd: soon(0.5) }), (e) => e.code === 'INVALID_TIME_RANGE');
  });

  await t.test('importance comes from labels, it is not a second priority field', async () => {
    const { owner } = await company();
    const item = await personal.create(owner, { title: 'Prioritised' });
    const critical = await labels.createLabel(owner, { kind: 'priority', name: 'Критично', colour: 'red' });
    const minor = await labels.createLabel(owner, { kind: 'priority', name: 'Потом', colour: 'grey' });
    await labels.apply(owner, critical.id, 'note', item.id);

    const withLabel = await personal.get(owner, item.id);
    assert.equal(withLabel.labels.length, 1);
    assert.equal(withLabel.labels[0].name, 'Критично');
    assert.equal(withLabel.priority, undefined, 'there is no separate priority column to drift from the label');

    await labels.apply(owner, minor.id, 'note', item.id);
    const after = await personal.get(owner, item.id);
    assert.equal(after.labels.filter((l) => l.kind === 'priority').length, 1, 'importance stays exclusive here too');
  });

  await t.test('comments make a running log of one item', async () => {
    const { owner } = await company();
    const item = await personal.create(owner, { kind: 'note', title: 'Вопросы к смете' });
    await personal.comment(owner, item.id, 'Витражи считает подрядчик');
    await personal.comment(owner, item.id, 'Узлы примыкания на мне');
    await assert.rejects(() => personal.comment(owner, item.id, '   '), (e) => e.code === 'INVALID_COMMENT');

    const full = await personal.get(owner, item.id);
    assert.equal(full.comments.length, 2);
    assert.equal(full.comments[0].body, 'Витражи считает подрядчик', 'oldest first, so it reads as a log');
    assert.equal((await personal.list(owner))[0].commentCount, 2);
  });

  await t.test('scheduling puts the item in the calendar without surrendering it', async () => {
    const { owner } = await company();
    const item = await personal.create(owner, { title: 'Разобрать замечания' });
    await assert.rejects(() => personal.schedule(owner, item.id, { startAt: soon(3), endAt: soon(1) }), (e) => e.code === 'INVALID_TIME_RANGE');

    const scheduled = await personal.schedule(owner, item.id, { startAt: soon(1), endAt: soon(3) });
    assert.ok(scheduled.calendarEventId);
    assert.ok(scheduled.plannedStart && scheduled.plannedEnd, 'the window follows the block');

    const events = await store.listCalendar(owner);
    const block = events.find((e) => e.id === scheduled.calendarEventId);
    assert.equal(block.kind, 'focus');
    assert.equal(block.title, 'Разобрать замечания');

    // The link is one-way on purpose: freeing the time must not delete the plan.
    await pool.query('DELETE FROM calendar_events WHERE workspace_id=$1 AND id=$2', [owner.workspaceId, scheduled.calendarEventId]);
    const survived = await personal.get(owner, item.id);
    assert.equal(survived.calendarEventId, null);
    assert.equal(survived.status, 'open');
  });

  await t.test('personal means personal, even with the id in hand', async () => {
    const { owner, join } = await company();
    const colleague = await join('Colleague');
    const item = await personal.create(owner, { title: 'Личное дело' });

    await assert.rejects(() => personal.get(colleague, item.id), (e) => e.code === 'PERSONAL_ITEM_NOT_FOUND');
    await assert.rejects(() => personal.update(colleague, item.id, { status: 'done' }), (e) => e.code === 'PERSONAL_ITEM_NOT_FOUND');
    await assert.rejects(() => personal.remove(colleague, item.id), (e) => e.code === 'PERSONAL_ITEM_NOT_FOUND');
    await assert.rejects(() => personal.comment(colleague, item.id, 'hi'), (e) => e.code === 'PERSONAL_ITEM_NOT_FOUND');
    assert.deepEqual(await personal.list(colleague, { status: 'all' }), []);
  });
});
