import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/persistence/store.js';
import { hashPassword, hashToken } from '../src/security.js';

test('company registration creates an isolated owner workspace and bootstrap channels', async () => {
  const store=new MemoryStore(),password=hashPassword('WorkspacePass42');
  const created=await store.createCompany({companyName:'Acme',ownerName:'Petr',email:'petr@example.com',passwordHash:password.hash,passwordSalt:password.salt});
  await store.createSession({userId:created.user.id,workspaceId:created.workspace.id,tokenHash:hashToken('session'),expiresAt:new Date(Date.now()+86400000).toISOString()});
  const session=await store.getSession(hashToken('session'));
  assert.equal(session.role,'owner');
  const conversations=await store.listConversations(session);
  assert.equal(conversations.length,2);
  assert.deepEqual(conversations.map((c)=>c.slug).sort(),['announcements','general']);
});

test('message, reaction, task and calendar event share one workspace context', async () => {
  const store=new MemoryStore(),password=hashPassword('WorkspacePass42');
  const created=await store.createCompany({companyName:'Acme',ownerName:'Petr',email:'petr2@example.com',passwordHash:password.hash,passwordSalt:password.salt});
  await store.createSession({userId:created.user.id,workspaceId:created.workspace.id,tokenHash:hashToken('session2'),expiresAt:new Date(Date.now()+86400000).toISOString()});
  const session=await store.getSession(hashToken('session2')),conversation=(await store.listConversations(session))[0];
  const message=await store.createMessage(session,conversation.id,{body:'Prepare launch'});
  const reactions=await store.toggleReaction(session,message.id,'👍');
  const task=await store.createTask(session,{title:'Prepare launch',sourceMessageId:message.id,promisedAt:new Date(Date.now()+3600000).toISOString()});
  const event=await store.createCalendarEvent(session,{kind:'task_block',title:'Prepare launch',startAt:new Date().toISOString(),endAt:new Date(Date.now()+1800000).toISOString(),commitmentId:task.id});
  assert.equal(reactions.length,1);
  assert.equal(task.sourceMessageId,message.id);
  assert.equal(event.commitmentId,task.id);
});
