import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl=process.env.DATABASE_URL;

async function sessionFor(store,userId,workspaceId,label){
  const tokenHash=hashToken(`pg-conversation-${label}-${randomUUID()}`);
  await store.createSession({userId,workspaceId,tokenHash,expiresAt:new Date(Date.now()+86400000).toISOString()});
  return store.getSession(tokenHash);
}

async function invite(store,owner,email,displayName){
  const password=hashPassword('WorkspacePass42');
  const tokenHash=hashToken(`pg-conversation-invite-${randomUUID()}`);
  await store.createInvitation(owner,{email,role:'member',tokenHash,expiresAt:new Date(Date.now()+86400000).toISOString()});
  const accepted=await store.acceptInvitation({tokenHash,displayName,passwordHash:password.hash,passwordSalt:password.salt});
  return sessionFor(store,accepted.user.id,owner.workspaceId,email);
}

test('Postgres conversation authority preserves private membership and reaction ACL',{skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  t.after(()=>pool.end());
  const store=new PostgresStore(pool),suffix=randomUUID().slice(0,8),password=hashPassword('WorkspacePass42');
  const created=await store.createCompany({companyName:`PG Conversation ${suffix}`,ownerName:'PG Owner',email:`pg-conv-owner-${suffix}@example.com`,passwordHash:password.hash,passwordSalt:password.salt});
  const owner=await sessionFor(store,created.user.id,created.workspace.id,`owner-${suffix}`);
  const alice=await invite(store,owner,`pg-conv-alice-${suffix}@example.com`,'Alice');
  const bob=await invite(store,owner,`pg-conv-bob-${suffix}@example.com`,'Bob');
  const carol=await invite(store,owner,`pg-conv-carol-${suffix}@example.com`,'Carol');

  const group=await store.createConversation(owner,{kind:'group',title:'Private launch',slug:null,purpose:null,visibility:'private',participantIds:[alice.userId,bob.userId],announcementOnly:false});
  assert.equal((await store.conversationPolicy(alice,group.id)).memberRole,'member');
  assert.equal(await store.conversationPolicy(carol,group.id),null);

  const initialMembers=await store.listConversationMembers(owner,group.id);
  assert.equal(initialMembers.length,3);

  const withCarol=await store.addConversationMembers(owner,group.id,[carol.userId]);
  assert.equal(withCarol.length,4);
  assert.equal(await store.canAccessConversation(carol,group.id),true);

  const withModerator=await store.setConversationMemberRole(owner,group.id,alice.userId,'moderator');
  assert.equal(withModerator.find(x=>x.userId===alice.userId).role,'moderator');
  assert.equal((await store.conversationPolicy(alice,group.id)).memberRole,'moderator');

  const message=await store.createMessage(owner,group.id,{kind:'text',body:'Private launch detail',replyToId:null,threadRootId:null,metadata:{},mentionedUserIds:[],clientRequestId:randomUUID()});
  assert.equal((await store.toggleReaction(carol,message.id,'👍')).length,1);

  const afterRemoval=await store.removeConversationMember(owner,group.id,carol.userId);
  assert.equal(afterRemoval.some(x=>x.userId===carol.userId),false);
  assert.equal(await store.canAccessConversation(carol,group.id),false);
  await assert.rejects(()=>store.toggleReaction(carol,message.id,'🔥'),{code:'NOT_FOUND'});

  await assert.rejects(()=>store.removeConversationMember(owner,group.id,owner.userId),{code:'LAST_CONVERSATION_OWNER'});

  const direct=await store.createConversation(owner,{kind:'direct',title:'Direct',slug:null,purpose:null,visibility:'private',participantIds:[alice.userId],announcementOnly:false});
  await assert.rejects(()=>store.addConversationMembers(owner,direct.id,[bob.userId]),{code:'DIRECT_MEMBERSHIP_IMMUTABLE'});
});
