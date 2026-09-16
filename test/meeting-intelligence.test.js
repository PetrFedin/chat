import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessToken } from 'livekit-server-sdk';
import { LiveKitWebhookReceiver, DisabledLiveKitWebhookReceiver, liveKitEventId, normalizeLiveKitEgress } from '../src/media/livekit-webhook.js';
import { MemoryMeetingRepository } from '../src/meeting/meeting-repository.js';
import { MeetingProcessor } from '../src/meeting/processor.js';

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

test('egress normalization requires COMPLETE and rejects failed terminal statuses',()=>{
  const complete={event:'egress_ended',egressInfo:{egressId:'EG_123',status:3,error:'',roomName:'room',fileResults:[]}};
  assert.deepEqual(normalizeLiveKitEgress(complete),{providerRecordingId:'EG_123',success:true,error:null,status:3,roomName:'room',startedAt:null,endedAt:null,fileResults:[]});
  const failed=normalizeLiveKitEgress({event:'egress_ended',egressInfo:{egressId:'EG_124',status:4,error:'encoder failed'}});
  assert.equal(failed.success,false);
  assert.equal(failed.error,'encoder failed');
  const aborted=normalizeLiveKitEgress({event:'egress_ended',egressInfo:{egressId:'EG_125',status:5,error:''}});
  assert.equal(aborted.success,false);
  assert.equal(aborted.error,'LiveKit egress aborted');
  assert.equal(liveKitEventId(complete,'same-body'),liveKitEventId(complete,'same-body'));
  assert.notEqual(liveKitEventId(complete,'same-body'),liveKitEventId(complete,'different-body'));
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

test('meeting processor validates the recording object before transcription and preserves evidence',async()=>{
  const repo=new MemoryMeetingRepository();
  const workspaceId=crypto.randomUUID(),organizationId=crypto.randomUUID(),callId=crypto.randomUUID(),recordingId=crypto.randomUUID();
  const storageKey='recordings/processor.mp4';
  await repo.registerRecording({id:recordingId,organizationId,workspaceId,callId,providerRecordingId:'EG_PROCESSOR',storageKey,status:'processing',transcriptStatus:'not_requested'});
  await repo.reconcileEgress('EG_PROCESSOR',{success:true});
  const objectBody=Buffer.from('deterministic-recording-bytes');
  const objectStore={
    async head(key){return key===storageKey?{exists:true,sizeBytes:objectBody.length}:{exists:false,sizeBytes:null}},
    async get(key){assert.equal(key,storageKey);return objectBody},
  };
  const transcriptionProvider={
    status:()=>({provider:'fixture-transcriber',enabled:true}),
    async transcribe(){return{provider:'fixture-transcriber',model:'fixture-v1',language:'ru',segments:[{startMs:0,endMs:2500,speakerLabel:'Speaker',text:'Проверить релиз перед запуском.',confidence:.99}]}}
  };
  const summaryProvider={
    status:()=>({provider:'fixture-summary',enabled:true}),
    async summarize({segments}){return{provider:'fixture-summary',model:'fixture-v1',overview:'Нужно проверить релиз.',summaryJson:{fixture:true},proposals:[{proposalType:'action',title:'Проверить релиз',body:'Закрыть QA.',sourceSegmentIds:[segments[0].id],confidence:.95}]}}
  };
  const processor=new MeetingProcessor({repository:repo,objectStore,transcriptionProvider,summaryProvider});
  const transcriptResult=await processor.runOnce('transcribe');
  assert.equal(transcriptResult.processed,true);
  assert.equal(transcriptResult.segmentCount,1);
  assert.match(transcriptResult.sourceSha256,/^[0-9a-f]{64}$/);
  const summaryResult=await processor.runOnce('summarize');
  assert.equal(summaryResult.processed,true);
  assert.equal(summaryResult.proposalCount,1);
  const view=await repo.getMeeting({workspaceId},callId);
  assert.equal(view.run.status,'review_ready');
  assert.deepEqual(view.proposals[0].sourceSegmentIds,[view.segments[0].id]);
});

test('meeting processor does not claim jobs when production providers are not configured',async()=>{
  const repo=new MemoryMeetingRepository();
  const processor=new MeetingProcessor({repository:repo,objectStore:{head:async()=>({exists:true,sizeBytes:1}),get:async()=>Buffer.from('x')}});
  assert.equal((await processor.runOnce('transcribe')).reason,'transcription_provider_unavailable');
  assert.equal((await processor.runOnce('summarize')).reason,'summary_provider_unavailable');
});

test('meeting processor fails a claimed job if the recording object is missing',async()=>{
  const repo=new MemoryMeetingRepository();
  const workspaceId=crypto.randomUUID(),organizationId=crypto.randomUUID(),callId=crypto.randomUUID(),recordingId=crypto.randomUUID();
  await repo.registerRecording({id:recordingId,organizationId,workspaceId,callId,providerRecordingId:'EG_MISSING',storageKey:'recordings/missing.mp4',status:'processing',transcriptStatus:'not_requested'});
  await repo.reconcileEgress('EG_MISSING',{success:true});
  const processor=new MeetingProcessor({
    repository:repo,
    objectStore:{head:async()=>({exists:false,sizeBytes:null}),get:async()=>Buffer.alloc(0)},
    transcriptionProvider:{status:()=>({provider:'fixture',enabled:true}),transcribe:async()=>{throw new Error('should not run')}},
    summaryProvider:{status:()=>({provider:'fixture',enabled:true}),summarize:async()=>({overview:'',proposals:[]})},
    retryDelayMs:1,
  });
  const result=await processor.runOnce('transcribe');
  assert.equal(result.processed,false);
  assert.equal(result.error.code,'RECORDING_OBJECT_MISSING');
  assert.equal([...repo.jobs.values()][0].status,'failed');
});
