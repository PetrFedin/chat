import { createHash, randomUUID } from 'node:crypto';
import { parseEmail, composeEmail, normalizeEmailAddresses, normalizeMessageId } from './email-mime.js';
import { EMAIL_PROVIDER_PRESETS } from './email-provider.js';
import { prepareEmailNotifications, insertEmailNotifications } from './email-notifications.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_SEND = new Set(['queued', 'scheduled', 'dispatching', 'unknown_outcome']);
const ADMIN_ROLES = new Set(['owner', 'admin']);
const MAX_ATTACHMENT = 10 * 1024 * 1024;
const MAX_TEXT = 200000;
const TABLES = {
  mailboxes: ['email_mailboxes', { owner_id: 'ownerId', kind: 'kind', address: 'address', provider_id: 'providerId', deleted_at: 'deletedAt', version: 'version' }],
  members: ['email_mailbox_members', { mailbox_id: 'mailboxId', user_id: 'userId', role: 'role', revoked_at: 'revokedAt' }],
  threads: ['email_threads', { mailbox_id: 'mailboxId' }],
  messages: ['email_messages', { mailbox_id: 'mailboxId', thread_id: 'threadId', provider_message_id: 'providerMessageId', internet_message_id: 'internetMessageId', raw_sha256: 'rawSha256', deleted_at: 'deletedAt' }],
  drafts: ['email_drafts', { mailbox_id: 'mailboxId', thread_id: 'threadId' }],
  notes: ['email_notes', { mailbox_id: 'mailboxId', thread_id: 'threadId', author_id: 'authorId', kind: 'kind' }],
  waiting: ['email_waiting', { mailbox_id: 'mailboxId', thread_id: 'threadId', controller_id: 'controllerId' }],
  labels: ['email_labels', {}],
  templates: ['email_templates', {}],
  preferences: ['email_preferences', { user_id: 'userId' }],
  attachments: ['email_attachments', { mailbox_id: 'mailboxId' }],
  resourceLinks: ['email_resource_links', { mailbox_id: 'mailboxId', message_id: 'messageId', resource_kind: 'kind', resource_id: 'resourceId' }],
  commands: ['email_commands', { actor_id: 'actorId', command_key: 'commandKey' }],
  sendIntents: ['email_send_intents', { mailbox_id: 'mailboxId', draft_id: 'draftId', actor_id: 'actorId', status: 'status' }],
};
const freshState = () => Object.fromEntries(Object.keys(TABLES).map(key => [key, new Map()]));
const values = map => [...map.values()];
const clone = value => structuredClone(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
};
export const emailError = (message, code = 'EMAIL_INVALID_REQUEST', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode, expose: true });
const missing = () => emailError('Письмо или почтовый ящик недоступны', 'EMAIL_NOT_FOUND', 404);
const conflict = () => emailError('Запись изменилась. Обновите её и повторите действие', 'EMAIL_VERSION_CONFLICT', 409);
const id = value => {
  if (!UUID.test(String(value ?? ''))) throw emailError('Некорректный идентификатор');
  return String(value);
};
const text = (value, limit = MAX_TEXT, allowEmpty = true) => {
  if (typeof value !== 'string' || value.includes('\0') || value.length > limit || (!allowEmpty && !value.trim())) throw emailError('Проверьте длину и содержимое текста');
  return value;
};
const header = (value, limit = 2000) => {
  const result = text(String(value ?? ''), limit);
  if (/[\r\n\x00-\x1f\x7f]/.test(result)) throw emailError('Заголовок содержит недопустимые символы');
  return result;
};
const date = (value, allowNull = true) => {
  if ((value === null || value === '') && allowNull) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) throw emailError('Укажите дату со смещением часового пояса', 'EMAIL_INVALID_DATE');
  return new Date(value).toISOString();
};
const sameAddress = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const mailboxAddress = value => {
  const result = normalizeEmailAddresses(value, { max: 1 });
  if (result.length !== 1) throw emailError('Укажите один почтовый адрес', 'EMAIL_INVALID_ADDRESS');
  return result[0].address;
};
const expect = (row, version) => {
  if (!Number.isInteger(Number(version)) || Number(version) !== row.version) throw conflict();
};
const safeProviderError = error => {
  const code = /^EMAIL_[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'EMAIL_PROVIDER_ERROR';
  return emailError('Не удалось выполнить действие у почтового провайдера. Проверьте подключение', code, 503);
};

/**
 * Product email owns only email data and typed source links. The callbacks in
 * linkResources create canonical ChatX objects within the same DB transaction.
 * Demo mode deliberately persists only for this process and never implies a
 * configured mailbox. Postgres metadata is indexed separately from MIME bytes.
 */
export function createEmailRepository(options = {}) {
  return new EmailRepository(options);
}

class EmailRepository {
  constructor({ pool = null, store = null, provider = null, secretBox = null, linkResources = {}, routingRules = null, features = null, clock = () => new Date(), demo = !pool, scanAttachment = null, undoMs = 10000, sendLeaseMs = 120000 } = {}) {
    this.pool = pool;
    this.store = store;
    this.provider = provider;
    this.secretBox = secretBox;
    this.linkResources = linkResources;
    this.routingRules = routingRules;
    this.features = features;
    this.clock = clock;
    this.mode = pool ? 'postgres' : 'demo';
    this.durable = Boolean(pool);
    this.enabled = Boolean(pool || demo);
    this.scanAttachment = scanAttachment;
    this.undoMs = Math.max(0, Math.min(60000, Number(undoMs) || 0));
    this.sendLeaseMs = Math.max(1000, Number(sendLeaseMs) || 120000);
    this.states = new Map();
    this.locks = new Map();
    this.metrics = { dispatched: 0, accepted: 0, unknown: 0, failed: 0, synced: 0 };
    if (!this.pool && this.store) this.store.canReadEmailNotification = (session, notification) => this.canReadNotification(session, notification);
  }

  now() { return new Date(this.clock()).toISOString(); }

  async _member(session, userId, client) {
    if (client) {
      const { rows } = await client.query(
        'SELECT m.user_id "userId",m.role,m.access_until "accessUntil",u.disabled_at "disabledAt" FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.workspace_id=$2 AND m.user_id=$3 FOR SHARE OF m,u',
        [session.organizationId, session.workspaceId, userId],
      );
      return rows[0] ?? null;
    }
    if (this.store?.memberships) {
      const membership = values(this.store.memberships).find(row => row.workspaceId === session.workspaceId && row.userId === userId && row.organizationId === session.organizationId);
      const user = this.store.users?.get(userId);
      return membership ? { ...membership, disabledAt: user?.disabledAt } : null;
    }
    if (this.store?.listPeople) {
      const person = (await this.store.listPeople(session)).find(row => row.userId === userId);
      return person ? { ...person, disabledAt: person.active === false ? this.now() : null } : null;
    }
    // Isolated demo/test repositories may use an explicit session as identity.
    return userId === session.userId ? { userId, role: session.role, accessUntil: session.accessUntil, disabledAt: session.disabledAt } : null;
  }

  _active(member) {
    return Boolean(member && member.role !== 'guest' && !member.disabledAt && (!member.accessUntil || Date.parse(member.accessUntil) > Date.parse(this.now())));
  }

  async _authorizeSession(session, client, { write = false } = {}) {
    if (!this.enabled) throw emailError('Почта недоступна', 'EMAIL_UNAVAILABLE', 503);
    if (!session?.userId || !session.workspaceId || !session.organizationId) throw missing();
    if (write && session.readOnly) throw emailError('Ключ разрешает только чтение', 'READ_ONLY_API_KEY', 403);
    const member = await this._member(session, session.userId, client);
    if (!this._active(member)) throw missing();
    if (client) {
      await client.query('SELECT id FROM workspaces WHERE id=$1 FOR SHARE', [session.workspaceId]);
      const { rows } = await client.query("SELECT enabled FROM workspace_features WHERE workspace_id=$1 AND feature='email'", [session.workspaceId]);
      if (rows[0]?.enabled === false) throw emailError('Почта отключена в настройках компании', 'FEATURE_DISABLED', 403);
    } else if (this.features && !(await this.features.isEnabled(session.workspaceId, 'email'))) throw emailError('Почта отключена в настройках компании', 'FEATURE_DISABLED', 403);
    return { ...session, role: member.role };
  }

  async _load(session, client) {
    const state = freshState();
    // All selects are tenant-scoped. MIME and attachment bytes remain outside
    // these metadata reads and are fetched only by an authorized content path.
    for (const [key, [table]] of Object.entries(TABLES)) {
      const { rows } = await client.query('SELECT data FROM ' + table + ' WHERE organization_id=$1 AND workspace_id=$2', [session.organizationId, session.workspaceId]);
      state[key] = new Map(rows.map(row => [row.data.id, row.data]));
    }
    return state;
  }

  async _save(session, before, state, client) {
    for (const [key, [table, fields]] of Object.entries(TABLES)) {
      for (const row of state[key].values()) {
        if (JSON.stringify(before[key].get(row.id)) === JSON.stringify(row)) continue;
        const persisted = { ...row };
        const extra = {};
        if (key === 'messages' && Object.hasOwn(persisted, 'rawBase64')) { extra.raw_mime = Buffer.from(persisted.rawBase64, 'base64'); delete persisted.rawBase64; }
        if (key === 'attachments' && Object.hasOwn(persisted, 'contentBase64')) { extra.content = Buffer.from(persisted.contentBase64, 'base64'); delete persisted.contentBase64; }
        const columns = ['id', 'organization_id', 'workspace_id', ...Object.keys(fields), ...Object.keys(extra), 'data'];
        const params = [row.id, session.organizationId, session.workspaceId, ...Object.values(fields).map(field => row[field] ?? null), ...Object.values(extra), persisted];
        const setters = columns.filter(col => !['id', 'organization_id', 'workspace_id'].includes(col)).map(col => col + '=EXCLUDED.' + col).join(',');
        await client.query('INSERT INTO ' + table + '(' + columns.join(',') + ') VALUES(' + params.map((_, i) => '$' + (i + 1)).join(',') + ') ON CONFLICT(id) DO UPDATE SET ' + setters + ' WHERE ' + table + '.workspace_id=EXCLUDED.workspace_id AND ' + table + '.organization_id=EXCLUDED.organization_id', params);
      }
    }
  }

  async _withState(session, callback, { write = false, client: externalClient = null, system = false } = {}) {
    if (this.pool) {
      const client = externalClient ?? await this.pool.connect();
      try {
        if (!externalClient) await client.query('BEGIN');
        const actor = system ? session : await this._authorizeSession(session, client, { write });
        if (write) {
          await client.query('INSERT INTO email_workspace_locks(organization_id,workspace_id) VALUES($1,$2) ON CONFLICT(workspace_id) DO NOTHING', [session.organizationId, session.workspaceId]);
          await client.query('SELECT workspace_id FROM email_workspace_locks WHERE organization_id=$1 AND workspace_id=$2 FOR UPDATE', [session.organizationId, session.workspaceId]);
        }
        const state = await this._load(actor, client);
        const before = write ? clone(state) : null;
        const result = await callback(state, actor, client);
        if (write) {
          const notifications = await this._notifications(before, state, actor, client);
          await this._save(actor, before, state, client);
          await insertEmailNotifications(client, notifications);
        }
        if (!externalClient) await client.query('COMMIT');
        return result;
      } catch (error) {
        if (!externalClient) await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { if (!externalClient) client.release(); }
    }
    const key = session.workspaceId;
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release;
    const next = new Promise(resolve => { release = resolve; });
    this.locks.set(key, next);
    await previous;
    try {
      const actor = system ? session : await this._authorizeSession(session, null, { write });
      const state = clone(this.states.get(key) ?? freshState());
      const before = write ? clone(state) : null;
      const result = await callback(state, actor, null);
      if (write) {
        const notifications = await this._notifications(before, state, actor, null);
        this.states.set(key, state);
        if (this.store?.dailyNotifications) for (const notification of notifications) {
          if (!values(this.store.dailyNotifications).some(row => row.workspaceId === notification.workspaceId && row.dedupeKey === notification.dedupeKey)) this.store.dailyNotifications.set(notification.id, notification);
        }
      }
      return result;
    } finally { release(); if (this.locks.get(key) === next) this.locks.delete(key); }
  }

  _role(state, session, mailbox) {
    if (!mailbox || mailbox.deletedAt || mailbox.workspaceId !== session.workspaceId || mailbox.organizationId !== session.organizationId) return null;
    if (mailbox.ownerId === session.userId) return 'manager';
    if (mailbox.kind !== 'shared') return null;
    return values(state.members).find(member => member.mailboxId === mailbox.id && member.userId === session.userId && !member.revokedAt)?.role ?? null;
  }

  async _notificationAccess(state, session, userId, source, client) {
    const member = await this._member(session, userId, client);
    if (!this._active(member)) return false;
    const actor = { ...session, userId, role: member.role };
    const mailbox = state.mailboxes.get(source.mailboxId);
    const role = this._role(state, actor, mailbox);
    if (!role) return false;
    if (source.messageId && (!state.messages.has(source.messageId) || state.messages.get(source.messageId).deletedAt)) return false;
    if (source.threadId && (!state.threads.has(source.threadId) || state.threads.get(source.threadId).deletedAt)) return false;
    if (source.sendIntentId) {
      const intent = state.sendIntents.get(source.sendIntentId), draft = intent ? state.drafts.get(intent.draftId) : null;
      if (role === 'reader' || !draft || !draft.shared && draft.authorId !== userId) return false;
    }
    return true;
  }

  async _notifications(before, state, session, client) {
    if (client) {
      const { rows } = await client.query("SELECT enabled FROM workspace_features WHERE workspace_id=$1 AND feature='email'", [session.workspaceId]);
      if (rows[0]?.enabled === false) return [];
    } else if (this.features && !(await this.features.isEnabled(session.workspaceId, 'email'))) return [];
    return prepareEmailNotifications({ before, state, session, now: this.now(), canReadRecipient: (userId, source) => this._notificationAccess(state, session, userId, source, client) });
  }

  async canReadNotification(session, notification) {
    try {
      return await this._withState(session, (state, actor, client) => this._notificationAccess(state, actor, actor.userId, { mailboxId: notification.emailMailboxId, threadId: notification.emailThreadId, messageId: notification.emailMessageId, sendIntentId: notification.emailSendIntentId }, client));
    } catch (error) { if ([403, 404].includes(error.statusCode)) return false; throw error; }
  }

  _mailbox(state, session, mailboxId, action = 'read') {
    const mailbox = state.mailboxes.get(id(mailboxId));
    const role = this._role(state, session, mailbox);
    if (!role) throw missing();
    if (action === 'reply' && !['responder', 'manager'].includes(role)) throw emailError('Для этого действия нужен доступ к ответам', 'EMAIL_REPLY_FORBIDDEN', 403);
    if (action === 'manage' && role !== 'manager') throw emailError('Для этого действия нужен управляющий ящиком', 'EMAIL_MANAGE_FORBIDDEN', 403);
    return mailbox;
  }

  _thread(state, session, threadId, action = 'read') {
    const row = state.threads.get(id(threadId));
    if (!row || row.deletedAt) throw missing();
    this._mailbox(state, session, row.mailboxId, action);
    return row;
  }

  _message(state, session, messageId, action = 'read') {
    const row = state.messages.get(id(messageId));
    if (!row || row.deletedAt) throw missing();
    this._mailbox(state, session, row.mailboxId, action);
    return row;
  }

  _draft(state, session, draftId, action = 'reply') {
    const row = state.drafts.get(id(draftId));
    if (!row || row.deletedAt) throw missing();
    this._mailbox(state, session, row.mailboxId, action);
    if (row.authorId !== session.userId && !row.shared) throw missing();
    return row;
  }

  _record(session, extra = {}) {
    return { id: randomUUID(), organizationId: session.organizationId, workspaceId: session.workspaceId, createdAt: this.now(), updatedAt: this.now(), version: 1, ...extra };
  }

  _touch(row) { row.version += 1; row.updatedAt = this.now(); return row; }

  async _command(state, session, scope, input, options, perform, project = value => value) {
    const key = options?.idempotencyKey ?? input?.commandKey;
    if (!key) return perform();
    if (typeof key !== 'string' || key.length > 200 || !key.trim()) throw emailError('Некорректный ключ команды', 'EMAIL_INVALID_COMMAND_KEY');
    const fingerprint = digest(JSON.stringify(stable({ scope, input })));
    const old = values(state.commands).find(row => row.actorId === session.userId && row.commandKey === key);
    if (old) {
      if (old.fingerprint !== fingerprint) throw emailError('Этот ключ уже использован для другого действия', 'IDEMPOTENCY_CONFLICT', 409);
      return project(clone(old.result), true);
    }
    const result = await perform();
    const record = this._record(session, { actorId: session.userId, commandKey: key, fingerprint, result: clone(result) });
    state.commands.set(record.id, record);
    return result;
  }

  _mailboxView(state, session, mailbox) {
    const role = this._role(state, session, mailbox);
    const canReply = ['responder', 'manager'].includes(role);
    const connected = mailbox.connectionState === 'connected' && !mailbox.paused;
    return {
      id: mailbox.id, label: mailbox.label, address: mailbox.address, kind: mailbox.kind,
      providerId: mailbox.providerId, ownerId: mailbox.ownerId, role,
      connectionState: mailbox.connectionState, paused: Boolean(mailbox.paused),
      version: mailbox.version, signature: mailbox.signature ?? '', requireApproval: Boolean(mailbox.requireApproval),
      aliases: mailbox.aliases ?? [], fromVerification: mailbox.fromVerification ?? 'unverified',
      lastSyncedAt: mailbox.lastSyncedAt ?? null, lastSyncError: mailbox.lastSyncError ?? null,
      historyLimited: Boolean(mailbox.historyLimited), hasMore: Boolean(mailbox.syncHasMore),
      canRead: Boolean(role), canReply, canManage: role === 'manager',
      canManageMembers: role === 'manager' && mailbox.kind === 'shared',
      canSync: role === 'manager' && connected && Boolean(mailbox.providerCapabilities?.read),
      canImport: canReply, canSend: canReply && connected && Boolean(mailbox.providerCapabilities?.send),
      unavailableReason: mailbox.unavailableReason ?? (mailbox.providerId === 'local' ? 'Локальный архив: отправка и синхронизация не подключены' : null),
    };
  }

  _threadView(state, session, thread) {
    const mailbox = this._mailbox(state, session, thread.mailboxId);
    const role = this._role(state, session, mailbox);
    const unread = !(thread.readBy?.[session.userId]) || Date.parse(thread.readBy[session.userId]) < Date.parse(thread.lastMessageAt);
    return {
      id: thread.id, mailboxId: thread.mailboxId, subject: thread.subject,
      preview: thread.preview ?? '', participants: thread.participants ?? [],
      lastMessageAt: thread.lastMessageAt, messageCount: thread.messageCount ?? 0,
      unread, archived: Boolean(thread.archived), snoozedUntil: thread.snoozedUntil ?? null,
      assignedTo: thread.assignedTo ?? null, labelIds: thread.labelIds ?? [], version: thread.version,
      createdAt: thread.createdAt, updatedAt: thread.updatedAt,
      allowedActions: { canRead: true, canReply: role !== 'reader', canNote: role !== 'reader', canAssign: role !== 'reader', canManage: role === 'manager' },
    };
  }

  _attachmentView(row) {
    return { id: row.id, name: row.name, mimeType: row.mimeType, size: row.size, sha256: row.sha256, scanStatus: row.scanStatus, contentId: row.contentId ?? null };
  }

  _messageView(state, session, row) {
    const originalRestricted = this._role(state, session, state.mailboxes.get(row.mailboxId)) === 'reader' && (row.direction === 'outgoing' || row.hasBcc);
    const result = {
      id: row.id, mailboxId: row.mailboxId, threadId: row.threadId, direction: row.direction,
      from: row.from, to: row.to, cc: row.cc, replyTo: row.replyTo ?? [],
      subject: row.subject, text: row.text, sentAt: row.sentAt, receivedAt: row.receivedAt,
      internetMessageId: row.internetMessageId, inReplyTo: row.inReplyTo, references: row.references,
      providerFlags: row.providerFlags ?? [], providerDeleted: Boolean(row.providerDeletedAt),
      sourceKind: row.sourceKind, deliveryStatus: row.deliveryStatus ?? null,
      attachments: (row.attachmentIds ?? []).map(key => state.attachments.get(key)).filter(Boolean).map(item => this._attachmentView(item)),
      hasOriginal: Boolean(row.hasOriginal) && !originalRestricted, originalRestricted, htmlAvailable: Boolean(row.htmlAvailable),
      bodyStatus: row.bodyStatus ?? 'complete', textTruncated: Boolean(row.textTruncated),
    };
    if (row.direction === 'outgoing' && this._role(state, session, state.mailboxes.get(row.mailboxId)) !== 'reader') result.bcc = row.bcc ?? [];
    return result;
  }

  _draftView(state, row) {
    const { organizationId, workspaceId, ...safe } = row;
    return { ...safe, attachments: (row.attachmentIds ?? []).map(key => state.attachments.get(key)).filter(Boolean).map(item => this._attachmentView(item)) };
  }

  _intentView(row) {
    return {
      id: row.id, mailboxId: row.mailboxId, draftId: row.draftId, threadId: row.threadId ?? null,
      subject: row.snapshot.subject, fromAddress: row.snapshot.from?.address ?? null, to: row.snapshot.to, cc: row.snapshot.cc,
      actorId: row.actorId, status: row.status, version: row.version,
      scheduledAt: row.scheduledAt, cancelUntil: row.cancelUntil, messageId: row.internetMessageId,
      providerMessageId: row.providerMessageId ?? null, sentMessageId: row.sentMessageId ?? null,
      lastError: row.lastError ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt,
      acceptedAt: row.acceptedAt ?? null, reconciledAt: row.reconciledAt ?? null,
      partial: Boolean(row.partial), acceptedRecipients: row.acceptedRecipients ?? [], rejectedRecipients: row.rejectedRecipients ?? [],
      sentCopy: row.sentCopy ?? null,
      canCancel: ['queued', 'scheduled'].includes(row.status),
      canReconcile: row.status === 'unknown_outcome',
    };
  }

  _preferences(state, session) {
    return values(state.preferences).find(row => row.userId === session.userId) ?? { signature: '', language: 'ru', notifications: { reply: true, assignment: true, waiting: true, sendFailure: true } };
  }

  async bootstrap(session) {
    return this._withState(session, async (state, actor) => {
      const mailboxes = values(state.mailboxes).filter(row => this._role(state, actor, row)).map(row => this._mailboxView(state, actor, row));
      const threads = values(state.threads).filter(row => this._role(state, actor, state.mailboxes.get(row.mailboxId)) && !row.deletedAt).map(row => this._threadView(state, actor, row));
      const capability = kind => Boolean(this.linkResources[kind] && this.linkResources.capabilities?.[kind] !== false);
      const providerList = typeof this.provider?.listProviders === 'function' ? this.provider.listProviders() : this.provider?.providers ?? Object.entries(EMAIL_PROVIDER_PRESETS).map(([key, value]) => ({ ...value, id: key, label: value.name, configured: Boolean(this.provider && this.secretBox?.configured && this.durable && value.supported !== false), capabilities: { read: value.supported !== false, send: value.supported !== false }, unavailableReason: value.supported === false ? 'Требуется подключение OAuth, оно пока не настроено' : (!this.durable || !this.secretBox?.configured ? 'Администратор должен настроить хранение и ключ шифрования' : null) }));
      return {
        capabilities: {
          mode: this.mode, durable: this.durable, canImport: true,
          canConnect: Boolean(this.provider && this.secretBox?.configured && this.durable),
          canSend: mailboxes.some(row => row.canSend), canCreateTask: capability('task'),
          canLinkTask: capability('task'), canLinkEvent: capability('event'),
          canLinkPage: capability('page'), canProposeDecision: capability('decision'),
          canManageLabels: true, canManageTemplates: true, canAttachFiles: true,
          attachmentScanning: this.scanAttachment ? 'configured' : 'unavailable',
          canReceiveReadReceipts: false,
          notifications: { inbox: true, push: false, quietHours: false },
        },
        providers: [{ id: 'local', label: 'Локальный архив EML', configured: true, capabilities: { read: false, send: false } }, ...await Promise.resolve(providerList)],
        mailboxes,
        summary: {
          inbox: threads.filter(row => !row.archived && (!row.snoozedUntil || Date.parse(row.snoozedUntil) <= Date.parse(this.now()))).length,
          unread: threads.filter(row => row.unread).length,
          drafts: values(state.drafts).filter(row => !row.deletedAt && row.status === 'draft' && this._role(state, actor, state.mailboxes.get(row.mailboxId)) && (row.authorId === actor.userId || row.shared)).length,
          waiting: values(state.waiting).filter(row => row.status === 'waiting' && this._role(state, actor, state.mailboxes.get(row.mailboxId))).length,
        },
        labels: values(state.labels).filter(row => !row.deletedAt),
        templates: values(state.templates).filter(row => !row.deletedAt && (row.scope === 'shared' || row.authorId === actor.userId)),
        preferences: this._preferences(state, actor),
      };
    });
  }

  async listMailboxes(session) { return { items: (await this.bootstrap(session)).mailboxes }; }

  async getMailbox(session, mailboxId) {
    return this._withState(session, (state, actor) => {
      const row = this._mailbox(state, actor, mailboxId);
      return { mailbox: this._mailboxView(state, actor, row), members: this._role(state, actor, row) === 'manager' ? values(state.members).filter(member => member.mailboxId === row.id && !member.revokedAt).map(({ id: memberId, userId, role }) => ({ id: memberId, userId, role })) : [] };
    });
  }

  async createMailbox(session, input = {}, options = {}) {
    await this._withState(session, (_state, actor) => {
      if (actor.viaApiKey) throw emailError('Подключать ящики можно только в личной сессии', 'EMAIL_SESSION_REQUIRED', 403);
    });
    const mailboxId = randomUUID();
    const address = mailboxAddress(input.address);
    const providerId = String(input.providerId ?? 'local');
    const kind = input.kind ?? 'personal';
    if (!['personal', 'shared'].includes(kind)) throw emailError('Неизвестный тип ящика');
    const label = header(input.label || address, 200);
    let verification = { address, aliases: [], capabilities: { read: false, send: false } }, secretEnvelope = null;
    if (providerId !== 'local') {
      if (!this.provider || !this.secretBox?.configured || !this.durable) throw emailError('Для подключения нужна база данных, провайдер и ключ шифрования', 'EMAIL_PROVIDER_UNAVAILABLE', 503);
      const config = { ...(input.config ?? {}), provider: providerId, email: address, displayName: label };
      try { verification = await this.provider.verify(config); }
      catch (error) { throw safeProviderError(error); }
      if (verification.sentFolder) config.sentFolder = verification.sentFolder;
      secretEnvelope = this.secretBox.encrypt(config, { workspaceId: session.workspaceId, accountId: mailboxId });
    }
    // Secret values are deliberately absent from command fingerprints/results.
    const commandInput = { providerId, address, kind, label };
    return this._withState(session, (state, actor) => this._command(state, actor, 'mailbox.create', commandInput, options, () => {
      if (values(state.mailboxes).some(row => !row.deletedAt && row.ownerId === actor.userId && sameAddress(row.address, address) && row.providerId === providerId)) throw emailError('Этот ящик уже подключён', 'EMAIL_MAILBOX_EXISTS', 409);
      const row = this._record(actor, {
        id: mailboxId, ownerId: actor.userId, kind, label, address, providerId, secretEnvelope,
        connectionState: providerId === 'local' ? 'local' : 'connected', paused: false,
        providerCapabilities: verification.capabilities ?? { read: false, send: false },
        aliases: (verification.aliases ?? []).map(item => typeof item === 'string' ? item : item.address).filter(alias => sameAddress(alias, address)),
        fromVerification: verification.fromVerification ?? (verification.capabilities?.send ? 'authenticated_account' : 'unverified'),
        signature: '', requireApproval: false, syncCursor: null, deletedAt: null,
      });
      state.mailboxes.set(row.id, row);
      return { mailbox: this._mailboxView(state, actor, row) };
    }, result => ({ mailbox: this._mailboxView(state, actor, this._mailbox(state, actor, result.mailbox.id)) })), { write: true });
  }

  async updateMailbox(session, mailboxId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const row = this._mailbox(state, actor, mailboxId, 'manage');
      return this._command(state, actor, 'mailbox.update:' + row.id, input, options, () => {
        expect(row, input.expectedVersion);
        if (input.label !== undefined) row.label = header(input.label, 200);
        if (input.signature !== undefined) row.signature = text(input.signature, 10000);
        if (input.requireApproval !== undefined) row.requireApproval = Boolean(input.requireApproval);
        if (input.paused !== undefined) row.paused = Boolean(input.paused);
        this._touch(row);
        return { mailbox: this._mailboxView(state, actor, row) };
      }, () => ({ mailbox: this._mailboxView(state, actor, row) }));
    }, { write: true });
  }

  async disconnectMailbox(session, mailboxId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const row = this._mailbox(state, actor, mailboxId, 'manage');
      return this._command(state, actor, 'mailbox.disconnect:' + row.id, input, options, () => {
        expect(row, input.expectedVersion);
        row.secretEnvelope = null; row.connectionState = 'disconnected'; row.paused = true;
        row.providerCapabilities = { read: false, send: false };
        this._touch(row);
        for (const intent of state.sendIntents.values()) if (intent.mailboxId === row.id && ['queued', 'scheduled'].includes(intent.status)) { intent.status = 'cancelled'; intent.lastError = 'EMAIL_MAILBOX_DISCONNECTED'; this._touch(intent); }
        return { mailbox: this._mailboxView(state, actor, row) };
      }, () => ({ mailbox: this._mailboxView(state, actor, row) }));
    }, { write: true });
  }

  async deleteMailbox(session, mailboxId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const row = this._mailbox(state, actor, mailboxId, 'manage');
      if (row.ownerId !== actor.userId) throw emailError('Удалить подключение может его владелец', 'EMAIL_OWNER_REQUIRED', 403);
      return this._command(state, actor, 'mailbox.delete:' + row.id, input, options, () => {
        expect(row, input.expectedVersion);
        row.deletedAt = this.now(); row.secretEnvelope = null; row.connectionState = 'disconnected';
        this._touch(row);
        for (const intent of state.sendIntents.values()) if (intent.mailboxId === row.id && ['queued', 'scheduled'].includes(intent.status)) { intent.status = 'cancelled'; this._touch(intent); }
        return { deleted: true };
      });
    }, { write: true });
  }

  async setMailboxMember(session, mailboxId, input = {}, options = {}) {
    return this._withState(session, async (state, actor, client) => {
      const mailbox = this._mailbox(state, actor, mailboxId, 'manage');
      if (mailbox.kind !== 'shared') throw emailError('Личный ящик нельзя открыть другим участникам', 'EMAIL_PERSONAL_MAILBOX', 409);
      const userId = id(input.userId), role = input.role ?? 'reader';
      if (!['reader', 'responder', 'manager'].includes(role)) throw emailError('Некорректная роль в ящике');
      if (!this._active(await this._member(actor, userId, client))) throw emailError('Выберите действующего сотрудника компании', 'EMAIL_MEMBER_REQUIRED', 409);
      return this._command(state, actor, 'mailbox.member:' + mailbox.id, input, options, () => {
        let member = values(state.members).find(row => row.mailboxId === mailbox.id && row.userId === userId);
        if (!member) { member = this._record(actor, { mailboxId: mailbox.id, userId, role, revokedAt: null }); state.members.set(member.id, member); }
        else { member.role = role; member.revokedAt = null; this._touch(member); }
        this._touch(mailbox);
        return { member: { id: member.id, userId, role }, mailbox: this._mailboxView(state, actor, mailbox) };
      });
    }, { write: true });
  }

  async removeMailboxMember(session, mailboxId, userId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const mailbox = this._mailbox(state, actor, mailboxId, 'manage');
      id(userId);
      if (userId === mailbox.ownerId) throw emailError('Нельзя удалить владельца ящика', 'EMAIL_OWNER_REQUIRED', 409);
      return this._command(state, actor, 'mailbox.member.remove:' + mailbox.id + ':' + userId, input, options, () => {
        const member = values(state.members).find(row => row.mailboxId === mailbox.id && row.userId === userId && !row.revokedAt);
        if (!member) throw missing();
        member.revokedAt = this.now(); this._touch(member); this._touch(mailbox);
        for (const intent of state.sendIntents.values()) if (intent.mailboxId === mailbox.id && intent.actorId === userId && ['queued', 'scheduled'].includes(intent.status)) { intent.status = 'cancelled'; intent.lastError = 'EMAIL_ACCESS_REVOKED'; this._touch(intent); }
        return { removed: true, mailbox: this._mailboxView(state, actor, mailbox) };
      });
    }, { write: true });
  }

  async _prepareIncoming(message) {
    const prepared = { ...message, attachments: [] };
    for (const item of message.attachments ?? []) {
      const content = Buffer.from(item.content ?? '');
      let scanStatus = 'unscanned';
      if (this.scanAttachment) {
        try {
          const result = await this.scanAttachment({ content, name: item.name, mimeType: item.mimeType });
          scanStatus = ['clean', 'quarantined', 'unscanned'].includes(result?.status ?? result) ? result.status ?? result : 'unscanned';
        } catch { scanStatus = 'unscanned'; }
      }
      prepared.attachments.push({ name: header(item.name || 'attachment', 255).split(/[/\\]/).pop(), mimeType: item.mimeType || 'application/octet-stream', size: content.length, contentBase64: content.toString('base64'), sha256: digest(content), contentId: item.contentId ?? null, scanStatus });
    }
    return prepared;
  }

  _insertMessage(state, session, mailbox, incoming, { sourceKind = 'email', direction = 'incoming', threadId = null, deliveryStatus = null, notificationEligible = true } = {}) {
    const raw = incoming.raw ? Buffer.from(incoming.raw) : null;
    const rawSha256 = raw ? digest(raw) : null;
    const providerMessageId = incoming.providerMessageId ?? null;
    const duplicate = values(state.messages).find(row => row.mailboxId === mailbox.id && !row.deletedAt && ((providerMessageId && (row.providerMessageId === providerMessageId || row.providerAliases?.includes(providerMessageId))) || (rawSha256 && row.rawSha256 === rawSha256)));
    if (duplicate) {
      if (providerMessageId && providerMessageId !== duplicate.providerMessageId) {
        duplicate.providerAliases = [...new Set([...(duplicate.providerAliases ?? []), duplicate.providerMessageId].filter(Boolean))].slice(-100);
        duplicate.providerMessageId = providerMessageId; duplicate.remoteUid = incoming.remoteUid ?? null;
        duplicate.providerFlags = incoming.flags ?? []; duplicate.providerDeletedAt = null; this._touch(duplicate);
      }
      return { message: duplicate, thread: state.threads.get(duplicate.threadId), imported: false };
    }
    const internetMessageId = normalizeMessageId(incoming.internetMessageId ?? incoming.messageId);
    const inReplyTo = normalizeMessageId(incoming.inReplyTo);
    const references = [...new Set((Array.isArray(incoming.references) ? incoming.references : []).map(value => normalizeMessageId(value)).filter(Boolean))].slice(-100);
    // Callers authorize user requests before entering this primitive. A worker
    // must record a provider response even if access was revoked while SMTP ran.
    let thread = threadId ? state.threads.get(threadId) : null;
    if (threadId && (!thread || thread.mailboxId !== mailbox.id || thread.workspaceId !== session.workspaceId)) throw missing();
    // Only provenance in this mailbox can connect a conversation. Subject,
    // sender name and email local-part are never identity or thread keys.
    if (!thread) {
      for (const ref of [inReplyTo, ...references.slice().reverse()].filter(Boolean)) {
        const matches = values(state.messages).filter(row => row.mailboxId === mailbox.id && row.internetMessageId === ref && !row.deletedAt);
        const candidates = [...new Set(matches.map(row => row.threadId))];
        if (candidates.length === 1) { thread = state.threads.get(candidates[0]); break; }
      }
    }
    const occurredAt = incoming.receivedAt && Number.isFinite(Date.parse(incoming.receivedAt)) ? new Date(incoming.receivedAt).toISOString() : this.now();
    if (!thread) {
      thread = this._record(session, { mailboxId: mailbox.id, subject: header(incoming.subject || '(без темы)'), participants: [], preview: '', lastMessageAt: occurredAt, readBy: {}, archived: false, snoozedUntil: null, assignedTo: null, labelIds: [], messageCount: 0 });
      state.threads.set(thread.id, thread);
    }
    const row = this._record(session, {
      mailboxId: mailbox.id, threadId: thread.id, direction, sourceKind, notificationEligible,
      providerMessageId, internetMessageId, inReplyTo, references, remoteUid: incoming.remoteUid ?? null,
      providerFlags: incoming.flags ?? [], providerAliases: [], providerDeletedAt: null,
      from: incoming.from ?? null, to: incoming.to ?? [], cc: incoming.cc ?? [], bcc: direction === 'outgoing' ? incoming.bcc ?? [] : [], hasBcc: Boolean(incoming.bcc?.length),
      replyTo: incoming.replyTo ?? [], subject: header(incoming.subject || ''),
      text: String(incoming.text ?? '').replace(/\0/g, '').slice(0, MAX_TEXT),
      textTruncated: String(incoming.text ?? '').length > MAX_TEXT,
      sentAt: incoming.sentAt && Number.isFinite(Date.parse(incoming.sentAt)) ? new Date(incoming.sentAt).toISOString() : null,
      receivedAt: occurredAt, attachmentIds: [], rawSha256, hasOriginal: Boolean(raw),
      htmlAvailable: Boolean(incoming.html), bodyStatus: incoming.bodyStatus ?? 'complete',
      deliveryStatus, deletedAt: null, ...(raw ? { rawBase64: raw.toString('base64') } : {}),
    });
    for (const item of incoming.attachments ?? []) {
      const attachment = this._record(session, { mailboxId: mailbox.id, messageId: row.id, draftId: null, authorId: null, ...item });
      state.attachments.set(attachment.id, attachment);
      row.attachmentIds.push(attachment.id);
    }
    state.messages.set(row.id, row);
    const participants = [...(thread.participants ?? []), incoming.from, ...(incoming.to ?? []), ...(incoming.cc ?? [])].filter(item => item?.address);
    thread.participants = [...new Map(participants.map(item => [item.address.toLowerCase(), item])).values()].slice(0, 200);
    thread.lastMessageAt = [thread.lastMessageAt, occurredAt].sort().at(-1);
    thread.preview = row.text.replace(/\s+/g, ' ').slice(0, 240);
    thread.messageCount += 1;
    if (direction === 'incoming') { thread.archived = false; thread.snoozedUntil = null; }
    this._touch(thread);
    return { message: row, thread, imported: true };
  }

  async importMessage(session, mailboxId, input = {}, options = {}) {
    await this._withState(session, (state, actor) => this._mailbox(state, actor, mailboxId, 'reply'));
    const parsed = await this._prepareIncoming(await parseEmail(input.raw));
    const commandInput = { rawSha256: parsed.sourceSha256 };
    return this._withState(session, (state, actor, client) => {
      const mailbox = this._mailbox(state, actor, mailboxId, 'reply');
      return this._command(state, actor, 'mailbox.import:' + mailbox.id, commandInput, options, async () => {
        const result = this._insertMessage(state, actor, mailbox, parsed, { sourceKind: 'manual_import', direction: sameAddress(parsed.from?.address, mailbox.address) ? 'outgoing' : 'incoming' });
        await this._applyRouting(state, actor, client, result);
        return { imported: result.imported, thread: this._threadView(state, actor, result.thread), message: this._messageView(state, actor, result.message) };
      }, result => ({ imported: false, thread: this._threadView(state, actor, this._thread(state, actor, result.thread.id)), message: this._messageView(state, actor, this._message(state, actor, result.message.id)) }));
    }, { write: true });
  }

  async syncMailbox(session, mailboxId, input = {}, options = {}) {
    const prepared = await this._withState(session, (state, actor) => {
      const mailbox = this._mailbox(state, actor, mailboxId, 'manage');
      if (mailbox.connectionState !== 'connected' || mailbox.paused || !mailbox.providerCapabilities?.read || !this.provider || !mailbox.secretEnvelope) throw emailError('Синхронизация ящика недоступна', 'EMAIL_PROVIDER_UNAVAILABLE', 503);
      return {
        config: this.secretBox.decrypt(mailbox.secretEnvelope, { workspaceId: actor.workspaceId, accountId: mailbox.id }), version: mailbox.version, cursor: mailbox.syncCursor,
        knownMessages: values(state.messages).filter(row => row.mailboxId === mailbox.id && row.providerMessageId && !row.deletedAt && !row.providerDeletedAt).flatMap(row => [row.providerMessageId, ...(row.providerAliases ?? [])].map(providerMessageId => ({ providerMessageId, remoteUid: providerMessageId === row.providerMessageId ? row.remoteUid : undefined, flags: row.providerFlags }))),
      };
    });
    let batch;
    try { batch = await this.provider.sync(prepared.config, { cursor: prepared.cursor, limit: 50, knownMessages: prepared.knownMessages }); }
    catch (error) {
      await this._withState(session, (state, actor) => {
        const mailbox = this._mailbox(state, actor, mailboxId, 'manage');
        mailbox.lastSyncError = safeProviderError(error).code; this._touch(mailbox);
      }, { write: true });
      throw safeProviderError(error);
    }
    const messages = [];
    for (const incoming of batch.messages ?? []) messages.push(await this._prepareIncoming(incoming));
    return this._withState(session, async (state, actor, client) => {
      const mailbox = this._mailbox(state, actor, mailboxId, 'manage');
      expect(mailbox, prepared.version);
      if (mailbox.connectionState !== 'connected' || mailbox.paused) throw conflict();
      let imported = 0;
      for (const incoming of messages) {
        const result = this._insertMessage(state, actor, mailbox, incoming, { direction: sameAddress(incoming.from?.address, mailbox.address) ? 'outgoing' : 'incoming', notificationEligible: Boolean(prepared.cursor && !batch.reset && (incoming.remoteUid ?? 0) > (prepared.cursor.lastUid ?? 0)) });
        if (result.imported) imported++;
        await this._applyRouting(state, actor, client, result);
      }
      for (const change of batch.changes ?? []) {
        const row = values(state.messages).find(message => message.mailboxId === mailbox.id && (message.providerMessageId === change.providerMessageId || message.providerAliases?.includes(change.providerMessageId)));
        if (row) { row.providerFlags = Array.isArray(change.flags) ? change.flags : []; this._touch(row); }
      }
      for (const tombstone of batch.tombstones ?? []) {
        const row = values(state.messages).find(message => message.mailboxId === mailbox.id && (message.providerMessageId === tombstone.providerMessageId || message.providerAliases?.includes(tombstone.providerMessageId)));
        if (row && row.providerMessageId === tombstone.providerMessageId) {
          // Preserve locally retained evidence and canonical links. Expunge at
          // the provider is a source-state change, not deletion of a Task.
          row.providerDeletedAt = this.now(); this._touch(row);
        }
      }
      mailbox.syncCursor = batch.cursor; mailbox.lastSyncedAt = this.now(); mailbox.lastSyncAttemptAt = this.now(); mailbox.lastSyncError = null;
      mailbox.historyLimited = Boolean(batch.historyLimited);
      mailbox.syncHasMore = Boolean(batch.hasMore);
      mailbox.syncReset = Boolean(batch.reset); this._touch(mailbox); this.metrics.synced += imported;
      return { mailbox: this._mailboxView(state, actor, mailbox), imported, hasMore: Boolean(batch.hasMore), historyLimited: Boolean(batch.historyLimited), reset: Boolean(batch.reset), incompleteMessages: messages.filter(row => row.bodyStatus && row.bodyStatus !== 'complete').length };
    }, { write: true });
  }

  async _applyRouting(state, session, client, result) {
    if (!result.imported || !client || !this.routingRules) return;
    const routed = await this.routingRules({ client, workspaceId: session.workspaceId, mailboxId: result.message.mailboxId, message: result.message });
    const patch = routed?.patch ?? {}, thread = result.thread;
    if (Array.isArray(patch.labelIds)) thread.labelIds = [...new Set([...thread.labelIds, ...patch.labelIds.filter(value => state.labels.has(value) && !state.labels.get(value).deletedAt)])].slice(0, 50);
    if (patch.assigneeId && this._active(await this._member(session, patch.assigneeId, client)) && this._role(state, { ...session, userId: patch.assigneeId }, state.mailboxes.get(thread.mailboxId))) thread.assignedTo = patch.assigneeId;
    if (typeof patch.archived === 'boolean') thread.archived = patch.archived;
    if (patch.snoozedUntil) thread.snoozedUntil = date(patch.snoozedUntil);
    result.message.matchedRuleIds = Array.isArray(routed?.matchedRuleIds) ? routed.matchedRuleIds : [];
  }

  async listThreads(session, query = {}) {
    return this._withState(session, (state, actor) => {
      if (query.mailboxId) this._mailbox(state, actor, query.mailboxId);
      const search = String(query.q ?? '').toLocaleLowerCase().slice(0, 500);
      const now = Date.parse(this.now());
      let items = values(state.threads).filter(row => !row.deletedAt && (!query.mailboxId || row.mailboxId === query.mailboxId) && this._role(state, actor, state.mailboxes.get(row.mailboxId))).map(row => this._threadView(state, actor, row));
      const folder = query.folder ?? 'inbox';
      items = items.filter(row => {
        if (folder === 'unread') return row.unread;
        if (folder === 'archived') return row.archived;
        if (folder === 'snoozed') return row.snoozedUntil && Date.parse(row.snoozedUntil) > now;
        if (folder === 'waiting') return values(state.waiting).some(wait => wait.threadId === row.id && wait.status === 'waiting');
        if (folder === 'drafts') return values(state.drafts).some(draft => draft.threadId === row.id && !draft.deletedAt && draft.status === 'draft' && (draft.authorId === actor.userId || draft.shared));
        if (folder === 'sent') return values(state.messages).some(message => message.threadId === row.id && message.direction === 'outgoing' && !message.deletedAt);
        if (folder === 'all') return true;
        return !row.archived && (!row.snoozedUntil || Date.parse(row.snoozedUntil) <= now);
      });
      if (query.labelId) items = items.filter(row => row.labelIds.includes(query.labelId));
      if (query.assignedTo) items = items.filter(row => row.assignedTo === query.assignedTo);
      if (search) items = items.filter(row => {
        if ((row.subject + ' ' + row.participants.map(p => (p.name ?? '') + ' ' + p.address).join(' ')).toLocaleLowerCase().includes(search)) return true;
        return values(state.messages).some(message => message.threadId === row.id && !message.deletedAt && message.text.toLocaleLowerCase().includes(search));
      });
      items.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || b.id.localeCompare(a.id));
      if (query.cursor) {
        let cursor;
        try { cursor = JSON.parse(Buffer.from(String(query.cursor), 'base64url').toString()); } catch { throw emailError('Некорректный курсор', 'EMAIL_INVALID_CURSOR'); }
        if (typeof cursor.time !== 'string' || !UUID.test(cursor.id ?? '')) throw emailError('Некорректный курсор', 'EMAIL_INVALID_CURSOR');
        items = items.filter(row => row.lastMessageAt < cursor.time || row.lastMessageAt === cursor.time && row.id < cursor.id);
      }
      const limit = Math.min(100, Math.max(1, Math.trunc(Number(query.limit) || 50)));
      const page = items.slice(0, limit), last = page.at(-1);
      return { items: page, nextCursor: items.length > limit ? Buffer.from(JSON.stringify({ time: last.lastMessageAt, id: last.id })).toString('base64url') : null };
    });
  }

  async getMessage(session, messageId, options = {}) {
    return this._withState(session, (state, actor) => this._messageView(state, actor, this._message(state, actor, messageId)), options);
  }

  async canReadMessage(session, messageId, { client = null } = {}) {
    if (!UUID.test(String(messageId ?? ''))) return false;
    if (this.pool) {
      const db = client ?? this.pool;
      const result = await db.query(
        "SELECT 1 FROM email_messages em JOIN email_mailboxes mb ON mb.workspace_id=em.workspace_id AND mb.id=em.mailbox_id JOIN memberships wm ON wm.workspace_id=em.workspace_id AND wm.user_id=$3 JOIN users u ON u.id=wm.user_id WHERE em.organization_id=$1 AND em.workspace_id=$2 AND em.id=$4 AND em.deleted_at IS NULL AND mb.deleted_at IS NULL AND wm.role<>'guest' AND u.disabled_at IS NULL AND (wm.access_until IS NULL OR wm.access_until>now()) AND NOT EXISTS(SELECT 1 FROM workspace_features wf WHERE wf.workspace_id=em.workspace_id AND wf.feature='email' AND wf.enabled=false) AND (mb.owner_id=$3 OR (mb.kind='shared' AND EXISTS(SELECT 1 FROM email_mailbox_members mm WHERE mm.workspace_id=mb.workspace_id AND mm.mailbox_id=mb.id AND mm.user_id=$3 AND mm.revoked_at IS NULL)))",
        [session.organizationId, session.workspaceId, session.userId, messageId],
      );
      return result.rowCount > 0;
    }
    try { await this.getMessage(session, messageId); return true; } catch (error) { if ([403, 404].includes(error.statusCode)) return false; throw error; }
  }

  async _visibleLinks(state, session, messageIds, client) {
    const result = [];
    for (const link of state.resourceLinks.values()) {
      if (link.deletedAt || !messageIds.includes(link.messageId)) continue;
      let target = null;
      try { target = this.linkResources.get ? await this.linkResources.get(session, link.kind, link.resourceId, { client }) : null; }
      catch (error) { if (![403, 404].includes(error.statusCode)) throw error; }
      if (target) result.push({ ...link, sourceKind: 'email', resource: { id: target.id, title: target.title ?? target.name ?? '' } });
    }
    return result;
  }

  async getThread(session, threadId, query = {}) {
    return this._withState(session, async (state, actor, client) => {
      const thread = this._thread(state, actor, threadId);
      const messages = values(state.messages).filter(row => row.threadId === thread.id && !row.deletedAt).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
      const offset = query.messageCursor ? Number(query.messageCursor) : 0;
      if (!Number.isInteger(offset) || offset < 0) throw emailError('Некорректный курсор', 'EMAIL_INVALID_CURSOR');
      const page = messages.slice(offset, offset + 100);
      const resourceLinks = await this._visibleLinks(state, actor, messages.map(row => row.id), client);
      return {
        thread: this._threadView(state, actor, thread), messages: page.map(row => this._messageView(state, actor, row)),
        notes: values(state.notes).filter(row => row.threadId === thread.id && !row.deletedAt && (row.kind === 'internal' || row.authorId === actor.userId)),
        drafts: values(state.drafts).filter(row => row.threadId === thread.id && !row.deletedAt && row.status === 'draft' && (row.authorId === actor.userId || row.shared) && this._role(state, actor, state.mailboxes.get(row.mailboxId)) !== 'reader').map(row => this._draftView(state, row)),
        waiting: values(state.waiting).filter(row => row.threadId === thread.id && !row.deletedAt),
        resourceLinks, taskLinks: resourceLinks.filter(row => row.kind === 'task'),
        sendIntents: values(state.sendIntents).filter(row => row.threadId === thread.id && this._role(state, actor, state.mailboxes.get(row.mailboxId)) !== 'reader' && (row.actorId === actor.userId || state.drafts.get(row.draftId)?.shared)).map(row => this._intentView(row)),
        nextMessageCursor: messages.length > offset + 100 ? String(offset + 100) : null,
      };
    });
  }

  /** Bounded evidence window for explicit assistant requests. Private and
   * internal notes are not silently included in an external mail summary. */
  async getThreadTail(session, threadId, { limit = 30 } = {}) {
    return this._withState(session, (state, actor) => {
      const thread = this._thread(state, actor, threadId);
      const messages = values(state.messages).filter(row => row.threadId === thread.id && !row.deletedAt).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
      const count = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 30)));
      return { thread: this._threadView(state, actor, thread), messages: messages.slice(-count).map(row => this._messageView(state, actor, row)), totalMessages: messages.length, truncated: messages.length > count };
    });
  }

  async updateThread(session, threadId, input = {}, options = {}) {
    return this._withState(session, async (state, actor, client) => {
      const onlyRead = Object.keys(input).every(key => ['unread', 'expectedVersion', 'commandKey'].includes(key));
      const row = this._thread(state, actor, threadId, onlyRead ? 'read' : 'reply');
      return this._command(state, actor, 'thread.update:' + row.id, input, options, async () => {
        expect(row, input.expectedVersion);
        if (input.archived !== undefined) row.archived = Boolean(input.archived);
        if (input.snoozedUntil !== undefined) row.snoozedUntil = date(input.snoozedUntil);
        if (input.unread !== undefined) {
          row.readBy ??= {};
          row.readBy[actor.userId] = input.unread ? null : this.now();
        }
        if (input.assignedTo !== undefined) {
          if (input.assignedTo) {
            const targetId = id(input.assignedTo);
            if (!this._active(await this._member(actor, targetId, client)) || !this._role(state, { ...actor, userId: targetId }, state.mailboxes.get(row.mailboxId))) throw emailError('Ответственным может быть участник этого ящика', 'EMAIL_ASSIGNEE_FORBIDDEN', 409);
            row.assignedTo = targetId;
          } else row.assignedTo = null;
        }
        if (input.labelIds !== undefined) {
          if (!Array.isArray(input.labelIds) || input.labelIds.length > 50) throw emailError('Некорректные метки');
          const labelIds = [...new Set(input.labelIds.map(id))];
          if (labelIds.some(labelId => !state.labels.get(labelId) || state.labels.get(labelId).deletedAt)) throw emailError('Метка недоступна');
          row.labelIds = labelIds;
        }
        this._touch(row);
        return { thread: this._threadView(state, actor, row) };
      }, () => ({ thread: this._threadView(state, actor, row) }));
    }, { write: true });
  }

  _editDraft(state, session, row, input) {
    if (input.fromAddress !== undefined) row.fromAddress = mailboxAddress(input.fromAddress);
    for (const key of ['to', 'cc', 'bcc']) if (input[key] !== undefined) row[key] = normalizeEmailAddresses(input[key]);
    if ([...row.to, ...row.cc, ...row.bcc].length > 100) throw emailError('Слишком много адресатов', 'EMAIL_TOO_MANY_RECIPIENTS');
    if (input.subject !== undefined) row.subject = header(input.subject);
    if (input.text !== undefined) row.text = text(input.text);
    if (input.shared !== undefined) row.shared = Boolean(input.shared) && state.mailboxes.get(row.mailboxId)?.kind === 'shared';
    if (input.attachments !== undefined) {
      if (!Array.isArray(input.attachments) || input.attachments.length > 50) throw emailError('Некорректные вложения');
      row.attachmentIds = [...new Set(input.attachments.map(item => id(typeof item === 'string' ? item : item.id)))];
      for (const attachmentId of row.attachmentIds) {
        const attachment = state.attachments.get(attachmentId);
        if (!attachment || attachment.deletedAt || attachment.mailboxId !== row.mailboxId || attachment.draftId && attachment.draftId !== row.id) throw missing();
        if (attachment.messageId) this._message(state, session, attachment.messageId);
      }
    }
    row.approvedVersion = null; row.approvedBy = null; row.approvedAt = null;
  }

  _ensureDraftEditable(state, row) {
    if (row.status !== 'draft') throw emailError('Этот черновик уже отправлен', 'EMAIL_DRAFT_CLOSED', 409);
    if (values(state.sendIntents).some(intent => intent.draftId === row.id && ACTIVE_SEND.has(intent.status))) throw emailError('Сначала отмените ожидающую отправку или уточните её результат', 'EMAIL_SEND_IN_PROGRESS', 409);
  }

  async createDraft(session, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const mailbox = this._mailbox(state, actor, input.mailboxId, 'reply');
      let thread = input.threadId ? this._thread(state, actor, input.threadId, 'reply') : null;
      const reply = input.replyToMessageId ? this._message(state, actor, input.replyToMessageId, 'reply') : null;
      if (reply) {
        if (reply.mailboxId !== mailbox.id || thread && reply.threadId !== thread.id) throw missing();
        thread = state.threads.get(reply.threadId);
      }
      if (thread && thread.mailboxId !== mailbox.id) throw missing();
      return this._command(state, actor, 'draft.create:' + mailbox.id, input, options, () => {
        const row = this._record(actor, {
          mailboxId: mailbox.id, threadId: thread?.id ?? null, replyToMessageId: reply?.id ?? null,
          authorId: actor.userId, shared: mailbox.kind === 'shared', status: 'draft',
          fromAddress: mailbox.address, to: [], cc: [], bcc: [], subject: reply ? (/^re:/i.test(reply.subject) ? reply.subject : 'Re: ' + reply.subject) : '',
          text: '', attachmentIds: [], approvedVersion: null, approvedBy: null, approvedAt: null, deletedAt: null,
        });
        this._editDraft(state, actor, row, input);
        state.drafts.set(row.id, row);
        return { draft: this._draftView(state, row) };
      }, result => ({ draft: this._draftView(state, this._draft(state, actor, result.draft.id)) }));
    }, { write: true });
  }

  async listDrafts(session, query = {}) {
    return this._withState(session, (state, actor) => {
      if (query.mailboxId) this._mailbox(state, actor, query.mailboxId, 'reply');
      return { items: values(state.drafts).filter(row => !row.deletedAt && row.status === 'draft' && (!query.mailboxId || row.mailboxId === query.mailboxId) && this._role(state, actor, state.mailboxes.get(row.mailboxId)) && this._role(state, actor, state.mailboxes.get(row.mailboxId)) !== 'reader' && (row.authorId === actor.userId || row.shared)).map(row => this._draftView(state, row)) };
    });
  }

  async getDraft(session, draftId) { return this._withState(session, (state, actor) => ({ draft: this._draftView(state, this._draft(state, actor, draftId)) })); }

  async updateDraft(session, draftId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const row = this._draft(state, actor, draftId);
      return this._command(state, actor, 'draft.update:' + row.id, input, options, () => {
        expect(row, input.expectedVersion); this._ensureDraftEditable(state, row);
        this._editDraft(state, actor, row, input); this._touch(row);
        return { draft: this._draftView(state, row) };
      }, () => ({ draft: this._draftView(state, row) }));
    }, { write: true });
  }

  async deleteDraft(session, draftId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const row = this._draft(state, actor, draftId);
      return this._command(state, actor, 'draft.delete:' + row.id, input, options, () => {
        expect(row, input.expectedVersion); this._ensureDraftEditable(state, row);
        row.deletedAt = this.now(); this._touch(row);
        return { deleted: true };
      });
    }, { write: true });
  }

  async approveDraft(session, draftId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const row = this._draft(state, actor, draftId);
      this._mailbox(state, actor, row.mailboxId, 'manage');
      return this._command(state, actor, 'draft.approve:' + row.id, input, options, () => {
        expect(row, input.expectedVersion); this._ensureDraftEditable(state, row);
        if (row.authorId === actor.userId) throw emailError('Черновик согласует другой управляющий ящиком', 'EMAIL_APPROVER_MUST_DIFFER', 409);
        row.approvedVersion = row.version; row.approvedBy = actor.userId; row.approvedAt = this.now(); row.updatedAt = this.now();
        return { draft: this._draftView(state, row) };
      }, () => ({ draft: this._draftView(state, row) }));
    }, { write: true });
  }

  async createNote(session, threadId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const thread = this._thread(state, actor, threadId, 'reply');
      const kind = input.kind ?? 'internal';
      if (!['internal', 'private'].includes(kind)) throw emailError('Выберите внутреннюю или личную заметку');
      const content = text(input.text, MAX_TEXT, false);
      return this._command(state, actor, 'note.create:' + thread.id, input, options, () => {
        const row = this._record(actor, { mailboxId: thread.mailboxId, threadId: thread.id, authorId: actor.userId, kind, text: content, deletedAt: null });
        state.notes.set(row.id, row); return { note: row };
      }, result => {
        const row = state.notes.get(result.note.id);
        if (!row || row.deletedAt || row.kind === 'private' && row.authorId !== actor.userId) throw missing();
        return { note: row };
      });
    }, { write: true });
  }

  async deleteNote(session, noteId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const row = state.notes.get(id(noteId));
      if (!row || row.deletedAt || row.kind === 'private' && row.authorId !== actor.userId) throw missing();
      const mailbox = this._mailbox(state, actor, row.mailboxId, 'reply');
      if (row.authorId !== actor.userId && this._role(state, actor, mailbox) !== 'manager') throw emailError('Удалять чужую заметку может управляющий ящиком', 'EMAIL_NOTE_FORBIDDEN', 403);
      return this._command(state, actor, 'note.delete:' + row.id, input, options, () => { expect(row, input.expectedVersion); row.deletedAt = this.now(); this._touch(row); return { deleted: true }; });
    }, { write: true });
  }

  async createWaiting(session, threadId, input = {}, options = {}) {
    return this._withState(session, async (state, actor, client) => {
      const thread = this._thread(state, actor, threadId, 'reply');
      const controllerId = input.controllerId ? id(input.controllerId) : actor.userId;
      if (!this._active(await this._member(actor, controllerId, client)) || !this._role(state, { ...actor, userId: controllerId }, state.mailboxes.get(thread.mailboxId))) throw emailError('Контролёр должен иметь доступ к этому ящику', 'EMAIL_CONTROLLER_FORBIDDEN', 409);
      return this._command(state, actor, 'waiting.create:' + thread.id, input, options, () => {
        const row = this._record(actor, { mailboxId: thread.mailboxId, threadId: thread.id, controllerId, title: text(input.title || 'Ожидаем ответ', 500, false), externalAddress: input.externalAddress ? mailboxAddress(input.externalAddress) : null, dueAt: input.dueAt ? date(input.dueAt, false) : null, status: 'waiting', evidenceMessageId: null, deletedAt: null });
        state.waiting.set(row.id, row); return { waiting: row };
      }, result => ({ waiting: state.waiting.get(result.waiting.id) }));
    }, { write: true });
  }

  async updateWaiting(session, waitingId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const row = state.waiting.get(id(waitingId));
      if (!row || row.deletedAt) throw missing();
      this._mailbox(state, actor, row.mailboxId, 'reply');
      return this._command(state, actor, 'waiting.update:' + row.id, input, options, () => {
        expect(row, input.expectedVersion);
        if (input.status !== undefined && !['waiting', 'answered', 'cancelled'].includes(input.status)) throw emailError('Неизвестное состояние ожидания');
        if (input.evidenceMessageId) {
          const evidence = this._message(state, actor, input.evidenceMessageId);
          if (evidence.threadId !== row.threadId) throw emailError('Подтверждением служит письмо из этой переписки', 'EMAIL_EVIDENCE_MISMATCH', 409);
          row.evidenceMessageId = evidence.id;
        }
        if (input.status === 'answered' && !row.evidenceMessageId) throw emailError('Выберите письмо с ответом', 'EMAIL_EVIDENCE_REQUIRED', 409);
        if (input.status) row.status = input.status;
        if (input.dueAt !== undefined) row.dueAt = date(input.dueAt);
        this._touch(row);
        return { waiting: row };
      }, () => ({ waiting: row }));
    }, { write: true });
  }

  async getPreferences(session) { return this._withState(session, (state, actor) => ({ preferences: this._preferences(state, actor) })); }

  async setPreferences(session, input = {}, options = {}) {
    return this._withState(session, (state, actor) => this._command(state, actor, 'preferences.update', input, options, () => {
      let row = values(state.preferences).find(pref => pref.userId === actor.userId);
      if (!row) { row = this._record(actor, { userId: actor.userId, signature: '', language: 'ru', notifications: {} }); state.preferences.set(row.id, row); }
      if (input.signature !== undefined) row.signature = text(input.signature, 10000);
      if (input.language !== undefined) {
        if (!['ru', 'en', 'es', 'it'].includes(input.language)) throw emailError('Неизвестный язык');
        row.language = input.language;
      }
      if (input.notifications !== undefined) {
        if (!input.notifications || typeof input.notifications !== 'object' || Array.isArray(input.notifications)) throw emailError('Некорректные настройки уведомлений');
        row.notifications = { ...row.notifications, ...Object.fromEntries(['reply', 'assignment', 'waiting', 'sendFailure', 'enabled'].filter(key => input.notifications[key] !== undefined).map(key => [key, Boolean(input.notifications[key])])) };
        if (input.notifications.focus !== undefined) {
          if (!['all', 'assigned'].includes(input.notifications.focus)) throw emailError('Неизвестный режим уведомлений');
          row.notifications.focus = input.notifications.focus;
        }
      }
      this._touch(row); return { preferences: row };
    }, () => ({ preferences: this._preferences(state, actor) })), { write: true });
  }

  async listLabels(session) { return this._withState(session, state => ({ items: values(state.labels).filter(row => !row.deletedAt) })); }

  async saveLabel(session, labelId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const existing = labelId ? state.labels.get(id(labelId)) : null;
      if (labelId && (!existing || existing.deletedAt)) throw missing();
      return this._command(state, actor, 'label.save:' + (labelId ?? 'new'), input, options, () => {
        if (existing) expect(existing, input.expectedVersion);
        const row = existing ?? this._record(actor, { authorId: actor.userId, deletedAt: null });
        row.name = text(input.name ?? row.name, 100, false);
        const color = input.color ?? row.color ?? 'neutral';
        if (!/^(?:#[a-f0-9]{6}|neutral|blue|green|red|yellow|purple|orange|gray)$/i.test(color)) throw emailError('Некорректный цвет метки');
        row.color = color;
        if (existing) this._touch(row); else state.labels.set(row.id, row);
        return { label: row };
      }, result => ({ label: state.labels.get(result.label.id) }));
    }, { write: true });
  }

  async deleteLabel(session, labelId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const row = state.labels.get(id(labelId));
      if (!row || row.deletedAt) throw missing();
      if (row.authorId !== actor.userId && !ADMIN_ROLES.has(actor.role)) throw emailError('Метка доступна для удаления её автору или администратору', 'EMAIL_LABEL_FORBIDDEN', 403);
      return this._command(state, actor, 'label.delete:' + row.id, input, options, () => {
        expect(row, input.expectedVersion); row.deletedAt = this.now(); this._touch(row);
        for (const thread of state.threads.values()) if (thread.labelIds.includes(row.id)) { thread.labelIds = thread.labelIds.filter(key => key !== row.id); this._touch(thread); }
        return { deleted: true };
      });
    }, { write: true });
  }

  async listTemplates(session) { return this._withState(session, (state, actor) => ({ items: values(state.templates).filter(row => !row.deletedAt && (row.scope === 'shared' || row.authorId === actor.userId)) })); }

  async saveTemplate(session, templateId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const existing = templateId ? state.templates.get(id(templateId)) : null;
      if (templateId && (!existing || existing.deletedAt || existing.scope !== 'shared' && existing.authorId !== actor.userId)) throw missing();
      if (existing && existing.authorId !== actor.userId && !ADMIN_ROLES.has(actor.role)) throw emailError('Шаблон редактирует автор или администратор', 'EMAIL_TEMPLATE_FORBIDDEN', 403);
      return this._command(state, actor, 'template.save:' + (templateId ?? 'new'), input, options, () => {
        if (existing) expect(existing, input.expectedVersion);
        const row = existing ?? this._record(actor, { authorId: actor.userId, deletedAt: null });
        row.name = text(input.name ?? row.name, 160, false);
        row.subject = header(input.subject ?? row.subject ?? '');
        row.text = text(input.text ?? row.text ?? '');
        row.scope = input.scope === 'workspace' ? 'shared' : input.scope ?? row.scope ?? 'personal';
        row.language = input.language ?? row.language ?? 'ru';
        if (!['shared', 'personal'].includes(row.scope) || !['ru', 'en', 'es', 'it'].includes(row.language)) throw emailError('Некорректные настройки шаблона');
        if (existing) this._touch(row); else state.templates.set(row.id, row);
        return { template: row };
      }, result => {
        const row = state.templates.get(result.template.id);
        if (!row || row.deletedAt || row.scope !== 'shared' && row.authorId !== actor.userId) throw missing();
        return { template: row };
      });
    }, { write: true });
  }

  async deleteTemplate(session, templateId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const row = state.templates.get(id(templateId));
      if (!row || row.deletedAt || row.scope !== 'shared' && row.authorId !== actor.userId) throw missing();
      if (row.authorId !== actor.userId && !ADMIN_ROLES.has(actor.role)) throw emailError('Шаблон удаляет автор или администратор', 'EMAIL_TEMPLATE_FORBIDDEN', 403);
      return this._command(state, actor, 'template.delete:' + row.id, input, options, () => { expect(row, input.expectedVersion); row.deletedAt = this.now(); this._touch(row); return { deleted: true }; });
    }, { write: true });
  }

  async attachToDraft(session, draftId, input = {}, options = {}) {
    const prepared = await this._withState(session, (state, actor) => {
      const draft = this._draft(state, actor, draftId); this._ensureDraftEditable(state, draft);
      return { version: draft.version };
    });
    const name = header(input.name || 'attachment', 255).split(/[/\\]/).pop();
    const mimeType = String(input.mimeType || 'application/octet-stream');
    if (!/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(mimeType)) throw emailError('Некорректный тип вложения');
    if (typeof input.contentBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.contentBase64)) throw emailError('Некорректное содержимое вложения');
    const content = Buffer.from(input.contentBase64, 'base64');
    if (!content.length || content.length > MAX_ATTACHMENT) throw emailError('Вложение должно быть от 1 байта до 10 МиБ', 'EMAIL_ATTACHMENT_TOO_LARGE', 413);
    const attachment = (await this._prepareIncoming({ attachments: [{ content, name, mimeType }] })).attachments[0];
    const commandInput = { name, mimeType, sha256: attachment.sha256, expectedVersion: input.expectedVersion };
    return this._withState(session, (state, actor) => {
      const draft = this._draft(state, actor, draftId);
      return this._command(state, actor, 'draft.attachment:' + draft.id, commandInput, options, () => {
        expect(draft, input.expectedVersion ?? prepared.version); this._ensureDraftEditable(state, draft);
        if (draft.attachmentIds.length >= 50) throw emailError('Не больше 50 вложений', 'EMAIL_TOO_MANY_ATTACHMENTS');
        const row = this._record(actor, { mailboxId: draft.mailboxId, draftId: draft.id, messageId: null, authorId: actor.userId, ...attachment });
        state.attachments.set(row.id, row); draft.attachmentIds.push(row.id);
        draft.approvedVersion = null; draft.approvedBy = null; draft.approvedAt = null; this._touch(draft);
        return { attachment: this._attachmentView(row), draft: this._draftView(state, draft) };
      }, result => ({ attachment: this._attachmentView(state.attachments.get(result.attachment.id)), draft: this._draftView(state, draft) }));
    }, { write: true });
  }

  async _bytes(session, key, row, client) {
    if (!client) return Buffer.from(row[key === 'messages' ? 'rawBase64' : 'contentBase64'] ?? '', 'base64');
    const column = key === 'messages' ? 'raw_mime' : 'content';
    const { rows } = await client.query('SELECT ' + column + ' AS bytes FROM ' + TABLES[key][0] + ' WHERE organization_id=$1 AND workspace_id=$2 AND id=$3', [session.organizationId, session.workspaceId, row.id]);
    return rows[0]?.bytes ?? Buffer.alloc(0);
  }

  async getOriginal(session, messageId) {
    return this._withState(session, async (state, actor, client) => {
      const message = this._message(state, actor, messageId);
      if (this._role(state, actor, state.mailboxes.get(message.mailboxId)) === 'reader' && (message.direction === 'outgoing' || message.hasBcc)) throw emailError('Оригинал с реквизитами отправки доступен участникам с правом ответа', 'EMAIL_ORIGINAL_FORBIDDEN', 403);
      if (!message.hasOriginal) throw emailError('Исходный MIME этого письма не загружен', 'EMAIL_ORIGINAL_UNAVAILABLE', 404);
      return { content: await this._bytes(actor, 'messages', message, client), name: 'email-' + message.id + '.eml', mimeType: 'message/rfc822' };
    });
  }

  async getAttachment(session, attachmentId) {
    return this._withState(session, async (state, actor, client) => {
      const row = state.attachments.get(id(attachmentId));
      if (!row || row.deletedAt) throw missing();
      this._mailbox(state, actor, row.mailboxId);
      if (row.messageId) this._message(state, actor, row.messageId);
      else if (row.draftId) this._draft(state, actor, row.draftId);
      else throw missing();
      if (row.scanStatus === 'quarantined') throw emailError('Вложение заблокировано проверкой безопасности', 'EMAIL_ATTACHMENT_QUARANTINED', 423);
      return { ...this._attachmentView(row), content: await this._bytes(actor, 'attachments', row, client) };
    });
  }

  async createLinkedResource(session, messageId, kind, input = {}, options = {}) {
    if (!['task', 'event', 'page', 'decision'].includes(kind)) throw emailError('Неизвестный тип записи');
    return this._withState(session, async (state, actor, client) => {
      const message = this._message(state, actor, messageId, 'reply');
      if (!this.linkResources[kind] || this.linkResources.capabilities?.[kind] === false) throw emailError('Связь с этим разделом пока недоступна', 'EMAIL_SOURCE_ADAPTER_UNAVAILABLE', 503);
      const source = { kind: 'email', sourceKind: 'email_message', messageId: message.id, threadId: message.threadId, mailboxId: message.mailboxId, subject: message.subject, text: message.text, from: message.from, occurredAt: message.sentAt ?? message.receivedAt };
      const project = async result => {
        this._message(state, actor, message.id, 'reply');
        const resource = await this.linkResources.get?.(actor, kind, result.link.resourceId, { client });
        if (!resource) throw missing();
        return { resource, link: state.resourceLinks.get(result.link.id) };
      };
      return this._command(state, actor, 'message.link:' + message.id + ':' + kind, input, options, async () => {
        const resource = input.resourceId
          ? await this.linkResources.get?.(actor, kind, id(input.resourceId), { client })
          : await this.linkResources[kind](actor, input, { client, source });
        if (!resource?.id) throw missing();
        let link = values(state.resourceLinks).find(row => row.messageId === message.id && row.kind === kind && row.resourceId === resource.id && !row.deletedAt);
        if (!link) {
          link = this._record(actor, { mailboxId: message.mailboxId, messageId: message.id, threadId: message.threadId, kind, resourceId: resource.id, actorId: actor.userId, deletedAt: null });
          state.resourceLinks.set(link.id, link);
        }
        return { resource, link };
      }, project);
    }, { write: true });
  }

  async getResourceLinks(session, kind, resourceId) {
    if (!['task', 'event', 'page', 'decision'].includes(kind)) throw emailError('Неизвестный тип записи');
    return this._withState(session, async (state, actor, client) => {
      const target = await this.linkResources.get?.(actor, kind, id(resourceId), { client });
      if (!target) throw missing();
      return values(state.resourceLinks).filter(row => row.kind === kind && row.resourceId === resourceId && !row.deletedAt && state.messages.has(row.messageId) && !state.messages.get(row.messageId).deletedAt && this._role(state, actor, state.mailboxes.get(row.mailboxId))).map(row => ({
        id: row.id, sourceKind: 'email', messageId: row.messageId, threadId: row.threadId, mailboxId: row.mailboxId,
        subject: state.messages.get(row.messageId).subject, createdAt: row.createdAt,
        resourceKind: kind, resourceId: row.resourceId,
      }));
    });
  }

  _requireProvider(mailbox) {
    if (!this.durable || !this.provider || !this.secretBox?.configured || !mailbox.secretEnvelope || mailbox.connectionState !== 'connected' || mailbox.paused || !mailbox.providerCapabilities?.send) throw emailError('Отправка из этого ящика не подключена', 'EMAIL_PROVIDER_UNAVAILABLE', 503);
  }

  async _checkSend(state, session, draft, client, { expectedVersion = draft.version } = {}) {
    const mailbox = this._mailbox(state, session, draft.mailboxId, 'reply');
    this._requireProvider(mailbox);
    if (draft.deletedAt || draft.status !== 'draft' || draft.version !== expectedVersion) throw conflict();
    if (!sameAddress(draft.fromAddress, mailbox.address) || !(mailbox.aliases ?? []).some(alias => sameAddress(alias, draft.fromAddress))) throw emailError('Адрес отправителя не подтверждён', 'EMAIL_SENDER_UNVERIFIED', 409);
    if (!draft.to.length && !draft.cc.length && !draft.bcc.length) throw emailError('Укажите адресата', 'EMAIL_RECIPIENT_REQUIRED');
    if (mailbox.requireApproval) {
      const approver = draft.approvedBy ? await this._member(session, draft.approvedBy, client) : null;
      if (draft.approvedVersion !== draft.version || draft.approvedBy === draft.authorId || !this._active(approver) || this._role(state, { ...session, userId: draft.approvedBy }, mailbox) !== 'manager') throw emailError('Текущую версию черновика должен согласовать другой управляющий', 'EMAIL_APPROVAL_REQUIRED', 409);
    }
    for (const attachmentId of draft.attachmentIds) {
      const attachment = state.attachments.get(attachmentId);
      if (!attachment || attachment.deletedAt || attachment.mailboxId !== mailbox.id) throw missing();
      if (attachment.scanStatus === 'quarantined') throw emailError('Заблокированное вложение нельзя отправить', 'EMAIL_ATTACHMENT_QUARANTINED', 423);
    }
    return mailbox;
  }

  async createSendIntent(session, draftId, input = {}, options = {}) {
    return this._withState(session, async (state, actor, client) => {
      const draft = this._draft(state, actor, draftId);
      return this._command(state, actor, 'draft.send:' + draft.id, input, options, async () => {
        expect(draft, input.expectedVersion); this._ensureDraftEditable(state, draft);
        await this._checkSend(state, actor, draft, client);
        if (draft.replyToMessageId && values(state.sendIntents).some(row => row.mailboxId === draft.mailboxId && row.replyToMessageId === draft.replyToMessageId && (ACTIVE_SEND.has(row.status) || row.status === 'provider_accepted' && row.acceptedAt >= draft.createdAt))) throw emailError('Другой участник уже подготовил или отправил ответ. Обновите переписку', 'EMAIL_REPLY_CONFLICT', 409);
        const now = Date.parse(this.now()), cancelUntil = new Date(now + this.undoMs).toISOString();
        const requested = input.scheduledAt ? date(input.scheduledAt, false) : null;
        const scheduledAt = new Date(Math.max(requested ? Date.parse(requested) : now, now + this.undoMs)).toISOString();
        if (Date.parse(scheduledAt) > now + 366 * 24 * 60 * 60 * 1000) throw emailError('Запланируйте отправку в пределах года', 'EMAIL_SCHEDULE_TOO_FAR');
        const reply = draft.replyToMessageId ? this._message(state, actor, draft.replyToMessageId) : null;
        const row = this._record(actor, {
          mailboxId: draft.mailboxId, draftId: draft.id, threadId: draft.threadId,
          replyToMessageId: draft.replyToMessageId, actorId: actor.userId,
          status: requested && Date.parse(requested) > now + this.undoMs ? 'scheduled' : 'queued',
          draftVersion: draft.version, snapshot: { from: { address: draft.fromAddress, name: state.mailboxes.get(draft.mailboxId).label }, to: clone(draft.to), cc: clone(draft.cc), bcc: clone(draft.bcc), subject: draft.subject, text: draft.text, attachmentIds: clone(draft.attachmentIds), inReplyTo: reply?.internetMessageId ?? null, references: [...(reply?.references ?? []), reply?.internetMessageId].filter(Boolean).slice(-100) },
          internetMessageId: '<' + randomUUID() + '@chatx.email>', scheduledAt, cancelUntil,
          lastError: null, leaseToken: null, leaseUntil: null, acceptedAt: null,
        });
        // Validate the complete MIME size and headers before creating a send
        // intent. A preflight error has no provider acceptance ambiguity.
        await composeEmail(await this._outgoingPayload(state, actor, row, client));
        state.sendIntents.set(row.id, row);
        return { sendIntent: this._intentView(row) };
      }, result => {
        const row = state.sendIntents.get(result.sendIntent.id);
        if (!row || row.mailboxId !== draft.mailboxId) throw missing();
        return { sendIntent: this._intentView(row) };
      });
    }, { write: true });
  }

  _intent(state, session, sendIntentId) {
    const row = state.sendIntents.get(id(sendIntentId));
    if (!row) throw missing();
    const mailbox = this._mailbox(state, session, row.mailboxId, 'reply');
    const draft = state.drafts.get(row.draftId);
    if (!draft || !draft.shared && draft.authorId !== session.userId) throw missing();
    return row;
  }

  async getSendIntent(session, sendIntentId) { return this._withState(session, (state, actor) => ({ sendIntent: this._intentView(this._intent(state, actor, sendIntentId)) })); }

  async listSendIntents(session, query = {}) {
    return this._withState(session, (state, actor) => ({
      items: values(state.sendIntents).filter(row => (!query.mailboxId || row.mailboxId === query.mailboxId) && (!query.draftId || row.draftId === query.draftId) && this._role(state, actor, state.mailboxes.get(row.mailboxId)) && this._role(state, actor, state.mailboxes.get(row.mailboxId)) !== 'reader' && (row.actorId === actor.userId || state.drafts.get(row.draftId)?.shared)).map(row => this._intentView(row)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100),
    }));
  }

  async cancelSendIntent(session, sendIntentId, input = {}, options = {}) {
    return this._withState(session, (state, actor) => {
      const row = this._intent(state, actor, sendIntentId);
      return this._command(state, actor, 'send.cancel:' + row.id, input, options, () => {
        expect(row, input.expectedVersion);
        if (!['queued', 'scheduled'].includes(row.status)) throw emailError('Передача провайдеру уже началась: отмена недоступна', 'EMAIL_CANNOT_CANCEL', 409);
        row.status = 'cancelled'; row.cancelledBy = actor.userId; this._touch(row);
        return { sendIntent: this._intentView(row) };
      }, () => ({ sendIntent: this._intentView(row) }));
    }, { write: true });
  }

  async _outgoingPayload(state, actor, intent, client) {
    const attachments = [];
    for (const attachmentId of intent.snapshot.attachmentIds) {
      const row = state.attachments.get(attachmentId);
      attachments.push({ name: row.name, mimeType: row.mimeType, content: await this._bytes(actor, 'attachments', row, client) });
    }
    return { ...clone(intent.snapshot), attachments, messageId: intent.internetMessageId, sentAt: intent.dispatchStartedAt ?? this.now() };
  }

  async _claimSend(session, sendIntentId) {
    return this._withState(session, async (state, systemActor, client) => {
      const intent = state.sendIntents.get(sendIntentId);
      if (!intent) return null;
      const now = Date.parse(this.now());
      if (intent.status === 'dispatching') {
        if (Date.parse(intent.leaseUntil ?? '') <= now) {
          intent.status = 'unknown_outcome'; intent.lastError = 'EMAIL_WORKER_INTERRUPTED'; intent.leaseToken = null; intent.leaseUntil = null; this._touch(intent); this.metrics.unknown++;
        }
        return null;
      }
      if (!['queued', 'scheduled'].includes(intent.status) || Date.parse(intent.scheduledAt) > now) return null;
      let actor, mailbox;
      try {
        actor = await this._authorizeSession({ ...systemActor, userId: intent.actorId }, client, { write: true });
        const draft = this._draft(state, actor, intent.draftId);
        mailbox = await this._checkSend(state, actor, draft, client, { expectedVersion: intent.draftVersion });
      } catch (error) {
        if (error.code === 'FEATURE_DISABLED') return null;
        intent.status = 'failed'; intent.lastError = error.code ?? 'EMAIL_SEND_AUTHORIZATION_FAILED'; this._touch(intent); this.metrics.failed++;
        return null;
      }
      let config;
      try { config = this.secretBox.decrypt(mailbox.secretEnvelope, { workspaceId: actor.workspaceId, accountId: mailbox.id }); }
      catch { intent.status = 'failed'; intent.lastError = 'EMAIL_SECRET_UNREADABLE'; this._touch(intent); this.metrics.failed++; return null; }
      intent.status = 'dispatching'; intent.leaseToken = randomUUID(); intent.leaseUntil = new Date(now + this.sendLeaseMs).toISOString(); intent.dispatchStartedAt = this.now(); this._touch(intent);
      const payload = await this._outgoingPayload(state, actor, intent, client);
      return { actor, intentId: intent.id, token: intent.leaseToken, config, payload };
    }, { write: true, system: true });
  }

  async _finishSend(claim, result) {
    return this._withState(claim.actor, (state, actor) => {
      const intent = state.sendIntents.get(claim.intentId);
      if (!intent || intent.status !== 'dispatching' || intent.leaseToken !== claim.token) return null;
      const status = ['provider_accepted', 'unknown_outcome', 'failed'].includes(result?.status) ? result.status : 'unknown_outcome';
      intent.status = status; intent.lastError = result?.errorCode ?? (status === 'unknown_outcome' ? 'EMAIL_SEND_UNKNOWN' : null);
      intent.providerMessageId = result?.providerMessageId ?? null; intent.leaseUntil = null; intent.leaseToken = null;
      intent.partial = Boolean(result?.partial);
      intent.sentCopy = result?.sentCopy ?? null;
      intent.acceptedRecipients = Array.isArray(result?.accepted) ? result.accepted : [];
      intent.rejectedRecipients = Array.isArray(result?.rejected) ? result.rejected : [];
      if (status === 'provider_accepted' || status === 'unknown_outcome') {
        if (status === 'provider_accepted') intent.acceptedAt = this.now();
        const mailbox = state.mailboxes.get(intent.mailboxId), draft = state.drafts.get(intent.draftId);
        // Result MIME is the bytes actually submitted by the provider adapter.
        // If an adapter cannot return them, the UI honestly offers no original.
        const sent = this._insertMessage(state, actor, mailbox, { ...claim.payload, internetMessageId: intent.internetMessageId, receivedAt: this.now(), sentAt: result?.sentAt ?? claim.payload.sentAt, raw: result?.raw ?? result?.composed?.raw ?? null, attachments: [] }, { direction: 'outgoing', threadId: intent.threadId, deliveryStatus: status });
        sent.message.attachmentIds = clone(intent.snapshot.attachmentIds);
        for (const attachmentId of sent.message.attachmentIds) {
          const attachment = state.attachments.get(attachmentId);
          if (attachment && attachment.draftId === draft.id) { attachment.messageId = sent.message.id; attachment.draftId = null; this._touch(attachment); }
        }
        intent.sentMessageId = sent.message.id; intent.threadId = sent.thread.id;
        if (status === 'provider_accepted') { draft.status = 'sent'; this._touch(draft); this.metrics.accepted++; }
        else this.metrics.unknown++;
        draft.threadId = sent.thread.id;
        // The draft version freezes the approved content. Attaching provenance
        // of an uncertain send does not edit that content or make it sent.
        draft.updatedAt = this.now();
      } else this.metrics.failed++;
      this._touch(intent);
      return this._intentView(intent);
    }, { write: true, system: true });
  }

  async processOutbox({ limit = 20, workspaceId = null } = {}) {
    const workspaceFilter = workspaceId === null ? null : id(workspaceId);
    if (!this.pool || !this.provider) return { processed: 0, mode: this.mode };
    const now = this.now();
    const { rows } = await this.pool.query(
      "SELECT id,organization_id \"organizationId\",workspace_id \"workspaceId\",actor_id \"userId\" FROM email_send_intents si WHERE ((status IN ('queued','scheduled') AND (data->>'scheduledAt')::timestamptz<=$1 AND NOT EXISTS(SELECT 1 FROM workspace_features wf WHERE wf.workspace_id=si.workspace_id AND wf.feature='email' AND wf.enabled=false)) OR (status='dispatching' AND (data->>'leaseUntil')::timestamptz<=$1)) AND ($3::uuid IS NULL OR si.workspace_id=$3) ORDER BY (data->>'createdAt') LIMIT $2",
      [now, Math.min(100, Math.max(1, Math.trunc(limit))), workspaceFilter],
    );
    let processed = 0, failedOperations = 0;
    for (const row of rows) {
      try {
        const claim = await this._claimSend(row, row.id);
        if (!claim) continue;
        this.metrics.dispatched++; processed++;
        let result;
        try { result = await this.provider.send(claim.config, claim.payload); }
        catch { result = { status: 'unknown_outcome', errorCode: 'EMAIL_SEND_UNKNOWN' }; }
        await this._finishSend(claim, result);
      } catch {
        // One unavailable record/workspace must not suppress unrelated queued
        // mail. Never retry SMTP here: if outcome persistence failed, the
        // durable dispatch lease is later recovered as unknown_outcome.
        failedOperations++;
      }
    }
    return { processed, ...(failedOperations ? { failedOperations, errorCode: 'EMAIL_OUTBOX_PARTIAL_FAILURE' } : {}) };
  }

  async processSync({ limit = 2, intervalMs = 60000, workspaceId = null } = {}) {
    const workspaceFilter = workspaceId === null ? null : id(workspaceId);
    if (!this.pool || !this.provider || !this.secretBox?.configured) return { processed: 0 };
    const { rows } = await this.pool.query(
      "SELECT mb.id,mb.organization_id \"organizationId\",mb.workspace_id \"workspaceId\",mb.owner_id \"userId\" FROM email_mailboxes mb JOIN memberships wm ON wm.workspace_id=mb.workspace_id AND wm.user_id=mb.owner_id JOIN users u ON u.id=wm.user_id WHERE mb.deleted_at IS NULL AND mb.data->>'connectionState'='connected' AND COALESCE((mb.data->>'paused')::boolean,false)=false AND wm.role<>'guest' AND u.disabled_at IS NULL AND (wm.access_until IS NULL OR wm.access_until>now()) AND NOT EXISTS(SELECT 1 FROM workspace_features wf WHERE wf.workspace_id=mb.workspace_id AND wf.feature='email' AND wf.enabled=false) AND (COALESCE(mb.data->>'lastSyncAttemptAt',mb.data->>'lastSyncedAt') IS NULL OR COALESCE(mb.data->>'lastSyncAttemptAt',mb.data->>'lastSyncedAt')::timestamptz<$1 OR ((mb.data->>'syncHasMore')::boolean=true AND mb.data->>'lastSyncError' IS NULL)) AND ($3::uuid IS NULL OR mb.workspace_id=$3) ORDER BY COALESCE(mb.data->>'lastSyncAttemptAt',mb.data->>'lastSyncedAt',''),mb.id LIMIT $2",
      [new Date(Date.parse(this.now()) - Math.max(1000, intervalMs)).toISOString(), Math.min(10, Math.max(1, Math.trunc(limit))), workspaceFilter],
    );
    let processed = 0;
    for (const row of rows) {
      try { await this.syncMailbox(row, row.id); processed++; }
      catch (error) {
        try {
          await this._withState(row, (state, actor) => {
            const mailbox = this._mailbox(state, actor, row.id, 'manage');
            mailbox.lastSyncAttemptAt = this.now(); mailbox.lastSyncError = safeProviderError(error).code; this._touch(mailbox);
          }, { write: true });
        } catch { /* Revoked/removed mailboxes are not eligible on the next pass. */ }
      }
    }
    return { processed };
  }

  async processWaiting({ limit = 20 } = {}) {
    if (!this.pool) {
      let processed = 0;
      for (const state of this.states.values()) {
        const due = values(state.waiting).find(row => row.status === 'waiting' && row.dueAt && Date.parse(row.dueAt) <= Date.parse(this.now()) && row.notificationDueKey !== row.dueAt);
        if (!due) continue;
        await this._withState({ organizationId: due.organizationId, workspaceId: due.workspaceId, userId: due.controllerId }, () => {}, { write: true, system: true });
        processed++;
      }
      return { processed };
    }
    const { rows } = await this.pool.query(
      "SELECT DISTINCT ew.organization_id \"organizationId\",ew.workspace_id \"workspaceId\" FROM email_waiting ew WHERE ew.data->>'status'='waiting' AND ew.data->>'dueAt' IS NOT NULL AND (ew.data->>'dueAt')::timestamptz<=$1 AND COALESCE(ew.data->>'notificationDueKey','')<>ew.data->>'dueAt' AND NOT EXISTS(SELECT 1 FROM workspace_features wf WHERE wf.workspace_id=ew.workspace_id AND wf.feature='email' AND wf.enabled=false) LIMIT $2",
      [this.now(), Math.min(100, Math.max(1, Math.trunc(limit)))],
    );
    for (const row of rows) await this._withState(row, () => {}, { write: true, system: true });
    return { processed: rows.length };
  }

  async reconcileSendIntent(session, sendIntentId, input = {}, options = {}) {
    const claim = await this._withState(session, async (state, actor, client) => {
      const intent = this._intent(state, actor, sendIntentId);
      if (intent.status !== 'unknown_outcome') throw emailError('Уточнение результата доступно для неизвестной отправки', 'EMAIL_RECONCILE_NOT_NEEDED', 409);
      const mailbox = this._mailbox(state, actor, intent.mailboxId, 'reply');
      this._requireProvider(mailbox);
      return { actor, intentId: intent.id, version: intent.version, config: this.secretBox.decrypt(mailbox.secretEnvelope, { workspaceId: actor.workspaceId, accountId: mailbox.id }), payload: await this._outgoingPayload(state, actor, intent, client), since: intent.createdAt };
    });
    let result;
    try { result = await this.provider.reconcileSent(claim.config, { messageId: claim.payload.messageId, since: claim.since }); }
    catch { result = { status: 'unknown_outcome', found: null }; }
    return this._withState(session, (state, actor) => {
      const intent = this._intent(state, actor, sendIntentId);
      expect(intent, claim.version);
      intent.reconciledAt = this.now();
      if (result?.status === 'provider_accepted' || result === true) {
        const mailbox = state.mailboxes.get(intent.mailboxId), draft = state.drafts.get(intent.draftId);
        const existing = intent.sentMessageId ? state.messages.get(intent.sentMessageId) : null;
        const sent = existing ? { message: existing, thread: state.threads.get(existing.threadId) } : this._insertMessage(state, actor, mailbox, { ...claim.payload, internetMessageId: intent.internetMessageId, receivedAt: this.now(), attachments: [] }, { direction: 'outgoing', threadId: intent.threadId, deliveryStatus: 'provider_accepted' });
        sent.message.deliveryStatus = 'provider_accepted'; this._touch(sent.message);
        sent.message.attachmentIds = clone(intent.snapshot.attachmentIds);
        for (const attachmentId of sent.message.attachmentIds) {
          const attachment = state.attachments.get(attachmentId);
          if (attachment?.draftId === draft.id) { attachment.messageId = sent.message.id; attachment.draftId = null; this._touch(attachment); }
        }
        intent.status = 'provider_accepted'; intent.acceptedAt = this.now(); intent.providerMessageId = result?.providerMessageId ?? null; intent.sentMessageId = sent.message.id; intent.threadId = sent.thread.id; intent.lastError = null;
        draft.status = 'sent'; draft.threadId = sent.thread.id; this._touch(draft);
      } else {
        // Absence in Sent is not proof of rejection. No retry is queued here.
        intent.lastError = result?.status === 'not_found' || result === false ? 'EMAIL_SENT_NOT_FOUND_UNPROVEN' : 'EMAIL_SEND_UNKNOWN';
      }
      this._touch(intent); return { sendIntent: this._intentView(intent) };
    }, { write: true });
  }

  status() { return { enabled: this.enabled, mode: this.mode, durable: this.durable, metrics: { ...this.metrics } }; }
}
