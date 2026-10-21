import { randomUUID } from 'node:crypto';

const VALUES = {
  'email.received': { preference: 'reply', title: 'Новое письмо' },
  'email.assigned': { preference: 'assignment', title: 'Вам поручили переписку' },
  'email.waiting_due': { preference: 'waiting', title: 'Истёк срок ожидания ответа' },
  'email.send_attention': { preference: 'sendFailure', title: 'Проверьте отправку письма' },
};
const all = map => [...map.values()];

/** Predicate for the existing canonical notification inbox and its counters.
 * It never embeds a copy of a subject, address, body or private note. */
export function emailNotificationVisibleSql(alias = 'n', userParameter = '$2') {
  if (!/^[a-z_]+$/i.test(alias) || !/^\$\d+$/.test(userParameter)) throw new Error('Invalid internal notification SQL alias');
  return '(' + alias + ".type NOT LIKE 'email.%' OR EXISTS(" +
    'SELECT 1 FROM email_mailboxes enmb JOIN memberships enwm ON enwm.workspace_id=enmb.workspace_id AND enwm.user_id=' + userParameter +
    ' JOIN users enu ON enu.id=enwm.user_id WHERE enmb.workspace_id=' + alias + '.workspace_id AND enmb.id=' + alias + '.email_mailbox_id' +
    " AND enmb.deleted_at IS NULL AND enwm.role<>'guest' AND enu.disabled_at IS NULL AND (enwm.access_until IS NULL OR enwm.access_until>now())" +
    " AND NOT EXISTS(SELECT 1 FROM workspace_features enf WHERE enf.workspace_id=enmb.workspace_id AND enf.feature='email' AND enf.enabled=false)" +
    ' AND (enmb.owner_id=' + userParameter + " OR (enmb.kind='shared' AND EXISTS(SELECT 1 FROM email_mailbox_members enmm WHERE enmm.workspace_id=enmb.workspace_id AND enmm.mailbox_id=enmb.id AND enmm.user_id=" + userParameter + ' AND enmm.revoked_at IS NULL)))' +
    ' AND (' + alias + '.email_message_id IS NULL OR EXISTS(SELECT 1 FROM email_messages enmsg WHERE enmsg.workspace_id=enmb.workspace_id AND enmsg.mailbox_id=enmb.id AND enmsg.id=' + alias + '.email_message_id AND enmsg.deleted_at IS NULL))' +
    ' AND (' + alias + '.email_thread_id IS NULL OR EXISTS(SELECT 1 FROM email_threads enth WHERE enth.workspace_id=enmb.workspace_id AND enth.mailbox_id=enmb.id AND enth.id=' + alias + ".email_thread_id AND enth.data->>'deletedAt' IS NULL))" +
    ' AND (' + alias + '.email_send_intent_id IS NULL OR EXISTS(SELECT 1 FROM email_send_intents ensi JOIN email_drafts endr ON endr.workspace_id=ensi.workspace_id AND endr.id=ensi.draft_id WHERE ensi.workspace_id=enmb.workspace_id AND ensi.mailbox_id=enmb.id AND ensi.id=' + alias + '.email_send_intent_id' +
    " AND ((endr.data->>'shared')::boolean=true OR ensi.actor_id=" + userParameter + ')' +
    ' AND (enmb.owner_id=' + userParameter + ' OR EXISTS(SELECT 1 FROM email_mailbox_members enmr WHERE enmr.workspace_id=enmb.workspace_id AND enmr.mailbox_id=enmb.id AND enmr.user_id=' + userParameter + " AND enmr.role IN ('responder','manager') AND enmr.revoked_at IS NULL))" +
    ')) ))';
}

/** Prepare projection before saving email metadata. Due/attention markers are
 * committed with source state, and notification inserts share that transaction. */
export async function prepareEmailNotifications({ before, state, session, now, canReadRecipient }) {
  const result = [];
  const preferences = new Map(all(state.preferences).map(row => [row.userId, row.notifications ?? {}]));
  const emit = async (type, source, recipients, suffix = '') => {
    const info = VALUES[type], mailbox = state.mailboxes.get(source.mailboxId);
    if (!mailbox || mailbox.deletedAt) return;
    for (const userId of new Set(recipients.filter(Boolean))) {
      const preference = preferences.get(userId) ?? {};
      if (preference.enabled === false || preference[info.preference] === false) continue;
      const thread = source.threadId ? state.threads.get(source.threadId) : null;
      if (preference.focus === 'assigned' && type === 'email.received' && mailbox.kind === 'shared' && thread?.assignedTo !== userId) continue;
      if (!(await canReadRecipient(userId, source))) continue;
      const dedupeKey = type + ':' + source.id + ':' + suffix + ':' + userId;
      result.push({
        id: randomUUID(), organizationId: session.organizationId, workspaceId: session.workspaceId,
        recipientUserId: userId, sourceEventId: source.id, dedupeKey, type,
        title: info.title, body: 'Откройте почту ChatX для подробностей.',
        status: 'unread', priority: type === 'email.send_attention' ? 'high' : 'normal',
        actorUserId: null, emailMailboxId: source.mailboxId, emailThreadId: source.threadId ?? null,
        emailMessageId: source.messageId ?? null, emailSendIntentId: source.sendIntentId ?? null,
        url: '/#/chats/email' + (source.threadId ? '/' + source.threadId : ''),
        metadata: { sourceKind: 'email' }, version: 1, createdAt: now, updatedAt: now, archivedAt: null,
      });
    }
  };
  for (const message of state.messages.values()) {
    if (before.messages.has(message.id) || message.direction !== 'incoming' || message.notificationEligible === false) continue;
    const mailbox = state.mailboxes.get(message.mailboxId);
    const members = mailbox?.kind === 'shared' ? all(state.members).filter(row => row.mailboxId === mailbox.id && !row.revokedAt).map(row => row.userId) : [];
    const audience = [mailbox?.ownerId, ...members].filter(userId => message.sourceKind !== 'manual_import' || userId !== session.userId);
    await emit('email.received', { id: message.id, mailboxId: message.mailboxId, threadId: message.threadId, messageId: message.id }, audience);
  }
  for (const thread of state.threads.values()) {
    if (!thread.assignedTo || thread.assignedTo === before.threads.get(thread.id)?.assignedTo || thread.assignedTo === session.userId) continue;
    await emit('email.assigned', { id: thread.id, mailboxId: thread.mailboxId, threadId: thread.id }, [thread.assignedTo], String(thread.version));
  }
  for (const waiting of state.waiting.values()) {
    if (waiting.status !== 'waiting' || waiting.deletedAt || !waiting.dueAt || Date.parse(waiting.dueAt) > Date.parse(now) || waiting.notificationDueKey === waiting.dueAt) continue;
    waiting.notificationDueKey = waiting.dueAt;
    await emit('email.waiting_due', { id: waiting.id, mailboxId: waiting.mailboxId, threadId: waiting.threadId }, [waiting.controllerId], waiting.dueAt);
  }
  for (const intent of state.sendIntents.values()) {
    if (!['failed', 'unknown_outcome'].includes(intent.status) && !(intent.status === 'provider_accepted' && intent.partial)) continue;
    const key = intent.status + ':' + (intent.lastError ?? '') + ':' + Boolean(intent.partial);
    if (intent.notificationAttentionKey === key) continue;
    intent.notificationAttentionKey = key;
    await emit('email.send_attention', { id: intent.id, mailboxId: intent.mailboxId, threadId: intent.threadId, messageId: intent.sentMessageId, sendIntentId: intent.id }, [intent.actorId], key);
  }
  return result;
}

export async function insertEmailNotifications(client, notifications) {
  for (const n of notifications) {
    await client.query(
      "INSERT INTO notifications(id,organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body,status,priority,url,metadata,email_mailbox_id,email_thread_id,email_message_id,email_send_intent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'unread',$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(workspace_id,dedupe_key) DO NOTHING",
      [n.id, n.organizationId, n.workspaceId, n.recipientUserId, n.sourceEventId, n.dedupeKey, n.type, n.title, n.body, n.priority, n.url, n.metadata, n.emailMailboxId, n.emailThreadId, n.emailMessageId, n.emailSendIntentId],
    );
  }
}
