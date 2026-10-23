import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/postgres-store.js';
import { PostgresMeetingRepository } from '../src/meeting/meeting-repository.js';
import { createCalendarRepository } from '../src/calendar/calendar-repository.js';
import { createWikiRepository } from '../src/wiki/wiki-repository.js';
import { createEmailRepository } from '../src/email/email-repository.js';
import { createEmailLinkResources } from '../src/email/email-links.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

test('Email source references and idempotent replay use one DB connection and canonical target ACL', { skip: !databaseUrl, timeout: 20000 }, async t => {
  // The previous adapter opened a second pool connection from inside an email
  // transaction, causing a deterministic timeout here and starvation at load.
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 1000 });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const company = await store.createCompany({ companyName: 'Email single connection ' + randomUUID(), ownerName: 'Owner',
    email: randomUUID() + '@example.test', passwordHash: 'a'.repeat(128), passwordSalt: 'b'.repeat(32) });
  const session = { organizationId: company.organization.id, workspaceId: company.workspace.id, userId: company.user.id, role: 'owner' };
  const memberId = randomUUID(), member = { ...session, userId: memberId, role: 'member' };
  await pool.query('INSERT INTO users(id,email) VALUES($1,$2)', [memberId, memberId + '@example.test']);
  await pool.query("INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES($1,$2,$3,'member')", [session.organizationId, session.workspaceId, memberId]);
  const calendar = createCalendarRepository(pool, store), meeting = new PostgresMeetingRepository(pool);
  const features = { async isEnabled() { throw new Error('A held transaction must read feature settings on its own connection'); } };
  const wiki = createWikiRepository(pool, null, store, meeting, calendar, null, features);
  const linkResources = createEmailLinkResources({ pool, store, wiki, calendar, meeting, features });
  const email = createEmailRepository({ pool, store, linkResources });
  const box = (await email.createMailbox(session, { address: 'owner@example.test', kind: 'shared', providerId: 'local' })).mailbox;
  await email.setMailboxMember(session, box.id, { userId: memberId, role: 'responder' });
  const source = await email.importMessage(session, box.id, { raw:
    'From: supplier@example.test\r\nTo: owner@example.test\r\nSubject: Shared source\r\nMessage-ID: <' + randomUUID() + '@example.test>\r\n\r\nAgreed scope.' });
  const startAt = new Date(Date.now() + 10 * 86400000).toISOString();
  const inputs = {
    task: { title: 'Canonical task', outcome: 'Verified outcome', confirmDisclosure: true },
    page: { title: 'Restricted canonical Page', content: 'Deliberately disclosed content', confirmDisclosure: true },
    event: { title: 'Canonical event', startAt, endAt: new Date(Date.parse(startAt) + 1800000).toISOString(), timezone: 'UTC', confirmDisclosure: true },
    decision: { title: 'Canonical decision', accepted: true, confirmDisclosure: true },
  };
  const resources = {};
  for (const [kind, input] of Object.entries(inputs)) {
    const options = { idempotencyKey: 'source-' + kind };
    const created = await email.createLinkedResource(session, source.message.id, kind, input, options);
    const replayed = await email.createLinkedResource(session, source.message.id, kind, input, options);
    resources[kind] = created.resource;
    assert.equal(replayed.resource.id, created.resource.id);
    assert.equal((await email.getResourceLinks(session, kind, created.resource.id))[0].messageId, source.message.id);
  }
  const detail = await email.getThread(session, source.thread.id);
  assert.deepEqual(detail.resourceLinks.map(link => link.kind).sort(), ['decision', 'event', 'page', 'task']);
  assert.equal(pool.totalCount, 1);
  const asMember = await email.getThread(member, source.thread.id);
  assert.equal(asMember.resourceLinks.some(link => link.kind === 'page'), false, 'a mailbox grant does not grant access to its restricted Page');
  assert.equal(asMember.resourceLinks.some(link => link.kind === 'event'), false, 'a mailbox grant does not invite the reader to the calendar event');
  assert.equal(asMember.resourceLinks.some(link => link.kind === 'decision'), true, 'accepted email decisions use current mailbox source access');
  for (const feature of ['tasks', 'wiki', 'calendar', 'decisions']) {
    await pool.query('INSERT INTO workspace_features(workspace_id,feature,enabled) VALUES($1,$2,false) ON CONFLICT(workspace_id,feature) DO UPDATE SET enabled=false', [session.workspaceId, feature]);
  }
  assert.equal((await email.getThread(session, source.thread.id)).resourceLinks.length, 0, 'disabled sections hide existing references without deleting provenance');
  await assert.rejects(email.createLinkedResource(session, source.message.id, 'task', inputs.task, { idempotencyKey: 'source-task' }), { code: 'EMAIL_NOT_FOUND' });
  await pool.query("DELETE FROM workspace_features WHERE workspace_id=$1 AND feature='wiki'", [session.workspaceId]);
  await wiki.archive(session, resources.page.id);
  assert.equal((await email.getThread(session, source.thread.id)).resourceLinks.length, 0, 'archived Pages cannot reappear through email references');
});
