import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/persistence/store.js';
import { hashPassword, hashToken } from '../src/security.js';

const password = hashPassword('WorkspacePass42');

async function sessionFor(store,userId,workspaceId,label){
  const tokenHash=hashToken(`session-${label}-${Math.random()}`);
  await store.createSession({userId,workspaceId,tokenHash,expiresAt:new Date(Date.now()+86400000).toISOString()});
  return store.getSession(tokenHash);
}

async function invite(store,owner,email,displayName,role='member'){
  const tokenHash=hashToken(`invite-${email}-${Math.random()}`);
  await store.createInvitation(owner,{email,role,tokenHash,expiresAt:new Date(Date.now()+86400000).toISOString()});
  const accepted=await store.acceptInvitation({tokenHash,displayName,passwordHash:password.hash,passwordSalt:password.salt});
  return sessionFor(store,accepted.user.id,owner.workspaceId,email);
}

async function fixture(){
  const store=new MemoryStore();
  const created=await store.createCompany({companyName:'Daily Co',ownerName:'Owner User',email:'owner@example.com',passwordHash:password.hash,passwordSalt:password.salt});
  const owner=await sessionFor(store,created.user.id,created.workspace.id,'owner');
  const member=await invite(store,owner,'member@example.com','Member User');
  const outsider=await invite(store,owner,'outsider@example.com','Outsider User');
  return{store,owner,member,outsider};
}

test('unread and mention projections clear when the conversation is read',async()=>{
  const{store,owner,member}=await fixture();
  const general=(await store.listConversations(owner)).find(c=>c.slug==='general');
  const message=await store.createMessage(member,general.id,{body:'@owner please review the launch decision',mentionedUserIds:[]});

  const conversations=await store.listConversations(owner);
  const projected=conversations.find(c=>c.id===general.id);
  assert.equal(projected.unreadCount,1);
  assert.equal(projected.mentionCount,1);

  const notifications=await store.listNotifications(owner,{status:'unread'});
  assert.equal(notifications.length,1);
  assert.equal(notifications[0].type,'message.mentioned');
  assert.equal(notifications[0].messageId,message.id);

  const attention=await store.attentionSummary(owner);
  assert.equal(attention.unreadMessages,1);
  assert.equal(attention.mentions,1);

  await store.markRead(owner,general.id,message.id);
  assert.equal((await store.listConversations(owner)).find(c=>c.id===general.id).unreadCount,0);
  assert.equal((await store.listNotifications(owner,{status:'unread'})).length,0);
});

test('task assignment creates one idempotent attention item for the assignee',async()=>{
  const{store,owner,member}=await fixture();
  const task=await store.createTask(owner,{title:'Ship release candidate',ownerId:member.userId,priority:'urgent',promisedAt:new Date(Date.now()+3600000).toISOString()});
  const notifications=await store.listNotifications(member,{status:'unread'});
  assert.equal(notifications.length,1);
  assert.equal(notifications[0].type,'task.assigned');
  assert.equal(notifications[0].commitmentId,task.id);
  const summary=await store.attentionSummary(member);
  assert.equal(summary.unreadNotifications,1);
  assert.equal(summary.dueSoonTasks,1);
});

test('files linked to private messages are visible only to conversation participants',async()=>{
  const{store,owner,member,outsider}=await fixture();
  const direct=await store.createConversation(owner,{kind:'direct',title:'Owner + Member',visibility:'private',participantIds:[member.userId]});
  const file=await store.saveFile(member,{id:crypto.randomUUID(),name:'private-plan.txt',mimeType:'text/plain',sizeBytes:22,storageKey:'private/plan.txt',sha256:'a'.repeat(64),status:'ready'});
  await store.createMessage(member,direct.id,{kind:'file',body:null,metadata:{fileId:file.id,name:file.name,mimeType:file.mimeType}});

  assert.ok(await store.getFile(owner,file.id));
  assert.ok(await store.getFile(member,file.id));
  assert.equal(await store.getFile(outsider,file.id),null);
  assert.equal((await store.listFiles(owner,{query:'private'})).length,1);
  assert.equal((await store.listFiles(outsider,{query:'private'})).length,0);
});

test('global search respects private conversation boundaries across messages and files',async()=>{
  const{store,owner,member,outsider}=await fixture();
  const direct=await store.createConversation(owner,{kind:'direct',title:'Confidential Launch',visibility:'private',participantIds:[member.userId]});
  await store.createMessage(member,direct.id,{body:'Orchid protocol is ready for executive review'});
  const file=await store.saveFile(member,{id:crypto.randomUUID(),name:'orchid-roadmap.txt',mimeType:'text/plain',sizeBytes:18,storageKey:'private/orchid.txt',sha256:'b'.repeat(64),status:'ready'});
  await store.createMessage(member,direct.id,{kind:'file',body:null,metadata:{fileId:file.id,name:file.name,mimeType:file.mimeType}});

  const ownerResults=await store.searchWorkspace(owner,'orchid',{limit:30});
  assert.ok(ownerResults.some(item=>item.type==='message'));
  assert.ok(ownerResults.some(item=>item.type==='file'));
  const outsiderResults=await store.searchWorkspace(outsider,'orchid',{limit:30});
  assert.equal(outsiderResults.some(item=>['message','file','conversation'].includes(item.type)),false);
});
