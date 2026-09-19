import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { hashPassword, hashToken } from '../src/security.js';
import { createLabelRepository } from '../src/labels/label-repository.js';

const databaseUrl = process.env.DATABASE_URL;

/**
 * A guest is an outside participant: a client, a contractor, an auditor.
 * `visibility: 'workspace'` is a convenience for staff, not a grant to
 * outsiders — without these rules a guest lands in the general channel and
 * reads whatever the company posts there.
 */
test('guest containment', { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);

  const sessionFor = async (userId, workspaceId, label) => {
    const tokenHash = hashToken(`guest-containment-${label}-${randomUUID()}`);
    await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
    return store.getSession(tokenHash);
  };

  const build = async () => {
    const pass = hashPassword('ContainmentPass2026');
    const company = await store.createCompany({
      companyName: `Co ${randomUUID().slice(0, 8)}`, ownerName: 'Owner', email: `owner-${randomUUID()}@test.local`,
      passwordHash: pass.hash, passwordSalt: pass.salt,
    });
    const owner = await sessionFor(company.user.id, company.workspace.id, 'owner');

    const join = async (role, name) => {
      const token = randomUUID();
      await store.createInvitation(owner, { email: `${role}-${randomUUID()}@test.local`, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 864e5).toISOString() });
      const p = hashPassword('ContainmentPass2026');
      const accepted = await store.acceptInvitation({ tokenHash: hashToken(token), displayName: name, passwordHash: p.hash, passwordSalt: p.salt });
      return sessionFor(accepted.user.id, accepted.workspace.id, name);
    };

    return { owner, staff: await join('member', 'Staff Member'), guest: await join('guest', 'Outside Client') };
  };

  await t.test('a guest is not enrolled into workspace-wide channels', async () => {
    const { owner, staff, guest } = await build();
    const staffSees = (await store.listConversations(staff)).map((c) => c.title);
    const guestSees = (await store.listConversations(guest)).map((c) => c.title);
    assert.ok(staffSees.length >= 1, 'staff still land in the default channels');
    assert.deepEqual(guestSees, [], 'a guest starts with no rooms at all');
    assert.ok((await store.listConversations(owner)).length >= 1);
  });

  await t.test('a guest cannot read or write a workspace channel they were not invited to', async () => {
    const { owner, staff, guest } = await build();
    const [channel] = await store.listConversations(staff);
    await store.createMessage(owner, channel.id, { kind: 'text', body: 'Payroll closes on the 25th', clientRequestId: randomUUID() });

    assert.equal(await store.canAccessConversation(guest, channel.id), false);
    await assert.rejects(() => store.listMessages(guest, channel.id), 'reading is refused');
    await assert.rejects(
      () => store.createMessage(guest, channel.id, { kind: 'text', body: 'can I post here', clientRequestId: randomUUID() }),
      'posting is refused',
    );
    assert.equal(await store.canAccessConversation(staff, channel.id), true, 'staff are unaffected');
  });

  await t.test('a guest reaches exactly the conversation they were invited to', async () => {
    const { owner, guest } = await build();
    const room = await store.createConversation(owner, { kind: 'external', title: 'Client room', visibility: 'private', participantIds: [guest.userId] });
    const titles = (await store.listConversations(guest)).map((c) => c.title);
    assert.deepEqual(titles, ['Client room']);
    assert.equal(await store.canAccessConversation(guest, room.id), true);
  });

  await t.test('a guest sees only the colleagues they share a room with', async () => {
    const { owner, staff, guest } = await build();
    await store.createConversation(owner, { kind: 'external', title: 'Client room', visibility: 'private', participantIds: [guest.userId] });
    const guestDirectory = (await store.getBootstrap(guest)).people.map((p) => p.displayName);
    assert.ok(guestDirectory.includes('Outside Client'), 'they see themselves');
    assert.ok(!guestDirectory.includes('Staff Member'), 'the staff list is not a customer-facing directory');
    const staffDirectory = (await store.getBootstrap(staff)).people.map((p) => p.displayName);
    assert.ok(staffDirectory.includes('Staff Member') && staffDirectory.length >= 3, 'staff still see the whole team');
  });

  await t.test('a guest never sees the company calendar', async () => {
    const { owner, staff, guest } = await build();
    await store.createCalendarEvent(staff, {
      kind: 'focus', title: 'Deep work', startAt: new Date(Date.now() + 36e5).toISOString(),
      endAt: new Date(Date.now() + 72e5).toISOString(), timezone: 'UTC', visibility: 'participants',
    });
    await store.createCalendarEvent(owner, {
      kind: 'meeting', title: 'All hands', startAt: new Date(Date.now() + 36e5).toISOString(),
      endAt: new Date(Date.now() + 72e5).toISOString(), timezone: 'UTC', visibility: 'workspace',
    });
    assert.deepEqual((await store.listCalendar(guest)).map((e) => e.title), []);
    assert.deepEqual((await store.listCalendar(staff)).map((e) => e.title).sort(), ['All hands', 'Deep work']);
  });

  await t.test("a colleague's private focus block stays private", async () => {
    const { owner, staff } = await build();
    await store.createCalendarEvent(staff, {
      kind: 'focus', title: 'Not your business', startAt: new Date(Date.now() + 36e5).toISOString(),
      endAt: new Date(Date.now() + 72e5).toISOString(), timezone: 'UTC', visibility: 'participants',
    });
    const ownerSees = (await store.listCalendar(owner)).map((e) => e.title);
    assert.ok(!ownerSees.includes('Not your business'), 'visibility is enforced, not merely stored');
    assert.ok((await store.listCalendar(staff)).some((e) => e.title === 'Not your business'), 'the owner of the block still sees it');
  });

  // The shared label vocabulary names internal things — an object, a client, a
  // stage of work. The staff directory and the org chart are already kept away
  // from a guest; the company's words are the same kind of asset.
  await t.test('a guest reaches no part of the company label vocabulary', async () => {
    const { owner, guest } = await build();
    const labels = createLabelRepository(pool, store);
    const room = await store.createConversation(owner, { kind: 'external', title: 'С заказчиком', visibility: 'private', participantIds: [guest.userId] });

    const shared = await labels.createLabel(owner, { kind: 'tag', name: `объект-${randomUUID().slice(0, 6)}` });
    const priority = await labels.createLabel(owner, { kind: 'priority', name: `важно-${randomUUID().slice(0, 6)}` });
    const own = await labels.createLabel(guest, { kind: 'tag', name: 'моя пометка', personal: true });

    assert.deepEqual((await labels.listLabels(guest)).map((l) => l.id), [own.id], 'гость видит словарь компании');
    assert.ok((await labels.listLabels(owner)).some((l) => l.id === shared.id), 'сотрудник потерял общие метки');

    const message = await store.createMessage(owner, room.id, { kind: 'text', body: 'Когда отчёт?', clientRequestId: randomUUID() });

    // Knowing the id is not access.
    await assert.rejects(
      () => labels.apply(guest, shared.id, 'message', message.id),
      (error) => error.code === 'LABEL_NOT_FOUND',
      'гость повесил общую метку компании',
    );

    // A staff member's triage of a message in the shared room stays internal.
    await labels.apply(owner, priority.id, 'message', message.id);
    await labels.apply(guest, own.id, 'message', message.id);
    assert.deepEqual((await labels.labelsOf(guest, 'message', message.id)).map((l) => l.id), [own.id],
      'гость читает внутреннюю пометку');

    // Importance is exclusive, but the guest's own must not strip the company's.
    assert.ok((await labels.labelsOf(owner, 'message', message.id)).some((l) => l.id === priority.id),
      'личная важность гостя стёрла общую');
  });
});
