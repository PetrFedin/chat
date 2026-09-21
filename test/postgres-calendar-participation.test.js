import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createCalendarRepository } from '../src/calendar/calendar-repository.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.DATABASE_URL;
const soon = (hours) => new Date(Date.now() + hours * 36e5).toISOString();

test('calendar participation', { skip: databaseUrl ? false : 'DATABASE_URL is not set' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const calendar = createCalendarRepository(pool, store);

  const sessionFor = async (userId, workspaceId, label) => {
    const tokenHash = hashToken(`cal-${label}-${randomUUID()}`);
    await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
    return store.getSession(tokenHash);
  };

  const company = async () => {
    const pass = hashPassword('CalendarPass2026x');
    const created = await store.createCompany({
      companyName: `Co ${randomUUID().slice(0, 8)}`, ownerName: 'Organiser', email: `org-${randomUUID()}@test.local`,
      passwordHash: pass.hash, passwordSalt: pass.salt,
    });
    const owner = await sessionFor(created.user.id, created.workspace.id, 'owner');
    const join = async (role, name) => {
      const token = randomUUID();
      await store.createInvitation(owner, { email: `${role}-${randomUUID()}@test.local`, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 864e5).toISOString() });
      const p = hashPassword('CalendarPass2026x');
      const a = await store.acceptInvitation({ tokenHash: hashToken(token), displayName: name, passwordHash: p.hash, passwordSalt: p.salt });
      return sessionFor(a.user.id, a.workspace.id, name);
    };
    const event = await store.createCalendarEvent(owner, {
      kind: 'meeting', title: 'Design review', startAt: soon(24), endAt: soon(25), timezone: 'UTC', visibility: 'participants',
    });
    return { owner, join, event };
  };

  await t.test('invited people are asked, and only staff can be asked', async () => {
    const { owner, join, event } = await company();
    const anna = await join('member', 'Anna');
    const guest = await join('guest', 'Client');

    assert.deepEqual(await calendar.invite(owner, event.id, [anna.userId]), { invited: 1 });
    await assert.rejects(() => calendar.invite(owner, event.id, [guest.userId]), (e) => e.code === 'NOT_WORKSPACE_STAFF');

    const pending = await calendar.pendingInvitations(anna);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].title, 'Design review');
    const detail = await calendar.getEvent(anna, event.id);
    assert.equal(detail.needsMyAnswer, true);
    assert.equal(detail.myResponse, 'invited');
  });

  await t.test('an answer is recorded with its time, and only the invited may give one', async () => {
    const { owner, join, event } = await company();
    const anna = await join('member', 'Anna');
    const bob = await join('member', 'Bob');
    await calendar.invite(owner, event.id, [anna.userId]);

    const answer = await calendar.respond(anna, event.id, 'declined', 'Уже занят');
    assert.equal(answer.response, 'declined');
    assert.ok(answer.respondedAt, 'the schema refuses an answer without a timestamp');
    assert.equal(answer.note, 'Уже занят');

    await assert.rejects(() => calendar.respond(anna, event.id, 'maybe'), (e) => e.code === 'INVALID_RESPONSE');
    // Закрытая встреча для постороннего не существует вовсе — иначе отказ
    // «вас не приглашали» сам по себе рассказывал бы, что встреча есть.
    await assert.rejects(() => calendar.respond(bob, event.id, 'accepted'), (e) => e.code === 'CALENDAR_EVENT_NOT_FOUND');

    // А во встрече, открытой всей компании, Боб её видит — и слышит по делу,
    // что приглашения у него нет.
    const open = await store.createCalendarEvent(owner, {
      kind: 'meeting', title: 'Открытая планёрка', startAt: soon(30), endAt: soon(31), timezone: 'UTC', visibility: 'workspace',
    });
    await assert.rejects(() => calendar.respond(bob, open.id, 'accepted'), (e) => e.code === 'NOT_INVITED');
    assert.equal((await calendar.pendingInvitations(anna)).length, 0, 'an answered invitation stops asking');
  });

  await t.test('moving the meeting invalidates the answers people already gave', async () => {
    const { owner, join, event } = await company();
    const anna = await join('member', 'Anna');
    const bob = await join('member', 'Bob');
    await calendar.invite(owner, event.id, [anna.userId, bob.userId]);
    await calendar.respond(anna, event.id, 'accepted');
    await calendar.respond(bob, event.id, 'tentative');

    const moved = await calendar.updateEvent(owner, event.id, { startAt: soon(48), endAt: soon(49) });
    assert.ok(moved.participants.every((p) => p.response === 'invited'), 'an answer to the old time is not an answer to the new one');
    assert.ok(moved.participants.every((p) => p.respondedAt === null));
    assert.equal((await calendar.pendingInvitations(anna)).length, 1, 'and they are asked again');

    const notifications = await pool.query(
      "SELECT type FROM notifications WHERE workspace_id=$1 AND recipient_user_id=$2 AND type='calendar.updated'",
      [anna.workspaceId, anna.userId],
    );
    assert.equal(notifications.rowCount, 1, 'they are told why');
  });

  await t.test('only the organiser edits, invites, attaches or cancels', async () => {
    const { owner, join, event } = await company();
    const anna = await join('member', 'Anna');
    await calendar.invite(owner, event.id, [anna.userId]);
    for (const attempt of [
      () => calendar.updateEvent(anna, event.id, { title: 'Renamed' }),
      () => calendar.invite(anna, event.id, [anna.userId]),
      () => calendar.cancelEvent(anna, event.id),
      () => calendar.removeParticipant(anna, event.id, anna.userId),
    ]) {
      await assert.rejects(attempt, (e) => e.code === 'CALENDAR_NOT_ORGANISER');
    }
    await assert.rejects(() => calendar.updateEvent(owner, event.id, { endAt: soon(1) }), (e) => e.code === 'INVALID_CALENDAR_RANGE');
  });

  await t.test('the range read tells the grid what still needs an answer', async () => {
    const { owner, join, event } = await company();
    const anna = await join('member', 'Anna');
    await calendar.invite(owner, event.id, [anna.userId]);

    const hers = await calendar.listRange(anna, { from: soon(-24), to: soon(72) });
    const row = hers.find((e) => e.id === event.id);
    assert.equal(row.needsMyAnswer, true);
    assert.equal(row.participantCount, 1);

    await calendar.respond(anna, event.id, 'accepted');
    const after = (await calendar.listRange(anna, { from: soon(-24), to: soon(72) })).find((e) => e.id === event.id);
    assert.equal(after.needsMyAnswer, false);
  });

  await t.test('cancelling tells the attendees and removes the event', async () => {
    const { owner, join, event } = await company();
    const anna = await join('member', 'Anna');
    await calendar.invite(owner, event.id, [anna.userId]);
    await calendar.cancelEvent(owner, event.id);

    await assert.rejects(() => calendar.getEvent(anna, event.id), (e) => e.code === 'CALENDAR_EVENT_NOT_FOUND');
    const told = await pool.query(
      "SELECT 1 FROM notifications WHERE workspace_id=$1 AND recipient_user_id=$2 AND type='calendar.cancelled'",
      [anna.workspaceId, anna.userId],
    );
    assert.equal(told.rowCount, 1);
  });
});
