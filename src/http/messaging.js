import { randomUUID } from 'node:crypto';
import { Permission, requirePermission } from '../rbac.js';
import { allowedConversationKinds, allowedMessageKinds, cleanText, json, noContent, readJson, messageKindLabel } from './helpers.js';

export async function handleMessaging(req,res,ctx,path,method){
  const {store,requireSession,hub,notifyUsers}=ctx;
  if(path==='/api/v1/conversations'&&method==='GET'){const s=await requireSession(req);json(res,200,{items:await store.listConversations(s)});return true}
  if(path==='/api/v1/conversations'&&method==='POST'){
    const s=await requireSession(req),b=await readJson(req),kind=String(b.kind??'group');if(!allowedConversationKinds.has(kind))throw Object.assign(new Error('Unsupported conversation kind'),{code:'INVALID_CONVERSATION_KIND'});requirePermission(s.role,kind==='channel'?Permission.CHANNEL_CREATE:Permission.MESSAGE_SEND);const ids=Array.isArray(b.participantIds)?b.participantIds.map(String):[];if(kind==='direct'&&new Set([s.userId,...ids]).size!==2)throw Object.assign(new Error('Direct conversation requires exactly two users'),{code:'DIRECT_REQUIRES_TWO_PARTICIPANTS'});const conversation=await store.createConversation(s,{kind,title:kind==='direct'?(b.title??null):cleanText(b.title,120),slug:b.slug?cleanText(b.slug,80):null,visibility:kind==='direct'?'private':(b.visibility??'private'),participantIds:ids,purpose:b.purpose?cleanText(b.purpose,500):null});const audience=await store.conversationAudience(s,conversation.id);hub.broadcastUsers(s.workspaceId,audience,'conversation.created',conversation);json(res,201,{conversation});return true;
  }
  let m=path.match(/^\/api\/v1\/conversations\/([0-9a-f-]+)\/messages$/i);
  if(m&&method==='GET'){const s=await requireSession(req);json(res,200,{items:await store.listMessages(s,m[1],100)});return true}
  if(m&&method==='POST'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MESSAGE_SEND);const b=await readJson(req),kind=String(b.kind??'text');if(!allowedMessageKinds.has(kind))throw Object.assign(new Error('Unsupported message kind'),{code:'INVALID_MESSAGE_KIND'});if(kind==='text'&&!String(b.body??'').trim())throw Object.assign(new Error('Message body required'),{code:'INVALID_MESSAGE_BODY'});const message=await store.createMessage(s,m[1],{kind,body:b.body??null,replyToId:b.replyToId??null,threadRootId:b.threadRootId??null,metadata:b.metadata??{},mentionedUserIds:Array.isArray(b.mentionedUserIds)?b.mentionedUserIds:[],clientRequestId:b.clientRequestId??randomUUID()});const audience=await store.conversationAudience(s,m[1]);hub.broadcastUsers(s.workspaceId,audience,'message.created',{conversationId:m[1],message});await notifyUsers(s.workspaceId,audience.filter(id=>id!==s.userId),{title:`Новое сообщение от ${s.displayName}`,body:message.body??messageKindLabel(message.kind),url:`/#/chats/${m[1]}`});json(res,201,{message});return true;
  }
  m=path.match(/^\/api\/v1\/messages\/([0-9a-f-]+)\/reactions$/i);
  if(m&&method==='POST'){const s=await requireSession(req),b=await readJson(req),reactions=await store.toggleReaction(s,m[1],cleanText(b.reaction,24)),conversationId=await store.messageConversation(s,m[1]);if(conversationId){const audience=await store.conversationAudience(s,conversationId);hub.broadcastUsers(s.workspaceId,audience,'message.reaction',{messageId:m[1],reactions})}json(res,200,{reactions});return true}
  m=path.match(/^\/api\/v1\/conversations\/([0-9a-f-]+)\/read$/i);
  if(m&&method==='POST'){const s=await requireSession(req),b=await readJson(req);await store.markRead(s,m[1],b.messageId??null);const audience=await store.conversationAudience(s,m[1]);hub.broadcastUsers(s.workspaceId,audience,'conversation.read',{conversationId:m[1],userId:s.userId,messageId:b.messageId??null});noContent(res);return true}
  return false;
}
