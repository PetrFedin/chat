import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl=process.env.DATABASE_URL;

async function sessionFor(store,userId,workspaceId,label){
  const tokenHash=hashToken(`message-actions-${label}-${randomUUID()}`);
  await store.createSession({userId,workspaceId,tokenHash,expiresAt:new Date(Date.now()+86400000).toISOString()});
  return store.getSession(tokenHash);
}

async function invite(store,owner,email,displayName){
  const password=hashPassword('WorkspacePass42'),tokenHash=hashToken(`message-actions-invite-${randomUUID()}`);
  await store.createInvitation(owner,{email,role:'member',tokenHash,expiresAt:new Date(Date.now()+86400000).toISOString()});
  const accepted=await store.acceptInvitation({tokenHash,displayName,passwordHash:password.hash,passwordSalt:password.salt});
  return sessionFor(store,accepted.user.id,owner.workspaceId,email);
}

test('Postgres message work actions preserve provenance, personal state and voice semantics',{skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  t.after(()=>pool.end());
  const store=new PostgresStore(pool),suffix=randomUUID().slice(0,8),password=hashPassword('WorkspacePass42');
  const created=await store.createCompany({
    companyName:`PG Message Actions ${suffix}`,
    ownerName:'Owner',
    email:`pg-message-owner-${suffix}@example.com`,
    passwordHash:password.hash,
    passwordSalt:password.salt,
  });
  const owner=await sessionFor(store,created.user.id,created.workspace.id,`owner-${suffix}`);
  const alice=await invite(store,owner,`pg-message-alice-${suffix}@example.com`,'Alice');
  const bob=await invite(store,owner,`pg-message-bob-${suffix}@example.com`,'Bob');

  const group=await store.createConversation(owner,{kind:'group',title:'Execution group',slug:null,purpose:null,visibility:'private',participantIds:[alice.userId],announcementOnly:false});
  const source=await store.createMessage(owner,group.id,{kind:'text',body:'Approved instruction',replyToId:null,threadRootId:null,metadata:{},mentionedUserIds:[],clientRequestId:randomUUID()});

  await assert.rejects(()=>store.setMessageSaved(bob,source.id,true),{code:'NOT_FOUND'});
  await store.setMessageSaved(alice,source.id,true);
  assert.equal((await store.listSavedMessages(alice)).length,1);
  assert.equal((await store.listSavedMessages(owner)).length,0);

  await store.setMessagePinned(owner,source.id,true);
  const pins=await store.listPinnedMessages(alice,group.id);
  assert.equal(pins.length,1);
  assert.equal(pins[0].id,source.id);

  const direct=await store.createConversation(alice,{kind:'direct',title:'Owner',slug:null,purpose:null,visibility:'private',participantIds:[owner.userId],announcementOnly:false});
  const forwarded=await store.forwardMessage(alice,source.id,direct.id);
  assert.equal(forwarded.forwarded,true);
  assert.equal(forwarded.forwardedFrom.messageId,source.id);
  assert.equal(forwarded.forwardedFrom.conversationId,group.id);
  assert.equal(forwarded.forwardedFrom.authorId,owner.userId);
  const rereadForward=await store.getMessage(alice,forwarded.id);
  assert.equal(rereadForward.forwardedFrom.messageId,source.id);

  const other=await store.createConversation(owner,{kind:'group',title:'Other',slug:null,purpose:null,visibility:'private',participantIds:[bob.userId],announcementOnly:false});
  await assert.rejects(
    ()=>store.createMessage(owner,other.id,{kind:'text',body:'Cross reference',replyToId:source.id,threadRootId:null,metadata:{},mentionedUserIds:[],clientRequestId:randomUUID()}),
    {code:'INVALID_MESSAGE_REFERENCE'}
  );

  const mutedUntil=new Date(Date.now()+8*3600000).toISOString();
  await store.setConversationPreferences(alice,group.id,{mutedUntil});
  const realtimeAudience=await store.conversationAudience(owner,group.id);
  const notificationAudience=await store.conversationNotificationAudience(owner,group.id);
  assert.ok(realtimeAudience.includes(alice.userId));
  assert.ok(!notificationAudience.includes(alice.userId));
  assert.ok(notificationAudience.includes(owner.userId));

  await store.setConversationPreferences(alice,group.id,{archived:true});
  assert.ok(!(await store.listConversations(alice)).some(item=>item.id===group.id));
  assert.ok((await store.listConversations(alice,{archived:true})).some(item=>item.id===group.id));
  assert.ok((await store.listConversations(owner)).some(item=>item.id===group.id));
  await store.setConversationPreferences(alice,group.id,{archived:false});
  assert.ok((await store.listConversations(alice)).some(item=>item.id===group.id));

  const fileId=randomUUID();
  const file=await store.saveFile(owner,{id:fileId,name:'voice.webm',mimeType:'audio/webm',sizeBytes:128,storageKey:`${owner.workspaceId}/${fileId}.webm`,sha256:'a'.repeat(64)});
  const voice=await store.saveVoiceMessage(owner,group.id,{file,durationMs:2400,waveform:[0.1,0.5,0.2]});
  const forwardedVoice=await store.forwardMessage(owner,voice.message.id,direct.id);
  assert.equal(forwardedVoice.kind,'voice');
  assert.equal(forwardedVoice.forwarded,true);
  const voiceRow=await pool.query('SELECT file_id,duration_ms,waveform FROM voice_messages WHERE workspace_id=$1 AND message_id=$2',[owner.workspaceId,forwardedVoice.id]);
  assert.equal(voiceRow.rowCount,1);
  assert.equal(voiceRow.rows[0].file_id,file.id);
  assert.equal(voiceRow.rows[0].duration_ms,2400);

  const edited=await store.editMessage(owner,source.id,'Approved instruction revised');
  assert.equal(edited.body,'Approved instruction revised');
  assert.ok(edited.editedAt);

  const deleted=await store.deleteMessage(owner,source.id);
  assert.ok(deleted.deletedAt);
  assert.equal(deleted.body,null);
  assert.equal((await store.listPinnedMessages(alice,group.id)).length,0);
  assert.ok(!(await store.listSavedMessages(alice)).some(item=>item.id===source.id));
  await assert.rejects(()=>store.toggleReaction(alice,source.id,'👍'),{code:'NOT_FOUND'});
});
