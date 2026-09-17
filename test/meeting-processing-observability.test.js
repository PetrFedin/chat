import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryMeetingRepository } from '../src/meeting/meeting-repository.js';
import { createProcessingAwareMeetingRepository } from '../src/meeting/processing-repository.js';
import { MeetingProcessor } from '../src/meeting/processor.js';

function recording(overrides={}){
  return{
    id:randomUUID(),
    organizationId:randomUUID(),
    workspaceId:randomUUID(),
    callId:randomUUID(),
    providerRecordingId:`EG_ARCHIVE_${randomUUID()}`,
    storageKey:`recordings/${randomUUID()}.mp4`,
    transcriptionProviderRecordingId:`EG_AUDIO_${randomUUID()}`,
    transcriptionStorageKey:`recordings/${randomUUID()}.transcription.ogg`,
    transcriptionSourceStatus:'processing',
    status:'processing',
    transcriptStatus:'not_requested',
    summaryStatus:'not_requested',
    ...overrides,
  };
}

test('archive completion waits for the preferred audio sidecar, then queues transcription from sidecar exactly once',async()=>{
  const base=new MemoryMeetingRepository();
  const repo=createProcessingAwareMeetingRepository(base);
  const item=recording();
  await repo.registerRecording(item);

  const archive=await repo.reconcileEgress(item.providerRecordingId,{success:true});
  assert.equal(archive.recording.status,'ready');
  assert.equal(archive.recording.transcriptStatus,'not_requested');
  assert.equal(archive.run,null);
  assert.equal(archive.job,null);

  const sidecar=await repo.reconcileEgress(item.transcriptionProviderRecordingId,{success:true});
  assert.equal(sidecar.recording.transcriptionSourceStatus,'ready');
  assert.equal(sidecar.recording.transcriptStatus,'queued');
  assert.equal(sidecar.sourceKind,'audio_sidecar');
  assert.equal(sidecar.job.kind,'transcribe');

  const duplicate=await repo.reconcileEgress(item.transcriptionProviderRecordingId,{success:true});
  assert.equal(duplicate.run.id,sidecar.run.id);
  assert.equal(duplicate.job.id,sidecar.job.id);
  assert.equal([...base.runs.values()].filter((run)=>run.recordingId===item.id).length,1);
  assert.equal([...base.jobs.values()].filter((job)=>job.runId===sidecar.run.id&&job.kind==='transcribe').length,1);

  const claimed=await repo.claimJob('transcribe');
  const context=await repo.jobContext(claimed);
  assert.equal(context.storageKey,item.transcriptionStorageKey);
  assert.equal(context.providerRecordingId,item.transcriptionProviderRecordingId);
  assert.equal(context.sourceKind,'audio_sidecar');
});

test('failed audio sidecar falls back to ready archive instead of losing the meeting',async()=>{
  const base=new MemoryMeetingRepository();
  const repo=createProcessingAwareMeetingRepository(base);
  const item=recording();
  await repo.registerRecording(item);

  const archive=await repo.reconcileEgress(item.providerRecordingId,{success:true});
  assert.equal(archive.run,null);
  const fallback=await repo.reconcileEgress(item.transcriptionProviderRecordingId,{success:false,error:'audio encoder failed'});
  assert.equal(fallback.recording.status,'ready');
  assert.equal(fallback.recording.transcriptionSourceStatus,'failed');
  assert.equal(fallback.recording.transcriptionSourceError,'audio encoder failed');
  assert.equal(fallback.sourceKind,'archive');
  assert.equal(fallback.recording.transcriptStatus,'queued');

  const claimed=await repo.claimJob('transcribe');
  const context=await repo.jobContext(claimed);
  assert.equal(context.storageKey,item.storageKey);
  assert.equal(context.providerRecordingId,item.providerRecordingId);
  assert.equal(context.sourceKind,'archive');
});

test('audio sidecar can preserve transcription even when archive egress fails',async()=>{
  const base=new MemoryMeetingRepository();
  const repo=createProcessingAwareMeetingRepository(base);
  const item=recording();
  await repo.registerRecording(item);

  const sidecar=await repo.reconcileEgress(item.transcriptionProviderRecordingId,{success:true});
  assert.equal(sidecar.sourceKind,'audio_sidecar');
  assert.equal(sidecar.recording.transcriptStatus,'queued');
  const archiveFailure=await repo.reconcileEgress(item.providerRecordingId,{success:false,error:'video composite failed'});
  assert.equal(archiveFailure.recording.status,'failed');
  assert.equal(archiveFailure.recording.transcriptionSourceStatus,'ready');
  assert.equal(archiveFailure.job.id,sidecar.job.id);
});

test('processor records provider request usage and latency against the exact retry attempt',async()=>{
  const base=new MemoryMeetingRepository();
  const repo=createProcessingAwareMeetingRepository(base);
  const item=recording();
  await repo.registerRecording(item);
  await repo.reconcileEgress(item.transcriptionProviderRecordingId,{success:true});
  const body=Buffer.from('small deterministic audio fixture');
  const objectStore={
    async head(key){assert.equal(key,item.transcriptionStorageKey);return{exists:true,sizeBytes:body.length}},
    async get(key){assert.equal(key,item.transcriptionStorageKey);return body},
  };
  const transcriptionProvider={
    status:()=>({provider:'fixture-transcriber',model:'fixture-v2',enabled:true}),
    async transcribe(){
      return{
        provider:'fixture-transcriber',model:'fixture-v2',requestId:'req_fixture_123',language:'ru',
        usage:{type:'duration',seconds:3.2},
        segments:[{startMs:0,endMs:3200,speakerLabel:'A',text:'Проверяем источник и телеметрию.',confidence:.99}],
      };
    },
  };
  const processor=new MeetingProcessor({
    repository:repo,objectStore,transcriptionProvider,
    summaryProvider:{status:()=>({provider:'none',enabled:false})},
  });
  const result=await processor.runOnce('transcribe');
  assert.equal(result.processed,true);
  assert.equal(result.sourceKind,'audio_sidecar');
  assert.equal(result.sourceSizeBytes,body.length);

  const view=await repo.getMeeting({workspaceId:item.workspaceId},item.callId);
  assert.equal(view.providerCalls.length,1);
  assert.equal(view.providerCalls[0].kind,'transcribe');
  assert.equal(view.providerCalls[0].attemptNumber,1);
  assert.equal(view.providerCalls[0].provider,'fixture-transcriber');
  assert.equal(view.providerCalls[0].model,'fixture-v2');
  assert.equal(view.providerCalls[0].status,'succeeded');
  assert.deepEqual(view.providerCalls[0].usage,{type:'duration',seconds:3.2});
  assert.ok(view.providerCalls[0].latencyMs>=0);
  assert.equal(view.providerCalls[0].providerRequestId,undefined,'user-facing meeting view must not expose provider request IDs');
  assert.equal(view.providerCalls[0].inputMetadata,undefined,'user-facing meeting view must not expose internal source metadata');
});

test('processor fails before download/provider call when the selected recording source exceeds the memory safety limit',async()=>{
  const base=new MemoryMeetingRepository();
  const repo=createProcessingAwareMeetingRepository(base);
  const item=recording({
    transcriptionProviderRecordingId:null,
    transcriptionStorageKey:null,
    transcriptionSourceStatus:'not_requested',
  });
  await repo.registerRecording(item);
  await repo.reconcileEgress(item.providerRecordingId,{success:true});
  let downloads=0,providerCalls=0;
  const objectStore={
    async head(){return{exists:true,sizeBytes:2*1024*1024}},
    async get(){downloads++;return Buffer.alloc(2*1024*1024)},
  };
  const processor=new MeetingProcessor({
    repository:repo,objectStore,maxInMemoryBytes:1024*1024,
    transcriptionProvider:{
      status:()=>({provider:'fixture',model:'fixture',enabled:true}),
      async transcribe(){providerCalls++;return{segments:[]}},
    },
    summaryProvider:{status:()=>({provider:'none',enabled:false})},
    retryDelayMs:1,
  });
  const result=await processor.runOnce('transcribe');
  assert.equal(result.processed,false);
  assert.equal(result.error.code,'RECORDING_OBJECT_TOO_LARGE');
  assert.equal(downloads,0);
  assert.equal(providerCalls,0);
  assert.equal(repo.providerCalls.size,0,'no provider attempt should be metered when provider was never called');
});
