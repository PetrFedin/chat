import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessToken } from 'livekit-server-sdk';
import { LiveKitWebhookReceiver, DisabledLiveKitWebhookReceiver, liveKitEventId, normalizeLiveKitEgress } from '../src/media/livekit-webhook.js';
import { MemoryMeetingRepository } from '../src/meeting/meeting-repository.js';

const testApiKey='abcdefg';
const testSecret='abababa';
const signedBody='{"event":"room_started", "room":{"sid":"RM_TkVjUvAqgzKz", "name":"mytestroom", "emptyTimeout":300, "creationTime":"1628545903", "turnPassword":"ICkSr2rEeslkN6e9bXL4Ji5zzMD5Z7zzr6ulOaxMj6N", "enabledCodecs":[{"mime":"audio/opus"}, {"mime":"video/VP8"}]}}';
const signedBodySha='CoEQz1chqJ9bnZRcORddjplkvpjmPujmLTR42DbefYI=';

test('LiveKit webhook receiver verifies official JWT + body SHA contract',async()=>{
  const token=new AccessToken(testApiKey,testSecret);token.sha256=signedBodySha;
  const jwt=await token.toJwt();
  const receiver=new LiveKitWebhookReceiver(testApiKey,testSecret);
  const event=await receiver.receive(signedBody,jwt);
  assert.equal(event.event,'room_started');
  assert.equal(event.room?.name,'mytestroom');
  await assert.rejects(()=>receiver.receive(`${signedBody} `,jwt),(error)=>error.code==='INVALID_WEBHOOK_SIGNATURE'&&error.statusCode===401);
});

test('LiveKit webhook is fail-closed when credentials are absent',async()=>{
  const receiver=new DisabledLiveKitWebhookReceiver();
  assert.equal(receiver.status().enabled,false);
  await assert.rejects(()=>receiver.receive('{}','token'),(error)=>error.code==='LIVEKIT_WEBHOOK_UNAVAILABLE'&&error.statusCode===503);
});

test('egress normalization remains deterministic and webhook fallback IDs are idempotent',()=>{
  const event={event:'egress_ended',egressInfo:{egressId:'EG_123',status:3,error:'',roomName:'room'}};
  assert.deepEqual(normalizeLiveKitEgress(event),{providerRecordingId:'EG_123',success:true,error:null,status:3,roomName:'room',startedAt:null,endedAt:null});
  assert.equal(liveKitEventId(event,'same-body'),liveKitEventId(event,'same-body'));
  assert.notEqual(liveKitEventId(event,'same-body'),liveKitEventId(event,'different-body'));
});

test('meeting intelligence keeps transcript evidence and requires human acceptance before task creation',async()=>{
  const repo=new MemoryMeetingRepository();
  const workspaceId=crypto.randomUUID(),organizationId=crypto.randomUUID(),callId=crypto.randomUUID(),recordingId=crypto.randomUUID(),userId=crypto.randomUUID();
  await repo.registerRecording({id:recordingId,organizationId,workspaceId,callId,providerRecordingId:'EG_MEMORY',storageKey:'recordings/memory.mp4',status:'processing',transcriptStatus:'not_requested'});
  const reconciled=await repo.reconcileEgress('EG_MEMORY',{success:true});
  assert.equal(reconciled.recording.status,'ready');
  assert.equal(reconciled.run.status,'queued');
  assert.equal(reconciled.job.kind,'transcribe');

  const transcribeJob=await repo.claimJob('transcribe');
  const transcript=await repo.completeTranscription(transcribeJob.id,transcribeJob.lockToken,{provider:'fixture',model:'deterministic',language:'ru',sourceSha256:'a'.repeat(64),segments:[
    {startMs:0,endMs:4200,speakerUserId:userId,speakerLabel:'Speaker 1',text:'Нужно завершить мобильный QA до релиза.',confidence:.99},
    {startMs:4300,endMs:7600,speakerLabel:'Speaker 2',text:'Согласовано, после QA выпускаем сборку.',confidence:.98},
  ]});
  assert.equal(transcript.segments.length,2);
  assert.equal(transcript.nextJob.kind,'summarize');

  const summarizeJob=await repo.claimJob('summarize');
  await repo.completeSummary(summarizeJob.id,summarizeJob.lockToken,{provider:'fixture',model:'deterministic',overview:'Команда согласовала выпуск после mobile QA.',summaryJson:{syntheticFixture:true},proposals:[
    {proposalType:'action',title:'Завершить mobile QA',body:'Проверить критические сценарии перед релизом.',proposedOwnerId:userId,sourceSegmentIds:[transcript.segments[0].id],confidence:.95},
    {proposalType:'decision',title:'Релиз после QA',body:'Сборка выпускается после прохождения QA.',sourceSegmentIds:[transcript.segments[1].id],confidence:.93},
  ]});

  const meeting=await repo.getMeeting({workspaceId},callId);
  assert.equal(meeting.run.status,'review_ready');
  assert.equal(meeting.segments.length,2);
  assert.equal(meeting.proposals.length,2);
  const action=meeting.proposals.find((proposal)=>proposal.proposalType==='action');
  assert.deepEqual(action.sourceSegmentIds,[transcript.segments[0].id]);
  assert.equal(action.status,'proposed');
  assert.equal(action.createdCommitmentId,undefined);

  const accepted=await repo.acceptProposal({workspaceId,userId},action.id,{});
  assert.equal(accepted.status,'accepted');
  assert.ok(accepted.confirmedTaskDraft);
  assert.equal(accepted.confirmedTaskDraft.ownerId,userId);
  assert.equal(accepted.createdCommitmentId,undefined);
});
