import { randomUUID } from 'node:crypto';
import { Permission, hasPermission, requirePermission } from '../rbac.js';
import { allowedConversationKinds, allowedMessageKinds, cleanText, json, noContent, readJson, messageKindLabel } from './helpers.js';

const CONVERSATION_ID='([0-9a-f-]+)';
const USER_ID='([0-9a-f-]+)';
const MESSAGE_ID='([0-9a-f-]+)';
const MEMBER_ROLES=new Set(['owner','moderator','member','guest']);

function httpError(message,code,statusCode){return Object.assign(new Error(message),{code,statusCode})}

async function policyOr404(store,session,conversationId){
  const policy=await store.conversationPolicy(session,conversationId);
  if(!policy)throw httpError('Conversation not found','NOT_FOUND',404);
  return policy;
}

function canManageConversation(session,policy){
  return hasPermission(session.role,Permission.CHANNEL_MANAGE)||['owner','moderator'].includes(policy.memberRole);
}

function requireConversationManager(session,policy){
  if(!canManageConversation(session,policy))throw httpError('Conversation management permission required','FORBIDDEN',403);
}

export async function handleMessaging(req,res,ctx,path,method){
  const {store,requireSession,hub,notifyUsers}=ctx;
  if(path==='/api/v1/conversations'&&method==='GET'){const s=await requireSession(req);json(res,200,{items:await store.listConversations(s)});return true}
  if(path==='/api/v1/conversations/archived'&&method==='GET'){const s=await requireSession(req);json(res,200,{items:await store.listConversations(s,{archived:true})});return true}
  if(path==='/api/v1/saved-messages'&&method==='GET'){const s=await requireSession(req);json(res,200,{items:await store.listSavedMessages(s)});return true}
  if(path==='/api/v1/conversations'&&method==='POST'){
    const s=await requireSession(req),b=await readJson(req),kind=String(b.kind??'group');
    if(!allowedConversationKinds.has(kind))throw httpError('Unsupported conversation kind','INVALID_CONVERSATION_KIND',400);
    requirePermission(s.role,kind==='channel'?Permission.CHANNEL_CREATE:Permission.MESSAGE_SEND);
    const ids=Array.isArray(b.participantIds)?[...new Set(b.participantIds.map(String).filter(Boolean))]:[];
    const participantCount=new Set([s.userId,...ids]).size;
    if(kind==='direct'&&participantCount!==2)throw httpError('Direct conversation requires exactly two users','DIRECT_REQUIRES_TWO_PARTICIPANTS',400);
    const visibility=kind==='direct'||kind==='group'?'private':(b.visibility??'private');
    const conversation=await store.createConversation(s,{
      kind,
      title:kind==='direct'?(b.title??null):cleanText(b.title,120),
      slug:b.slug?cleanText(b.slug,80):null,
      visibility,
      participantIds:ids,
      purpose:b.purpose?cleanText(b.purpose,500):null,
      announcementOnly:kind==='channel'&&Boolean(b.announcementOnly),
    });
    const audience=await store.conversationAudience(s,conversation.id);
    hub.broadcastUsers(s.workspaceId,audience,'conversation.created',conversation);
    json(res,201,{conversation});return true;
  }

  let m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/preferences$`,'i'));
  if(m&&method==='PATCH'){
    const s=await requireSession(req);await policyOr404(store,s,m[1]);const b=await readJson(req),value={};
    if(typeof b.archived==='boolean')value.archived=b.archived;
    if(Object.prototype.hasOwnProperty.call(b,'mutedUntil')){
      if(b.mutedUntil===null||b.mutedUntil==='')value.mutedUntil=null;
      else{const at=new Date(b.mutedUntil);if(Number.isNaN(at.getTime()))throw httpError('Invalid mutedUntil','INVALID_MUTE_UNTIL',400);value.mutedUntil=at.toISOString()}
    }
    if(!Object.keys(value).length)throw httpError('No conversation preference supplied','INVALID_CONVERSATION_PREFERENCES',400);
    const preferences=await store.setConversationPreferences(s,m[1],value);json(res,200,{preferences});return true;
  }

  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/pins$`,'i'));
  if(m&&method==='GET'){const s=await requireSession(req);await policyOr404(store,s,m[1]);json(res,200,{items:await store.listPinnedMessages(s,m[1])});return true}

  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/members$`,'i'));
  if(m&&method==='GET'){
    const s=await requireSession(req),policy=await policyOr404(store,s,m[1]);
    const items=await store.listConversationMembers(s,m[1]);
    json(res,200,{conversation:policy.conversation,items,canManage:canManageConversation(s,policy)});return true;
  }
  if(m&&method==='POST'){
    const s=await requireSession(req),policy=await policyOr404(store,s,m[1]);requireConversationManager(s,policy);
    if(policy.conversation.kind==='direct')throw httpError('Direct conversation membership is immutable','DIRECT_MEMBERSHIP_IMMUTABLE',409);
    const b=await readJson(req),userIds=Array.isArray(b.userIds)?[...new Set(b.userIds.map(String).filter(Boolean))]:[];
    if(!userIds.length)throw httpError('At least one userId is required','INVALID_CONVERSATION_MEMBERS',400);
    const role=String(b.role??'member');if(!MEMBER_ROLES.has(role))throw httpError('Invalid conversation role','INVALID_CONVERSATION_ROLE',400);
    const previous=await store.conversationAudience(s,m[1]);
    const items=await store.addConversationMembers(s,m[1],userIds,role);
    const audience=await store.conversationAudience(s,m[1]);
    hub.broadcastUsers(s.workspaceId,[...new Set([...previous,...audience,...userIds])],'conversation.members.updated',{conversationId:m[1],items});
    json(res,200,{items});return true;
  }

  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/members/${USER_ID}$`,'i'));
  if(m&&method==='PATCH'){
    const s=await requireSession(req),policy=await policyOr404(store,s,m[1]);requireConversationManager(s,policy);
    if(policy.conversation.kind==='direct')throw httpError('Direct conversation membership is immutable','DIRECT_MEMBERSHIP_IMMUTABLE',409);
    const b=await readJson(req),role=String(b.role??'');if(!MEMBER_ROLES.has(role))throw httpError('Invalid conversation role','INVALID_CONVERSATION_ROLE',400);
    const items=await store.setConversationMemberRole(s,m[1],m[2],role);
    const audience=await store.conversationAudience(s,m[1]);
    hub.broadcastUsers(s.workspaceId,audience,'conversation.members.updated',{conversationId:m[1],items});
    json(res,200,{items});return true;
  }
  if(m&&method==='DELETE'){
    const s=await requireSession(req),policy=await policyOr404(store,s,m[1]);requireConversationManager(s,policy);
    if(policy.conversation.kind==='direct')throw httpError('Direct conversation membership is immutable','DIRECT_MEMBERSHIP_IMMUTABLE',409);
    const previous=await store.conversationAudience(s,m[1]);
    const items=await store.removeConversationMember(s,m[1],m[2]);
    const audience=await store.conversationAudience(s,m[1]);
    hub.broadcastUsers(s.workspaceId,[...new Set([...previous,...audience,m[2]])],'conversation.members.updated',{conversationId:m[1],items});
    json(res,200,{items});return true;
  }

  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/messages$`,'i'));
  if(m&&method==='GET'){const s=await requireSession(req);json(res,200,{items:await store.listMessages(s,m[1],100)});return true}
  if(m&&method==='POST'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MESSAGE_SEND);
    const policy=await policyOr404(store,s,m[1]);
    if(policy.conversation.announcementOnly&&!canManageConversation(s,policy))throw httpError('Only channel managers may publish in this announcement channel','ANNOUNCEMENT_ONLY',403);
    const b=await readJson(req),kind=String(b.kind??'text');
    if(!allowedMessageKinds.has(kind))throw httpError('Unsupported message kind','INVALID_MESSAGE_KIND',400);
    if(kind==='text'&&!String(b.body??'').trim())throw httpError('Message body required','INVALID_MESSAGE_BODY',400);
    const message=await store.createMessage(s,m[1],{kind,body:b.body??null,replyToId:b.replyToId??null,threadRootId:b.threadRootId??null,metadata:b.metadata??{},mentionedUserIds:Array.isArray(b.mentionedUserIds)?b.mentionedUserIds:[],clientRequestId:b.clientRequestId??randomUUID()});
    const audience=await store.conversationAudience(s,m[1]),notificationAudience=store.conversationNotificationAudience?await store.conversationNotificationAudience(s,m[1]):audience;
    hub.broadcastUsers(s.workspaceId,audience,'message.created',{conversationId:m[1],message});
    await notifyUsers(s.workspaceId,notificationAudience.filter(id=>id!==s.userId),{title:`Новое сообщение от ${s.displayName}`,body:message.body??messageKindLabel(message.kind),url:`/#/chats/${m[1]}`});
    json(res,201,{message});return true;
  }

  m=path.match(new RegExp(`^/api/v1/messages/${MESSAGE_ID}/save$`,'i'));
  if(m&&(method==='POST'||method==='DELETE')){const s=await requireSession(req),state=await store.setMessageSaved(s,m[1],method==='POST');json(res,200,state);return true}

  m=path.match(new RegExp(`^/api/v1/messages/${MESSAGE_ID}/pin$`,'i'));
  if(m&&(method==='POST'||method==='DELETE')){
    const s=await requireSession(req),message=await store.getMessage(s,m[1]);if(!message||message.deletedAt)throw httpError('Message not found','NOT_FOUND',404);
    const policy=await policyOr404(store,s,message.conversationId);
    if(policy.conversation.kind!=='direct')requireConversationManager(s,policy);
    const state=await store.setMessagePinned(s,m[1],method==='POST'),audience=await store.conversationAudience(s,message.conversationId);
    hub.broadcastUsers(s.workspaceId,audience,'message.pin',{conversationId:message.conversationId,messageId:m[1],pinned:state.pinned});
    json(res,200,state);return true;
  }

  m=path.match(new RegExp(`^/api/v1/messages/${MESSAGE_ID}/forward$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MESSAGE_SEND);const source=await store.getMessage(s,m[1]);if(!source||source.deletedAt)throw httpError('Message not found','NOT_FOUND',404);
    const b=await readJson(req),targetConversationId=String(b.conversationId??''),policy=await policyOr404(store,s,targetConversationId);
    if(policy.conversation.announcementOnly&&!canManageConversation(s,policy))throw httpError('Only channel managers may publish in this announcement channel','ANNOUNCEMENT_ONLY',403);
    const message=await store.forwardMessage(s,m[1],targetConversationId),audience=await store.conversationAudience(s,targetConversationId),notificationAudience=store.conversationNotificationAudience?await store.conversationNotificationAudience(s,targetConversationId):audience;
    hub.broadcastUsers(s.workspaceId,audience,'message.created',{conversationId:targetConversationId,message});
    await notifyUsers(s.workspaceId,notificationAudience.filter(id=>id!==s.userId),{title:`Переслано от ${s.displayName}`,body:message.body??messageKindLabel(message.kind),url:`/#/chats/${targetConversationId}`});
    json(res,201,{message});return true;
  }

  m=path.match(new RegExp(`^/api/v1/messages/${MESSAGE_ID}$`,'i'));
  if(m&&method==='PATCH'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MESSAGE_SEND);const message=await store.getMessage(s,m[1]);if(!message||message.deletedAt)throw httpError('Message not found','NOT_FOUND',404);
    if(message.authorId!==s.userId)throw httpError('Only the author may edit this message','MESSAGE_EDIT_FORBIDDEN',403);
    if(message.forwarded)throw httpError('Forwarded message content is immutable','MESSAGE_FORWARD_IMMUTABLE',409);
    if(message.kind!=='text')throw httpError('Only text messages can be edited','MESSAGE_KIND_NOT_EDITABLE',409);
    const b=await readJson(req),body=cleanText(b.body,12000),updated=await store.editMessage(s,m[1],body),audience=await store.conversationAudience(s,message.conversationId);
    hub.broadcastUsers(s.workspaceId,audience,'message.updated',{conversationId:message.conversationId,message:updated});json(res,200,{message:updated});return true;
  }
  if(m&&method==='DELETE'){
    const s=await requireSession(req),message=await store.getMessage(s,m[1]);if(!message||message.deletedAt)throw httpError('Message not found','NOT_FOUND',404);
    if(message.authorId===s.userId)requirePermission(s.role,Permission.MESSAGE_DELETE_OWN);else requirePermission(s.role,Permission.MESSAGE_DELETE_ANY);
    const deleted=await store.deleteMessage(s,m[1]),audience=await store.conversationAudience(s,message.conversationId);
    hub.broadcastUsers(s.workspaceId,audience,'message.deleted',{conversationId:message.conversationId,message:deleted});json(res,200,{message:deleted});return true;
  }

  m=path.match(/^\/api\/v1\/messages\/([0-9a-f-]+)\/reactions$/i);
  if(m&&method==='POST'){
    const s=await requireSession(req),conversationId=await store.messageConversation(s,m[1]);
    if(!conversationId||!(await store.canAccessConversation(s,conversationId)))throw httpError('Message not found','NOT_FOUND',404);
    const b=await readJson(req),reactions=await store.toggleReaction(s,m[1],cleanText(b.reaction,24));
    const audience=await store.conversationAudience(s,conversationId);
    hub.broadcastUsers(s.workspaceId,audience,'message.reaction',{messageId:m[1],reactions});
    json(res,200,{reactions});return true;
  }

  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/read$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req);await policyOr404(store,s,m[1]);const b=await readJson(req);
    await store.markRead(s,m[1],b.messageId??null);
    const audience=await store.conversationAudience(s,m[1]);
    hub.broadcastUsers(s.workspaceId,audience,'conversation.read',{conversationId:m[1],userId:s.userId,messageId:b.messageId??null});
    noContent(res);return true;
  }
  return false;
}
