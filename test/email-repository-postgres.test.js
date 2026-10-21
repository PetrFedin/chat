import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createEmailRepository } from '../src/email/email-repository.js';
import { createEmailSecretBox } from '../src/email/email-secret.js';
import { createEmailWorker } from '../src/email/email-worker.js';
import { parseEmail, composeEmail } from '../src/email/email-mime.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const rawMessage = (messageId = randomUUID() + '@outside.test', references = '') =>
  'From: Client <client@outside.test>\r\nTo: Owner <owner@example.test>\r\nSubject: Work evidence\r\nMessage-ID: <' + messageId + '>\r\n' + (references ? 'In-Reply-To: <' + references + '>\r\n' : '') + 'MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nПроверяем исходное письмо';

async function fixture(t, settings = {}) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const company = await store.createCompany({ companyName: 'Email PG ' + randomUUID(), ownerName: 'Owner', email: 'email-pg-' + randomUUID() + '@example.test', passwordHash: 'a'.repeat(128), passwordSalt: 'b'.repeat(32) });
  const owner = { userId: company.user.id, organizationId: company.organization.id, workspaceId: company.workspace.id, role: 'owner' };
  let time = Date.now(), sends = 0;
  const clock = () => new Date(time);
  const provider = {
    async verify(config) { return { address: config.email, aliases: [config.email], capabilities: { read: true, send: true }, fromVerification: 'test_authenticated' }; },
    async sync() { return { messages: [], cursor: { folder: 'INBOX', uidValidity: '1', lastUid: 0 }, hasMore: false }; },
    async send(config, payload) { sends++; return { status: 'provider_accepted', providerMessageId: payload.messageId, ...await composeEmail(payload) }; },
    async reconcileSent() { return { status: 'not_found', found: false, retryable: false }; },
  };
  const secretBox = createEmailSecretBox({ key: randomBytes(32).toString('base64') });
  const options = { pool, store, provider, secretBox, clock, undoMs: 0, sendLeaseMs: 1000, ...settings };
  const repo = createEmailRepository(options);
  const member = async (role = 'member') => {
    const userId = randomUUID();
    await pool.query('INSERT INTO users(id,email) VALUES($1,$2)', [userId, userId + '@example.test']);
    await pool.query('INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES($1,$2,$3,$4)', [owner.organizationId, owner.workspaceId, userId, role]);
    return { ...owner, userId, role };
  };
  return { pool, store, owner, member, provider, secretBox, repo, options, advance(ms) { time += ms; }, sentCount() { return sends; } };
}

async function mailbox(f, input = {}) {
  return (await f.repo.createMailbox(f.owner, { providerId: 'custom', address: 'owner@example.test', config: { username: 'owner@example.test', password: 'fixture-password-not-real', imap: { host: 'imap.example.com', port: 993, secure: true }, smtp: { host: 'smtp.example.com', port: 465, secure: true } }, ...input })).mailbox;
}
async function draft(f, box, input = {}, actor = f.owner) {
  return (await f.repo.createDraft(actor, { mailboxId: box.id, subject: 'Delivery', to: [{ address: 'client@outside.test' }], text: 'Reviewed external email', ...input })).draft;
}
const command = key => ({ idempotencyKey: key });

test('Internal outbox workspace filter validates UUID and leaves another workspace queue untouched', { skip: !databaseUrl }, async t => {
  const current = await fixture(t), other = await fixture(t);
  const currentDraft = await draft(current, await mailbox(current));
  const otherDraft = await draft(other, await mailbox(other));
  const currentIntent = (await current.repo.createSendIntent(current.owner, currentDraft.id, { expectedVersion: currentDraft.version })).sendIntent;
  const otherIntent = (await other.repo.createSendIntent(other.owner, otherDraft.id, { expectedVersion: otherDraft.version })).sendIntent;
  await assert.rejects(current.repo.processOutbox({ workspaceId: 'not-a-workspace-uuid' }), { code: 'EMAIL_INVALID_REQUEST' });
  assert.equal(current.sentCount(), 0);
  assert.deepEqual(await current.repo.processOutbox({ workspaceId: current.owner.workspaceId }), { processed: 1 });
  assert.equal((await current.repo.getSendIntent(current.owner, currentIntent.id)).sendIntent.status, 'provider_accepted');
  assert.equal((await other.repo.getSendIntent(other.owner, otherIntent.id)).sendIntent.status, 'queued');
  assert.equal(other.sentCount(), 0);
  await other.repo.cancelSendIntent(other.owner, otherIntent.id, { expectedVersion: otherIntent.version });
});

test('Email PG persists MIME, attachments, metadata and private access across repository restart', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f), other = await f.member('admin');
  const raw = rawMessage(), imported = await f.repo.importMessage(f.owner, box.id, { raw }, command('original'));
  const pending = await draft(f, box);
  const attachment = await f.repo.attachToDraft(f.owner, pending.id, { name: 'private.txt', mimeType: 'text/plain', contentBase64: Buffer.from('private byte content').toString('base64') });
  const label = (await f.repo.saveLabel(f.owner, null, { name: 'Owner label', color: 'neutral' })).label;
  await f.repo.updateThread(f.owner, imported.thread.id, { expectedVersion: imported.thread.version, labelIds: [label.id] });
  await f.repo.createNote(f.owner, imported.thread.id, { kind: 'private', text: 'Private note' });
  await f.repo.createWaiting(f.owner, imported.thread.id, { title: 'Wait for external party' });
  const restarted = createEmailRepository(f.options);
  assert.equal((await restarted.getThread(f.owner, imported.thread.id)).notes[0].text, 'Private note');
  assert.deepEqual((await restarted.getOriginal(f.owner, imported.message.id)).content, Buffer.from(raw));
  assert.equal((await restarted.getAttachment(f.owner, attachment.attachment.id)).content.toString(), 'private byte content');
  await assert.rejects(restarted.getThread(other, imported.thread.id), { code: 'EMAIL_NOT_FOUND' });
  assert.equal(await restarted.canReadMessage(other, imported.message.id), false);
  const stored = (await f.pool.query('SELECT data,raw_mime FROM email_messages WHERE id=$1', [imported.message.id])).rows[0];
  assert.equal(stored.data.rawBase64, undefined);
  assert.equal(stored.raw_mime.toString(), raw);
  const credential = (await f.pool.query('SELECT data FROM email_mailboxes WHERE id=$1', [box.id])).rows[0].data;
  assert.equal(JSON.stringify(credential).includes('fixture-password-not-real'), false);
  assert.ok(credential.secretEnvelope.startsWith('v1.'));
  assert.equal(Number((await f.pool.query('SELECT count(*) FROM files WHERE workspace_id=$1', [f.owner.workspaceId])).rows[0].count), 0);
});

test('Email PG tenant composite FKs, membership revocation and idempotency cannot cross access boundaries', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f, { kind: 'shared' }), responder = await f.member();
  await f.repo.setMailboxMember(f.owner, box.id, { userId: responder.userId, role: 'responder' });
  const incoming = await f.repo.importMessage(f.owner, box.id, { raw: rawMessage() });
  const body = { kind: 'internal', text: 'Current ACL before replay' };
  const result = await f.repo.createNote(responder, incoming.thread.id, body, command('same-command'));
  await f.repo.removeMailboxMember(f.owner, box.id, responder.userId);
  const restarted = createEmailRepository(f.options);
  await assert.rejects(restarted.createNote(responder, incoming.thread.id, body, command('same-command')), { code: 'EMAIL_NOT_FOUND' });
  assert.equal((await f.pool.query('SELECT count(*) FROM email_notes WHERE id=$1', [result.note.id])).rows[0].count, '1');
  const foreign = await fixture(t);
  await assert.rejects(f.pool.query('INSERT INTO email_messages(id,organization_id,workspace_id,mailbox_id,thread_id,data) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), foreign.owner.organizationId, foreign.owner.workspaceId, box.id, incoming.thread.id, {}]), { code: '23503' });
  await f.pool.query('UPDATE users SET disabled_at=now() WHERE id=$1', [f.owner.userId]);
  await assert.rejects(f.repo.bootstrap(f.owner), { code: 'EMAIL_NOT_FOUND' });
});

test('Durable outbox commits once, keeps stable Message-ID and returns provider acceptance, not delivery', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f), pending = await draft(f, box);
  const body = { expectedVersion: pending.version };
  const intent = await f.repo.createSendIntent(f.owner, pending.id, body, command('send-one'));
  const replay = await f.repo.createSendIntent(f.owner, pending.id, body, command('send-one'));
  assert.equal(intent.sendIntent.id, replay.sendIntent.id);
  const restarted = createEmailRepository(f.options), worker = createEmailWorker(restarted);
  assert.equal((await worker.tick()).processed, 1);
  assert.equal((await worker.tick()).processed, 0);
  assert.equal(f.sentCount(), 1);
  const sent = (await restarted.getSendIntent(f.owner, intent.sendIntent.id)).sendIntent;
  assert.equal(sent.status, 'provider_accepted');
  assert.equal(sent.messageId, intent.sendIntent.messageId);
  assert.equal(sent.deliveredAt, undefined);
  const message = await restarted.getMessage(f.owner, sent.sentMessageId);
  assert.equal(message.deliveryStatus, 'provider_accepted');
  assert.equal((await parseEmail((await restarted.getOriginal(f.owner, message.id)).content)).internetMessageId, sent.messageId);
  await assert.rejects(restarted.cancelSendIntent(f.owner, sent.id, { expectedVersion: sent.version }), { code: 'EMAIL_CANNOT_CANCEL' });
  assert.equal((await restarted.createSendIntent(f.owner, pending.id, body, command('send-one'))).sendIntent.status, 'provider_accepted');
});

test('Queued send cancellation is durable; a cancelled draft can be edited and sent only by a new command', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f), pending = await draft(f, box);
  const intent = await f.repo.createSendIntent(f.owner, pending.id, { expectedVersion: 1, scheduledAt: new Date(Date.now() + 3600000).toISOString() });
  await assert.rejects(f.repo.updateDraft(f.owner, pending.id, { expectedVersion: 1, text: 'pending edit' }), { code: 'EMAIL_SEND_IN_PROGRESS' });
  const cancelled = await f.repo.cancelSendIntent(f.owner, intent.sendIntent.id, { expectedVersion: 1 }, command('cancel'));
  assert.equal(cancelled.sendIntent.status, 'cancelled');
  f.advance(7200000);
  assert.equal((await createEmailRepository(f.options).processOutbox()).processed, 0);
  assert.equal(f.sentCount(), 0);
  const edited = (await f.repo.updateDraft(f.owner, pending.id, { expectedVersion: 1, text: 'new version' })).draft;
  const next = await f.repo.createSendIntent(f.owner, pending.id, { expectedVersion: edited.version });
  assert.notEqual(next.sendIntent.messageId, intent.sendIntent.messageId);
  await f.repo.processOutbox();
  assert.equal(f.sentCount(), 1);
});

test('Restart after a dispatch claim becomes unknown outcome; not_found does not enqueue a retry', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f), pending = await draft(f, box);
  const intent = (await f.repo.createSendIntent(f.owner, pending.id, { expectedVersion: 1 })).sendIntent;
  const claim = await f.repo._claimSend(f.owner, intent.id);
  assert.ok(claim);
  f.advance(2000);
  const restarted = createEmailRepository(f.options);
  await restarted.processOutbox();
  let state = (await restarted.getSendIntent(f.owner, intent.id)).sendIntent;
  assert.equal(state.status, 'unknown_outcome');
  assert.equal(f.sentCount(), 0);
  state = (await restarted.reconcileSendIntent(f.owner, intent.id)).sendIntent;
  assert.equal(state.status, 'unknown_outcome');
  assert.equal(state.lastError, 'EMAIL_SENT_NOT_FOUND_UNPROVEN');
  await restarted.processOutbox();
  await assert.rejects(restarted.createSendIntent(f.owner, pending.id, { expectedVersion: 1 }), { code: 'EMAIL_SEND_IN_PROGRESS' });
  f.provider.reconcileSent = async () => ({ status: 'provider_accepted', found: true, providerMessageId: 'found-in-sent' });
  state = (await restarted.reconcileSendIntent(f.owner, intent.id)).sendIntent;
  assert.equal(state.status, 'provider_accepted');
  assert.equal(f.sentCount(), 0);
});

test('Ambiguous SMTP result stays unknown and partial recipient acceptance never retries the whole intent', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f), first = await draft(f, box);
  let attempts = 0;
  f.provider.send = async () => { attempts++; throw new Error('simulated disconnect after DATA'); };
  const intent = (await f.repo.createSendIntent(f.owner, first.id, { expectedVersion: 1 })).sendIntent;
  await f.repo.processOutbox(); await f.repo.processOutbox();
  assert.equal(attempts, 1);
  assert.equal((await f.repo.getSendIntent(f.owner, intent.id)).sendIntent.status, 'unknown_outcome');
  const second = await draft(f, box, { to: [{ address: 'a@outside.test' }, { address: 'b@outside.test' }] });
  f.provider.send = async () => { attempts++; return { status: 'provider_accepted', accepted: ['a@outside.test'], rejected: ['b@outside.test'], partial: true, errorCode: 'EMAIL_RECIPIENTS_PARTIALLY_REJECTED' }; };
  const partial = (await f.repo.createSendIntent(f.owner, second.id, { expectedVersion: 1 })).sendIntent;
  await f.repo.processOutbox(); await f.repo.processOutbox();
  const state = (await f.repo.getSendIntent(f.owner, partial.id)).sendIntent;
  assert.equal(state.partial, true); assert.deepEqual(state.rejectedRecipients, ['b@outside.test']); assert.equal(attempts, 2);
});

test('Shared mailbox approval is bound to exact version and current approver membership', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f, { kind: 'shared' }), author = await f.member(), approver = await f.member();
  await f.repo.setMailboxMember(f.owner, box.id, { userId: author.userId, role: 'responder' });
  await f.repo.setMailboxMember(f.owner, box.id, { userId: approver.userId, role: 'manager' });
  const current = (await f.repo.getMailbox(f.owner, box.id)).mailbox;
  await f.repo.updateMailbox(f.owner, box.id, { expectedVersion: current.version, requireApproval: true });
  const pending = await draft(f, box, {}, author);
  await assert.rejects(f.repo.createSendIntent(author, pending.id, { expectedVersion: 1 }), { code: 'EMAIL_APPROVAL_REQUIRED' });
  await f.repo.approveDraft(approver, pending.id, { expectedVersion: 1 });
  const intent = (await f.repo.createSendIntent(author, pending.id, { expectedVersion: 1 })).sendIntent;
  await f.repo.removeMailboxMember(f.owner, box.id, approver.userId);
  await f.repo.processOutbox();
  assert.equal((await f.repo.getSendIntent(author, intent.id)).sendIntent.lastError, 'EMAIL_APPROVAL_REQUIRED');
  assert.equal(f.sentCount(), 0);
});

test('Two shared drafts cannot race to reply to the same incoming message', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f, { kind: 'shared' }), other = await f.member();
  await f.repo.setMailboxMember(f.owner, box.id, { userId: other.userId, role: 'responder' });
  const incoming = await f.repo.importMessage(f.owner, box.id, { raw: rawMessage() });
  const a = await draft(f, box, { replyToMessageId: incoming.message.id });
  const b = await draft(f, box, { replyToMessageId: incoming.message.id }, other);
  const outcomes = await Promise.allSettled([f.repo.createSendIntent(f.owner, a.id, { expectedVersion: 1 }), f.repo.createSendIntent(other, b.id, { expectedVersion: 1 })]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(row => row.status === 'rejected').reason.code, 'EMAIL_REPLY_CONFLICT');
  await f.repo.processOutbox();
  assert.equal(f.sentCount(), 1);
});

test('Revoked actor before dispatch cannot send, but revocation during SMTP does not lose accepted outcome', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f, { kind: 'shared' }), other = await f.member();
  await f.repo.setMailboxMember(f.owner, box.id, { userId: other.userId, role: 'responder' });
  const incoming = await f.repo.importMessage(f.owner, box.id, { raw: rawMessage() });
  const pending = await draft(f, box, { replyToMessageId: incoming.message.id }, other);
  const intent = (await f.repo.createSendIntent(other, pending.id, { expectedVersion: 1 })).sendIntent;
  const claim = await f.repo._claimSend(other, intent.id);
  assert.ok(claim);
  await f.repo.removeMailboxMember(f.owner, box.id, other.userId);
  const finished = await f.repo._finishSend(claim, { status: 'provider_accepted', raw: (await composeEmail(claim.payload)).raw });
  assert.equal(finished.status, 'provider_accepted');
  assert.ok(finished.sentMessageId);
  assert.equal((await f.repo.getSendIntent(f.owner, intent.id)).sendIntent.status, 'provider_accepted');
  await assert.rejects(f.repo.getSendIntent(other, intent.id), { code: 'EMAIL_NOT_FOUND' });
  await f.repo.processOutbox(); assert.equal(f.sentCount(), 0);
  const next = await draft(f, box), nextIntent = (await f.repo.createSendIntent(f.owner, next.id, { expectedVersion: 1 })).sendIntent;
  await f.pool.query('UPDATE users SET disabled_at=now() WHERE id=$1', [f.owner.userId]);
  await f.repo.processOutbox();
  const raw = (await f.pool.query('SELECT status,data FROM email_send_intents WHERE id=$1', [nextIntent.id])).rows[0];
  assert.equal(raw.status, 'failed'); assert.equal(raw.data.lastError, 'EMAIL_NOT_FOUND'); assert.equal(f.sentCount(), 0);
});

test('Sync is cursor-persistent, replays deduplicate and mailbox modification prevents stale cursor commit', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f), incoming = await parseEmail(rawMessage());
  let calls = 0;
  f.provider.sync = async (config, { cursor }) => {
    calls++; if (calls > 1) assert.equal(cursor.lastUid, 1);
    return { messages: [{ ...incoming, providerMessageId: 'INBOX:1:1', remoteUid: 1 }], cursor: { folder: 'INBOX', uidValidity: '1', lastUid: 1 }, hasMore: false };
  };
  assert.equal((await f.repo.syncMailbox(f.owner, box.id)).imported, 1);
  assert.equal((await createEmailRepository(f.options).syncMailbox(f.owner, box.id)).imported, 0);
  assert.equal((await f.repo.listThreads(f.owner, { folder: 'all' })).items.length, 1);
  f.provider.sync = async () => {
    const current = (await f.repo.getMailbox(f.owner, box.id)).mailbox;
    await f.repo.updateMailbox(f.owner, box.id, { expectedVersion: current.version, paused: true });
    return { messages: [], cursor: { folder: 'INBOX', uidValidity: '1', lastUid: 2 } };
  };
  await assert.rejects(f.repo.syncMailbox(f.owner, box.id), { code: 'EMAIL_VERSION_CONFLICT' });
});

test('Unknown outcome retains exact submitted MIME and reconciliation updates the same source record', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f), pending = await draft(f, box);
  let sentRaw;
  f.provider.send = async (config, payload) => { sentRaw = (await composeEmail(payload)).raw; return { status: 'unknown_outcome', raw: sentRaw, errorCode: 'EMAIL_SEND_UNKNOWN' }; };
  const queued = (await f.repo.createSendIntent(f.owner, pending.id, { expectedVersion: 1 })).sendIntent;
  await f.repo.processOutbox();
  const unknown = (await f.repo.getSendIntent(f.owner, queued.id)).sendIntent;
  assert.equal(unknown.status, 'unknown_outcome');
  assert.ok(unknown.sentMessageId);
  assert.deepEqual((await f.repo.getOriginal(f.owner, unknown.sentMessageId)).content, sentRaw);
  assert.equal((await f.repo.getMessage(f.owner, unknown.sentMessageId)).deliveryStatus, 'unknown_outcome');
  f.provider.reconcileSent = async () => ({ status: 'provider_accepted', found: true });
  const accepted = (await createEmailRepository(f.options).reconcileSendIntent(f.owner, queued.id)).sendIntent;
  assert.equal(accepted.sentMessageId, unknown.sentMessageId);
  assert.deepEqual((await f.repo.getOriginal(f.owner, accepted.sentMessageId)).content, sentRaw);
  assert.equal((await f.repo.getThread(f.owner, accepted.threadId)).messages.length, 1);
});

test('Sync UIDVALIDITY remap, flags and expunge preserve the stable source and retained MIME', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f), incoming = await parseEmail(rawMessage());
  let round = 0;
  f.provider.sync = async (config, { knownMessages }) => {
    round++;
    if (round === 1) return { messages: [{ ...incoming, providerMessageId: 'INBOX:1:2', remoteUid: 2, flags: [] }], cursor: { folder: 'INBOX', uidValidity: '1', lastUid: 2, backfillBefore: 2 }, historyLimited: true, hasMore: true };
    if (round === 2) {
      assert.ok(knownMessages.some(row => row.providerMessageId === 'INBOX:1:2'));
      return { messages: [{ ...incoming, providerMessageId: 'INBOX:2:5', remoteUid: 5, flags: ['\\Seen'] }], cursor: { folder: 'INBOX', uidValidity: '2', lastUid: 5, backfillBefore: null }, reset: true, hasMore: false };
    }
    assert.ok(knownMessages.some(row => row.providerMessageId === 'INBOX:2:5'));
    return { messages: [], cursor: { folder: 'INBOX', uidValidity: '2', lastUid: 5 }, changes: [{ providerMessageId: 'INBOX:2:5', flags: ['\\Seen', '\\Flagged'] }], tombstones: [{ providerMessageId: 'INBOX:2:5', reason: 'expunged' }] };
  };
  assert.equal((await f.repo.syncMailbox(f.owner, box.id)).historyLimited, true);
  const thread = (await f.repo.listThreads(f.owner, { folder: 'all' })).items[0];
  const messageId = (await f.repo.getThread(f.owner, thread.id)).messages[0].id;
  assert.equal((await f.repo.syncMailbox(f.owner, box.id)).imported, 0);
  await f.repo.syncMailbox(f.owner, box.id);
  const messages = (await f.repo.getThread(f.owner, thread.id)).messages;
  assert.equal(messages.length, 1); assert.equal(messages[0].id, messageId);
  assert.deepEqual(messages[0].providerFlags, ['\\Seen', '\\Flagged']);
  assert.equal(messages[0].providerDeleted, true);
  assert.ok((await f.repo.getOriginal(f.owner, messageId)).content.length > 0);
});

test('Canonical email notifications obey preferences, due scheduling, generic text and current source ACL', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f, { kind: 'shared' }), colleague = await f.member(), muted = await f.member();
  await f.repo.setMailboxMember(f.owner, box.id, { userId: colleague.userId, role: 'responder' });
  await f.repo.setMailboxMember(f.owner, box.id, { userId: muted.userId, role: 'reader' });
  await f.repo.setPreferences(muted, { notifications: { enabled: false } });
  const imported = await f.repo.importMessage(f.owner, box.id, { raw: rawMessage() }, command('notify-import'));
  await f.repo.importMessage(f.owner, box.id, { raw: (await f.repo.getOriginal(f.owner, imported.message.id)).content.toString() }, command('notify-import'));
  let notices = await f.store.listNotifications(colleague);
  assert.equal(notices.filter(row => row.type === 'email.received').length, 1);
  assert.equal((await f.store.listNotifications(muted)).length, 0);
  assert.equal(notices[0].emailThreadId, imported.thread.id);
  assert.equal(notices[0].body.includes('Проверяем исходное письмо'), false);
  assert.equal(notices[0].title.includes('Work evidence'), false);
  assert.equal(notices[0].body.includes('client@outside.test'), false);
  const thread = (await f.repo.getThread(f.owner, imported.thread.id)).thread;
  await f.repo.updateThread(f.owner, thread.id, { expectedVersion: thread.version, assignedTo: colleague.userId });
  notices = await f.store.listNotifications(colleague);
  assert.equal(notices.filter(row => row.type === 'email.assigned').length, 1);
  const waiting = await f.repo.createWaiting(f.owner, thread.id, { controllerId: colleague.userId, dueAt: new Date(Date.now() + 60000).toISOString() });
  assert.ok(waiting.waiting.id);
  f.advance(120000);
  await f.repo.processWaiting(); await f.repo.processWaiting();
  notices = await f.store.listNotifications(colleague);
  assert.equal(notices.filter(row => row.type === 'email.waiting_due').length, 1);
  assert.ok((await f.store.attentionSummary(colleague)).unreadNotifications >= 3);
  const noticeId = notices[0].id;
  await f.repo.removeMailboxMember(f.owner, box.id, colleague.userId);
  assert.equal((await f.store.listNotifications(colleague)).filter(row => row.type.startsWith('email.')).length, 0);
  assert.equal((await f.store.attentionSummary(colleague)).unreadNotifications, 0);
  assert.equal(await f.store.markNotificationRead(colleague, noticeId), null);
  assert.equal(await f.store.archiveNotification(colleague, noticeId), null);
  assert.equal(await f.store.markAllNotificationsRead(colleague), 0);
  assert.equal(await f.store.archiveReadNotifications(colleague), 0);
});

test('Email feature disable pauses queued work and hides canonical notifications, then re-enable resumes', { skip: !databaseUrl }, async t => {
  const f = await fixture(t), box = await mailbox(f), pending = await draft(f, box);
  const intent = (await f.repo.createSendIntent(f.owner, pending.id, { expectedVersion: 1 })).sendIntent;
  await f.pool.query("INSERT INTO workspace_features(workspace_id,feature,enabled,updated_by) VALUES($1,'email',false,$2) ON CONFLICT(workspace_id,feature) DO UPDATE SET enabled=false", [f.owner.workspaceId, f.owner.userId]);
  await f.repo.processOutbox(); await f.repo.processSync();
  assert.equal(f.sentCount(), 0);
  assert.equal((await f.pool.query('SELECT status FROM email_send_intents WHERE id=$1', [intent.id])).rows[0].status, 'queued');
  await assert.rejects(f.repo.getDraft(f.owner, pending.id), { code: 'FEATURE_DISABLED' });
  await f.pool.query("UPDATE workspace_features SET enabled=true WHERE workspace_id=$1 AND feature='email'", [f.owner.workspaceId]);
  f.provider.send = async () => ({ status: 'failed', errorCode: 'EMAIL_AUTH_FAILED' });
  await f.repo.processOutbox();
  assert.equal((await f.store.listNotifications(f.owner)).filter(row => row.type === 'email.send_attention').length, 1);
  await f.pool.query("UPDATE workspace_features SET enabled=false WHERE workspace_id=$1 AND feature='email'", [f.owner.workspaceId]);
  assert.equal((await f.store.listNotifications(f.owner)).filter(row => row.type.startsWith('email.')).length, 0);
});
