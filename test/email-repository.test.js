import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/persistence/store.js';
import { createEmailRepository } from '../src/email/email-repository.js';

const eml = ({ messageId = randomUUID() + '@outside.test', from = 'Client <client@outside.test>', subject = 'Проект', references = '', text = 'Согласуем результат', extra = '' } = {}) =>
  'From: ' + from + '\r\nTo: Owner <owner@example.test>\r\nSubject: ' + subject + '\r\nMessage-ID: <' + messageId + '>\r\n' + (references ? 'In-Reply-To: <' + references + '>\r\nReferences: <' + references + '>\r\n' : '') + extra + 'MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n' + text;

async function fixture(options = {}) {
  const store = new MemoryStore();
  const company = await store.createCompany({ companyName: 'Email tests', ownerName: 'Owner', email: 'email-' + randomUUID() + '@example.test', passwordHash: 'x', passwordSalt: 'x' });
  const owner = { userId: company.user.id, organizationId: company.organization.id, workspaceId: company.workspace.id, role: 'owner' };
  function member(role = 'member') {
    const userId = randomUUID();
    store.users.set(userId, { id: userId, email: userId + '@example.test' });
    store.memberships.set(store.membershipKey(owner.workspaceId, userId), { userId, workspaceId: owner.workspaceId, organizationId: owner.organizationId, role });
    return { ...owner, userId, role };
  }
  const repo = createEmailRepository({ store, demo: true, ...options });
  return { repo, store, owner, member };
}

async function mailbox(f, input = {}) {
  return (await f.repo.createMailbox(f.owner, { providerId: 'local', address: 'owner@example.test', ...input })).mailbox;
}

test('Email demo is explicitly nondurable, local import never claims outbound delivery', async () => {
  const f = await fixture(), box = await mailbox(f);
  const bootstrap = await f.repo.bootstrap(f.owner);
  assert.equal(bootstrap.capabilities.mode, 'demo');
  assert.equal(bootstrap.capabilities.durable, false);
  assert.equal(bootstrap.capabilities.canSend, false);
  assert.equal(box.canSend, false);
  assert.equal(box.connectionState, 'local');
  const { draft } = await f.repo.createDraft(f.owner, { mailboxId: box.id, to: [{ address: 'friend@example.test' }], subject: 'Draft', text: 'Not transmitted' });
  await assert.rejects(f.repo.createSendIntent(f.owner, draft.id, { expectedVersion: draft.version }), { code: 'EMAIL_PROVIDER_UNAVAILABLE' });
  assert.deepEqual(await f.repo.processOutbox(), { processed: 0, mode: 'demo' });
});

test('Personal mailbox stays private from workspace admin, colleague, guest and another tenant', async () => {
  const f = await fixture(), box = await mailbox(f);
  const imported = await f.repo.importMessage(f.owner, box.id, { raw: eml({ text: 'Private body' }) });
  for (const actor of [f.member('admin'), f.member(), f.member('guest'), { ...f.owner, workspaceId: randomUUID(), organizationId: randomUUID() }]) {
    await assert.rejects(f.repo.getThread(actor, imported.thread.id), { code: 'EMAIL_NOT_FOUND' });
    await assert.rejects(f.repo.getOriginal(actor, imported.message.id), { code: 'EMAIL_NOT_FOUND' });
    assert.equal(await f.repo.canReadMessage(actor, imported.message.id), false);
  }
  await assert.rejects(f.repo.setMailboxMember(f.owner, box.id, { userId: f.member().userId }), { code: 'EMAIL_PERSONAL_MAILBOX' });
});

test('Shared roles, current ACL before idempotency replay, and expiry disable access', async () => {
  const f = await fixture(), box = await mailbox(f, { kind: 'shared' });
  const reader = f.member(), responder = f.member(), guest = f.member('guest');
  await f.repo.setMailboxMember(f.owner, box.id, { userId: reader.userId, role: 'reader' });
  await f.repo.setMailboxMember(f.owner, box.id, { userId: responder.userId, role: 'responder' });
  await assert.rejects(f.repo.setMailboxMember(f.owner, box.id, { userId: guest.userId }), { code: 'EMAIL_MEMBER_REQUIRED' });
  const imported = await f.repo.importMessage(f.owner, box.id, { raw: eml() });
  assert.equal((await f.repo.getThread(reader, imported.thread.id)).messages.length, 1);
  await assert.rejects(f.repo.createDraft(reader, { mailboxId: box.id, text: 'no' }), { code: 'EMAIL_REPLY_FORBIDDEN' });
  const options = { idempotencyKey: 'shared-note' }, body = { kind: 'internal', text: 'Internal conversation' };
  const created = await f.repo.createNote(responder, imported.thread.id, body, options);
  assert.equal((await f.repo.createNote(responder, imported.thread.id, body, options)).note.id, created.note.id);
  await assert.rejects(f.repo.createNote(responder, imported.thread.id, { ...body, text: 'Different command' }, options), { code: 'IDEMPOTENCY_CONFLICT' });
  await f.repo.removeMailboxMember(f.owner, box.id, responder.userId);
  await assert.rejects(f.repo.createNote(responder, imported.thread.id, body, options), { code: 'EMAIL_NOT_FOUND' });
  const membership = f.store.memberships.get(f.store.membershipKey(reader.workspaceId, reader.userId));
  membership.accessUntil = '2000-01-01T00:00:00.000Z';
  assert.equal(await f.repo.canReadMessage(reader, imported.message.id), false);
});

test('Thread provenance uses exact message references, not name or subject; import is deduplicated', async () => {
  const f = await fixture(), box = await mailbox(f);
  const raw = eml({ messageId: 'root@outside.test', subject: 'Same subject' });
  const first = await f.repo.importMessage(f.owner, box.id, { raw });
  const duplicate = await f.repo.importMessage(f.owner, box.id, { raw });
  assert.equal(duplicate.imported, false);
  assert.equal(duplicate.message.id, first.message.id);
  const unrelated = await f.repo.importMessage(f.owner, box.id, { raw: eml({ subject: 'Same subject' }) });
  assert.notEqual(unrelated.thread.id, first.thread.id);
  const reply = await f.repo.importMessage(f.owner, box.id, { raw: eml({ subject: 'Changed title', references: 'root@outside.test' }) });
  assert.equal(reply.thread.id, first.thread.id);
  const copiedIdDifferentBody = await f.repo.importMessage(f.owner, box.id, { raw: eml({ messageId: 'root@outside.test', subject: 'Same subject', text: 'Different bytes' }) });
  assert.notEqual(copiedIdDifferentBody.message.id, first.message.id);
  const another = await mailbox(f, { address: 'another@example.test' });
  const crossMailboxReply = await f.repo.importMessage(f.owner, another.id, { raw: eml({ references: 'root@outside.test' }) });
  assert.notEqual(crossMailboxReply.thread.id, first.thread.id);
});

test('Private notes are author-only and cannot become external drafts by changing mode', async () => {
  const f = await fixture(), box = await mailbox(f, { kind: 'shared' }), colleague = f.member();
  await f.repo.setMailboxMember(f.owner, box.id, { userId: colleague.userId, role: 'manager' });
  const imported = await f.repo.importMessage(f.owner, box.id, { raw: eml() });
  const secret = await f.repo.createNote(colleague, imported.thread.id, { kind: 'private', text: 'Personal thought' });
  await f.repo.createNote(colleague, imported.thread.id, { kind: 'internal', text: 'Shared thought' });
  assert.deepEqual((await f.repo.getThread(f.owner, imported.thread.id)).notes.map(row => row.text), ['Shared thought']);
  assert.equal((await f.repo.getThread(colleague, imported.thread.id)).notes.length, 2);
  await assert.rejects(f.repo.deleteNote(f.owner, secret.note.id, { expectedVersion: 1 }), { code: 'EMAIL_NOT_FOUND' });
  await assert.rejects(f.repo.getDraft(colleague, secret.note.id), { code: 'EMAIL_NOT_FOUND' });
  assert.equal((await f.repo.listDrafts(colleague)).items.length, 0);
});

test('Draft versions, private drafts, recipient validation and approval invalidation', async () => {
  const f = await fixture(), box = await mailbox(f, { kind: 'shared' }), manager = f.member();
  await f.repo.setMailboxMember(f.owner, box.id, { userId: manager.userId, role: 'manager' });
  let { draft } = await f.repo.createDraft(f.owner, { mailboxId: box.id, to: [{ address: 'client@outside.test' }], text: 'v1' });
  await assert.rejects(f.repo.updateDraft(f.owner, draft.id, { expectedVersion: 0, text: 'stale' }), { code: 'EMAIL_VERSION_CONFLICT' });
  await assert.rejects(f.repo.updateDraft(f.owner, draft.id, { expectedVersion: 1, to: ['x@example.test\r\nBcc: secret@example.test'] }), { code: 'EMAIL_INVALID_ADDRESS' });
  await assert.rejects(f.repo.approveDraft(f.owner, draft.id, { expectedVersion: 1 }), { code: 'EMAIL_APPROVER_MUST_DIFFER' });
  draft = (await f.repo.approveDraft(manager, draft.id, { expectedVersion: 1 })).draft;
  assert.equal(draft.approvedVersion, 1);
  draft = (await f.repo.updateDraft(f.owner, draft.id, { expectedVersion: 1, text: 'v2' })).draft;
  assert.equal(draft.version, 2); assert.equal(draft.approvedVersion, null);
  draft = (await f.repo.updateDraft(f.owner, draft.id, { expectedVersion: 2, shared: false })).draft;
  await assert.rejects(f.repo.getDraft(manager, draft.id), { code: 'EMAIL_NOT_FOUND' });
});

test('Waiting is separate from Task, controlled by member with mail access and evidence in the same thread', async () => {
  const f = await fixture(), box = await mailbox(f);
  const a = await f.repo.importMessage(f.owner, box.id, { raw: eml() });
  const b = await f.repo.importMessage(f.owner, box.id, { raw: eml() });
  await assert.rejects(f.repo.createWaiting(f.owner, a.thread.id, { controllerId: f.member().userId }), { code: 'EMAIL_CONTROLLER_FORBIDDEN' });
  const { waiting } = await f.repo.createWaiting(f.owner, a.thread.id, { externalAddress: 'client@outside.test', dueAt: '2030-05-10T09:00:00+03:00' });
  assert.equal(waiting.dueAt, '2030-05-10T06:00:00.000Z');
  await assert.rejects(f.repo.updateWaiting(f.owner, waiting.id, { expectedVersion: 1, status: 'answered' }), { code: 'EMAIL_EVIDENCE_REQUIRED' });
  await assert.rejects(f.repo.updateWaiting(f.owner, waiting.id, { expectedVersion: 1, status: 'answered', evidenceMessageId: b.message.id }), { code: 'EMAIL_EVIDENCE_MISMATCH' });
  assert.equal((await f.repo.updateWaiting(f.owner, waiting.id, { expectedVersion: 1, status: 'answered', evidenceMessageId: a.message.id })).waiting.status, 'answered');
  assert.equal((await f.store.listTasks(f.owner)).length, 0);
});

test('Read marks are per viewer; label, snooze, assignment and text search remain ACL scoped', async () => {
  const f = await fixture(), box = await mailbox(f, { kind: 'shared' }), reader = f.member();
  await f.repo.setMailboxMember(f.owner, box.id, { userId: reader.userId, role: 'reader' });
  const imported = await f.repo.importMessage(f.owner, box.id, { raw: eml({ text: 'UniqueScopedSearch' }) });
  const { label } = await f.repo.saveLabel(f.owner, null, { name: 'Project', color: 'blue' });
  let thread = (await f.repo.updateThread(f.owner, imported.thread.id, { expectedVersion: imported.thread.version, unread: false, labelIds: [label.id], assignedTo: f.owner.userId, snoozedUntil: '2099-05-10T09:00:00Z' })).thread;
  assert.equal(thread.unread, false);
  assert.equal((await f.repo.getThread(reader, thread.id)).thread.unread, true);
  assert.equal((await f.repo.listThreads(f.owner, { folder: 'inbox' })).items.length, 0);
  assert.equal((await f.repo.listThreads(f.owner, { folder: 'snoozed', labelId: label.id, q: 'uniquescopedsearch' })).items.length, 1);
  await assert.rejects(f.repo.updateThread(f.owner, thread.id, { expectedVersion: thread.version, assignedTo: f.member().userId }), { code: 'EMAIL_ASSIGNEE_FORBIDDEN' });
  await assert.rejects(f.repo.updateThread(f.owner, thread.id, { expectedVersion: thread.version, snoozedUntil: '2030-01-01T10:00' }), { code: 'EMAIL_INVALID_DATE' });
});

test('Email attachments use private storage, preserve exact bytes, carry honest scanning and cannot be stolen into another draft', async () => {
  const f = await fixture(), box = await mailbox(f);
  const { draft } = await f.repo.createDraft(f.owner, { mailboxId: box.id });
  const bytes = Buffer.from('<script>alert("test")</script>');
  const added = await f.repo.attachToDraft(f.owner, draft.id, { name: 'test.html', mimeType: 'text/html', contentBase64: bytes.toString('base64') }, { idempotencyKey: 'upload-one' });
  assert.equal(added.attachment.scanStatus, 'unscanned');
  assert.deepEqual((await f.repo.getAttachment(f.owner, added.attachment.id)).content, bytes);
  await assert.rejects(f.repo.getAttachment(f.member('admin'), added.attachment.id), { code: 'EMAIL_NOT_FOUND' });
  const another = await f.repo.createDraft(f.owner, { mailboxId: box.id });
  await assert.rejects(f.repo.updateDraft(f.owner, another.draft.id, { expectedVersion: 1, attachments: [added.attachment.id] }), { code: 'EMAIL_NOT_FOUND' });
  assert.equal(f.store.files.size, 0);
  const scanned = await fixture({ scanAttachment: async () => 'quarantined' }), otherBox = await mailbox(scanned);
  const otherDraft = await scanned.repo.createDraft(scanned.owner, { mailboxId: otherBox.id });
  const blocked = await scanned.repo.attachToDraft(scanned.owner, otherDraft.draft.id, { name: 'unsafe.bin', contentBase64: 'YWJj' });
  await assert.rejects(scanned.repo.getAttachment(scanned.owner, blocked.attachment.id), { code: 'EMAIL_ATTACHMENT_QUARANTINED' });
});

test('Templates and signatures are persisted; personal template cannot leak through command replay', async () => {
  const f = await fixture(), other = f.member();
  const { template } = await f.repo.saveTemplate(f.owner, null, { name: 'Russian response', text: 'Спасибо', language: 'ru', scope: 'personal' });
  assert.equal((await f.repo.listTemplates(other)).items.length, 0);
  await assert.rejects(f.repo.saveTemplate(other, template.id, { expectedVersion: 1, name: 'Stolen' }), { code: 'EMAIL_NOT_FOUND' });
  await f.repo.setPreferences(f.owner, { signature: 'Owner', language: 'en', notifications: { reply: true } });
  assert.equal((await f.repo.getPreferences(f.owner)).preferences.signature, 'Owner');
  assert.equal((await f.repo.getPreferences(other)).preferences.signature, '');
});

test('Canonical links carry typed provenance, create one resource, and re-check target visibility on replay', async () => {
  const resources = new Map(); let creates = 0; let visible = true;
  const f = await fixture({ linkResources: {
    capabilities: { task: true },
    async task(session, input, { source }) { creates++; assert.equal(source.kind, 'email'); assert.ok(source.messageId); assert.equal(input.sourceMessageId, undefined); const row = { id: randomUUID(), title: input.title }; resources.set(row.id, row); return row; },
    async get(session, kind, resourceId) { return visible ? resources.get(resourceId) : null; },
  } });
  const box = await mailbox(f), imported = await f.repo.importMessage(f.owner, box.id, { raw: eml() });
  const body = { title: 'Canonical Task', confirmDisclosure: true }, options = { idempotencyKey: 'make-task' };
  const a = await f.repo.createLinkedResource(f.owner, imported.message.id, 'task', body, options);
  const b = await f.repo.createLinkedResource(f.owner, imported.message.id, 'task', body, options);
  assert.equal(creates, 1); assert.equal(a.resource.id, b.resource.id);
  assert.equal((await f.repo.getResourceLinks(f.owner, 'task', a.resource.id)).length, 1);
  visible = false;
  await assert.rejects(f.repo.createLinkedResource(f.owner, imported.message.id, 'task', body, options), { code: 'EMAIL_NOT_FOUND' });
  assert.equal((await f.repo.getThread(f.owner, imported.thread.id)).resourceLinks.length, 0);
});

test('Raw HTML is preserved only in original MIME; reader gets plain text and no unsafe HTML', async () => {
  const f = await fixture(), box = await mailbox(f);
  const raw = 'From: attacker@outside.test\r\nTo: owner@example.test\r\nSubject: hostile\r\nMessage-ID: <hostile@outside.test>\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<img src="https://tracker.example/pixel"><script>document.cookie</script><p>Hello</p>';
  const imported = await f.repo.importMessage(f.owner, box.id, { raw });
  assert.equal(imported.message.html, undefined);
  assert.equal(imported.message.htmlAvailable, true);
  assert.equal((await f.repo.getOriginal(f.owner, imported.message.id)).content.toString(), raw);
  assert.equal((await f.repo.listThreads(f.member('admin'), { folder: 'all', q: 'hostile' })).items.length, 0);
});

test('Reader cannot recover hidden Bcc through original MIME of imported outgoing email', async () => {
  const f = await fixture(), box = await mailbox(f, { kind: 'shared' }), reader = f.member();
  await f.repo.setMailboxMember(f.owner, box.id, { userId: reader.userId, role: 'reader' });
  const raw = eml({ from: 'owner@example.test', extra: 'Bcc: private@outside.test\r\n' });
  const imported = await f.repo.importMessage(f.owner, box.id, { raw });
  assert.equal(imported.message.bcc[0].address, 'private@outside.test');
  const view = await f.repo.getMessage(reader, imported.message.id);
  assert.equal(view.bcc, undefined);
  assert.equal(view.hasOriginal, false);
  assert.equal(view.originalRestricted, true);
  await assert.rejects(f.repo.getOriginal(reader, imported.message.id), { code: 'EMAIL_ORIGINAL_FORBIDDEN' });
  assert.equal((await f.repo.getOriginal(f.owner, imported.message.id)).content.toString(), raw);
});

test('Demo notifications use the canonical inbox and retract visibility after mailbox revoke', async () => {
  const f = await fixture(), box = await mailbox(f, { kind: 'shared' }), colleague = f.member();
  await f.repo.setMailboxMember(f.owner, box.id, { userId: colleague.userId, role: 'responder' });
  await f.repo.importMessage(f.owner, box.id, { raw: eml() });
  const notifications = await f.store.listNotifications(colleague);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'email.received');
  await f.repo.removeMailboxMember(f.owner, box.id, colleague.userId);
  assert.equal((await f.store.listNotifications(colleague)).length, 0);
  assert.equal(await f.store.markNotificationRead(colleague, notifications[0].id), null);
});
