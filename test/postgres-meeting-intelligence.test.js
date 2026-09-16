import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { PostgresCallRepository } from '../src/media/call-repository.js';
import { PostgresMeetingRepository } from '../src/meeting/meeting-repository.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl=process.env.DATABASE_URL;

async function sessionFor(store,userId,workspaceId,label){
  const tokenHash=hashToken(`mi-session-${label}-${randomUUID()}`);
  await store.createSession({userId,workspaceId,tokenHash,expiresAt:new Date(Date.now()+86400000).toISOString()});
  return store.getSession(tokenHash);
}

async function invite(store,owner,email,displayName){
  const password=hashPassword('WorkspacePass42');
  const tokenHash=hashToken(`mi-invite-${randomUUID()}`);
  await store.createInvitation(owner,{email,role:'member',tokenHash,expiresAt:new Date(Date.now()+86400000).toISOString()});
  const accepted=await store.acceptInvitation({tokenHash,displayName,passwordHash:password.hash,passwordSalt:password.salt});
  return sessionFor(store,accepted.user.id,owner.workspaceId,email);
}

test('Postgres meeting intelligence preserves source evidence and human confirmation boundary',{skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  t.after(()=>pool.end());
  const store=new PostgresStore(pool),calls=new PostgresCallRepository(pool),meeting=new PostgresMeetingRepository(pool),suffix=randomUUID().slice(0,8),password=hashPassword('WorkspacePass42');
  const created=await store.createCompany({companyName:`Meeting ${suffix}`,ownerName:'Meeting Owner',email:`mi-owner-${suffix}@example.com`,passwordHash:password.hash,passwordSalt:password.salt});
  const owner=await sessionFor(store,created.user.id,created.workspace.id,`owner-${suffix}`);
  const member=await invite(store,owner,`mi-member-${suffix}@example.com`,'Meeting Member');
  const general=(await store.listConversations(owner)).find(c=>c.slug==='general');

  const call=await calls.create(owner,{conversationId:general.id,calendarEventId:null,title:'Release review',mode:'video',participantIds:[owner.userId,member.userId],scheduledFor:null,providerRoomName:`mi-${suffix}`});
  await calls.join(owner,call.id);
  const recording=await calls.startRecording(owner,call.id,{provider:'livekit',providerRecordingId:`EG_${suffix}`,storageKey:`recordings/${owner.workspaceId}/${call.id}/fixture.mp4`});
  await calls.stopRecording(owner,call.id);

  const first=await meeting.reconcileEgress(recording.providerRecordingId,{success:true});
  assert.equal(first.recording.status,'ready');
  assert.equal(first.run.status,'queued');
  assert.equal(first.job.kind,'transcribe');
  const second=await meeting.reconcileEgress(recording.providerRecordingId,{success:true});
  assert.equal(second.run.id,first.run.id);
  assert.equal(second.job.id,first.job.id);

  const webhookOne=await meeting.recordWebhook({provider:'livekit',providerEventId:`WH_${suffix}`,eventType:'egress_ended',payload:{event:'egress_ended'}});
  const webhookTwo=await meeting.recordWebhook({provider:'livekit',providerEventId:`WH_${suffix}`,eventType:'egress_ended',payload:{event:'egress_ended'}});
  assert.equal(webhookOne.inserted,true);
  assert.equal(webhookTwo.inserted,false);

  const transcriptionJob=await meeting.claimJob('transcribe');
  assert.equal(transcriptionJob.runId,first.run.id);
  const transcript=await meeting.completeTranscription(transcriptionJob.id,transcriptionJob.lockToken,{provider:'fixture',model:'fixture-v1',language:'ru',sourceSha256:'d'.repeat(64),segments:[
    {startMs:0,endMs:3000,speakerUserId:member.userId,speakerLabel:'Meeting Member',text:'Нужно закрыть мобильный QA до релиза.',confidence:.99},
    {startMs:3100,endMs:6100,speakerUserId:owner.userId,speakerLabel:'Meeting Owner',text:'После QA выпускаем сборку.',confidence:.98},
  ]});
  assert.equal(transcript.segments.length,2);
  assert.equal(transcript.nextJob.kind,'summarize');

  const summaryJob=await meeting.claimJob('summarize');
  const summary=await meeting.completeSummary(summaryJob.id,summaryJob.lockToken,{provider:'fixture',model:'fixture-v1',overview:'Релиз после завершения mobile QA.',summaryJson:{fixture:true},proposals:[
    {proposalType:'action',title:'Завершить mobile QA',body:'Проверить критические сценарии и зафиксировать результат.',proposedOwnerId:member.userId,proposedDueAt:new Date(Date.now()+7200000).toISOString(),sourceSegmentIds:[transcript.segments[0].id],confidence:.96},
    {proposalType:'decision',title:'Выпустить сборку после QA',body:'Релиз разрешён после успешного QA.',sourceSegmentIds:[transcript.segments[1].id],confidence:.94},
  ]});
  assert.equal(summary.runId,first.run.id);

  const viewBefore=await meeting.getMeeting(owner,call.id);
  assert.equal(viewBefore.run.status,'review_ready');
  assert.equal(viewBefore.proposals.length,2);
  const action=viewBefore.proposals.find(p=>p.proposalType==='action');
  assert.ok(action);
  assert.equal(action.status,'proposed');
  assert.equal(action.createdCommitmentId,null);
  assert.deepEqual(action.sourceSegmentIds,[transcript.segments[0].id]);

  const beforeTaskCount=Number((await pool.query('SELECT count(*) FROM commitments WHERE workspace_id=$1',[owner.workspaceId])).rows[0].count);
  const accepted=await meeting.acceptProposal(owner,action.id,{ownerId:member.userId});
  assert.equal(accepted.proposal.status,'accepted');
  assert.ok(accepted.task?.id);
  assert.equal(accepted.task.ownerId,member.userId);
  const afterTaskCount=Number((await pool.query('SELECT count(*) FROM commitments WHERE workspace_id=$1',[owner.workspaceId])).rows[0].count);
  assert.equal(afterTaskCount,beforeTaskCount+1);

  const evidence=(await pool.query('SELECT type,value FROM evidence WHERE workspace_id=$1 AND commitment_id=$2',[owner.workspaceId,accepted.task.id])).rows;
  assert.equal(evidence.length,1);
  assert.equal(evidence[0].type,'note');
  assert.match(evidence[0].value,/Meeting proposal/);

  const viewAfter=await meeting.getMeeting(owner,call.id);
  const acceptedAction=viewAfter.proposals.find(p=>p.id===action.id);
  assert.equal(acceptedAction.status,'accepted');
  assert.equal(acceptedAction.createdCommitmentId,accepted.task.id);
});
