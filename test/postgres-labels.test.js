import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createLabelRepository } from '../src/labels/label-repository.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.DATABASE_URL;

test('labels', { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const labels = createLabelRepository(pool, store);

  const sessionFor = async (userId, workspaceId, label) => {
    const tokenHash = hashToken(`lbl-${label}-${randomUUID()}`);
    await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
    return store.getSession(tokenHash);
  };

  const company = async () => {
    const pass = hashPassword('LabelPass2026xxx');
    const created = await store.createCompany({
      companyName: `Co ${randomUUID().slice(0, 8)}`, ownerName: 'Owner', email: `lbl-${randomUUID()}@test.local`,
      passwordHash: pass.hash, passwordSalt: pass.salt,
    });
    const owner = await sessionFor(created.user.id, created.workspace.id, 'owner');
    const join = async (role, name) => {
      const token = randomUUID();
      await store.createInvitation(owner, { email: `${role}-${randomUUID()}@test.local`, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 864e5).toISOString() });
      const p = hashPassword('LabelPass2026xxx');
      const a = await store.acceptInvitation({ tokenHash: hashToken(token), displayName: name, passwordHash: p.hash, passwordSalt: p.salt });
      return sessionFor(a.user.id, a.workspace.id, name);
    };
    const room = await store.createConversation(owner, { kind: 'team', title: 'Room', visibility: 'private', participantIds: [] });
    const message = await store.createMessage(owner, room.id, { kind: 'text', body: 'Subject of the label', clientRequestId: randomUUID() });
    const task = await store.createTask(owner, { title: 'Labelled task', ownerId: owner.userId, acceptorId: owner.userId });
    return { owner, join, room, message, task };
  };

  await t.test('importance is exclusive while tags and folders accumulate', async () => {
    const { owner, message } = await company();
    const critical = await labels.createLabel(owner, { kind: 'priority', name: 'Критично', colour: 'red' });
    const minor = await labels.createLabel(owner, { kind: 'priority', name: 'Второстепенное', colour: 'grey' });
    const estimate = await labels.createLabel(owner, { kind: 'tag', name: 'смета' });
    const folder = await labels.createLabel(owner, { kind: 'folder', name: 'Проект' });

    await labels.apply(owner, critical.id, 'message', message.id);
    await labels.apply(owner, estimate.id, 'message', message.id);
    await labels.apply(owner, folder.id, 'message', message.id);
    await labels.apply(owner, minor.id, 'message', message.id);

    const on = await labels.labelsOf(owner, 'message', message.id);
    const priorities = on.filter((l) => l.kind === 'priority');
    assert.equal(priorities.length, 1, 'a thing cannot be both critical and minor');
    assert.equal(priorities[0].name, 'Второстепенное', 'the latest importance wins');
    assert.equal(on.filter((l) => l.kind === 'tag').length, 1, 'the tag survived the importance change');
    assert.equal(on.filter((l) => l.kind === 'folder').length, 1);
    assert.equal(on[0].kind, 'priority', 'importance sorts first, which is the order the chips render in');
  });

  await t.test('one mechanism covers every kind of object', async () => {
    const { owner, room, message, task } = await company();
    const tag = await labels.createLabel(owner, { kind: 'tag', name: 'ремстрой' });
    for (const [type, id] of [['message', message.id], ['conversation', room.id], ['task', task.id]]) {
      await labels.apply(owner, tag.id, type, id);
    }
    const targets = await labels.targetsOf(owner, tag.id);
    assert.deepEqual(targets.map((x) => x.targetType).sort(), ['conversation', 'message', 'task']);
    assert.ok(targets.every((x) => x.title), 'each target carries a readable title for the list');
  });

  await t.test('a personal label belongs to one person and hides from everyone else', async () => {
    const { owner, join, message } = await company();
    const colleague = await join('member', 'Colleague');
    const mine = await labels.createLabel(owner, { kind: 'folder', name: 'Личное', personal: true });
    const theirs = await labels.createLabel(colleague, { kind: 'folder', name: 'Личное', personal: true });
    assert.notEqual(mine.id, theirs.id, 'the same personal name is free for each person');

    const seen = (await labels.listLabels(colleague)).map((l) => l.id);
    assert.ok(seen.includes(theirs.id));
    assert.ok(!seen.includes(mine.id), 'a personal folder is not workspace vocabulary');
    // Not merely hidden from the list: unreachable even by id.
    await assert.rejects(() => labels.apply(colleague, mine.id, 'message', message.id), (e) => e.code === 'LABEL_NOT_FOUND');
    await assert.rejects(() => labels.targetsOf(colleague, mine.id), (e) => e.code === 'LABEL_NOT_FOUND');
  });

  await t.test('a label never widens access to the thing it marks', async () => {
    const { owner, join } = await company();
    const outsider = await join('member', 'Outsider');
    const shared = await labels.createLabel(owner, { kind: 'tag', name: 'общий' });
    const closed = await store.createConversation(owner, { kind: 'team', title: 'Closed', visibility: 'private', participantIds: [] });
    const secret = await store.createMessage(owner, closed.id, { kind: 'text', body: 'Not for outsiders', clientRequestId: randomUUID() });
    await labels.apply(owner, shared.id, 'message', secret.id);

    await assert.rejects(() => labels.apply(outsider, shared.id, 'message', secret.id), (e) => e.code === 'TARGET_NOT_FOUND');
    const visible = await labels.targetsOf(outsider, shared.id);
    assert.deepEqual(visible, [], 'a shared label does not surface a message the viewer cannot read');
    assert.equal((await labels.targetsOf(owner, shared.id)).length, 1, 'while the owner still sees it');
  });

  await t.test('names, nesting and unknown kinds are constrained', async () => {
    const { owner } = await company();
    const folder = await labels.createLabel(owner, { kind: 'folder', name: 'Каталог' });
    await assert.rejects(() => labels.createLabel(owner, { kind: 'colour', name: 'x' }), (e) => e.code === 'INVALID_LABEL_KIND');
    await assert.rejects(() => labels.createLabel(owner, { kind: 'tag', name: '  ' }), (e) => e.code === 'INVALID_LABEL_NAME');
    await assert.rejects(() => labels.createLabel(owner, { kind: 'tag', name: 'вложенный', parentId: folder.id }), (e) => e.code === 'LABEL_NESTING_NOT_ALLOWED');
    await labels.createLabel(owner, { kind: 'tag', name: 'Смета' });
    // Shared vocabulary is case-insensitively unique, or the same tag exists twice.
    await assert.rejects(() => labels.createLabel(owner, { kind: 'tag', name: 'смета' }), (e) => String(e.code) === '23505' || e.statusCode === 409);
  });

  await t.test('deleting a label takes its marks with it', async () => {
    const { owner, message } = await company();
    const tag = await labels.createLabel(owner, { kind: 'tag', name: 'временный' });
    await labels.apply(owner, tag.id, 'message', message.id);
    assert.equal((await labels.labelsOf(owner, 'message', message.id)).length, 1);
    await labels.deleteLabel(owner, tag.id);
    assert.deepEqual(await labels.labelsOf(owner, 'message', message.id), [], 'a label nobody can see must stop marking things');
    await assert.rejects(() => labels.remove(owner, tag.id, 'message', message.id), (e) => e.code === 'LABEL_NOT_FOUND');
  });

  await t.test('usage counts what is actually marked', async () => {
    const { owner, message, task } = await company();
    const tag = await labels.createLabel(owner, { kind: 'tag', name: 'счётчик' });
    assert.equal(tag.usage, 0);
    await labels.apply(owner, tag.id, 'message', message.id);
    await labels.apply(owner, tag.id, 'task', task.id);
    await labels.apply(owner, tag.id, 'task', task.id);
    const listed = (await labels.listLabels(owner)).find((l) => l.id === tag.id);
    assert.equal(listed.usage, 2, 'applying twice is not two marks');
  });
});
