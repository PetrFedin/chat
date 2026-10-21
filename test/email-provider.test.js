import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import nodemailer from 'nodemailer';
import { selfSigned } from '../test-support/self-signed.mjs';
import { createEmailSecretBox } from '../src/email/email-secret.js';
import { composeEmail, parseEmail, normalizeEmailAddresses, normalizeMessageId } from '../src/email/email-mime.js';
import {
  createEmailProvider as createProductionEmailProvider, EMAIL_PROVIDER_PRESETS, normalizeEmailConfig,
  isPublicEmailAddress, resolveEmailEndpoint,
} from '../src/email/email-provider.js';

const context = { workspaceId: 'workspace-a', accountId: 'mailbox-a' };
const config = {
  provider: 'custom', email: 'owner@example.com', password: 'test-application-password',
  imap: { host: 'imap.example.com', port: 993, secure: true },
  smtp: { host: 'smtp.example.com', port: 465, secure: true },
};
const lookup = async () => [{ address: '8.8.8.8', family: 4 }];
const payload = {
  messageId: '<stable-intent@example.com>', from: 'owner@example.com',
  to: 'recipient@example.com', subject: 'Проверка', text: 'Письмо из CHATX',
  sentAt: '2026-10-20T12:00:00.000Z',
};
const throwsCode = (fn, code) => assert.throws(fn, error => error.code === code);
const rejectsCode = (fn, code) => assert.rejects(fn, error => error.code === code);
const createEmailProvider = options => createProductionEmailProvider({ imapClientFactory: () => imapDouble(), ...options });

test('mailbox secret encryption is randomized, authenticated and bound to the tenant and mailbox', () => {
  const key = randomBytes(32);
  const box = createEmailSecretBox({ key });
  const secret = { ...config, password: 'synthetic-secret-value' };
  const a = box.encrypt(secret, context), b = box.encrypt(secret, context);
  assert.equal(box.configured, true);
  assert.notEqual(a, b);
  assert.equal(a.includes(secret.password), false);
  assert.deepEqual(box.decrypt(a, context), secret);
  for (const other of [{ ...context, workspaceId: 'workspace-b' }, { ...context, accountId: 'mailbox-b' }]) {
    throwsCode(() => box.decrypt(a, other), 'EMAIL_SECRET_UNREADABLE');
  }
  const tampered = Buffer.from(a.slice(3), 'base64url');
  tampered[tampered.length - 1] ^= 1;
  throwsCode(() => box.decrypt('v1.' + tampered.toString('base64url'), context), 'EMAIL_SECRET_UNREADABLE');
  throwsCode(() => createEmailSecretBox({ key: randomBytes(32) }).decrypt(a, context), 'EMAIL_SECRET_UNREADABLE');
  const rotated = createEmailSecretBox({ key: randomBytes(32).toString('base64'), previousKeys: [key] });
  assert.deepEqual(rotated.decrypt(a, context), secret);
  throwsCode(() => box.encrypt(secret, { accountId: 'mailbox-a' }), 'EMAIL_SECRET_CONTEXT_REQUIRED');
});

test('mailbox credentials cannot be saved or read without a valid encryption key', () => {
  for (const key of ['', 'human-password', randomBytes(31), randomBytes(33), 'x'.repeat(44)]) {
    const box = createEmailSecretBox({ key });
    assert.equal(box.configured, false);
    throwsCode(() => box.encrypt(config, context), 'EMAIL_ENCRYPTION_NOT_CONFIGURED');
    throwsCode(() => box.decrypt('v1.fake', context), 'EMAIL_ENCRYPTION_NOT_CONFIGURED');
  }
});

test('real MIME round-trips Unicode, threading, alternatives and binary attachments while keeping Bcc private', async () => {
  const content = Buffer.from([0, 1, 127, 128, 255, 10, 13]);
  const composed = await composeEmail({
    ...payload, from: { address: 'owner@example.com', name: 'Анна Смирнова' },
    to: '"Фёдор, инженер" <fedor@example.com>, second@example.com',
    cc: [{ address: 'copy@example.com', name: 'Копия' }],
    bcc: ['hidden@example.com', 'second@example.com'],
    subject: 'Договор — версия № 2', text: 'Строка 1\n.Строка 2', html: '<p>Привет <b>команда</b></p>',
    inReplyTo: '<parent@example.com>', references: ['<root@example.com>', '<parent@example.com>'],
    replyTo: 'replies@example.com',
    attachments: [{ name: 'Расчёт.bin', mimeType: 'application/octet-stream', content }],
  });
  assert.deepEqual(composed.envelope.to, ['fedor@example.com', 'second@example.com', 'copy@example.com', 'hidden@example.com']);
  const rawHeaders = composed.raw.toString('utf8').split('\r\n\r\n')[0];
  assert.doesNotMatch(rawHeaders, /^Bcc:/mi);
  assert.doesNotMatch(composed.raw.toString('utf8'), /hidden@example\.com/);
  const parsed = await parseEmail(composed.raw);
  assert.equal(parsed.internetMessageId, payload.messageId);
  assert.equal(parsed.inReplyTo, '<parent@example.com>');
  assert.deepEqual(parsed.references, ['<root@example.com>', '<parent@example.com>']);
  assert.equal(parsed.from.name, 'Анна Смирнова');
  assert.equal(parsed.to[0].name, 'Фёдор, инженер');
  assert.equal(parsed.subject, 'Договор — версия № 2');
  assert.match(parsed.text, /Строка 1\n\.Строка 2/);
  assert.equal(parsed.html, '<p>Привет <b>команда</b></p>');
  assert.equal(parsed.htmlIsUnsafe, true);
  assert.deepEqual(parsed.bcc, []);
  assert.equal(parsed.replyTo[0].address, 'replies@example.com');
  assert.equal(parsed.attachments[0].name, 'Расчёт.bin');
  assert.deepEqual(parsed.attachments[0].content, content);
  assert.equal(parsed.sentAt, payload.sentAt);
  assert.match(parsed.sourceSha256, /^[a-f0-9]{64}$/);
});

test('MIME input cannot inject headers, fetch a URL or read a local attachment path', async () => {
  for (const fields of [
    { subject: 'Subject\r\nBcc: injected@example.com' },
    { to: 'recipient@example.com\r\nBcc: injected@example.com' },
    { from: { address: 'owner@example.com', name: 'Name\nHeader: value' } },
  ]) await assert.rejects(() => composeEmail({ ...payload, ...fields }));
  for (const descriptor of [{ path: '/etc/passwd' }, { href: 'http://127.0.0.1/' }, { raw: 'Content-Type: text/plain' }]) {
    await rejectsCode(() => composeEmail({ ...payload, attachments: [{ ...descriptor, content: Buffer.from('x') }] }), 'EMAIL_ATTACHMENT_SOURCE_FORBIDDEN');
  }
  await rejectsCode(() => composeEmail({ ...payload, messageId: undefined }), 'EMAIL_MESSAGE_ID_REQUIRED');
  await rejectsCode(() => composeEmail({ ...payload, text: 'x'.repeat(2000) }, { maxBytes: 1000 }), 'EMAIL_MESSAGE_TOO_LARGE');
  await rejectsCode(() => parseEmail(Buffer.alloc(1001), { maxBytes: 1000 }), 'EMAIL_MESSAGE_TOO_LARGE');
  assert.equal(normalizeMessageId('bad\n@example.com'), null);
  for (const invalid of ['a@b@example.com', '.a@example.com', 'a..b@example.com']) throwsCode(() => normalizeEmailAddresses({ address: invalid }), 'EMAIL_INVALID_ADDRESS');
  assert.deepEqual(normalizeEmailAddresses('Команда: a@example.com, b@example.com;').map(a => a.address), ['a@example.com', 'b@example.com']);
  assert.equal(normalizeEmailAddresses('user@пример.рф')[0].address, 'user@xn--e1afmkfd.xn--p1ai');
});

test('only public mail endpoints pass the network guard, including IPv6 and mixed DNS answers', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '0.0.0.0', '100.64.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1',
    '198.18.0.1', '192.0.2.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1',
    'fe80::1', '::ffff:127.0.0.1', '64:ff9b::7f00:1', '2001:db8::1', '2002:7f00:1::', '3fff::1', 'ff02::1']) {
    assert.equal(isPublicEmailAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '2606:4700:4700::1111']) assert.equal(isPublicEmailAddress(ip), true, ip);
  await rejectsCode(() => resolveEmailEndpoint(config.smtp, { lookup: async () => [{ address: '8.8.8.8' }, { address: '127.0.0.1' }] }), 'EMAIL_HOST_FORBIDDEN');
  await rejectsCode(() => resolveEmailEndpoint({ host: '169.254.169.254' }), 'EMAIL_HOST_FORBIDDEN');
  for (const host of ['localhost', 'a.internal', 'a.local', 'a.test', 'https://mail.example.com', 'user@mail.example.com', 'fe80::1%eth0']) {
    await rejectsCode(() => resolveEmailEndpoint({ host }), 'EMAIL_INVALID_HOST');
  }
  const resolved = await resolveEmailEndpoint(config.smtp, { lookup });
  assert.equal(resolved.host, '8.8.8.8');
  assert.equal(resolved.servername, 'smtp.example.com');
  assert.equal(resolved.originalHost, 'smtp.example.com');
});

test('provider presets are explicit; OAuth-only providers and plaintext/custom TLS bypasses are rejected', () => {
  assert.equal(EMAIL_PROVIDER_PRESETS.gmail.auth, 'app_password');
  assert.equal(EMAIL_PROVIDER_PRESETS.outlook.supported, false);
  assert.equal(normalizeEmailConfig({ ...config, provider: 'gmail', imap: undefined, smtp: undefined }).imap.host, 'imap.gmail.com');
  throwsCode(() => normalizeEmailConfig({ ...config, provider: 'outlook' }), 'EMAIL_OAUTH_REQUIRED');
  throwsCode(() => normalizeEmailConfig({ ...config, auth: 'oauth2' }), 'EMAIL_OAUTH_REQUIRED');
  throwsCode(() => normalizeEmailConfig({ ...config, provider: 'gmail' }), 'EMAIL_INVALID_CONFIG');
  for (const smtp of [{ host: 'smtp.example.com', port: 25, secure: false }, { ...config.smtp, secure: false }]) {
    throwsCode(() => normalizeEmailConfig({ ...config, smtp }), 'EMAIL_TLS_REQUIRED');
  }
  throwsCode(() => normalizeEmailConfig({ ...config, smtp: { ...config.smtp, tls: { rejectUnauthorized: false } } }), 'EMAIL_INVALID_CONFIG');
  assert.equal(normalizeEmailConfig({ ...config, smtp: { host: 'smtp.example.com', port: 587, secure: false } }).smtp.secure, false);
});

function imapDouble({ items = [], validity = '11', uidNext, folders = [{ path: 'INBOX' }, { path: 'Отправленные', specialUse: '\\Sent' }], search = [] } = {}) {
  const calls = [];
  return {
    calls, mailbox: { exists: items.length, uidValidity: validity, uidNext: uidNext ?? ((items.at(-1)?.uid ?? 0) + 1) },
    on() {}, async connect() { calls.push(['connect']); }, async logout() { calls.push(['logout']); },
    async list() { return folders; },
    async getMailboxLock(folder, options) { calls.push(['lock', folder, options]); return { release() { calls.push(['release']); } }; },
    async fetchAll(range, fields, options) {
      calls.push(['fetchAll', range, fields, options]);
      if (Array.isArray(range)) return items.filter(item => range.includes(item.uid));
      const [start, end] = String(range).split(':').map(Number);
      return options.uid ? items.filter(item => item.uid >= start && item.uid <= end) : items.slice(start - 1, end);
    },
    async fetchOne(id, fields, options) { calls.push(['fetchOne', id, fields, options]); return items.find(item => item.uid === id) ?? false; },
    async search(query, options) { calls.push(['search', query, options]); return search; },
    async append(folder, source, flags, sentAt) {
      calls.push(['append', folder, source, flags, sentAt]);
      return { uid: (items.at(-1)?.uid ?? 0) + 1, uidValidity: validity };
    },
  };
}

async function imapItem(uid, extra = {}) {
  const composed = await composeEmail({ ...payload, messageId: `<incoming-${uid}@example.com>`, text: `Body ${uid}` });
  return {
    uid, size: composed.raw.length, source: composed.raw, internalDate: new Date(payload.sentAt), flags: new Set(['\\Seen']),
    envelope: { messageId: composed.messageId, from: [{ address: config.email }], to: [{ address: 'recipient@example.com' }], subject: payload.subject, date: new Date(payload.sentAt) },
    ...extra,
  };
}

test('verified transport uses pinned addresses, strict TLS and does not invent aliases from a different login', async () => {
  const seen = [], clients = [];
  const provider = createEmailProvider({ lookup,
    imapClientFactory(options) { seen.push(['imap', options]); const client = imapDouble(); clients.push(client); return client; },
    smtpTransportFactory(options) { seen.push(['smtp', options]); return { async verify() {}, close() {} }; },
  });
  const verified = await provider.verify(config);
  assert.equal(verified.capabilities.send, true);
  assert.deepEqual(verified.aliases, [config.email]);
  assert.equal(verified.sentFolder, 'Отправленные');
  const other = await provider.verify({ ...config, username: 'different@example.com' });
  assert.equal(other.capabilities.read, true);
  assert.equal(other.capabilities.send, false);
  assert.deepEqual(other.aliases, []);
  assert.equal(other.fromVerification, 'unverified');
  for (const [kind, options] of seen) {
    assert.equal(options.host, '8.8.8.8');
    assert.equal(options.tls.servername, `${kind}.example.com`);
    assert.equal(options.tls.rejectUnauthorized, true);
    assert.equal(options.tls.minVersion, 'TLSv1.2');
    assert.equal(options.logger, false);
  }
  assert.ok(clients.every(client => client.calls.at(-1)[0] === 'logout'));
});

test('credential authentication never starts if a preset resolves into an internal network', async () => {
  let connections = 0;
  const provider = createEmailProvider({ lookup: async host => [{ address: host.startsWith('smtp') ? '127.0.0.1' : '8.8.8.8' }],
    imapClientFactory() { connections++; }, smtpTransportFactory() { connections++; },
  });
  await rejectsCode(() => provider.verify(config), 'EMAIL_HOST_FORBIDDEN');
  assert.equal(connections, 0);
});

test('IMAP sync imports a bounded initial window, then advances UID cursor without a reversed UID range', async () => {
  const items = await Promise.all([1, 3, 7, 10].map(n => imapItem(n)));
  let client = imapDouble({ items });
  const provider = createEmailProvider({ lookup, imapClientFactory: () => client });
  const initial = await provider.sync(config, { limit: 2 });
  assert.deepEqual(initial.messages.map(m => m.remoteUid), [7, 10]);
  assert.equal(initial.historyLimited, true);
  assert.equal(initial.hasMore, true);
  assert.deepEqual(initial.cursor, { folder: 'INBOX', uidValidity: '11', lastUid: 10, backfillBefore: 7, flagsAfterUid: 0 });
  assert.equal(initial.messages[0].text.trimEnd(), 'Body 7');
  assert.equal(initial.messages[0].providerMessageId, 'imap:INBOX:11:7');
  assert.equal(initial.messages[0].bodyStatus, 'complete');
  assert.equal(client.calls.find(call => call[0] === 'lock')[2].readOnly, true);
  assert.equal(client.calls.find(call => call[0] === 'fetchAll')[1], '3:4');
  client = imapDouble({ items: [...items, await imapItem(14)], uidNext: 15 });
  const update = await provider.sync(config, { cursor: initial.cursor, limit: 2 });
  assert.deepEqual(update.messages.map(m => m.remoteUid), [14, 3]);
  assert.equal(update.cursor.lastUid, 14);
  assert.equal(update.cursor.backfillBefore, 3);
  const fetchCall = client.calls.find(call => call[0] === 'fetchAll');
  assert.equal(fetchCall[1], '11:14');
  assert.equal(fetchCall[3].uid, true);
  const history = await provider.sync(config, { cursor: update.cursor });
  assert.deepEqual(history.messages.map(m => m.remoteUid), [1]);
  assert.equal(history.cursor.lastUid, 14);
  assert.equal(history.cursor.backfillBefore, null);
  assert.equal(history.historyLimited, false);
  assert.equal(history.hasMore, false);
  client.calls.length = 0;
  const noOp = await provider.sync(config, { cursor: history.cursor });
  assert.deepEqual(noOp.messages, []);
  assert.equal(client.calls.some(call => call[0] === 'fetchAll'), false);
});

test('IMAP flags and expunges are bounded deltas scoped to the current folder and UIDVALIDITY', async () => {
  const client = imapDouble({ items: [await imapItem(3, { flags: new Set(['\\Seen', '\\Flagged']) }), await imapItem(4)], uidNext: 5 });
  const provider = createEmailProvider({ lookup, imapClientFactory: () => client });
  const result = await provider.sync(config, {
    cursor: { folder: 'INBOX', uidValidity: '11', lastUid: 4, backfillBefore: null },
    knownMessages: [
      { providerMessageId: 'imap:INBOX:11:1', flags: [] },
      { providerMessageId: 'imap:INBOX:11:3', flags: [] },
      { providerMessageId: 'imap:INBOX:11:4', flags: ['\\Seen'] },
      { providerMessageId: 'imap:INBOX:10:2', flags: [] },
      { providerMessageId: 'imap:Sent:11:2', flags: [] },
    ],
  });
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.changes, [{ providerMessageId: 'imap:INBOX:11:3', remoteUid: 3, folder: 'INBOX', uidValidity: '11', flags: ['\\Flagged', '\\Seen'] }]);
  assert.deepEqual(result.tombstones, [{ providerMessageId: 'imap:INBOX:11:1', remoteUid: 1, folder: 'INBOX', uidValidity: '11', reason: 'expunged' }]);
  assert.equal(result.hasMore, false);
  assert.equal(client.calls.some(call => call[0] === 'fetchOne'), false);
  const items = Array.from({ length: 110 }, (_, index) => ({ uid: index + 1, flags: new Set(['\\Seen']) }));
  const pagedClient = imapDouble({ items });
  const paged = createEmailProvider({ lookup, imapClientFactory: () => pagedClient });
  const knownMessages = items.map(item => ({ providerMessageId: `imap:INBOX:11:${item.uid}`, flags: [] }));
  const first = await paged.sync(config, { cursor: { folder: 'INBOX', uidValidity: '11', lastUid: 110, backfillBefore: null }, knownMessages });
  assert.equal(first.changes.length, 100);
  assert.equal(first.cursor.flagsAfterUid, 100);
  assert.equal(first.hasMore, true);
  const second = await paged.sync(config, { cursor: first.cursor, knownMessages });
  assert.equal(second.changes.length, 10);
  assert.equal(second.cursor.flagsAfterUid, 0);
  assert.equal(second.hasMore, false);
});

test('UIDVALIDITY resets message identity; message and batch limits preserve cursor progress honestly', async () => {
  let client = imapDouble({ items: [await imapItem(2)], validity: '22' });
  const provider = createEmailProvider({ lookup, imapClientFactory: () => client, maxMessageBytes: 1000, maxBatchBytes: 700 });
  const reset = await provider.sync(config, { cursor: { folder: 'INBOX', uidValidity: '11', lastUid: 900 } });
  assert.equal(reset.reset, true);
  assert.equal(reset.messages[0].providerMessageId, 'imap:INBOX:22:2');
  client = imapDouble({ items: [await imapItem(3, { size: 2000 }), await imapItem(4)] });
  const sized = await provider.sync(config);
  assert.equal(sized.messages[0].bodyStatus, 'too_large');
  assert.equal(sized.messages[0].raw, null);
  assert.equal(client.calls.some(call => call[0] === 'fetchOne' && call[1] === 3), false);
  assert.equal(sized.messages[1].bodyStatus, 'complete');
  const a = await imapItem(7), b = await imapItem(8), c = await imapItem(9);
  client = imapDouble({ items: [a, b, c] });
  const bounded = createEmailProvider({ lookup, imapClientFactory: () => client, maxBatchBytes: a.size + 1 });
  const first = await bounded.sync(config);
  assert.deepEqual(first.messages.map(m => m.remoteUid), [7]);
  assert.equal(first.hasMore, true);
  assert.equal(first.cursor.lastUid, 7);
  const next = await bounded.sync(config, { cursor: first.cursor });
  assert.deepEqual(next.messages.map(m => m.remoteUid), [8]);
  assert.equal(next.cursor.lastUid, 8);
});

test('SMTP results preserve stable Message-ID and recipient-specific partial acceptance', async () => {
  const sent = [];
  const provider = createEmailProvider({ lookup, smtpTransportFactory: () => ({
    async sendMail(message) { sent.push(message); return { accepted: ['recipient@example.com'], rejected: ['hidden@example.com'] }; }, close() {},
  }) });
  const result = await provider.send(config, { ...payload, bcc: 'hidden@example.com' });
  assert.equal(result.status, 'provider_accepted');
  assert.equal(result.partial, true);
  assert.equal(result.retryable, false);
  assert.deepEqual(result.rejected, ['hidden@example.com']);
  assert.equal(result.messageId, payload.messageId);
  assert.deepEqual(result.raw, sent[0].raw);
  assert.deepEqual(result.bcc, [{ address: 'hidden@example.com', name: '' }]);
  assert.equal((await parseEmail(sent[0].raw)).internetMessageId, payload.messageId);
  assert.deepEqual(sent[0].envelope.to, ['recipient@example.com', 'hidden@example.com']);
  const disallowed = await provider.send(config, { ...payload, from: 'other@example.com' });
  assert.equal(disallowed.status, 'failed');
  assert.equal(disallowed.phase, 'preflight');
  assert.equal(disallowed.errorCode, 'EMAIL_SENDER_NOT_ALLOWED');
  assert.equal((await provider.send({ ...config, username: 'other@example.com' }, payload)).errorCode, 'EMAIL_SENDER_UNVERIFIED');
  assert.equal(sent.length, 1);
});

test('MIME budget failure is an unsent draft failure, never an unknown provider outcome', async () => {
  let transportCalls = 0;
  const provider = createEmailProvider({ lookup, maxMessageBytes: 1000, smtpTransportFactory() { transportCalls++; } });
  const result = await provider.send(config, { ...payload, attachments: [{ name: 'x.bin', content: Buffer.alloc(2000) }] });
  assert.equal(result.status, 'failed');
  assert.equal(result.phase, 'preflight');
  assert.equal(result.errorCode, 'EMAIL_MESSAGE_TOO_LARGE');
  assert.equal(result.retryable, false);
  assert.equal(transportCalls, 0);
});

test('SMTP acceptance files its exact source in Sent once; Sent failure never changes the send result', async () => {
  let client = imapDouble();
  const provider = createEmailProvider({ lookup, imapClientFactory: () => client,
    smtpTransportFactory: () => ({ async sendMail() { return { accepted: ['recipient@example.com'] }; }, close() {} }),
  });
  const saved = await provider.send(config, payload);
  assert.equal(saved.status, 'provider_accepted');
  assert.equal(saved.sentCopy.status, 'saved');
  const appended = client.calls.find(call => call[0] === 'append');
  assert.equal(appended[1], 'Отправленные');
  assert.deepEqual(appended[2], saved.raw);
  assert.equal((await parseEmail(appended[2])).internetMessageId, payload.messageId);
  client = imapDouble({ items: [await imapItem(5, { envelope: { messageId: payload.messageId, from: [{ address: config.email }] } })], search: [5] });
  const present = await provider.send(config, payload);
  assert.equal(present.sentCopy.status, 'already_present');
  assert.equal(client.calls.some(call => call[0] === 'append'), false);
  client = imapDouble();
  client.append = async () => { throw new Error('Connection closed after APPEND'); };
  const failedArchive = await provider.send(config, payload);
  assert.equal(failedArchive.status, 'provider_accepted');
  assert.equal(failedArchive.retryable, false);
  assert.equal(failedArchive.sentCopy.status, 'unknown');
  client = imapDouble();
  const delegated = await provider.send({ ...config, sentCopyMode: 'provider' }, payload);
  assert.equal(delegated.status, 'provider_accepted');
  assert.equal(delegated.sentCopy.status, 'provider_pending');
  assert.equal(client.calls.some(call => call[0] === 'append'), false);
});

test('SMTP explicit rejection permits only safe retry, while disconnect or timeout stays unknown', async () => {
  for (const [error, status, retryable] of [
    [{ code: 'EENVELOPE', responseCode: 451 }, 'failed', true],
    [{ code: 'EENVELOPE', responseCode: 550 }, 'failed', false],
    [{ code: 'EMESSAGE', responseCode: 554 }, 'failed', false],
    [{ code: 'EAUTH', responseCode: 535 }, 'failed', false],
    [{ code: 'ESOCKET', originalCode: 'ECONNREFUSED' }, 'failed', true],
    [{ code: 'ECONNECTION', command: 'CONN' }, 'unknown_outcome', false],
    [{ code: 'ETIMEDOUT', command: 'CONN' }, 'unknown_outcome', false],
    [{ code: 'ESOCKET', originalCode: 'ECONNRESET' }, 'unknown_outcome', false],
  ]) {
    const provider = createEmailProvider({ lookup, smtpTransportFactory: () => ({
      async sendMail() { throw Object.assign(new Error('synthetic secret must not escape'), error); }, close() {},
    }) });
    const result = await provider.send(config, payload);
    assert.equal(result.status, status, JSON.stringify(error));
    assert.equal(result.retryable, retryable, JSON.stringify(error));
    assert.equal(JSON.stringify(result).includes('synthetic secret'), false);
  }
});

test('Sent reconciliation needs an exact Message-ID and sender; an empty search never authorizes retry', async () => {
  let client = imapDouble({ items: [await imapItem(2, { envelope: { messageId: '<prefix-stable-intent@example.com>', from: [{ address: config.email }] } })], search: [2] });
  const provider = createEmailProvider({ lookup, imapClientFactory: () => client });
  const miss = await provider.reconcileSent(config, { messageId: payload.messageId, since: payload.sentAt });
  assert.equal(miss.status, 'not_found');
  assert.equal(miss.retryable, false);
  client = imapDouble({ items: [await imapItem(3, { envelope: { messageId: payload.messageId, from: [{ address: 'different@example.com' }] } })], search: [3] });
  assert.equal((await provider.reconcileSent(config, { messageId: payload.messageId })).found, false);
  client = imapDouble({ items: [await imapItem(4, { envelope: { messageId: payload.messageId, from: [{ address: config.email }] } })], search: [4] });
  const found = await provider.reconcileSent(config, { messageId: payload.messageId });
  assert.equal(found.status, 'provider_accepted');
  assert.equal(found.found, true);
  assert.equal(found.evidence, 'imap_sent');
  assert.match(found.providerMessageId, /:11:4$/);
  client = imapDouble({ folders: [{ path: 'INBOX' }] });
  const noFolder = await provider.reconcileSent(config, { messageId: payload.messageId });
  assert.equal(noFolder.status, 'unknown_outcome');
  assert.equal(noFolder.found, null);
  assert.equal(noFolder.retryable, false);
});

// The production provider keeps its public-host guard. Only this trusted factory
// substitutes a controlled loopback server, with an explicitly trusted test CA.
async function controlledSmtp(t, { implicit = true, offerTls = true, dropAfterData = false, responseCode = 250 } = {}) {
  const certificate = selfSigned();
  const sessions = [], sockets = new Set();
  const serve = (socket, session, { encrypted, greet }) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = '', readingData = false, data = '';
    if (greet) socket.write('220 controlled.example.com ESMTP\r\n');
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n');
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (readingData) {
          if (line === '.') {
            session.raw = Buffer.from(data); readingData = false;
            if (dropAfterData) socket.destroy();
            else socket.write(`${responseCode} ${responseCode === 250 ? '2.0.0 queued' : '5.7.1 rejected'}\r\n`);
          } else data += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
          continue;
        }
        if (!line) continue;
        session.commands.push(line);
        if (!encrypted) session.plain.push(line);
        const command = line.split(' ')[0].toUpperCase();
        if (command === 'EHLO') socket.write('250-controlled.example.com\r\n250-AUTH PLAIN\r\n'
          + (!encrypted && offerTls ? '250-STARTTLS\r\n' : '') + '250 SIZE 52428800\r\n');
        else if (command === 'STARTTLS' && offerTls) {
          socket.write('220 start TLS\r\n'); socket.removeAllListeners('data'); buffer = '';
          const secured = new tls.TLSSocket(socket, { isServer: true, key: certificate.key, cert: certificate.cert });
          serve(secured, session, { encrypted: true, greet: false });
          return;
        } else if (command === 'STARTTLS') socket.write('502 TLS unavailable\r\n');
        else if (command === 'AUTH') socket.write(encrypted ? '235 authenticated\r\n' : '535 must use TLS\r\n');
        else if (command === 'MAIL' || command === 'RCPT' || command === 'RSET') socket.write('250 OK\r\n');
        else if (command === 'DATA') { readingData = true; socket.write('354 send data\r\n'); }
        else if (command === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('502 unsupported\r\n');
      }
    });
  };
  const open = socket => { const session = { commands: [], plain: [], raw: null }; sessions.push(session); serve(socket, session, { encrypted: implicit, greet: true }); };
  const server = implicit ? tls.createServer(certificate, open) : net.createServer(open);
  server.on('tlsClientError', () => {});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const factory = options => nodemailer.createTransport({
    ...options, host: '127.0.0.1', port: server.address().port,
    tls: { ...options.tls, servername: undefined, ca: certificate.cert },
  });
  return { sessions, factory, certificate };
}

test('real SMTP over verified TLS transports multiple recipients and full MIME without exposing Bcc', { timeout: 20000 }, async t => {
  const smtp = await controlledSmtp(t);
  const provider = createEmailProvider({ lookup, smtpTransportFactory: smtp.factory, connectionTimeout: 3000, socketTimeout: 3000 });
  const binary = Buffer.concat([Buffer.from([0, 255, 128]), Buffer.alloc(65536, 97)]);
  const result = await provider.send(config, { ...payload, to: ['recipient@example.com', 'second@example.com'],
    cc: 'copy@example.com', bcc: 'hidden@example.com', text: 'Первый абзац\n.Линия с точкой\nКонец',
    attachments: [{ name: 'данные.bin', mimeType: 'application/octet-stream', content: binary }],
  });
  assert.equal(result.status, 'provider_accepted');
  assert.equal(result.partial, false);
  const session = smtp.sessions[0];
  assert.deepEqual(session.plain, []);
  assert.equal(session.commands.filter(command => command.startsWith('RCPT TO:')).length, 4);
  assert.ok(session.commands.includes('RCPT TO:<hidden@example.com>'));
  assert.doesNotMatch(session.raw.toString('utf8'), /hidden@example\.com/);
  const parsed = await parseEmail(session.raw);
  assert.equal(parsed.internetMessageId, payload.messageId);
  assert.match(parsed.text, /\n\.Линия с точкой/);
  assert.deepEqual(parsed.attachments[0].content, binary);
});

test('real SMTP STARTTLS precedes credentials, and refusal of TLS sends no authentication', { timeout: 20000 }, async t => {
  const smtp = await controlledSmtp(t, { implicit: false });
  const provider = createEmailProvider({ lookup, smtpTransportFactory: smtp.factory, connectionTimeout: 3000, socketTimeout: 3000 });
  const startTlsConfig = { ...config, smtp: { host: 'smtp.example.com', port: 587, secure: false } };
  assert.equal((await provider.send(startTlsConfig, payload)).status, 'provider_accepted');
  assert.deepEqual(smtp.sessions[0].plain.map(line => line.split(' ')[0]), ['EHLO', 'STARTTLS']);
  const noTls = await controlledSmtp(t, { implicit: false, offerTls: false });
  const refused = await createEmailProvider({ lookup, smtpTransportFactory: noTls.factory, connectionTimeout: 3000, socketTimeout: 3000 }).send(startTlsConfig, payload);
  assert.equal(refused.status, 'failed');
  assert.equal(noTls.sessions[0].commands.some(line => line.startsWith('AUTH')), false);
  assert.equal(noTls.sessions[0].raw, null);
});

test('real SMTP dropped final acknowledgement stays unknown; explicit DATA rejection is a known failure', { timeout: 20000 }, async t => {
  const smtp = await controlledSmtp(t, { dropAfterData: true });
  const provider = createEmailProvider({ lookup, smtpTransportFactory: smtp.factory, connectionTimeout: 3000, socketTimeout: 3000 });
  const unknown = await provider.send(config, payload);
  assert.ok(smtp.sessions[0].raw);
  assert.equal(unknown.status, 'unknown_outcome');
  assert.equal(unknown.retryable, false);
  const rejecting = await controlledSmtp(t, { responseCode: 554 });
  const result = await createEmailProvider({ lookup, smtpTransportFactory: rejecting.factory, connectionTimeout: 3000, socketTimeout: 3000 }).send(config, payload);
  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, false);
  assert.equal(result.responseCode, 554);
});
