import { randomUUID } from 'node:crypto';
import { MemoryStore as BaseMemoryStore } from './memory-store.js';
import { PostgresStore as BasePostgresStore } from './postgres-store.js';

const clone = (value) => value == null ? value : structuredClone(value);
const nowIso = () => new Date().toISOString();
const ACTIVE_TASK_STATUSES = new Set(['inbox','clarify','proposed','accepted','scheduled','in_progress','blocked','in_review','deferred']);

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

function resolveMentionsFromPeople(body, explicitIds, people) {
  const ids = new Set((explicitIds ?? []).map(String));
  const text = String(body ?? '').toLowerCase();
  if (!text) return [...ids];
  for (const person of people) {
    const userId = String(person.userId ?? person.user_id ?? '');
    if (!userId) continue;
    const handles = mentionHandles(person);
    if (handles.some((handle) => text.includes(`@${handle}`))) ids.add(userId);
  }
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
        title:`Новая задача от ${session.displayName}`,
        body:task.title,
        actorUserId:session.userId,
        commitmentId:task.id,
        url:`/#/tasks/${task.id}`,
        priority:['urgent','high'].includes(task.priority) ? 'high' : 'normal',
      });
    }
    return task;
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
    const audience = await this.conversationNotificationAudience(session, conversationId);
    const mentioned = new Set((message.mentionedUserIds ?? []).filter((id) => id !== session.userId && audience.includes(id)));
    const rows = [];
    for (const userId of mentioned) {
      rows.push(this.putNotification({
        organizationId:session.organizationId, workspaceId:session.workspaceId, recipientUserId:userId,
        sourceEventId:message.id, dedupeKey:`message.mentioned:${message.id}:${userId}`, type:'message.mentioned',
        title:`Упоминание от ${session.displayName}`, body:notificationBody(message), actorUserId:session.userId,
        conversationId, messageId:message.id, url:`/#/chats/${conversationId}?message=${message.id}`, priority:'high',
      }));
    }
    if (['direct','group'].includes(conversation.kind)) {
      for (const userId of audience) {
        if (userId === session.userId || mentioned.has(userId)) continue;
        rows.push(this.putNotification({
          organizationId:session.organizationId, workspaceId:session.workspaceId, recipientUserId:userId,
          sourceEventId:message.id, dedupeKey:`message.created:${message.id}:${userId}`, type:'message.created',
          title:`Новое сообщение от ${session.displayName}`, body:notificationBody(message), actorUserId:session.userId,
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
    const tasks = [...this.tasks.values()].filter((t) => t.workspaceId === session.workspaceId && t.ownerId === session.userId && ACTIVE_TASK_STATUSES.has(t.status));
    const now = Date.now(), soon = now + 24*60*60*1000;
    return {
      unreadMessages:conversations.reduce((sum,c) => sum + Number(c.unreadCount || 0), 0),
      unreadConversations:conversations.filter((c) => c.unreadCount > 0).length,
      unreadNotifications:notifications.length,
      mentions:notifications.filter((n) => n.type === 'message.mentioned').length,
      overdueTasks:tasks.filter((t) => t.promisedAt && Date.parse(t.promisedAt) < now).length,
      dueSoonTasks:tasks.filter((t) => t.promisedAt && Date.parse(t.promisedAt) >= now && Date.parse(t.promisedAt) <= soon).length,
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
      rows.push({ ...clone(file), uploaderName:profile?.displayName ?? null, context:this.fileContext(session,file.id), contentUrl:`/api/v1/files/${file.id}/content`, previewUrl:/^(image\/|application\/pdf$|text\/)/.test(file.mimeType ?? '')?`/api/v1/files/${file.id}/preview`:null });
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
    const { rows } = await this.pool.query(`
      SELECT c.id,c.kind,c.title,c.slug,c.purpose,c.visibility,c.announcement_only "announcementOnly",c.created_at "createdAt",
        cm.archived_at "archivedAt",cm.muted_until "mutedUntil",
        (SELECT jsonb_build_object('id',m.id,'body',m.body,'kind',m.kind,'authorId',m.author_id,'createdAt',m.created_at)
          FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.id AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC,m.id DESC LIMIT 1) "lastMessage",
        COALESCE((SELECT count(*) FROM messages um
          WHERE um.workspace_id=c.workspace_id AND um.conversation_id=c.id AND um.deleted_at IS NULL AND um.author_id<>$2
            AND um.created_at>COALESCE(cm.last_read_at,cm.joined_at,'epoch'::timestamptz)),0)::int "unreadCount",
        COALESCE((SELECT count(*) FROM message_mentions mm JOIN messages xm ON xm.workspace_id=mm.workspace_id AND xm.id=mm.message_id
          WHERE mm.workspace_id=c.workspace_id AND mm.mentioned_user_id=$2 AND xm.conversation_id=c.id AND xm.deleted_at IS NULL
            AND xm.created_at>COALESCE(cm.last_read_at,cm.joined_at,'epoch'::timestamptz)),0)::int "mentionCount"
      FROM conversations c
      LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$2
      WHERE c.workspace_id=$1 AND c.archived_at IS NULL AND(c.visibility IN('workspace','organization') OR cm.user_id IS NOT NULL)
        AND(($3::boolean AND cm.archived_at IS NOT NULL) OR (NOT $3::boolean AND cm.archived_at IS NULL))
      ORDER BY COALESCE((SELECT max(created_at) FROM messages m2 WHERE m2.workspace_id=c.workspace_id AND m2.conversation_id=c.id),c.created_at) DESC`,[session.workspaceId,session.userId,Boolean(archived)]);
    return rows;
  }

  async createMessage(session, conversationId, value) {
    const mentionedUserIds = await this.resolveMentionedUserIds(session, value.body, value.mentionedUserIds);
    const message = await super.createMessage(session, conversationId, { ...value, mentionedUserIds });
    if (message.metadata?.fileId) await this.linkFile(session, message.metadata.fileId, 'message', message.id);
    await this.projectMessageNotifications(session, conversationId, { ...message, mentionedUserIds }).catch((error) => console.error('notification projection failed', error));
    return { ...message, mentionedUserIds };
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
        title:`Новая задача от ${session.displayName}`,body:task.title,actorUserId:session.userId,commitmentId:task.id,
        url:`/#/tasks/${task.id}`,priority:['urgent','high'].includes(task.priority)?'high':'normal',metadata:{priority:task.priority},
      }).catch((error)=>console.error('task notification projection failed',error));
    }
    return task;
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
    const audience=await this.conversationNotificationAudience(session,conversationId),mentioned=new Set((message.mentionedUserIds??[]).filter((id)=>id!==session.userId&&audience.includes(id))),rows=[];
    for(const userId of mentioned){const row=await this.insertNotification({organizationId:session.organizationId,workspaceId:session.workspaceId,recipientUserId:userId,sourceEventId:message.id,dedupeKey:`message.mentioned:${message.id}:${userId}`,type:'message.mentioned',title:`Упоминание от ${session.displayName}`,body:notificationBody(message),actorUserId:session.userId,conversationId,messageId:message.id,url:`/#/chats/${conversationId}?message=${message.id}`,priority:'high'});if(row)rows.push(row)}
    if(['direct','group'].includes(conversation.kind))for(const userId of audience){if(userId===session.userId||mentioned.has(userId))continue;const row=await this.insertNotification({organizationId:session.organizationId,workspaceId:session.workspaceId,recipientUserId:userId,sourceEventId:message.id,dedupeKey:`message.created:${message.id}:${userId}`,type:'message.created',title:`Новое сообщение от ${session.displayName}`,body:notificationBody(message),actorUserId:session.userId,conversationId,messageId:message.id,url:`/#/chats/${conversationId}?message=${message.id}`,priority:'normal'});if(row)rows.push(row)}
    return rows;
  }

  async markRead(session, conversationId, messageId = null) {
    await this.tx(async c=>{
      await c.query('UPDATE conversation_members SET last_read_at=now(),last_read_message_id=$4 WHERE workspace_id=$1 AND conversation_id=$2 AND user_id=$3',[session.workspaceId,conversationId,session.userId,messageId]);
      await c.query(`UPDATE notifications SET status='read',read_at=COALESCE(read_at,now()),read_by=$3,updated_at=now() WHERE workspace_id=$1 AND conversation_id=$2 AND recipient_user_id=$3 AND status='unread'`,[session.workspaceId,conversationId,session.userId]);
    });
  }

  async listNotifications(session, { status = null, type = null, limit = 50 } = {}) {
    const typeValue=type==='mentions'?'message.mentioned':type;
    const {rows}=await this.pool.query(`SELECT n.id,n.type,n.title,n.body,n.status,n.priority,n.url,n.actor_user_id "actorUserId",n.conversation_id "conversationId",n.message_id "messageId",n.commitment_id "commitmentId",n.calendar_event_id "calendarEventId",n.metadata,n.created_at "createdAt",n.read_at "readAt",p.display_name "actorName",c.title "conversationTitle"
      FROM notifications n LEFT JOIN workspace_profiles p ON p.workspace_id=n.workspace_id AND p.user_id=n.actor_user_id LEFT JOIN conversations c ON c.workspace_id=n.workspace_id AND c.id=n.conversation_id
      WHERE n.workspace_id=$1 AND n.recipient_user_id=$2 AND n.archived_at IS NULL AND($3::text IS NULL OR n.status=$3) AND($4::text IS NULL OR n.type=$4)
      ORDER BY n.created_at DESC,n.id DESC LIMIT $5`,[session.workspaceId,session.userId,status,typeValue,Math.min(Math.max(Number(limit)||50,1),100)]);
    return rows;
  }

  async markNotificationRead(session,id){const{rows}=await this.pool.query(`UPDATE notifications SET status='read',read_at=COALESCE(read_at,now()),read_by=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND recipient_user_id=$3 RETURNING id,type,status,read_at "readAt"`,[session.workspaceId,id,session.userId]);return rows[0]??null}

  async markAllNotificationsRead(session,type=null){const typeValue=type==='mentions'?'message.mentioned':type,{rowCount}=await this.pool.query(`UPDATE notifications SET status='read',read_at=COALESCE(read_at,now()),read_by=$2,updated_at=now() WHERE workspace_id=$1 AND recipient_user_id=$2 AND status='unread' AND archived_at IS NULL AND($3::text IS NULL OR type=$3)`,[session.workspaceId,session.userId,typeValue]);return rowCount}

  async attentionSummary(session){
    const [conversationRows,notificationCounts,taskCounts]=await Promise.all([
      this.listConversations(session),
      this.pool.query(`SELECT count(*) FILTER(WHERE status='unread')::int unread,count(*) FILTER(WHERE status='unread' AND type='message.mentioned')::int mentions FROM notifications WHERE workspace_id=$1 AND recipient_user_id=$2 AND archived_at IS NULL`,[session.workspaceId,session.userId]),
      this.pool.query(`SELECT count(*) FILTER(WHERE promised_at<now())::int overdue,count(*) FILTER(WHERE promised_at>=now() AND promised_at<=now()+interval '24 hours')::int due_soon FROM commitments WHERE workspace_id=$1 AND owner_id=$2 AND status=ANY($3::text[])`,[session.workspaceId,session.userId,[...ACTIVE_TASK_STATUSES]])
    ]);
    const n=notificationCounts.rows[0]??{},t=taskCounts.rows[0]??{};
    return{unreadMessages:conversationRows.reduce((sum,c)=>sum+Number(c.unreadCount||0),0),unreadConversations:conversationRows.filter(c=>c.unreadCount>0).length,unreadNotifications:Number(n.unread||0),mentions:Number(n.mentions||0),overdueTasks:Number(t.overdue||0),dueSoonTasks:Number(t.due_soon||0)};
  }

  async linkFile(session,fileId,entityType,entityId){await this.pool.query(`INSERT INTO file_links(organization_id,workspace_id,file_id,entity_type,entity_id,linked_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[session.organizationId,session.workspaceId,fileId,entityType,entityId,session.userId])}

  async canAccessFile(session,fileId){const{rowCount}=await this.pool.query(`SELECT 1 FROM files f WHERE f.workspace_id=$1 AND f.id=$2 AND f.deleted_at IS NULL AND(f.uploaded_by=$3 OR EXISTS(SELECT 1 FROM file_links fl JOIN messages m ON fl.workspace_id=m.workspace_id AND fl.entity_type='message' AND fl.entity_id=m.id JOIN conversations c ON c.workspace_id=m.workspace_id AND c.id=m.conversation_id LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$3 WHERE fl.workspace_id=f.workspace_id AND fl.file_id=f.id AND m.deleted_at IS NULL AND c.archived_at IS NULL AND(c.visibility IN('workspace','organization') OR cm.user_id IS NOT NULL)))`,[session.workspaceId,fileId,session.userId]);return rowCount>0}

  async getFile(session,id){if(!await this.canAccessFile(session,id))return null;return super.getFile(session,id)}

  async listFiles(session,{query='',mime=null,limit=60}={}){
    const q=String(query??'').trim();
    const{rows}=await this.pool.query(`SELECT f.id,f.name,f.mime_type "mimeType",f.size_bytes "sizeBytes",f.storage_key "storageKey",f.sha256,f.status,f.created_at "createdAt",f.uploaded_by "uploadedBy",p.display_name "uploaderName",ctx.message_id "messageId",ctx.conversation_id "conversationId",ctx.conversation_title "conversationTitle",ctx.conversation_kind "conversationKind"
      FROM files f LEFT JOIN workspace_profiles p ON p.workspace_id=f.workspace_id AND p.user_id=f.uploaded_by
      LEFT JOIN LATERAL(SELECT m.id message_id,c.id conversation_id,c.title conversation_title,c.kind conversation_kind FROM file_links fl JOIN messages m ON m.workspace_id=fl.workspace_id AND fl.entity_type='message' AND m.id=fl.entity_id JOIN conversations c ON c.workspace_id=m.workspace_id AND c.id=m.conversation_id LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$2 WHERE fl.workspace_id=f.workspace_id AND fl.file_id=f.id AND m.deleted_at IS NULL AND c.archived_at IS NULL AND(c.visibility IN('workspace','organization') OR cm.user_id IS NOT NULL) ORDER BY fl.created_at DESC LIMIT 1)ctx ON true
      WHERE f.workspace_id=$1 AND f.deleted_at IS NULL AND f.status<>'deleted' AND(f.uploaded_by=$2 OR ctx.message_id IS NOT NULL) AND($3='' OR f.name ILIKE '%'||$3||'%') AND($4::text IS NULL OR f.mime_type LIKE $4||'%') ORDER BY f.created_at DESC LIMIT $5`,[session.workspaceId,session.userId,q,mime,Math.min(Math.max(Number(limit)||60,1),100)]);
    return rows.map(r=>({...r,context:r.messageId?{messageId:r.messageId,conversationId:r.conversationId,conversationTitle:r.conversationTitle,conversationKind:r.conversationKind}:null,contentUrl:`/api/v1/files/${r.id}/content`,previewUrl:/^(image\/|application\/pdf$|text\/)/.test(r.mimeType??'')?`/api/v1/files/${r.id}/preview`:null}));
  }

  async searchWorkspace(session,query,{types=null,limit=30}={}){
    const q=String(query??'').trim();if(q.length<2)return[];const wanted=new Set(types?.length?types:['message','conversation','task','file','person','event']),each=Math.min(Math.max(Number(limit)||30,5),60),items=[],like=`%${q}%`;
    const jobs=[];
    if(wanted.has('message'))jobs.push(this.pool.query(`SELECT 'message' type,m.id,COALESCE(c.title,'Диалог') title,m.body snippet,m.conversation_id "conversationId",m.author_id "authorId",p.display_name "authorName",m.created_at "createdAt",ts_rank_cd(to_tsvector('simple',coalesce(m.body,'')),plainto_tsquery('simple',$3)) score FROM messages m JOIN conversations c ON c.workspace_id=m.workspace_id AND c.id=m.conversation_id LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$2 LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.author_id WHERE m.workspace_id=$1 AND m.deleted_at IS NULL AND c.archived_at IS NULL AND(c.visibility IN('workspace','organization') OR cm.user_id IS NOT NULL) AND(to_tsvector('simple',coalesce(m.body,''))@@plainto_tsquery('simple',$3) OR m.body ILIKE $4) ORDER BY score DESC,m.created_at DESC LIMIT $5`,[session.workspaceId,session.userId,q,like,each]).then(r=>items.push(...r.rows)));
    if(wanted.has('conversation'))jobs.push(this.pool.query(`SELECT 'conversation' type,c.id,COALESCE(c.title,'Диалог') title,COALESCE(c.purpose,'') snippet,c.id "conversationId",c.created_at "createdAt",ts_rank_cd(to_tsvector('simple',coalesce(c.title,'')||' '||coalesce(c.purpose,'')),plainto_tsquery('simple',$3)) score FROM conversations c LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$2 WHERE c.workspace_id=$1 AND c.archived_at IS NULL AND(c.visibility IN('workspace','organization') OR cm.user_id IS NOT NULL) AND(to_tsvector('simple',coalesce(c.title,'')||' '||coalesce(c.purpose,''))@@plainto_tsquery('simple',$3) OR c.title ILIKE $4 OR c.purpose ILIKE $4) ORDER BY score DESC,c.created_at DESC LIMIT $5`,[session.workspaceId,session.userId,q,like,each]).then(r=>items.push(...r.rows)));
    if(wanted.has('task'))jobs.push(this.pool.query(`SELECT 'task' type,id,title,outcome snippet,status,created_at "createdAt",ts_rank_cd(to_tsvector('simple',coalesce(title,'')||' '||coalesce(outcome,'')),plainto_tsquery('simple',$3)) score FROM commitments WHERE workspace_id=$1 AND(owner_id=$2 OR requester_id=$2 OR acceptor_id=$2) AND(to_tsvector('simple',coalesce(title,'')||' '||coalesce(outcome,''))@@plainto_tsquery('simple',$3) OR title ILIKE $4 OR outcome ILIKE $4) ORDER BY score DESC,created_at DESC LIMIT $5`,[session.workspaceId,session.userId,q,like,each]).then(r=>items.push(...r.rows)));
    if(wanted.has('person'))jobs.push(this.pool.query(`SELECT 'person' type,m.user_id id,COALESCE(p.display_name,u.email) title,concat_ws(' · ',p.title,p.department) snippet,m.created_at "createdAt",ts_rank_cd(to_tsvector('simple',coalesce(p.display_name,'')||' '||coalesce(p.email,u.email)||' '||coalesce(p.title,'')||' '||coalesce(p.department,'')),plainto_tsquery('simple',$3)) score FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id WHERE m.workspace_id=$1 AND(to_tsvector('simple',coalesce(p.display_name,'')||' '||coalesce(p.email,u.email)||' '||coalesce(p.title,'')||' '||coalesce(p.department,''))@@plainto_tsquery('simple',$3) OR p.display_name ILIKE $4 OR COALESCE(p.email,u.email) ILIKE $4 OR p.title ILIKE $4 OR p.department ILIKE $4) ORDER BY score DESC,m.created_at DESC LIMIT $5`,[session.workspaceId,session.userId,q,like,each]).then(r=>items.push(...r.rows)));
    if(wanted.has('event'))jobs.push(this.pool.query(`SELECT 'event' type,e.id,e.title,COALESCE(e.description,e.kind) snippet,e.conversation_id "conversationId",e.created_at "createdAt",ts_rank_cd(to_tsvector('simple',coalesce(e.title,'')||' '||coalesce(e.description,'')),plainto_tsquery('simple',$3)) score FROM calendar_events e LEFT JOIN calendar_event_participants ep ON ep.workspace_id=e.workspace_id AND ep.calendar_event_id=e.id AND ep.user_id=$2 WHERE e.workspace_id=$1 AND(e.owner_id=$2 OR e.visibility='workspace' OR ep.user_id IS NOT NULL) AND(to_tsvector('simple',coalesce(e.title,'')||' '||coalesce(e.description,''))@@plainto_tsquery('simple',$3) OR e.title ILIKE $4 OR e.description ILIKE $4) ORDER BY score DESC,e.created_at DESC LIMIT $5`,[session.workspaceId,session.userId,q,like,each]).then(r=>items.push(...r.rows)));
    if(wanted.has('file'))jobs.push(this.listFiles(session,{query:q,limit:each}).then(rows=>items.push(...rows.map(f=>({type:'file',id:f.id,title:f.name,snippet:f.mimeType,conversationId:f.context?.conversationId,messageId:f.context?.messageId,createdAt:f.createdAt,previewUrl:f.previewUrl,contentUrl:f.contentUrl,score:1})))));
    await Promise.all(jobs);return items.sort((a,b)=>(Number(b.score||0)-Number(a.score||0))||String(b.createdAt??'').localeCompare(String(a.createdAt??''))).slice(0,Math.min(Math.max(Number(limit)||30,1),60));
  }
}
