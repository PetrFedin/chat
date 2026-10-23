import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const password = 'EmailLocalFixture42Password!';
async function request(base, path, { cookie, method = 'GET', body, key } = {}) {
  const response = await fetch(base + path, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  return { status: response.status, headers: response.headers, payload, raw, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}
async function company(base) {
  const result = await request(base, '/api/v1/auth/register-company', { method: 'POST', body: { companyName: 'Email API ' + randomUUID().slice(0, 8), ownerName: 'Owner', email: 'email-api-' + randomUUID() + '@example.test', password } });
  assert.equal(result.status, 201);
  const boot = await request(base, '/api/v1/bootstrap', { cookie: result.cookie });
  return { cookie: result.cookie, session: boot.payload.session };
}
async function invite(base, owner, role = 'member') {
  const invitation = await request(base, '/api/v1/invitations', { cookie: owner.cookie, method: 'POST', body: { email: 'email-api-' + randomUUID() + '@example.test', role } });
  assert.equal(invitation.status, 201);
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted = await request(base, '/api/v1/invitations/accept', { method: 'POST', body: { token, displayName: 'Colleague', password } });
  assert.equal(accepted.status, 201);
  const bootstrap = await request(base, '/api/v1/bootstrap', { cookie: accepted.cookie });
  return { cookie: accepted.cookie, session: bootstrap.payload.session };
}

test('Email HTTP contracts: scoped commands, original downloads, large private attachments and notes ACL', { skip: !databaseUrl, timeout: 120000 }, async t => {
  const app = await createChatServer({ databaseUrl, startMeetingWorker: false });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const owner = await company(base), colleague = await invite(base, owner), guest = await invite(base, owner, 'guest');
  const anonymous = await request(base, '/api/v1/email/bootstrap');
  assert.equal(anonymous.status, 401);
  assert.equal((await request(base, '/api/v1/email/bootstrap', { cookie: guest.cookie })).status, 404);
  let result = await request(base, '/api/v1/mailbox-connections', { cookie: owner.cookie, method: 'POST', key: 'box-http', body: { providerId: 'local', address: 'owner@example.test', label: 'Shared test', kind: 'shared' } });
  assert.equal(result.status, 201);
  const box = result.payload.mailbox;
  assert.equal(box.canSend, false);
  assert.equal((await request(base, '/api/v1/mailbox-connections/' + box.id + '/members', { cookie: owner.cookie, method: 'POST', body: { userId: colleague.session.userId, role: 'responder' } })).status, 200);
  const raw = 'From: Client <client@outside.test>\r\nTo: owner@example.test\r\nSubject: HTTP mail\r\nMessage-ID: <http-' + randomUUID() + '@outside.test>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nOriginal evidence';
  result = await request(base, '/api/v1/mailbox-connections/' + box.id + '/import', { cookie: owner.cookie, method: 'POST', body: { raw }, key: 'import-http' });
  assert.equal(result.status, 201);
  const { thread, message } = result.payload;
  const duplicate = await request(base, '/api/v1/mailbox-connections/' + box.id + '/import', { cookie: owner.cookie, method: 'POST', body: { raw }, key: 'import-http' });
  assert.equal(duplicate.payload.message.id, message.id);
  const original = await request(base, '/api/v1/email/messages/' + message.id + '/original', { cookie: colleague.cookie });
  assert.equal(original.status, 200); assert.equal(original.raw, raw);
  assert.match(original.headers.get('content-disposition'), /^attachment/);
  assert.match(original.headers.get('cache-control'), /no-store/);
  assert.equal(original.headers.get('x-content-type-options'), 'nosniff');
  result = await request(base, '/api/v1/email/drafts', { cookie: owner.cookie, method: 'POST', body: { mailboxId: box.id, subject: 'Draft with private file', text: 'Body' } });
  assert.equal(result.status, 201);
  const draft = result.payload.draft;
  // This intentionally exceeds the application's default 1 MB JSON limit.
  const contentBase64 = Buffer.alloc(1100000, 65).toString('base64');
  result = await request(base, '/api/v1/email/drafts/' + draft.id + '/attachments', { cookie: owner.cookie, method: 'POST', key: 'large-file', body: { name: 'private.bin', mimeType: 'application/octet-stream', contentBase64 } });
  assert.equal(result.status, 201);
  const attachment = result.payload.attachment;
  const downloaded = await request(base, '/api/v1/email/attachments/' + attachment.id + '/content', { cookie: owner.cookie });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.raw.length, 1100000);
  assert.equal(downloaded.headers.get('x-email-scan-status'), 'unscanned');
  assert.equal((await request(base, '/api/v1/files/' + attachment.id + '/content', { cookie: owner.cookie })).status, 404);
  result = await request(base, '/api/v1/email/threads/' + thread.id + '/notes', { cookie: colleague.cookie, method: 'POST', key: 'private-note-http', body: { kind: 'private', text: 'Private colleague thought' } });
  assert.equal(result.status, 201);
  const noteId = result.payload.note.id;
  const ownerThread = await request(base, '/api/v1/email/threads/' + thread.id, { cookie: owner.cookie });
  assert.equal(ownerThread.payload.notes.some(row => row.id === noteId), false);
  assert.equal((await request(base, '/api/v1/mailbox-connections/' + box.id + '/members/' + colleague.session.userId, { cookie: owner.cookie, method: 'DELETE', body: {} })).status, 200);
  const replay = await request(base, '/api/v1/email/threads/' + thread.id + '/notes', { cookie: colleague.cookie, method: 'POST', key: 'private-note-http', body: { kind: 'private', text: 'Private colleague thought' } });
  assert.equal(replay.status, 404, 'early generic idempotency replay must not reveal a revoked private note');
  assert.equal((await request(base, '/api/v1/email/messages/' + message.id + '/original', { cookie: colleague.cookie })).status, 404);
  assert.equal((await request(base, '/api/v1/email/attachments/' + attachment.id + '/content', { cookie: colleague.cookie })).status, 404);
  const boot = await request(base, '/api/v1/email/bootstrap', { cookie: owner.cookie });
  assert.equal(boot.status, 200);
  assert.equal(boot.payload.capabilities.durable, true);
  assert.equal(boot.payload.capabilities.canSend, false);
  assert.ok(Array.isArray(boot.payload.providers));
});
