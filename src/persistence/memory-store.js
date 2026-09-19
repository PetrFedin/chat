import { randomUUID } from 'node:crypto';

function nowIso() { return new Date().toISOString(); }
function clone(value) { return value == null ? value : structuredClone(value); }

export class MemoryStore {
  constructor() {
    this.users = new Map();
    this.userByEmail = new Map();
    this.credentials = new Map();
    this.sessions = new Map();
    this.organizations = new Map();
    this.workspaces = new Map();
    this.memberships = new Map();
    this.profiles = new Map();
    this.conversations = new Map();
    this.conversationMembers = new Map();
    this.messages = new Map();
    this.reactions = new Map();
    this.readState = new Map();
    this.presence = new Map();
    this.invitations = new Map();
    this.files = new Map();
    this.voiceMessages = new Map();
    this.pushSubscriptions = new Map();
    this.tasks = new Map();
    this.calendarEvents = new Map();
  }

  membershipKey(workspaceId, userId) { return `${workspaceId}:${userId}`; }
  conversationMemberKey(conversationId, userId) { return `${conversationId}:${userId}`; }

  async createCompany({ companyName, workspaceName, ownerName, email, passwordHash, passwordSalt }) {
    if (this.userByEmail.has(email)) throw Object.assign(new Error('Email already registered'), { code: 'EMAIL_EXISTS', statusCode: 409 });
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const userId = randomUUID();
    const createdAt = nowIso();
    const user = { id: userId, email, createdAt };
    const organization = { id: organizationId, name: companyName, createdAt };
    const workspace = { id: workspaceId, organizationId, name: workspaceName || companyName, createdAt };
    const membership = { organizationId, workspaceId, userId, role: 'owner', createdAt };
    const profile = { workspaceId, userId, displayName: ownerName, email, title: 'Владелец', timezone: 'UTC' };
    this.users.set(userId, user); this.userByEmail.set(email, userId);
    this.credentials.set(userId, { passwordHash, passwordSalt });
    this.organizations.set(organizationId, organization); this.workspaces.set(workspaceId, workspace);
    this.memberships.set(this.membershipKey(workspaceId, userId), membership); this.profiles.set(this.membershipKey(workspaceId, userId), profile);
    for (const [slug, title, announcementOnly] of [['general','Общий',false],['announcements','Объявления',true]]) {
      const conversation = { id: randomUUID(), organizationId, workspaceId, kind: 'channel', title, slug, visibility: 'workspace', announcementOnly, createdBy: userId, createdAt };
      this.conversations.set(conversation.id, conversation);
      this.conversationMembers.set(this.conversationMemberKey(conversation.id, userId), { conversationId: conversation.id, workspaceId, userId, role: 'owner' });
      this.messages.set(conversation.id, []);
    }
    return { user, organization, workspace, membership, profile };
  }

  async findAuthByEmail(email) {
    const userId = this.userByEmail.get(email); if (!userId) return null;
    const user = this.users.get(userId); const credential = this.credentials.get(userId);
    const membership = [...this.memberships.values()].find((item) => item.userId === userId);
    return membership ? { ...clone(user), ...clone(credential), workspaceId: membership.workspaceId } : null;
  }

  async createSession({ userId, workspaceId, tokenHash, expiresAt, userAgent = null, ipAddress = null }) {
    const id = randomUUID();
    this.sessions.set(tokenHash, { id, userId, workspaceId, tokenHash, expiresAt, userAgent, ipAddress, createdAt: nowIso(), revokedAt: null });
    return { id, expiresAt };
  }

  async getSession(tokenHash) {
    const row = this.sessions.get(tokenHash);
    if (!row || row.revokedAt || Date.parse(row.expiresAt) <= Date.now()) return null;
    const membership = this.memberships.get(this.membershipKey(row.workspaceId, row.userId)); if (!membership) return null;
    const workspace = this.workspaces.get(row.workspaceId); const organization = this.organizations.get(workspace.organizationId);
    const user = this.users.get(row.userId); const profile = this.profiles.get(this.membershipKey(row.workspaceId, row.userId));
    return { sessionId: row.id, userId: row.userId, workspaceId: row.workspaceId, organizationId: workspace.organizationId, role: membership.role, email: user.email, displayName: profile?.displayName ?? user.email, workspaceName: workspace.name, organizationName: organization.name, profile: clone(profile) };
  }

  async revokeSession(tokenHash) { const row = this.sessions.get(tokenHash); if (row) row.revokedAt = nowIso(); }

  async getBootstrap(session) {
    const conversations = await this.listConversations(session);
    const people = [...this.memberships.values()].filter((m) => m.workspaceId === session.workspaceId).map((m) => ({ ...clone(this.profiles.get(this.membershipKey(m.workspaceId, m.userId))), userId: m.userId, role: m.role, presence: clone(this.presence.get(this.membershipKey(m.workspaceId, m.userId)) ?? { state: 'offline' }) }));
    return { session, conversations, people };
  }

  async createInvitation(session, { email, role, tokenHash, expiresAt }) {
    const row = { id: randomUUID(), organizationId: session.organizationId, workspaceId: session.workspaceId, email, role, invitedBy: session.userId, tokenHash, status: 'pending', expiresAt, createdAt: nowIso() };
    this.invitations.set(row.id, row); return clone(row);
  }

  async acceptInvitation({ tokenHash, displayName, passwordHash, passwordSalt }) {
    const invitation=[...this.invitations.values()].find((row)=>row.tokenHash===tokenHash);
    if(!invitation || invitation.status!=='pending') throw Object.assign(new Error('Invitation is not available'),{code:'INVITATION_NOT_FOUND',statusCode:404});
    if(Date.parse(invitation.expiresAt)<=Date.now()) throw Object.assign(new Error('Invitation has expired'),{code:'INVITATION_EXPIRED',statusCode:410});
    if(this.userByEmail.has(invitation.email)) throw Object.assign(new Error('This email already has an account; sign in before joining another workspace'),{code:'EXISTING_ACCOUNT_LOGIN_REQUIRED',statusCode:409});
    const userId=randomUUID(),createdAt=nowIso(),user={id:userId,email:invitation.email,createdAt};
    this.users.set(userId,user);this.userByEmail.set(invitation.email,userId);this.credentials.set(userId,{passwordHash,passwordSalt});
    this.memberships.set(this.membershipKey(invitation.workspaceId,userId),{organizationId:invitation.organizationId,workspaceId:invitation.workspaceId,userId,role:invitation.role,createdAt});
    this.profiles.set(this.membershipKey(invitation.workspaceId,userId),{workspaceId:invitation.workspaceId,userId,displayName,email:invitation.email,timezone:'UTC'});
    for(const conversation of this.conversations.values()) if(conversation.workspaceId===invitation.workspaceId && conversation.kind==='channel' && conversation.visibility==='workspace') this.conversationMembers.set(this.conversationMemberKey(conversation.id,userId),{conversationId:conversation.id,workspaceId:invitation.workspaceId,userId,role:'member'});
    invitation.status='accepted';invitation.acceptedBy=userId;invitation.acceptedAt=createdAt;
    return {user,workspace:this.workspaces.get(invitation.workspaceId),membership:this.memberships.get(this.membershipKey(invitation.workspaceId,userId))};
  }

  async listConversations(session) {
    return [...this.conversations.values()].filter((c) => c.workspaceId === session.workspaceId && (c.visibility !== 'private' || this.conversationMembers.has(this.conversationMemberKey(c.id, session.userId)))).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((c) => {
      const list = this.messages.get(c.id) ?? []; const lastMessage = list.at(-1) ?? null;
      return { ...clone(c), lastMessage: clone(lastMessage), unreadCount: 0 };
    });
  }

  async canAccessConversation(session, conversationId) {
    const conversation = this.conversations.get(conversationId);
    return Boolean(conversation && !conversation.archivedAt && conversation.workspaceId === session.workspaceId && (conversation.visibility !== 'private' || this.conversationMembers.has(this.conversationMemberKey(conversationId, session.userId))));
  }

  async conversationPolicy(session, conversationId) {
    if (!(await this.canAccessConversation(session, conversationId))) return null;
    const conversation = this.conversations.get(conversationId);
    const member = this.conversationMembers.get(this.conversationMemberKey(conversationId, session.userId));
    return { conversation: clone(conversation), memberRole: member?.role ?? null };
  }

  async listConversationMembers(session, conversationId) {
    if (!(await this.canAccessConversation(session, conversationId))) throw Object.assign(new Error('Conversation not found'), { code:'NOT_FOUND', statusCode:404 });
    return clone([...this.conversationMembers.values()]
      .filter((m) => m.workspaceId === session.workspaceId && m.conversationId === conversationId)
      .map((m) => {
        const profile = this.profiles.get(this.membershipKey(session.workspaceId, m.userId)) ?? {};
        const membership = this.memberships.get(this.membershipKey(session.workspaceId, m.userId)) ?? {};
        return { userId:m.userId, role:m.role, displayName:profile.displayName ?? profile.email ?? m.userId, email:profile.email ?? null, title:profile.title ?? null, workspaceRole:membership.role ?? null };
      })
      .sort((a,b) => String(a.displayName).localeCompare(String(b.displayName))));
  }

  assertConversationUser(session, userId) {
    if (!this.memberships.has(this.membershipKey(session.workspaceId, userId))) {
      throw Object.assign(new Error('Conversation participant must belong to the workspace'), { code:'INVALID_CONVERSATION_MEMBER', statusCode:400 });
    }
  }

  async addConversationMembers(session, conversationId, userIds, role='member') {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.workspaceId !== session.workspaceId || conversation.archivedAt) throw Object.assign(new Error('Conversation not found'), { code:'NOT_FOUND', statusCode:404 });
    if (conversation.kind === 'direct') throw Object.assign(new Error('Direct conversation membership is immutable'), { code:'DIRECT_MEMBERSHIP_IMMUTABLE', statusCode:409 });
    for (const userId of new Set(userIds)) {
      this.assertConversationUser(session, userId);
      const key=this.conversationMemberKey(conversationId,userId);
      const existing=this.conversationMembers.get(key);
      this.conversationMembers.set(key,{conversationId,workspaceId:session.workspaceId,userId,role:existing?.role ?? role,joinedAt:existing?.joinedAt ?? nowIso()});
    }
    return this.listConversationMembers(session, conversationId);
  }

  async setConversationMemberRole(session, conversationId, userId, role) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.workspaceId !== session.workspaceId || conversation.archivedAt) throw Object.assign(new Error('Conversation not found'), { code:'NOT_FOUND', statusCode:404 });
    if (conversation.kind === 'direct') throw Object.assign(new Error('Direct conversation membership is immutable'), { code:'DIRECT_MEMBERSHIP_IMMUTABLE', statusCode:409 });
    const key=this.conversationMemberKey(conversationId,userId),member=this.conversationMembers.get(key);
    if(!member)throw Object.assign(new Error('Conversation member not found'),{code:'CONVERSATION_MEMBER_NOT_FOUND',statusCode:404});
    if(member.role==='owner'&&role!=='owner'){
      const owners=[...this.conversationMembers.values()].filter((m)=>m.conversationId===conversationId&&m.workspaceId===session.workspaceId&&m.role==='owner');
      if(owners.length<=1)throw Object.assign(new Error('Conversation must keep at least one owner'),{code:'LAST_CONVERSATION_OWNER',statusCode:409});
    }
    member.role=role;
    return this.listConversationMembers(session, conversationId);
  }

  async removeConversationMember(session, conversationId, userId) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.workspaceId !== session.workspaceId || conversation.archivedAt) throw Object.assign(new Error('Conversation not found'), { code:'NOT_FOUND', statusCode:404 });
    if (conversation.kind === 'direct') throw Object.assign(new Error('Direct conversation membership is immutable'), { code:'DIRECT_MEMBERSHIP_IMMUTABLE', statusCode:409 });
    const key=this.conversationMemberKey(conversationId,userId),member=this.conversationMembers.get(key);
    if(!member)throw Object.assign(new Error('Conversation member not found'),{code:'CONVERSATION_MEMBER_NOT_FOUND',statusCode:404});
    if(member.role==='owner'){
      const owners=[...this.conversationMembers.values()].filter((m)=>m.conversationId===conversationId&&m.workspaceId===session.workspaceId&&m.role==='owner');
      if(owners.length<=1)throw Object.assign(new Error('Conversation must keep at least one owner'),{code:'LAST_CONVERSATION_OWNER',statusCode:409});
    }
    this.conversationMembers.delete(key);
    return clone([...this.conversationMembers.values()]
      .filter((m) => m.workspaceId === session.workspaceId && m.conversationId === conversationId)
      .map((m) => {
        const profile = this.profiles.get(this.membershipKey(session.workspaceId, m.userId)) ?? {};
        const membership = this.memberships.get(this.membershipKey(session.workspaceId, m.userId)) ?? {};
        return { userId:m.userId, role:m.role, displayName:profile.displayName ?? profile.email ?? m.userId, email:profile.email ?? null, title:profile.title ?? null, workspaceRole:membership.role ?? null };
      })
      .sort((a,b) => String(a.displayName).localeCompare(String(b.displayName))));
  }

  async conversationAudience(session, conversationId) {
    const conversation=this.conversations.get(conversationId);
    if(!conversation || conversation.workspaceId!==session.workspaceId) return [];
    if(conversation.visibility==='workspace' || conversation.visibility==='organization') return [...new Set([...this.memberships.values()].filter((m)=>m.workspaceId===session.workspaceId).map((m)=>m.userId))];
    return [...new Set([...this.conversationMembers.values()].filter((m)=>m.workspaceId===session.workspaceId && m.conversationId===conversationId).map((m)=>m.userId))];
  }

  async createConversation(session, { kind, title, slug = null, visibility = 'private', participantIds = [], purpose = null, announcementOnly = false }) {
    for (const userId of new Set([session.userId,...participantIds])) this.assertConversationUser(session,userId);
    const row = { id: randomUUID(), organizationId: session.organizationId, workspaceId: session.workspaceId, kind, title, slug, visibility, purpose, announcementOnly:Boolean(announcementOnly), createdBy: session.userId, createdAt: nowIso(), archivedAt:null };
    this.conversations.set(row.id, row); this.messages.set(row.id, []);
    const memberIds = visibility === 'workspace' && kind === 'channel' ? [...this.memberships.values()].filter((m) => m.workspaceId === session.workspaceId).map((m) => m.userId) : [session.userId, ...participantIds];
    for (const userId of new Set(memberIds)) this.conversationMembers.set(this.conversationMemberKey(row.id, userId), { conversationId: row.id, workspaceId: session.workspaceId, userId, role: userId === session.userId ? 'owner' : 'member', joinedAt:nowIso() });
    return clone(row);
  }

  async listMessages(session, conversationId, limit = 100) {
    if (!(await this.canAccessConversation(session, conversationId))) throw Object.assign(new Error('Conversation not found'), { statusCode: 404, code: 'NOT_FOUND' });
    return clone((this.messages.get(conversationId) ?? []).slice(-Math.min(limit, 200)).map((message) => ({ ...message, reactions: this.reactions.get(message.id) ?? [] })));
  }

  async createMessage(session, conversationId, { kind = 'text', body = null, replyToId = null, threadRootId = null, metadata = {}, mentionedUserIds = [], clientRequestId = null }) {
    if (!(await this.canAccessConversation(session, conversationId))) throw Object.assign(new Error('Conversation not found'), { statusCode: 404, code: 'NOT_FOUND' });
    const message = { id: randomUUID(), organizationId: session.organizationId, workspaceId: session.workspaceId, conversationId, kind, authorId: session.userId, body, replyToId, threadRootId, metadata, mentionedUserIds: [...new Set(mentionedUserIds)], clientRequestId, createdAt: nowIso(), editedAt: null, deletedAt: null };
    this.messages.get(conversationId).push(message); return clone(message);
  }

  async messageConversation(session,messageId) { for(const [conversationId,list] of this.messages.entries()){ const message=list.find((m)=>m.id===messageId); if(message && message.workspaceId===session.workspaceId) return conversationId; } return null; }

  async toggleReaction(session, messageId, reaction) {
    const conversationId=await this.messageConversation(session,messageId);
    if(!conversationId||!(await this.canAccessConversation(session,conversationId)))throw Object.assign(new Error('Message not found'),{code:'NOT_FOUND',statusCode:404});
    const list = this.reactions.get(messageId) ?? [];
    const index = list.findIndex((item) => item.userId === session.userId && item.reaction === reaction);
    if (index >= 0) list.splice(index, 1); else list.push({ userId: session.userId, reaction, createdAt: nowIso() });
    this.reactions.set(messageId, list); return clone(list);
  }

  async markRead(session, conversationId, messageId = null) {
    this.readState.set(this.conversationMemberKey(conversationId, session.userId), { messageId, readAt: nowIso() });
  }

  async setPresence(session, value) {
    const row = { state: value.state ?? 'online', statusEmoji: value.statusEmoji ?? null, statusText: value.statusText ?? null, statusExpiresAt: value.statusExpiresAt ?? null, lastSeenAt: nowIso(), updatedAt: nowIso() };
    this.presence.set(this.membershipKey(session.workspaceId, session.userId), row); return clone(row);
  }

  async saveFile(session, record) { const row = { id: record.id ?? randomUUID(), organizationId: session.organizationId, workspaceId: session.workspaceId, uploadedBy: session.userId, ...record, createdAt: nowIso() }; this.files.set(row.id, row); return clone(row); }

  async getFile(session, fileId) { const row = this.files.get(fileId); return row && row.workspaceId === session.workspaceId ? clone(row) : null; }

  async saveVoiceMessage(session, conversationId, { file, durationMs, waveform = [] }) {
    const message = await this.createMessage(session, conversationId, { kind: 'voice', body: null, metadata: { fileId: file.id, durationMs } });
    const voice = { id: randomUUID(), workspaceId: session.workspaceId, messageId: message.id, fileId: file.id, durationMs, waveform, transcriptStatus: 'not_requested', createdAt: nowIso() };
    this.voiceMessages.set(message.id, voice); return { message, voice, file };
  }

  async listTasks(session) { return clone([...this.tasks.values()].filter((row) => row.workspaceId === session.workspaceId && (row.ownerId === session.userId || row.requesterId === session.userId)).sort((a,b) => String(a.promisedAt ?? '9999').localeCompare(String(b.promisedAt ?? '9999')))); }

  async createTask(session, value) { const row={id:randomUUID(),organizationId:session.organizationId,workspaceId:session.workspaceId,title:value.title,outcome:value.outcome ?? value.title,ownerId:value.ownerId ?? session.userId,requesterId:session.userId,acceptorId:value.acceptorId ?? session.userId,sourceMessageId:value.sourceMessageId ?? null,status:'proposed',priority:value.priority ?? 'normal',promisedAt:value.promisedAt ?? null,forecastAt:value.forecastAt ?? null,createdAt:nowIso(),updatedAt:nowIso()}; this.tasks.set(row.id,row); return clone(row); }

  async listCalendar(session, from=null, to=null) { return clone([...this.calendarEvents.values()].filter((row)=>row.workspaceId===session.workspaceId && (!from || Date.parse(row.startAt)>=Date.parse(from)) && (!to || Date.parse(row.startAt)<=Date.parse(to))).sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt))); }

  async createCalendarEvent(session,value) { const row={id:randomUUID(),organizationId:session.organizationId,workspaceId:session.workspaceId,kind:value.kind ?? 'meeting',title:value.title,description:value.description ?? null,ownerId:value.ownerId ?? session.userId,startAt:value.startAt,endAt:value.endAt ?? null,timezone:value.timezone ?? 'UTC',allDay:Boolean(value.allDay),visibility:value.visibility ?? 'participants',commitmentId:value.commitmentId ?? null,conversationId:value.conversationId ?? null,createdAt:nowIso(),updatedAt:nowIso()}; this.calendarEvents.set(row.id,row); return clone(row); }

  async savePushSubscription(session, { endpoint, p256dh, auth, userAgent = null }) {
    const key = `${session.workspaceId}:${session.userId}:${endpoint}`; const row = { id: randomUUID(), workspaceId: session.workspaceId, userId: session.userId, endpoint, p256dh, auth, userAgent, createdAt: nowIso(), revokedAt: null };
    this.pushSubscriptions.set(key, row); return clone(row);
  }

  async listPushSubscriptions(workspaceId, userIds) {
    const ids = new Set(userIds); return clone([...this.pushSubscriptions.values()].filter((row) => row.workspaceId === workspaceId && ids.has(row.userId) && !row.revokedAt));
  }
}
