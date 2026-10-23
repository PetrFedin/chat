import { json, readJson, readBuffer } from './helpers.js';
import { emailError } from '../email/email-repository.js';

const ID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const route = suffix => new RegExp('^/api/v1/email/' + suffix + '$', 'i');
const connectionRoute = suffix => new RegExp('^/api/v1/mailbox-connections/' + suffix + '$', 'i');
const CONNECTION = connectionRoute(ID);
const CONNECTION_ACTION = connectionRoute(ID + '/(sync|disconnect|import|members)');
const CONNECTION_MEMBER = connectionRoute(ID + '/members/' + ID);
const THREAD = route('threads/' + ID);
const THREAD_ACTION = route('threads/' + ID + '/(notes|waiting)');
const MESSAGE = route('messages/' + ID);
const MESSAGE_ACTION = route('messages/' + ID + '/(original|resource-links|task-links|event-links|page-links|decision-links)');
const DRAFT = route('drafts/' + ID);
const DRAFT_ACTION = route('drafts/' + ID + '/(approve|attachments|send-intents)');
const NOTE = route('notes/' + ID);
const WAITING = route('waiting/' + ID);
const ITEM = route('(labels|templates)/' + ID);
const CONTENT = route('attachments/' + ID + '/content');
const SEND = route('send-intents/' + ID);
const SEND_ACTION = route('send-intents/' + ID + '/(cancel|reconcile)');
const RESOURCE = route('resource-links/(task|event|page|decision)/' + ID);

async function readLargeJson(req, limit) {
  const bytes = await readBuffer(req, limit);
  let value;
  try { value = bytes.length ? JSON.parse(bytes.toString('utf8')) : {}; }
  catch { throw emailError('Некорректный JSON', 'INVALID_JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw emailError('Нужен JSON-объект', 'INVALID_JSON');
  return value;
}

function content(res, file) {
  const filename = String(file.name ?? 'attachment').replace(/[\r\n\0"]/g, '').slice(0, 200);
  res.writeHead(200, {
    'Content-Type': file.mimeType || 'application/octet-stream',
    'Content-Length': file.content.length,
    'Content-Disposition': 'attachment; filename="download"; filename*=UTF-8\'\'' + encodeURIComponent(filename),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
    ...(file.scanStatus ? { 'X-Email-Scan-Status': file.scanStatus } : {}),
  });
  res.end(file.content);
}

/** Email commands deliberately bypass the application's early replay cache.
 * Repository methods check current membership/mailbox ACL before command keys. */
export function createEmailHandler() {
  return async function handleEmail(req, res, ctx, url, path, method) {
    if (path !== '/api/v1/mailbox-connections' && !path.startsWith('/api/v1/mailbox-connections/') && !path.startsWith('/api/v1/email/')) return false;
    const session = await ctx.requireSession(req), email = ctx.email;
    if (!email?.enabled) throw emailError('Почта недоступна', 'EMAIL_UNAVAILABLE', 503);
    if (session.readOnly && !['GET', 'HEAD'].includes(method)) throw emailError('Ключ разрешает только чтение', 'READ_ONLY_API_KEY', 403);
    const options = { idempotencyKey: req.headers['idempotency-key'] };
    const query = Object.fromEntries(url.searchParams);
    res.setHeader('Cache-Control', 'private, no-store');

    if (path === '/api/v1/email/bootstrap' && method === 'GET') {
      const base = await email.bootstrap(session);
      const extras = await ctx.emailExtras?.status(session) ?? {};
      json(res, 200, { ...base, capabilities: { ...base.capabilities, ...extras } }); return true;
    }
    if (path === '/api/v1/mailbox-connections') {
      if (method === 'GET') { json(res, 200, await email.listMailboxes(session)); return true; }
      if (method === 'POST') { json(res, 201, await email.createMailbox(session, await readJson(req), options)); return true; }
    }
    let match = path.match(CONNECTION_MEMBER);
    if (match && method === 'DELETE') { json(res, 200, await email.removeMailboxMember(session, match[1], match[2], await readJson(req), options)); return true; }
    match = path.match(CONNECTION_ACTION);
    if (match && method === 'POST') {
      const body = match[2] === 'import' ? await readLargeJson(req, 35 * 1024 * 1024) : await readJson(req);
      if (match[2] === 'sync') json(res, 200, await email.syncMailbox(session, match[1], body, options));
      if (match[2] === 'disconnect') json(res, 200, await email.disconnectMailbox(session, match[1], body, options));
      if (match[2] === 'import') json(res, 201, await email.importMessage(session, match[1], body, options));
      if (match[2] === 'members') json(res, 200, await email.setMailboxMember(session, match[1], body, options));
      return true;
    }
    match = path.match(CONNECTION);
    if (match) {
      if (method === 'GET') { json(res, 200, await email.getMailbox(session, match[1])); return true; }
      if (method === 'PATCH') { json(res, 200, await email.updateMailbox(session, match[1], await readJson(req), options)); return true; }
      if (method === 'DELETE') { json(res, 200, await email.deleteMailbox(session, match[1], await readJson(req), options)); return true; }
    }
    if (path === '/api/v1/email/threads' && method === 'GET') { json(res, 200, await email.listThreads(session, query)); return true; }
    match = path.match(THREAD_ACTION);
    if (match && method === 'POST') {
      const body = await readJson(req);
      json(res, 201, match[2] === 'notes' ? await email.createNote(session, match[1], body, options) : await email.createWaiting(session, match[1], body, options)); return true;
    }
    match = path.match(THREAD);
    if (match) {
      if (method === 'GET') { json(res, 200, await email.getThread(session, match[1], query)); return true; }
      if (method === 'PATCH') { json(res, 200, await email.updateThread(session, match[1], await readJson(req), options)); return true; }
    }
    match = path.match(MESSAGE_ACTION);
    if (match) {
      if (match[2] === 'original' && method === 'GET') { content(res, await email.getOriginal(session, match[1])); return true; }
      if (match[2] !== 'original' && method === 'POST') {
        const body = await readJson(req), kind = match[2] === 'resource-links' ? body.kind : match[2].split('-')[0];
        const result = await email.createLinkedResource(session, match[1], kind, match[2] === 'resource-links' ? body.input ?? {} : body.input ?? body, options);
        json(res, 201, result); return true;
      }
    }
    match = path.match(MESSAGE);
    if (match && method === 'GET') { json(res, 200, { message: await email.getMessage(session, match[1]) }); return true; }
    if (path === '/api/v1/email/drafts') {
      if (method === 'GET') { json(res, 200, await email.listDrafts(session, query)); return true; }
      if (method === 'POST') { json(res, 201, await email.createDraft(session, await readJson(req), options)); return true; }
    }
    match = path.match(DRAFT_ACTION);
    if (match && method === 'POST') {
      const body = match[2] === 'attachments' ? await readLargeJson(req, 15 * 1024 * 1024) : await readJson(req);
      if (match[2] === 'approve') json(res, 200, await email.approveDraft(session, match[1], body, options));
      if (match[2] === 'attachments') json(res, 201, await email.attachToDraft(session, match[1], body, options));
      if (match[2] === 'send-intents') json(res, 202, await email.createSendIntent(session, match[1], body, options));
      return true;
    }
    match = path.match(DRAFT);
    if (match) {
      if (method === 'GET') { json(res, 200, await email.getDraft(session, match[1])); return true; }
      if (method === 'PATCH') { json(res, 200, await email.updateDraft(session, match[1], await readJson(req), options)); return true; }
      if (method === 'DELETE') { json(res, 200, await email.deleteDraft(session, match[1], await readJson(req), options)); return true; }
    }
    match = path.match(NOTE);
    if (match && method === 'DELETE') { json(res, 200, await email.deleteNote(session, match[1], await readJson(req), options)); return true; }
    match = path.match(WAITING);
    if (match && method === 'PATCH') { json(res, 200, await email.updateWaiting(session, match[1], await readJson(req), options)); return true; }
    match = path.match(CONTENT);
    if (match && method === 'GET') { content(res, await email.getAttachment(session, match[1])); return true; }
    if (path === '/api/v1/email/send-intents' && method === 'GET') { json(res, 200, await email.listSendIntents(session, query)); return true; }
    match = path.match(SEND_ACTION);
    if (match && method === 'POST') {
      const body = await readJson(req);
      json(res, 200, match[2] === 'cancel' ? await email.cancelSendIntent(session, match[1], body, options) : await email.reconcileSendIntent(session, match[1], body, options)); return true;
    }
    match = path.match(SEND);
    if (match && method === 'GET') { json(res, 200, await email.getSendIntent(session, match[1])); return true; }
    if (path === '/api/v1/email/preferences') {
      if (method === 'GET') { json(res, 200, await email.getPreferences(session)); return true; }
      if (method === 'PUT') { json(res, 200, await email.setPreferences(session, await readJson(req), options)); return true; }
    }
    if (path === '/api/v1/email/labels' || path === '/api/v1/email/templates') {
      const label = path.endsWith('/labels');
      if (method === 'GET') { json(res, 200, label ? await email.listLabels(session) : await email.listTemplates(session)); return true; }
      if (method === 'POST') { json(res, 201, label ? await email.saveLabel(session, null, await readJson(req), options) : await email.saveTemplate(session, null, await readJson(req), options)); return true; }
    }
    match = path.match(ITEM);
    if (match) {
      const label = match[1] === 'labels';
      if (method === 'PATCH') { json(res, 200, label ? await email.saveLabel(session, match[2], await readJson(req), options) : await email.saveTemplate(session, match[2], await readJson(req), options)); return true; }
      if (method === 'DELETE') { json(res, 200, label ? await email.deleteLabel(session, match[2], await readJson(req), options) : await email.deleteTemplate(session, match[2], await readJson(req), options)); return true; }
    }
    match = path.match(RESOURCE);
    if (match && method === 'GET') { json(res, 200, { items: await email.getResourceLinks(session, match[1], match[2]) }); return true; }
    return false;
  };
}
