import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { PostgresCallRepository } from '../src/media/call-repository.js';
import { PostgresMeetingRepository } from '../src/meeting/meeting-repository.js';
import { createProcessingAwareMeetingRepository } from '../src/meeting/processing-repository.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl=process.env.DATABASE_URL;

async function ownerSession(store,suffix){
  const password=hashPassword('WorkspacePass42');
  const created=await store.createCompany({
    companyName:`Processing ${suffix}`,
    ownerName:'Processing Owner',
    email:`processing-owner-${suffix}@example.com`,
    passwordHash:password.hash,
    passwordSalt:password.salt,
  });
  const tokenHash=hashToken(`processing-session-${suffix}-${randomUUID()}`);
  await store.createSession({
    userId:created.user.id,
    workspaceId:created.workspace.id,
    tokenHash,
    expiresAt:new Date(Date.now()+86400000).toISOString(),
  });
  return store.getSession(tokenHash);
}

async function createRecordedCall({store,calls,owner,suffix}){
  const general=(await store.listConversations(owner)).find((conversation)=>conversation.slug==='general');
  const call=await calls.create(owner,{
    conversationId:general.id,
    calendarEventId:null,
    title:`Processing ${suffix}`,
    mode:'video',
    participantIds:[owner.userId],
    scheduledFor:null,
    providerRoomName:`processing-${suffix}`,
  });
  const recording=await calls.startRecording(owner,call.id,{
    recordingId:randomUUID(),
    providerRecordingId:`EG_ARCHIVE_${suffix}`,
    storageKey:`recordings/${owner.workspaceId}/${call.id}/archive.mp4`,
    transcriptionProviderRecordingId:`EG_AUDIO_${suffix}`,
    transcriptionStorageKey:`recordings/${owner.workspaceId}/${call.id}/transcription.ogg`,
    transcriptionSourceStatus:'recording',
  });
  await calls.stopRecording(owner,call.id);
  return{call,recording};
}

test('Postgres processing repository waits for sidecar, selects it as evidence source and meters the claimed attempt', {skip:!databaseUrl}, async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  t.after(()=>pool.end());
  const store=new PostgresStore(pool);
  const calls=new PostgresCallRepository(pool);
  const meeting=createProcessingAwareMeetingRepository(new PostgresMeetingRepository(pool),pool);
  const suffix=randomUUID().slice(0,8);
  const owner=await ownerSession(store,suffix);
  const {call,recording}=await createRecordedCall({store,calls,owner,suffix});

  const archive=await meeting.reconcileEgress(recording.providerRecordingId,{success:true});
  assert.equal(archive.recording.status,'ready');
  assert.equal(archive.run,null,'archive should not queue while preferred sidecar is still processing');
  const callsAfterArchive=await calls.get(owner,call.id);
  assert.equal(callsAfterArchive.recordings[0].transcriptionSourceStatus,'processing');

  const sidecar=await meeting.reconcileEgress(recording.transcriptionProviderRecordingId,{success:true});
  assert.equal(sidecar.sourceKind,'audio_sidecar');
  assert.ok(sidecar.run?.id);
  assert.ok(sidecar.job?.id);
  assert.equal(sidecar.recording.transcriptStatus,'queued');

  const duplicate=await meeting.reconcileEgress(recording.transcriptionProviderRecordingId,{success:true});
  assert.equal(duplicate.run.id,sidecar.run.id);
  assert.equal(duplicate.job.id,sidecar.job.id);
  const readyCount=Number((await pool.query(`SELECT count(*) FROM outbox_events
    WHERE workspace_id=$1 AND topic='meeting.recording.ready' AND aggregate_id=$2`,[owner.workspaceId,sidecar.run.id])).rows[0].count);
  assert.equal(readyCount,1);

  const job=await meeting.claimJob('transcribe');
  assert.equal(job.id,sidecar.job.id);
  const context=await meeting.jobContext(job);
  assert.equal(context.sourceKind,'audio_sidecar');
  assert.equal(context.storageKey,recording.transcriptionStorageKey);
  assert.equal(context.providerRecordingId,recording.transcriptionProviderRecordingId);

  const providerCall=await meeting.startProviderCall(job,context,{
    provider:'openai',
    model:'gpt-4o-transcribe-diarize',
    inputMetadata:{sourceKind:context.sourceKind,sourceSizeBytes:4321},
  });
  assert.equal(providerCall.attemptNumber,job.attempts);
  const finished=await meeting.finishProviderCall(providerCall.id,{
    status:'succeeded',requestId:'req_pg_fixture',usage:{type:'duration',seconds:19.5},
  });
  assert.equal(finished.status,'succeeded');
  assert.ok(finished.latencyMs>=0);

  const rows=(await pool.query(`SELECT kind,attempt_number,provider,model,status,provider_request_id,usage,input_metadata,latency_ms
    FROM meeting_provider_calls WHERE workspace_id=$1 AND run_id=$2`,[owner.workspaceId,sidecar.run.id])).rows;
  assert.equal(rows.length,1);
  assert.equal(rows[0].kind,'transcribe');
  assert.equal(rows[0].attempt_number,job.attempts);
  assert.equal(rows[0].provider_request_id,'req_pg_fixture');
  assert.equal(rows[0].usage.seconds,19.5);
  assert.equal(rows[0].input_metadata.sourceKind,'audio_sidecar');

  const visible=await meeting.getMeeting(owner,call.id);
  assert.equal(visible.providerCalls.length,1);
  assert.equal(visible.providerCalls[0].provider,'openai');
  assert.equal(visible.providerCalls[0].providerRequestId,undefined);
  assert.equal(visible.providerCalls[0].inputMetadata,undefined);
});

test('Postgres processing repository falls back to archive if sidecar fails after archive is ready', {skip:!databaseUrl}, async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  t.after(()=>pool.end());
  const store=new PostgresStore(pool);
  const calls=new PostgresCallRepository(pool);
  const meeting=createProcessingAwareMeetingRepository(new PostgresMeetingRepository(pool),pool);
  const suffix=randomUUID().slice(0,8);
  const owner=await ownerSession(store,suffix);
  const {call,recording}=await createRecordedCall({store,calls,owner,suffix});

  const archive=await meeting.reconcileEgress(recording.providerRecordingId,{success:true});
  assert.equal(archive.run,null);
  const fallback=await meeting.reconcileEgress(recording.transcriptionProviderRecordingId,{success:false,error:'audio sidecar failed'});
  assert.equal(fallback.sourceKind,'archive');
  assert.ok(fallback.run?.id);
  assert.equal(fallback.recording.transcriptionSourceStatus,'failed');
  assert.equal(fallback.recording.transcriptStatus,'queued');

  const job=await meeting.claimJob('transcribe');
  const context=await meeting.jobContext(job);
  assert.equal(context.sourceKind,'archive');
  assert.equal(context.storageKey,recording.storageKey);

  const persisted=(await calls.get(owner,call.id)).recordings[0];
  assert.equal(persisted.transcriptionSourceStatus,'failed');
  assert.equal(persisted.transcriptionSourceError,'audio sidecar failed');
});
