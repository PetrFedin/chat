import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl=process.env.DATABASE_URL;

async function sessionFor(store,userId,workspaceId,label){
  const tokenHash=hashToken(`pg-session-${label}-${randomUUID()}`);
  await store.createSession({userId,workspaceId,tokenHash,expiresAt:new Date(Date.now()+86400000).toISOString()});
  return store.getSession(tokenHash);
}

async function invite(store,owner,email,displayName){
  const password=hashPassword('WorkspacePass42');
  const tokenHash=hashToken(`pg-invite-${randomUUID()}`);
  await store.createInvitation(owner,{email,role:'member',tokenHash,expiresAt:new Date(Date.now()+86400000).toISOString()});
  const accepted=await store.acceptInvitation({tokenHash,displayName,passwordHash:password.hash,passwordSalt:password.salt});
  return sessionFor(store,accepted.user.id,owner.workspaceId,email);
}

test('Postgres daily-work runtime preserves attention and privacy boundaries',{skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  t.after(()=>pool.end());
  const store=new PostgresStore(pool),suffix=randomUUID().slice(0,8),password=hashPassword('WorkspacePass42');
  const ownerEmail=`pgowner-${suffix}@example.com`;
  const created=await store.createCompany({companyName:`PG Daily ${suffix}`,ownerName:'PG Owner',email:ownerEmail,passwordHash:password.hash,passwordSalt:password.salt});
  const owner=await sessionFor(store,created.user.id,created.workspace.id,`owner-${suffix}`);
  const member=await invite(store,owner,`pgmember-${suffix}@example.com`,'PG Member');
  const outsider=await invite(store,owner,`pgoutsider-${suffix}@example.com`,'PG Outsider');

  const general=(await store.listConversations(owner)).find(c=>c.slug==='general');
  const handle=ownerEmail.split('@')[0];
  const mention=await store.createMessage(member,general.id,{kind:'text',body:`@${handle} review the postgres launch`,replyToId:null,threadRootId:null,metadata:{},clientRequestId:null,mentionedUserIds:[]});
  const projected=(await store.listConversations(owner)).find(c=>c.id===general.id);
  assert.equal(projected.unreadCount,1);
  assert.equal(projected.mentionCount,1);
  const inbox=await store.listNotifications(owner,{status:'unread'});
  assert.equal(inbox.length,1);
  assert.equal(inbox[0].type,'message.mentioned');
  assert.equal(inbox[0].messageId,mention.id);
  await store.markRead(owner,general.id,mention.id);
  assert.equal((await store.listNotifications(owner,{status:'unread'})).length,0);

  const direct=await store.createConversation(owner,{kind:'direct',title:'PG Private',slug:null,purpose:null,visibility:'private',participantIds:[member.userId]});
  const privateMessage=await store.createMessage(member,direct.id,{kind:'text',body:'Cobalt protocol is private',replyToId:null,threadRootId:null,metadata:{},clientRequestId:null,mentionedUserIds:[]});
  const file=await store.saveFile(member,{id:randomUUID(),name:'cobalt-plan.txt',mimeType:'text/plain',sizeBytes:20,storageKey:`test/${suffix}/cobalt.txt`,sha256:'c'.repeat(64)});
  await store.createMessage(member,direct.id,{kind:'file',body:null,replyToId:null,threadRootId:null,metadata:{fileId:file.id,name:file.name,mimeType:file.mimeType},clientRequestId:null,mentionedUserIds:[]});

  assert.ok(await store.getFile(owner,file.id));
  assert.ok(await store.getFile(member,file.id));
  assert.equal(await store.getFile(outsider,file.id),null);
  assert.equal((await store.listFiles(owner,{query:'cobalt'})).length,1);
  assert.equal((await store.listFiles(outsider,{query:'cobalt'})).length,0);

  const ownerResults=await store.searchWorkspace(owner,'Cobalt',{limit:30});
  assert.ok(ownerResults.some(x=>x.type==='message'&&x.id===privateMessage.id));
  assert.ok(ownerResults.some(x=>x.type==='file'&&x.id===file.id));
  const outsiderResults=await store.searchWorkspace(outsider,'Cobalt',{limit:30});
  assert.equal(outsiderResults.some(x=>['message','conversation','file'].includes(x.type)),false);

  const task=await store.createTask(owner,{title:'Postgres daily work review',outcome:'Verify attention projection',ownerId:member.userId,acceptorId:owner.userId,sourceMessageId:null,priority:'urgent',promisedAt:new Date(Date.now()+3600000).toISOString(),forecastAt:null});
  const memberInbox=await store.listNotifications(member,{status:'unread'});
  assert.ok(memberInbox.some(x=>x.type==='task.assigned'&&x.commitmentId===task.id));
  const summary=await store.attentionSummary(member);
  assert.ok(summary.dueSoonTasks>=1);
});
