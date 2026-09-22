import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createOrgRepository } from '../src/org/org-repository.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

test('organisational structure', { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const org = createOrgRepository(pool);

  const sessionFor = async (userId, workspaceId, label) => {
    const tokenHash = hashToken(`org-${label}-${randomUUID()}`);
    await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
    return store.getSession(tokenHash);
  };

  const company = async () => {
    const pass = hashPassword('OrgStructurePass26');
    const created = await store.createCompany({
      companyName: `Co ${randomUUID().slice(0, 8)}`, ownerName: 'Owner', email: `owner-${randomUUID()}@test.local`,
      passwordHash: pass.hash, passwordSalt: pass.salt,
    });
    const owner = await sessionFor(created.user.id, created.workspace.id, 'owner');
    const join = async (role, name) => {
      const token = randomUUID();
      await store.createInvitation(owner, { email: `${role}-${randomUUID()}@test.local`, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 864e5).toISOString() });
      const p = hashPassword('OrgStructurePass26');
      const a = await store.acceptInvitation({ tokenHash: hashToken(token), displayName: name, passwordHash: p.hash, passwordSalt: p.salt });
      return sessionFor(a.user.id, a.workspace.id, name);
    };
    return { owner, join };
  };

  await t.test('a tree is built, read back with headcount, and keeps its depth', async () => {
    const { owner } = await company();
    const root = await org.createUnit(owner, { kind: 'company', name: 'Head office' });
    const dept = await org.createUnit(owner, { kind: 'department', name: 'Design', parentId: root.id, seatLimit: 5 });
    const team = await org.createUnit(owner, { kind: 'team', name: 'BIM', parentId: dept.id, seatLimit: 2 });
    assert.deepEqual([root.depth, dept.depth, team.depth], [0, 1, 2]);
    assert.deepEqual(dept.seats, { limit: 5, used: 0, free: 5 });
    assert.equal(root.seats.limit, null, 'a unit without a plan reports no limit, not zero');

    const tree = await org.listUnits(owner);
    assert.equal(tree.length, 3);
    assert.equal(tree.find((u) => u.id === team.id).parentId, dept.id);
  });

  await t.test('a planned headcount is a limit, not a label', async () => {
    const { owner, join } = await company();
    const unit = await org.createUnit(owner, { kind: 'team', name: 'Two seats', seatLimit: 2 });
    const a = await join('member', 'First');
    const b = await join('member', 'Second');
    const c = await join('member', 'Third');
    await org.addMember(owner, unit.id, { userId: a.userId });
    await org.addMember(owner, unit.id, { userId: b.userId });
    await assert.rejects(() => org.addMember(owner, unit.id, { userId: c.userId }), (e) => e.code === 'SEAT_LIMIT_REACHED');

    await assert.rejects(() => org.updateUnit(owner, unit.id, { seatLimit: 1 }), (e) => e.code === 'SEAT_LIMIT_BELOW_HEADCOUNT');
    const widened = await org.updateUnit(owner, unit.id, { seatLimit: 3 });
    assert.deepEqual(widened.seats, { limit: 3, used: 2, free: 1 });
    await org.addMember(owner, unit.id, { userId: c.userId });
    assert.equal((await org.listUnits(owner)).find((u) => u.id === unit.id).seats.free, 0);

    // Re-adding somebody already in the unit is a role change, not a new seat.
    await org.addMember(owner, unit.id, { userId: c.userId, role: 'admin' });
    assert.equal((await org.listUnits(owner)).find((u) => u.id === unit.id).seats.used, 3);
  });

  await t.test('exactly one person is accountable for a unit, and they belong to it', async () => {
    const { owner, join } = await company();
    const unit = await org.createUnit(owner, { kind: 'division', name: 'Structures' });
    const lead = await join('manager', 'Lead');
    const other = await join('member', 'Other');
    await assert.rejects(() => org.updateUnit(owner, unit.id, { headUserId: lead.userId }), (e) => e.code === 'HEAD_NOT_IN_UNIT');

    await org.addMember(owner, unit.id, { userId: lead.userId, role: 'head' });
    await org.addMember(owner, unit.id, { userId: other.userId });
    assert.equal((await org.listUnits(owner)).find((u) => u.id === unit.id).headUserId, lead.userId);

    await org.addMember(owner, unit.id, { userId: other.userId, role: 'head' });
    const roles = (await org.listMembers(owner, unit.id)).filter((m) => m.role === 'head');
    assert.equal(roles.length, 1, 'appointing a new head demotes the previous one');
    assert.equal(roles[0].userId, other.userId);

    await org.removeMember(owner, unit.id, other.userId);
    assert.equal((await org.listUnits(owner)).find((u) => u.id === unit.id).headUserId, null, 'removing the head clears the post');
  });

  await t.test('a guest is never placed on the chart', async () => {
    const { owner, join } = await company();
    const unit = await org.createUnit(owner, { kind: 'team', name: 'Internal' });
    const guest = await join('guest', 'Outside client');
    await assert.rejects(() => org.addMember(owner, unit.id, { userId: guest.userId }), (e) => e.code === 'NOT_WORKSPACE_STAFF');
  });

  await t.test('the reporting chain is derived from the tree and follows a move', async () => {
    const { owner, join } = await company();
    const root = await org.createUnit(owner, { kind: 'company', name: 'Company' });
    const design = await org.createUnit(owner, { kind: 'department', name: 'Design', parentId: root.id });
    const build = await org.createUnit(owner, { kind: 'department', name: 'Construction', parentId: root.id });
    const team = await org.createUnit(owner, { kind: 'team', name: 'Facades', parentId: design.id });

    const boss = await join('manager', 'Department head');
    const worker = await join('member', 'Engineer');
    await org.addMember(owner, design.id, { userId: boss.userId, role: 'head' });
    await org.addMember(owner, team.id, { userId: worker.userId });

    const before = await org.reportingChain(owner, worker.userId);
    assert.deepEqual(before.map((c) => c.unitName), ['Facades', 'Design', 'Company']);
    assert.equal(before[1].headName, 'Department head');

    await org.updateUnit(owner, team.id, { parentId: build.id });
    const after = await org.reportingChain(owner, worker.userId);
    assert.deepEqual(after.map((c) => c.unitName), ['Facades', 'Construction', 'Company'], 'moving the unit moved the reporting line with it');
  });

  await t.test('a unit admin runs their own branch and nothing else', async () => {
    const { owner, join } = await company();
    const root = await org.createUnit(owner, { kind: 'company', name: 'Company' });
    const mine = await org.createUnit(owner, { kind: 'department', name: 'Mine', parentId: root.id });
    const sub = await org.createUnit(owner, { kind: 'team', name: 'Below mine', parentId: mine.id });
    const theirs = await org.createUnit(owner, { kind: 'department', name: 'Theirs', parentId: root.id });

    const lead = await join('manager', 'Branch lead');
    await org.addMember(owner, mine.id, { userId: lead.userId, role: 'admin' });

    const managed = await org.adminUnitIds(lead);
    assert.ok(managed.includes(mine.id) && managed.includes(sub.id), 'authority reaches down the branch');
    assert.ok(!managed.includes(theirs.id) && !managed.includes(root.id), 'and not sideways or upwards');
    assert.equal(await org.canManageUnit(lead, theirs.id), false);
    assert.equal(await org.canManageUnit(lead, sub.id), true);
  });

  await t.test('the tree cannot be tied in a knot or silently emptied', async () => {
    const { owner, join } = await company();
    const root = await org.createUnit(owner, { kind: 'company', name: 'Company' });
    const dept = await org.createUnit(owner, { kind: 'department', name: 'Dept', parentId: root.id });
    const team = await org.createUnit(owner, { kind: 'team', name: 'Team', parentId: dept.id });

    await assert.rejects(() => org.updateUnit(owner, dept.id, { parentId: team.id }), (e) => e.code === 'ORG_CYCLE');
    await assert.rejects(() => org.deleteUnit(owner, dept.id), (e) => e.code === 'ORG_UNIT_HAS_CHILDREN');

    const person = await join('member', 'Somebody');
    await org.addMember(owner, team.id, { userId: person.userId });
    await assert.rejects(() => org.deleteUnit(owner, team.id), (e) => e.code === 'ORG_UNIT_HAS_MEMBERS');
    await org.removeMember(owner, team.id, person.userId);
    assert.deepEqual(await org.deleteUnit(owner, team.id), { deleted: true });
  });

  await t.test('a moved branch carries its depth with it', async () => {
    const { owner } = await company();
    const root = await org.createUnit(owner, { kind: 'company', name: 'Company' });
    const a = await org.createUnit(owner, { kind: 'department', name: 'A', parentId: root.id });
    const b = await org.createUnit(owner, { kind: 'division', name: 'B', parentId: a.id });
    const c = await org.createUnit(owner, { kind: 'team', name: 'C', parentId: b.id });
    await org.updateUnit(owner, b.id, { parentId: root.id });
    const units = Object.fromEntries((await org.listUnits(owner)).map((u) => [u.name, u.depth]));
    assert.deepEqual(units, { Company: 0, A: 1, B: 1, C: 2 }, 'the whole branch shifted, not just its top');
  });
});
