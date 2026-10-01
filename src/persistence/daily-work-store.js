import { openConversationSql, conversationListSql, conversationTitleSql } from './visibility.js';
import { randomUUID } from 'node:crypto';
import { MemoryStore as BaseMemoryStore } from './memory-store.js';
import { PostgresStore as BasePostgresStore } from './postgres-store.js';

const clone = (value) => value == null ? value : structuredClone(value);
const nowIso = () => new Date().toISOString();
import { ACTIVE_TASK_STATUSES } from '../task/task-authority.js';

function messageLabel(kind) {
  return ({ voice:'Голосовое сообщение', file:'Файл', call:'Звонок', task:'Задача', calendar:'Событие' })[kind] || 'Новое сообщение';
}

function mentionHandles(profile) {
  const values = [];
  const local = String(profile?.email ?? '').split('@')[0].trim().toLowerCase();
  if (local) values.push(local);
  const display = String(profile?.displayName ?? profile?.display_name ?? '').trim().toLowerCase();
  if (display) values.push(display);
  return values;
}

const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A plain includes() made «@anna» fire on «@annabelle» and made the local part
// of any email address in the text a mention. A handle has to end where a word
// ends, and the «@» has to start one.
function mentionMatches(text, handle) {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_@.])@${escapeForRegExp(handle)}(?![\\p{L}\\p{N}_])`, 'gu');
  return [...text.matchAll(pattern)].map((match) => match.index);
}

function resolveMentionsFromPeople(body, explicitIds, people) {
  const ids = new Set((explicitIds ?? []).map(String));
  const text = String(body ?? '').toLowerCase();
  if (!text) return [...ids];

  // «@Анна Белова» also ends a word after «Анна», so a colleague called just
  // «Анна» would be pulled into someone else's mention. At a given position
  // the longest handle is the one the author typed.
  const bestAt = new Map();
  for (const person of people) {
    const userId = String(person.userId ?? person.user_id ?? '');
    if (!userId) continue;
    for (const handle of mentionHandles(person)) {
      for (const at of mentionMatches(text, handle)) {
        const current = bestAt.get(at);
        if (!current || handle.length > current.length) bestAt.set(at, { length:handle.length, userId });
      }
    }
  }
  for (const { userId } of bestAt.values()) ids.add(userId);
  return [...ids];
}

function notificationBody(message) {
  return String(message?.body ?? '').trim() || messageLabel(message?.kind);
}

function searchScore(value, query) {
  const haystack = String(value ?? '').toLowerCase();
  const needle = String(query ?? '').toLowerCase();
  if (!haystack || !needle) return 0;
  if (haystack === needle) return 100;
  if (haystack.startsWith(needle)) return 70;
  const at = haystack.indexOf(needle);
  return at >= 0 ? Math.max(20, 55 - Math.min(at, 35)) : 0;
}

export class MemoryStore extends BaseMemoryStore {
  constructor() {
    super();
    this.dailyNotifications = new Map();
    this.dailyFileLinks = new Map();
  }

  async resolveMentionedUserIds(session, body, explicitIds = []) {
    const people = [...this.memberships.values()]
      .filter((m) => m.workspaceId === session.workspaceId)
      .map((m) => ({ userId:m.userId, ...clone(this.profiles.get(this.membershipKey(m.workspaceId, m.userId))) }));
    const valid = new Set(people.map((p) => String(p.userId)));
    return resolveMentionsFromPeople(body, explicitIds, people).filter((id) => valid.has(String(id)));
  }

  async listConversations(session, options = {}) {
    const rows = await super.listConversations(session, options);
    return rows.map((conversation) => {
      const messages = this.messages.get(conversation.id) ?? [];
      const read = this.readState.get(this.conversationMemberKey(conversation.id, session.userId));
      let start = 0;
      if (read?.messageId) {
        const index = messages.findIndex((m) => m.id === read.messageId);
        if (index >= 0) start = index + 1;
      } else if (read?.readAt) {
        start = messages.findIndex((m) => Date.parse(m.createdAt) > Date.parse(read.readAt));
        if (start < 0) start = messages.length;
      }
      const unread = messages.slice(start).filter((m) => m.authorId !== session.userId && !m.deletedAt);
      return {
        ...conversation,
        unreadCount: unread.length,
        mentionCount: unread.filter((m) => (m.mentionedUserIds ?? []).includes(session.userId)).length,
      };
    });
  }

  async createMessage(session, conversationId, value) {
    const mentionedUserIds = await this.resolveMentionedUserIds(session, value.body, value.mentionedUserIds);
    const message = await super.createMessage(session, conversationId, { ...value, mentionedUserIds });
    if (message.metadata?.fileId) await this.linkFile(session, message.metadata.fileId, 'message', message.id);
    await this.projectMessageNotifications(session, conversationId, message);
    return message;
  }

  // Editing left the original mention set in place: adding «@Марина» to a
  // message never reached her, and removing a name kept counting against the
  // person who was no longer named.
  async editMessage(session, messageId, body) {
    const message = await super.editMessage(session, messageId, body);
    const record = await this.messageRecord(session, messageId);
    if (!record) return message;
    const mentionedUserIds = await this.resolveMentionedUserIds(session, body, []);
    record.mentionedUserIds = mentionedUserIds;
    const updated = { ...message, mentionedUserIds };
    // Already-delivered mentions carry a dedupe key, so re-projecting reaches
    // only the people the edit newly named.
    await this.projectMessageNotifications(session, record.conversationId, updated)
      .catch((error) => console.error('notification projection failed', error));
    return updated;
  }

  async saveVoiceMessage(session, conversationId, value) {
    // BaseMemoryStore delegates message creation to this.createMessage, which already
    // links the file and projects message notifications.
    return super.saveVoiceMessage(session, conversationId, value);
  }

  async forwardMessage(session, sourceMessageId, targetConversationId) {
    const message = await super.forwardMessage(session, sourceMessageId, targetConversationId);
    if (message.metadata?.fileId) await this.linkFile(session, message.metadata.fileId, 'message', message.id);
    await this.projectMessageNotifications(session, targetConversationId, { ...message, mentionedUserIds:[] });
    return message;
  }

  async createTask(session, value) {
    const task = await super.createTask(session, value);
    if (task.ownerId && task.ownerId !== session.userId) {
      this.putNotification({
        organizationId:session.organizationId,
        workspaceId:session.workspaceId,
        recipientUserId:task.ownerId,
        sourceEventId:task.id,
        dedupeKey:`task.assigned:${task.id}:${task.ownerId}`,
        type:'task.assigned',
        // «Новая задача от Игорь Ветров»: имя вставлялось в родительный
        // падеж как есть, и склонять чужие имена нам нечем. Ставим имя
        // в именительный — глагол делает фразу правильной при любом имени.
        title:`${session.displayName} поручил(а) задачу`,
        body:task.title,
        actorUserId:session.userId,
        commitmentId:task.id,
        url:`/#/tasks/${task.id}`,
        priority:['urgent','high'].includes(task.priority) ? 'high' : 'normal',
      });
    }
    return task;
  }

  async projectCallNotification(session, call, { recipients=[], type='call.started', title='Звонок', body=null } = {}) {
    const targets=[...new Set(recipients.filter((id)=>id&&id!==session.userId))];
    return targets.map((recipientUserId)=>this.putNotification({
      organizationId:session.organizationId,
      workspaceId:session.workspaceId,
      recipientUserId,
      sourceEventId:call.id,
      dedupeKey:`${type}:${call.id}:${recipientUserId}`,
      type,
      title,
      body:body||call.title||'Звонок',
      actorUserId:session.userId,
      conversationId:call.conversationId??null,
      url:call.conversationId?`/#/chats/${call.conversationId}`:null,
      priority:type==='call.started'?'high':'normal',
      metadata:{callId:call.id,mode:call.mode??null},
    }));
  }

  async projectTaskLifecycleNotification(session, task, { type='task.updated', title='Задача обновлена', body=null } = {}) {
    const recipients=[...new Set([task.ownerId,task.requesterId,task.acceptorId].filter((id)=>id&&id!==session.userId))];
    return recipients.map((recipientUserId)=>this.putNotification({
      organizationId:session.organizationId,
      workspaceId:session.workspaceId,
      recipientUserId,
      sourceEventId:task.id,
      dedupeKey:`${type}:${task.id}:v${task.version}:${recipientUserId}`,
      type,
      title,
      body:body||task.title,
      actorUserId:session.userId,
      commitmentId:task.id,
      url:`/#/tasks/${task.id}`,
      priority:['urgent','high'].includes(task.priority)?'high':'normal',
      metadata:{status:task.status,version:task.version},
    }));
  }

  putNotification(value) {
    const existing = [...this.dailyNotifications.values()].find((n) => n.workspaceId === value.workspaceId && n.dedupeKey === value.dedupeKey);
    if (existing) return clone(existing);
    const row = {
      id:randomUUID(), status:'unread', metadata:{}, createdAt:nowIso(), updatedAt:nowIso(), readAt:null, readBy:null, archivedAt:null,
      actorUserId:null, conversationId:null, messageId:null, commitmentId:null, calendarEventId:null, url:null, priority:'normal', ...value,
    };
    this.dailyNotifications.set(row.id, row);
    return clone(row);
  }

  async projectMessageNotifications(session, conversationId, message) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return [];
    const everyone = await this.conversationAudience(session, conversationId);
    const audience = await this.conversationNotificationAudience(session, conversationId);
    // Названного по имени приглушение не касается: см. хранилище с базой.
    const mentioned = new Set((message.mentionedUserIds ?? []).filter((id) => id !== session.userId && everyone.includes(id)));
    const rows = [];
    for (const userId of mentioned) {
      rows.push(this.putNotification({
        organizationId:session.organizationId, workspaceId:session.workspaceId, recipientUserId:userId,
        sourceEventId:message.id, dedupeKey:`message.mentioned:${message.id}:${userId}`, type:'message.mentioned',
        title:`Упоминание · ${session.displayName}`, body:notificationBody(message), actorUserId:session.userId,
        conversationId, messageId:message.id, url:`/#/chats/${conversationId}?message=${message.id}`, priority:'high',
      }));
    }
    if (['direct','group'].includes(conversation.kind)) {
      for (const userId of audience) {
        if (userId === session.userId || mentioned.has(userId)) continue;
        rows.push(this.putNotification({
          organizationId:session.organizationId, workspaceId:session.workspaceId, recipientUserId:userId,
          sourceEventId:message.id, dedupeKey:`message.created:${message.id}:${userId}`, type:'message.created',
          title:`${session.displayName} написал(а)`, body:notificationBody(message), actorUserId:session.userId,
          conversationId, messageId:message.id, url:`/#/chats/${conversationId}?message=${message.id}`, priority:'normal',
        }));
      }
    }
    return rows;
  }

  async markRead(session, conversationId, messageId = null) {
    await super.markRead(session, conversationId, messageId);
    const readAt = nowIso();
    for (const notification of this.dailyNotifications.values()) {
      if (notification.workspaceId === session.workspaceId && notification.recipientUserId === session.userId && notification.conversationId === conversationId && notification.status === 'unread') {
        notification.status = 'read'; notification.readAt = readAt; notification.readBy = session.userId; notification.updatedAt = readAt;
      }
    }
  }

  async listNotifications(session, { status = null, type = null, limit = 50 } = {}) {
    let rows = [...this.dailyNotifications.values()].filter((n) => n.workspaceId === session.workspaceId && n.recipientUserId === session.userId && !n.archivedAt);
    if (status) rows = rows.filter((n) => n.status === status);
    if (type === 'mentions') rows = rows.filter((n) => n.type === 'message.mentioned');
    else if (type) rows = rows.filter((n) => n.type === type);
    rows.sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return clone(rows.slice(0, Math.min(Math.max(Number(limit) || 50, 1), 100)).map((row) => ({ ...row, actorName:this.profiles.get(this.membershipKey(row.workspaceId,row.actorUserId))?.displayName ?? null, conversationTitle:this.conversations.get(row.conversationId)?.title ?? null })));
  }

  async archiveNotification(session, id) {
    const row = this.dailyNotifications.get(id);
    if (!row || row.workspaceId !== session.workspaceId || row.recipientUserId !== session.userId || row.archivedAt) return null;
    row.archivedAt = nowIso();
    if (row.status === 'unread') { row.status = 'read'; row.readAt = row.readAt ?? nowIso(); }
    return { id: row.id, type: row.type, status: row.status, archivedAt: row.archivedAt };
  }

  async archiveReadNotifications(session) {
    let count = 0;
    for (const row of this.dailyNotifications.values()) {
      if (row.workspaceId !== session.workspaceId || row.recipientUserId !== session.userId) continue;
      if (row.status !== 'read' || row.archivedAt) continue;
      row.archivedAt = nowIso();
      count += 1;
    }
    return count;
  }

  async markNotificationRead(session, id) {
    const row = this.dailyNotifications.get(id);
    if (!row || row.workspaceId !== session.workspaceId || row.recipientUserId !== session.userId) return null;
    if (row.status !== 'read') { row.status='read'; row.readAt=nowIso(); row.readBy=session.userId; row.updatedAt=row.readAt; }
    return clone(row);
  }

  async markAllNotificationsRead(session, type = null) {
    let count = 0; const at = nowIso();
    for (const row of this.dailyNotifications.values()) {
      if (row.workspaceId !== session.workspaceId || row.recipientUserId !== session.userId || row.status !== 'unread') continue;
      if (type === 'mentions' && row.type !== 'message.mentioned') continue;
      if (type && type !== 'mentions' && row.type !== type) continue;
      row.status='read'; row.readAt=at; row.readBy=session.userId; row.updatedAt=at; count++;
    }
    return count;
  }

  async attentionSummary(session) {
    const conversations = await this.listConversations(session);
    const notifications = await this.listNotifications(session, { status:'unread', limit:100 });
    const mine = [...this.tasks.values()].filter((t) => t.workspaceId === session.workspaceId
      && [t.ownerId, t.requesterId, t.acceptorId].includes(session.userId)
      && ACTIVE_TASK_STATUSES.has(t.status));
    const now = Date.now(), soon = now + 24*60*60*1000;
    // Те же три случая, что и в хранилище с базой: ход за смотрящим.
    const all = [...this.tasks.values()].filter((t) => t.workspaceId === session.workspaceId);
    const me = session.userId;
    const toAnswer = all.filter((t) => t.status === 'proposed' && t.ownerId === me).length;
    const toReview = all.filter((t) => t.status === 'in_review' && t.acceptorId === me).length;
    const toClose = all.filter((t) => t.status === 'accepted_result' && (t.requesterId === me || t.acceptorId === me)).length;
    return {
      awaitingMyDecision: toAnswer + toReview + toClose,
      tasksToAnswer: toAnswer, tasksToReview: toReview, tasksToClose: toClose,
      unreadMessages:conversations.reduce((sum,c) => sum + Number(c.unreadCount || 0), 0),
      unreadConversations:conversations.filter((c) => c.unreadCount > 0).length,
      unreadNotifications:notifications.length,
      mentions:notifications.filter((n) => n.type === 'message.mentioned').length,
      // См. PostgreSQL-хранилище: обязательство касается троих.
      overdueTasks:mine.filter((t) => t.promisedAt && Date.parse(t.promisedAt) < now).length,
      dueSoonTasks:mine.filter((t) => t.promisedAt && Date.parse(t.promisedAt) >= now && Date.parse(t.promisedAt) <= soon).length,
    };
  }

  async linkFile(session, fileId, entityType, entityId) {
    const key = `${session.workspaceId}:${fileId}:${entityType}:${entityId}`;
    this.dailyFileLinks.set(key, { organizationId:session.organizationId, workspaceId:session.workspaceId, fileId, entityType, entityId, linkedBy:session.userId, createdAt:nowIso() });
  }

  async canAccessFile(session, fileId) {
    const file = this.files.get(fileId);
    if (!file || file.workspaceId !== session.workspaceId) return false;
    if (file.uploadedBy === session.userId) return true;
    for (const link of this.dailyFileLinks.values()) {
      if (link.workspaceId !== session.workspaceId || link.fileId !== fileId || link.entityType !== 'message') continue;
      const conversationId = await this.messageConversation(session, link.entityId);
      if (conversationId && await this.canAccessConversation(session, conversationId)) return true;
    }
    return false;
  }

  async getFile(session, fileId) {
    if (!await this.canAccessFile(session, fileId)) return null;
    return super.getFile(session, fileId);
  }

  fileContext(session, fileId) {
    for (const link of [...this.dailyFileLinks.values()].reverse()) {
      if (link.workspaceId !== session.workspaceId || link.fileId !== fileId || link.entityType !== 'message') continue;
      for (const [conversationId, messages] of this.messages.entries()) {
        const message = messages.find((m) => m.id === link.entityId);
        if (!message) continue;
        const conversation = this.conversations.get(conversationId);
        return { messageId:message.id, conversationId, conversationTitle:conversation?.title ?? null, conversationKind:conversation?.kind ?? null };
      }
    }
    return null;
  }

  async listFiles(session, { query = '', mime = null, limit = 60 } = {}) {
    const q = String(query).trim().toLowerCase();
    const rows = [];
    for (const file of this.files.values()) {
      if (file.workspaceId !== session.workspaceId || file.status === 'deleted') continue;
      if (!await this.canAccessFile(session, file.id)) continue;
      if (q && !String(file.name).toLowerCase().includes(q)) continue;
      if (mime && !String(file.mimeType ?? '').startsWith(mime)) continue;
      const profile = this.profiles.get(this.membershipKey(session.workspaceId, file.uploadedBy));
      rows.push({ ...clone(file), uploaderName:profile?.displayName ?? null, context:this.fileContext(session,file.id), contentUrl:`/api/v1/files/${file.id}/content`, previewUrl:/^(image\/(?!svg\+xml)|application\/pdf$|text\/plain|audio\/|video\/)/.test(file.mimeType ?? '')?`/api/v1/files/${file.id}/preview`:null });
    }
    rows.sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return rows.slice(0, Math.min(Math.max(Number(limit)||60,1),100));
  }

  async searchWorkspace(session, query, { types = null, limit = 30 } = {}) {
    const q = String(query).trim().toLowerCase();
    if (q.length < 2) return [];
    const wanted = new Set(types?.length ? types : ['message','conversation','task','file','person','event']);
    const items = [];
    const conversations = await this.listConversations(session);
    const accessible = new Set(conversations.map((c) => c.id));
    if (wanted.has('conversation')) for (const c of conversations) {
      const score = Math.max(searchScore(c.title,q), searchScore(c.purpose,q));
      if (score) items.push({ type:'conversation', id:c.id, title:c.title || 'Диалог', snippet:c.purpose || '', conversationId:c.id, createdAt:c.createdAt, score });
    }
    if (wanted.has('message')) for (const [conversationId,messages] of this.messages.entries()) {
      if (!accessible.has(conversationId)) continue;
      for (const m of messages) { const score=searchScore(m.body,q); if(score) items.push({ type:'message', id:m.id, title:this.conversations.get(conversationId)?.title || 'Диалог', snippet:m.body || messageLabel(m.kind), conversationId, authorId:m.authorId, createdAt:m.createdAt, score }); }
    }
    if (wanted.has('task')) for (const t of await this.listTasks(session)) { const score=Math.max(searchScore(t.title,q),searchScore(t.outcome,q)); if(score) items.push({ type:'task',id:t.id,title:t.title,snippet:t.outcome,status:t.status,createdAt:t.createdAt,score }); }
    if (wanted.has('file')) for (const f of await this.listFiles(session,{query:q,limit:100})) items.push({ type:'file',id:f.id,title:f.name,snippet:f.mimeType,conversationId:f.context?.conversationId,messageId:f.context?.messageId,createdAt:f.createdAt,previewUrl:f.previewUrl,contentUrl:f.contentUrl,score:searchScore(f.name,q) });
    if (wanted.has('person')) for (const m of this.memberships.values()) { if(m.workspaceId!==session.workspaceId)continue;const p=this.profiles.get(this.membershipKey(m.workspaceId,m.userId));const score=Math.max(searchScore(p?.displayName,q),searchScore(p?.email,q),searchScore(p?.title,q),searchScore(p?.department,q));if(score)items.push({type:'person',id:m.userId,title:p?.displayName||p?.email,snippet:[p?.title,p?.department].filter(Boolean).join(' · '),createdAt:m.createdAt,score}); }
    if (wanted.has('event')) for (const e of await this.listCalendar(session)) { const score=Math.max(searchScore(e.title,q),searchScore(e.description,q));if(score)items.push({type:'event',id:e.id,title:e.title,snippet:e.description||e.kind,conversationId:e.conversationId,createdAt:e.createdAt,score}); }
    return items.sort((a,b)=>(b.score-a.score)||String(b.createdAt??'').localeCompare(String(a.createdAt??''))).slice(0,Math.min(Math.max(Number(limit)||30,1),60));
  }
}

export class PostgresStore extends BasePostgresStore {
  async workspacePeople(session) {
    const { rows } = await this.pool.query(`SELECT m.user_id "userId",p.display_name "displayName",COALESCE(p.email,u.email) email,p.title,p.department FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id WHERE m.workspace_id=$1`,[session.workspaceId]);
    return rows;
  }

  async resolveMentionedUserIds(session, body, explicitIds = []) {
    const people = await this.workspacePeople(session);
    const valid = new Set(people.map((p) => String(p.userId)));
    return resolveMentionsFromPeople(body, explicitIds, people).filter((id) => valid.has(String(id)));
  }

  async listConversations(session, { archived=false } = {}) {
    // Тот же список, что у базового хранилища, плюс счётчик упоминаний:
    // запрос один на всё приложение, чтобы копии снова не разошлись.
    const { rows } = await this.pool.query(conversationListSql(session, { withMentions: true }),
      [session.workspaceId, session.userId, Boolean(archived)]);
    return rows;
  }

  async createMessage(session, conversationId, value) {
    const mentionedUserIds = await this.resolveMentionedUserIds(session, value.body, value.mentionedUserIds);
    const message = await super.createMessage(session, conversationId, { ...value, mentionedUserIds });
    if (message.metadata?.fileId) await this.linkFile(session, message.metadata.fileId, 'message', message.id);
    await this.projectMessageNotifications(session, conversationId, { ...message, mentionedUserIds }).catch((error) => console.error('notification projection failed', error));
    return { ...message, mentionedUserIds };
  }

  // See the memory store: an edit used to leave message_mentions untouched, so
  // the mention counters described the message as it was first sent.
  async editMessage(session, messageId, body) {
    const message = await super.editMessage(session, messageId, body);
    const mentionedUserIds = await this.resolveMentionedUserIds(session, body, []);
    await this.tx(async (client) => {
      await client.query('DELETE FROM message_mentions WHERE workspace_id=$1 AND message_id=$2', [session.workspaceId, messageId]);
      for (const userId of mentionedUserIds) {
        await client.query(
          'INSERT INTO message_mentions(organization_id,workspace_id,message_id,mentioned_user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [session.organizationId, session.workspaceId, messageId, userId],
        );
      }
    });
    const updated = { ...message, mentionedUserIds };
    await this.projectMessageNotifications(session, message.conversationId, updated)
      .catch((error) => console.error('notification projection failed', error));
    return updated;
  }

  async saveVoiceMessage(session, conversationId, value) {
    const result = await super.saveVoiceMessage(session, conversationId, value);
    await this.linkFile(session, value.file.id, 'message', result.message.id);
    await this.projectMessageNotifications(session, conversationId, { ...result.message, mentionedUserIds:[] }).catch((error) => console.error('notification projection failed', error));
    return result;
  }

  async forwardMessage(session, sourceMessageId, targetConversationId) {
    const message = await super.forwardMessage(session, sourceMessageId, targetConversationId);
    if (message.metadata?.fileId) await this.linkFile(session, message.metadata.fileId, 'message', message.id);
    await this.projectMessageNotifications(session, targetConversationId, { ...message, mentionedUserIds:[] }).catch((error) => console.error('notification projection failed', error));
    return message;
  }

  async createTask(session, value) {
    const task = await super.createTask(session, value);
    if (task.ownerId && task.ownerId !== session.userId) {
      await this.insertNotification({
        organizationId:session.organizationId,workspaceId:session.workspaceId,recipientUserId:task.ownerId,
        sourceEventId:task.id,dedupeKey:`task.assigned:${task.id}:${task.ownerId}`,type:'task.assigned',
        title:`${session.displayName} поручил(а) задачу`,body:task.title,actorUserId:session.userId,commitmentId:task.id,
        url:`/#/tasks/${task.id}`,priority:['urgent','high'].includes(task.priority)?'high':'normal',metadata:{priority:task.priority},
      }).catch((error)=>console.error('task notification projection failed',error));
    }
    return task;
  }

  /**
   * Извещение о звонке.
   *
   * Звонок был слышен только тому, кто сидел у экрана: извещение уходило
   * в браузерный push и никуда больше. Отошёл от стола — и не узнал ни
   * что тебе звонили, ни что человек не смог говорить.
   */
  async projectCallNotification(session, call, { recipients=[], type='call.started', title='Звонок', body=null } = {}) {
    const targets=[...new Set(recipients.filter((id)=>id&&id!==session.userId))],rows=[];
    for(const recipientUserId of targets){
      const row=await this.insertNotification({
        organizationId:session.organizationId,workspaceId:session.workspaceId,recipientUserId,
        sourceEventId:call.id,dedupeKey:`${type}:${call.id}:${recipientUserId}`,type,title,
        body:body||call.title||'Звонок',actorUserId:session.userId,conversationId:call.conversationId??null,
        url:call.conversationId?`/#/chats/${call.conversationId}`:null,
        priority:type==='call.started'?'high':'normal',metadata:{callId:call.id,mode:call.mode??null},
      });
      if(row)rows.push(row);
    }
    return rows;
  }

  async projectTaskLifecycleNotification(session, task, { type='task.updated', title='Задача обновлена', body=null } = {}) {
    const recipients=[...new Set([task.ownerId,task.requesterId,task.acceptorId].filter((id)=>id&&id!==session.userId))],rows=[];
    for(const recipientUserId of recipients){
      const row=await this.insertNotification({
        organizationId:session.organizationId,workspaceId:session.workspaceId,recipientUserId,
        sourceEventId:task.id,dedupeKey:`${type}:${task.id}:v${task.version}:${recipientUserId}`,type,title,
        body:body||task.title,actorUserId:session.userId,commitmentId:task.id,url:`/#/tasks/${task.id}`,
        priority:['urgent','high'].includes(task.priority)?'high':'normal',metadata:{status:task.status,version:task.version},
      }).catch((error)=>{console.error('task lifecycle notification projection failed',error);return null});
      if(row)rows.push(row);
    }
    return rows;
  }

  async insertNotification(value) {
    const id=randomUUID();
    const { rows } = await this.pool.query(`INSERT INTO notifications(
      id,organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body,status,
      actor_user_id,conversation_id,message_id,commitment_id,calendar_event_id,url,priority,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'unread',$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT(workspace_id,dedupe_key) DO NOTHING
      RETURNING id,type,title,body,status,priority,url,created_at "createdAt"`,[
      id,value.organizationId,value.workspaceId,value.recipientUserId,value.sourceEventId,value.dedupeKey,value.type,value.title,value.body,
      value.actorUserId??null,value.conversationId??null,value.messageId??null,value.commitmentId??null,value.calendarEventId??null,value.url??null,value.priority??'normal',value.metadata??{}
    ]);
    return rows[0]??null;
  }

  async projectMessageNotifications(session, conversationId, message) {
    const conversation=(await this.pool.query('SELECT kind FROM conversations WHERE workspace_id=$1 AND id=$2',[session.workspaceId,conversationId])).rows[0];
    if(!conversation)return[];
    // Круга два: полный — для тех, кого назвали по имени, и очищенный от
    // приглушивших — для всех прочих. Приглушение убирает шум, а не
    // личное обращение; пока круг был один, «приглушить на восемь часов»
    // означало пропустить и прямой вопрос.
    const everyone=await this.conversationAudience(session,conversationId);
    const audience=await this.conversationNotificationAudience(session,conversationId);
    const mentioned=[...new Set((message.mentionedUserIds??[]).filter((id)=>id!==session.userId&&everyone.includes(id)))];
    const plain=['direct','group'].includes(conversation.kind)
      ? audience.filter((id)=>id!==session.userId&&!mentioned.includes(id))
      : [];

    // Уведомления вставлялись по одному, в цикле с await: сообщение в группе
    // на двести человек уходило 1 300 мс вместо 95 — курсор крутился больше
    // секунды, прежде чем собственная реплика появлялась на экране. Теперь
    // это одна вставка на всех получателей.
    const many=async(userIds,{type,title,priority})=>{
      if(!userIds.length)return[];
      const{rows}=await this.pool.query(
        `INSERT INTO notifications(organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,
                                   type,title,body,status,actor_user_id,conversation_id,message_id,url,priority)
         SELECT $1,$2,u,$3::uuid,$4||':'||$3::text||':'||u::text,$4,$5,$6,'unread',$7,$8,$3::uuid,$9,$10
           FROM unnest($11::uuid[]) u
         ON CONFLICT(workspace_id,dedupe_key) DO NOTHING
         RETURNING id,type,title,body,status,priority,url,created_at "createdAt"`,
        [session.organizationId,session.workspaceId,message.id,type,title,notificationBody(message),
         session.userId,conversationId,`/#/chats/${conversationId}?message=${message.id}`,priority,userIds]);
      return rows;
    };

    const rows=[
      ...await many(mentioned,{type:'message.mentioned',title:`Упоминание · ${session.displayName}`,priority:'high'}),
      ...await many(plain,{type:'message.created',title:`Новое сообщение · ${session.displayName}`,priority:'normal'}),
    ];
    return rows;
  }

  async markRead(session, conversationId, messageId = null) {
    // Здесь лежала своя запись отметки — голый UPDATE с `now()`. Она
    // перекрывала выверенную родительскую и вместе с ней две вещи:
    // строчку участника, которой у пришедшего по общей видимости нет, и
    // границу чтения по времени названного сообщения. Отметка «прочитано
    // до середины» стирала всё, что пришло после. Пишет теперь родитель,
    // а здесь остаётся то, ради чего наследник и заведён, — извещения.
    await super.markRead(session, conversationId, messageId);
    await this.pool.query(`UPDATE notifications SET status='read',read_at=COALESCE(read_at,now()),read_by=$3,updated_at=now() WHERE workspace_id=$1 AND conversation_id=$2 AND recipient_user_id=$3 AND status='unread'`,[session.workspaceId,conversationId,session.userId]);
  }

  async listNotifications(session, { status = null, type = null, limit = 50 } = {}) {
    const typeValue=type==='mentions'?'message.mentioned':type;
    // Тело уведомления — снимок сообщения на момент отправки. Если само
    // сообщение с тех пор удалили, показывать снимок нельзя: удаление у всех
    // должно значить у всех. Старые записи гасим на чтении — они были
    // созданы до того, как удаление стало их затирать.
    const {rows}=await this.pool.query(`SELECT n.id,n.type,n.title,
      CASE WHEN dm.id IS NOT NULL THEN 'Сообщение удалено' ELSE n.body END AS body,n.status,n.priority,n.url,n.actor_user_id "actorUserId",n.conversation_id "conversationId",n.message_id "messageId",n.commitment_id "commitmentId",n.calendar_event_id "calendarEventId",n.metadata,n.created_at "createdAt",n.read_at "readAt",p.display_name "actorName",c.title "conversationTitle"
      FROM notifications n LEFT JOIN workspace_profiles p ON p.workspace_id=n.workspace_id AND p.user_id=n.actor_user_id LEFT JOIN conversations c ON c.workspace_id=n.workspace_id AND c.id=n.conversation_id
      LEFT JOIN messages dm ON dm.workspace_id=n.workspace_id AND dm.id=n.message_id AND dm.deleted_at IS NOT NULL
      WHERE n.workspace_id=$1 AND n.recipient_user_id=$2
        -- «archived» — это не состояние прочтения, а место: разобранное,
        -- убранное с глаз. Поэтому оно выбирает архив целиком, а не
        -- строки со статусом «archived», которого не бывает.
        AND (CASE WHEN $3::text='archived' THEN n.archived_at IS NOT NULL ELSE n.archived_at IS NULL END)
        AND ($3::text IS NULL OR $3::text='archived' OR n.status=$3)
        AND ($4::text IS NULL OR n.type=$4)
      ORDER BY n.created_at DESC,n.id DESC LIMIT $5`,[session.workspaceId,session.userId,status,typeValue,Math.min(Math.max(Number(limit)||50,1),100)]);
    return rows;
  }

  /**
   * Убрать разобранное с глаз.
   *
   * Список рос бесконечно: единственным способом его разгрести было
   * «прочитать всё», после чего разобранное оставалось лежать тем же
   * списком. Архив был заложен с самого начала — колонка `archived_at`
   * есть, — но заполнять её было нечем.
   */
  async archiveNotification(session,id){
    const{rows}=await this.pool.query(`UPDATE notifications SET archived_at=now(),status=CASE WHEN status='unread' THEN 'read' ELSE status END,
      read_at=COALESCE(read_at,now()),updated_at=now()
      WHERE workspace_id=$1 AND id=$2 AND recipient_user_id=$3 AND archived_at IS NULL
      RETURNING id,type,status,archived_at "archivedAt"`,[session.workspaceId,id,session.userId]);
    return rows[0]??null;
  }

  /** Убрать в архив всё прочитанное разом. */
  async archiveReadNotifications(session){
    const{rowCount}=await this.pool.query(`UPDATE notifications SET archived_at=now(),updated_at=now()
      WHERE workspace_id=$1 AND recipient_user_id=$2 AND status='read' AND archived_at IS NULL`,
      [session.workspaceId,session.userId]);
    return rowCount;
  }

  async markNotificationRead(session,id){const{rows}=await this.pool.query(`UPDATE notifications SET status='read',read_at=COALESCE(read_at,now()),read_by=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND recipient_user_id=$3 RETURNING id,type,status,read_at "readAt"`,[session.workspaceId,id,session.userId]);return rows[0]??null}

  async markAllNotificationsRead(session,type=null){const typeValue=type==='mentions'?'message.mentioned':type,{rowCount}=await this.pool.query(`UPDATE notifications SET status='read',read_at=COALESCE(read_at,now()),read_by=$2,updated_at=now() WHERE workspace_id=$1 AND recipient_user_id=$2 AND status='unread' AND archived_at IS NULL AND($3::text IS NULL OR type=$3)`,[session.workspaceId,session.userId,typeValue]);return rowCount}

  async attentionSummary(session){
    const [conversationRows,notificationCounts,taskCounts,decisions]=await Promise.all([
      this.listConversations(session),
      this.pool.query(`SELECT count(*) FILTER(WHERE status='unread')::int unread,count(*) FILTER(WHERE status='unread' AND type='message.mentioned')::int mentions FROM notifications WHERE workspace_id=$1 AND recipient_user_id=$2 AND archived_at IS NULL`,[session.workspaceId,session.userId]),
      // Считались только задачи, которыми человек владеет. Руководитель
      // задачи раздаёт, а не исполняет, — и видел вечные нули, пока в
      // компании горели шесть просроченных. Обязательство касается троих:
      // кто делает, кто просил и кто принимает результат.
      this.pool.query(`SELECT count(*) FILTER(WHERE promised_at<now())::int overdue,
               count(*) FILTER(WHERE promised_at>=now() AND promised_at<=now()+interval '24 hours')::int due_soon
          FROM commitments
         WHERE workspace_id=$1 AND (owner_id=$2 OR requester_id=$2 OR acceptor_id=$2)
           AND status=ANY($3::text[])`,[session.workspaceId,session.userId,[...ACTIVE_TASK_STATUSES]]),
      // Работа, дошедшая до чужих рук, не значилась нигде.
      //
      // Экран «Сегодня» считал непрочитанное, упоминания и сроки — то есть
      // всё, что человек должен прочесть, и ничего из того, что он должен
      // решить. Исполнитель сдал работу и ждёт; руководителю она видна
      // одной строчкой в колокольчике, которая уходит вниз за полдня. Ход
      // при этом за ним, и пока он его не сделает, не движется никто.
      //
      // Три случая, когда мяч на стороне смотрящего: ему предложили
      // обязательство, ему сдали работу на приёмку, принятый результат
      // ждёт закрытия.
      this.pool.query(`SELECT
               count(*) FILTER(WHERE status='proposed' AND owner_id=$2)::int mine_to_answer,
               count(*) FILTER(WHERE status='in_review' AND acceptor_id=$2)::int to_review,
               count(*) FILTER(WHERE status='accepted_result' AND (requester_id=$2 OR acceptor_id=$2))::int to_close
          FROM commitments WHERE workspace_id=$1`,[session.workspaceId,session.userId])
    ]);
    const n=notificationCounts.rows[0]??{},t=taskCounts.rows[0]??{},d=decisions.rows[0]??{};
    return{unreadMessages:conversationRows.reduce((sum,c)=>sum+Number(c.unreadCount||0),0),unreadConversations:conversationRows.filter(c=>c.unreadCount>0).length,unreadNotifications:Number(n.unread||0),mentions:Number(n.mentions||0),overdueTasks:Number(t.overdue||0),dueSoonTasks:Number(t.due_soon||0),
      awaitingMyDecision:Number(d.mine_to_answer||0)+Number(d.to_review||0)+Number(d.to_close||0),
      tasksToAnswer:Number(d.mine_to_answer||0),tasksToReview:Number(d.to_review||0),tasksToClose:Number(d.to_close||0)};
  }

  async linkFile(session,fileId,entityType,entityId){await this.pool.query(`INSERT INTO file_links(organization_id,workspace_id,file_id,entity_type,entity_id,linked_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[session.organizationId,session.workspaceId,fileId,entityType,entityId,session.userId])}

  async canAccessFile(session,fileId){const{rowCount}=await this.pool.query(`SELECT 1 FROM files f WHERE f.workspace_id=$1 AND f.id=$2 AND f.deleted_at IS NULL AND(f.uploaded_by=$3 OR($4::boolean AND EXISTS(SELECT 1 FROM stories st WHERE st.workspace_id=f.workspace_id AND st.file_id=f.id AND st.deleted_at IS NULL AND st.expires_at>now())) OR EXISTS(SELECT 1 FROM file_links fl JOIN messages m ON fl.workspace_id=m.workspace_id AND fl.entity_type='message' AND fl.entity_id=m.id JOIN conversations c ON c.workspace_id=m.workspace_id AND c.id=m.conversation_id LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$3 WHERE fl.workspace_id=f.workspace_id AND fl.file_id=f.id AND m.deleted_at IS NULL AND c.archived_at IS NULL AND(${openConversationSql(session,'c')} OR cm.user_id IS NOT NULL)))`,[session.workspaceId,fileId,session.userId,session.role!=='guest']);return rowCount>0}

  async getFile(session,id){if(!await this.canAccessFile(session,id))return null;return super.getFile(session,id)}

  async listFiles(session,{query='',mime=null,limit=60,cursor=null}={}){
    const size=Math.min(Math.max(Number(limit)||60,1),100);
    const q=String(query??'').trim();
    const{rows}=await this.pool.query(`SELECT f.id,f.name,f.mime_type "mimeType",f.size_bytes "sizeBytes",f.storage_key "storageKey",f.sha256,f.status,f.created_at "createdAt",f.uploaded_by "uploadedBy",p.display_name "uploaderName",ctx.message_id "messageId",ctx.conversation_id "conversationId",ctx.conversation_title "conversationTitle",ctx.conversation_kind "conversationKind"
      FROM files f LEFT JOIN workspace_profiles p ON p.workspace_id=f.workspace_id AND p.user_id=f.uploaded_by
      LEFT JOIN LATERAL(SELECT m.id message_id,c.id conversation_id,c.title conversation_title,c.kind conversation_kind FROM file_links fl JOIN messages m ON m.workspace_id=fl.workspace_id AND fl.entity_type='message' AND m.id=fl.entity_id JOIN conversations c ON c.workspace_id=m.workspace_id AND c.id=m.conversation_id LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$2 WHERE fl.workspace_id=f.workspace_id AND fl.file_id=f.id AND m.deleted_at IS NULL AND c.archived_at IS NULL AND(${openConversationSql(session,'c')} OR cm.user_id IS NOT NULL) ORDER BY fl.created_at DESC LIMIT 1)ctx ON true
      WHERE f.workspace_id=$1 AND f.deleted_at IS NULL AND f.status<>'deleted' AND(f.uploaded_by=$2 OR ctx.message_id IS NOT NULL) AND($3='' OR f.name ILIKE '%'||replace(replace(replace($3,'\\','\\\\'),'%','\\%'),'_','\\_')||'%') AND($4::text IS NULL OR f.mime_type LIKE $4||'%') AND($6::timestamptz IS NULL OR f.created_at<$6) ORDER BY f.created_at DESC,f.id DESC LIMIT $5`,[session.workspaceId,session.userId,q,mime,size+1,cursor||null]);
    // Список обрывался на сотне и молчал об этом: после сто первого
    // файла остальные были недостижимы с экрана. Курсор — время
    // последнего показанного файла, как у сообщений и задач.
    const page=rows.slice(0,size);
    const items=page.map(r=>({...r,context:r.messageId?{messageId:r.messageId,conversationId:r.conversationId,conversationTitle:r.conversationTitle,conversationKind:r.conversationKind}:null,contentUrl:`/api/v1/files/${r.id}/content`,previewUrl:/^(image\/(?!svg\+xml)|application\/pdf$|text\/plain|audio\/|video\/)/.test(r.mimeType??'')?`/api/v1/files/${r.id}/preview`:null}));
    items.nextCursor=rows.length>size?page[page.length-1]?.createdAt??null:null;
    return items;
  }


}
