import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { PostgresMeetingOperationsRepository } from '../src/meeting/operations-repository.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl=process.env.DATABASE_URL;

async function ownerSession(store,suffix){
  const password=hashPassword('WorkspacePass42');
  const created=await store.createCompany({
    companyName:`Meeting Ops ${suffix}`,
    ownerName:'Ops Owner',
    email:`meeting-ops-${suffix}@example.com`,
    passwordHash:password.hash,
    passwordSalt:password.salt,
  });
  const tokenHash=hashToken(`meeting-ops-session-${suffix}-${randomUUID()}`);
  await store.createSession({userId:created.user.id,workspaceId:created.workspace.id,tokenHash,expiresAt:new Date(Date.now()+86400000).toISOString()});
  return store.getSession(tokenHash);
}

test('Postgres cost report chooses the effective catalog and keeps exact provider usage', {skip:!databaseUrl}, async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});t.after(()=>pool.end());
  const store=new PostgresStore(pool),ops=new PostgresMeetingOperationsRepository(pool),suffix=randomUUID().slice(0,8);
  const owner=await ownerSession(store,suffix);
  const general=(await store.listConversations(owner)).find((item)=>item.slug==='general');
  const callId=randomUUID(),recordingId=randomUUID(),runId=randomUUID(),jobId=randomUUID(),providerCallId=randomUUID();
  await pool.query(`INSERT INTO call_sessions(id,organization_id,workspace_id,conversation_id,created_by,title,mode,state,provider,provider_room_name)
    VALUES($1,$2,$3,$4,$5,'Cost test','video','ended','livekit',$6)`,[callId,owner.organizationId,owner.workspaceId,general.id,owner.userId,`cost-${suffix}`]);
  await pool.query(`INSERT INTO call_recordings(id,organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,started_by)
    VALUES($1,$2,$3,$4,'livekit',$5,$6,'ready',$7)`,[recordingId,owner.organizationId,owner.workspaceId,callId,`EG_COST_${suffix}`,`recordings/${suffix}.mp4`,owner.userId]);
  await pool.query(`INSERT INTO meeting_intelligence_runs(id,organization_id,workspace_id,call_id,recording_id,status)
    VALUES($1,$2,$3,$4,$5,'review_ready')`,[runId,owner.organizationId,owner.workspaceId,callId,recordingId]);
  await pool.query(`INSERT INTO meeting_intelligence_jobs(id,organization_id,workspace_id,run_id,kind,status,attempts,max_attempts,finished_at)
    VALUES($1,$2,$3,$4,'summarize','succeeded',2,5,now())`,[jobId,owner.organizationId,owner.workspaceId,runId]);
  await pool.query(`INSERT INTO meeting_provider_calls(id,organization_id,workspace_id,run_id,job_id,kind,attempt_number,provider,model,status,usage,started_at,finished_at,latency_ms,error_code,error_message)
    VALUES($1,$2,$3,$4,$5,'summarize',1,'openai','gpt-5.6','failed',$6,'2026-03-01T11:59:00Z','2026-03-01T11:59:01Z',1000,'PROVIDER_TIMEOUT','temporary failure')`,
  [randomUUID(),owner.organizationId,owner.workspaceId,runId,jobId,{input_tokens:500,output_tokens:0}]);
  await pool.query(`INSERT INTO meeting_provider_calls(id,organization_id,workspace_id,run_id,job_id,kind,attempt_number,provider,model,status,usage,started_at,finished_at,latency_ms)
    VALUES($1,$2,$3,$4,$5,'summarize',2,'openai','gpt-5.6','succeeded',$6,'2026-03-01T12:00:00Z','2026-03-01T12:00:01Z',1000)`,
  [providerCallId,owner.organizationId,owner.workspaceId,runId,jobId,{input_tokens:1000,output_tokens:200}]);

  const version=await ops.createPriceVersion(owner,{
    provider:'openai',model:'gpt-5.6',kind:'summarize',currency:'USD',effectiveFrom:'2026-01-01T00:00:00Z',sourceRef:'test-price-source',
    items:[
      {metricName:'input_tokens',usagePath:'input_tokens',unitQuantity:1000,unitPrice:0.002},
      {metricName:'output_tokens',usagePath:'output_tokens',unitQuantity:1000,unitPrice:0.01},
    ],
  });
  await ops.createPriceVersion(owner,{
    provider:'openai',model:'gpt-5.6',kind:'summarize',currency:'USD',effectiveFrom:'2026-07-01T00:00:00Z',
    items:[
      {metricName:'input_tokens',usagePath:'input_tokens',unitQuantity:1000,unitPrice:0.004},
      {metricName:'output_tokens',usagePath:'output_tokens',unitQuantity:1000,unitPrice:0.02},
    ],
  });

  const report=await ops.costReport(owner,{from:'2026-01-01T00:00:00Z',to:'2026-12-31T23:59:59Z',limit:1});
  assert.equal(report.calls.length,1,'detail limit must not truncate the period rollup');
  assert.equal(report.calls[0].pricing.priceVersionId,version.id);
  assert.equal(report.calls[0].pricing.priced,true);
  assert.equal(report.calls[0].pricing.amount,'0.004');
  assert.equal(report.rollup.totalCalls,2);
  assert.equal(report.rollup.pricedCalls,2);
  assert.equal(report.rollup.currencies[0].amount,'0.005');
  assert.deepEqual(report.calls[0].usage,{input_tokens:1000,output_tokens:200});
  assert.equal(report.calls[0].providerRequestId,undefined);

  const auditCount=Number((await pool.query(`SELECT count(*) FROM audit_events WHERE workspace_id=$1 AND aggregate_type='meeting_price_version' AND aggregate_id=$2 AND event_type='meeting.price_version.created'`,[owner.workspaceId,version.id])).rows[0].count);
  assert.equal(auditCount,1);
});

test('Postgres manual retry preserves attempt sequence and monotonically audits repeated recovery', {skip:!databaseUrl}, async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});t.after(()=>pool.end());
  const store=new PostgresStore(pool),ops=new PostgresMeetingOperationsRepository(pool),suffix=randomUUID().slice(0,8);
  const owner=await ownerSession(store,suffix);
  const general=(await store.listConversations(owner)).find((item)=>item.slug==='general');
  const callId=randomUUID(),recordingId=randomUUID(),runId=randomUUID(),jobId=randomUUID();
  await pool.query(`INSERT INTO call_sessions(id,organization_id,workspace_id,conversation_id,created_by,title,mode,state,provider,provider_room_name)
    VALUES($1,$2,$3,$4,$5,'Retry test','video','ended','livekit',$6)`,[callId,owner.organizationId,owner.workspaceId,general.id,owner.userId,`retry-${suffix}`]);
  await pool.query(`INSERT INTO call_recordings(id,organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,started_by,transcript_status)
    VALUES($1,$2,$3,$4,'livekit',$5,$6,'ready',$7,'failed')`,[recordingId,owner.organizationId,owner.workspaceId,callId,`EG_RETRY_${suffix}`,`recordings/${suffix}.mp4`,owner.userId]);
  await pool.query(`INSERT INTO meeting_intelligence_runs(id,organization_id,workspace_id,call_id,recording_id,status,error_code,error_message)
    VALUES($1,$2,$3,$4,$5,'failed','MEETING_JOB_DEAD_LETTER','provider failed')`,[runId,owner.organizationId,owner.workspaceId,callId,recordingId]);
  await pool.query(`INSERT INTO meeting_intelligence_jobs(id,organization_id,workspace_id,run_id,kind,status,attempts,max_attempts,last_error,finished_at)
    VALUES($1,$2,$3,$4,'transcribe','dead_letter',5,5,'provider failed',now())`,[jobId,owner.organizationId,owner.workspaceId,runId]);

  const first=await ops.retryJob(owner,jobId,{reason:'Provider incident resolved',extraAttempts:2});
  assert.equal(first.status,'pending');
  assert.equal(first.attempts,5);
  assert.equal(first.maxAttempts,7);
  let persisted=(await pool.query(`SELECT j.status,j.attempts,j.max_attempts,r.status run_status,cr.transcript_status
    FROM meeting_intelligence_jobs j JOIN meeting_intelligence_runs r ON r.workspace_id=j.workspace_id AND r.id=j.run_id
    JOIN call_recordings cr ON cr.workspace_id=r.workspace_id AND cr.id=r.recording_id WHERE j.id=$1`,[jobId])).rows[0];
  assert.equal(persisted.status,'pending');
  assert.equal(persisted.attempts,5);
  assert.equal(persisted.max_attempts,7);
  assert.equal(persisted.run_status,'queued');
  assert.equal(persisted.transcript_status,'queued');
  await assert.rejects(()=>ops.retryJob(owner,jobId,{reason:'duplicate'}),(err)=>err.code==='JOB_NOT_RETRYABLE'&&err.statusCode===409);

  await pool.query(`UPDATE meeting_intelligence_jobs SET status='dead_letter',attempts=7,max_attempts=7,last_error='second provider incident',finished_at=now(),updated_at=now()
    WHERE workspace_id=$1 AND id=$2`,[owner.workspaceId,jobId]);
  await pool.query(`UPDATE meeting_intelligence_runs SET status='failed',error_code='MEETING_JOB_DEAD_LETTER',error_message='second provider incident',updated_at=now()
    WHERE workspace_id=$1 AND id=$2`,[owner.workspaceId,runId]);
  await pool.query(`UPDATE call_recordings SET transcript_status='failed',updated_at=now() WHERE workspace_id=$1 AND id=$2`,[owner.workspaceId,recordingId]);

  const second=await ops.retryJob(owner,jobId,{reason:'Second incident resolved',extraAttempts:1});
  assert.equal(second.status,'pending');
  assert.equal(second.attempts,7);
  assert.equal(second.maxAttempts,8);
  persisted=(await pool.query(`SELECT status,attempts,max_attempts FROM meeting_intelligence_jobs WHERE workspace_id=$1 AND id=$2`,[owner.workspaceId,jobId])).rows[0];
  assert.equal(persisted.status,'pending');
  assert.equal(persisted.attempts,7);
  assert.equal(persisted.max_attempts,8);

  const audit=await ops.jobAudit(owner,jobId);
  assert.equal(audit.length,2);
  assert.ok(Number(audit[0].sequence)>Number(audit[1].sequence),'Postgres identity sequence must advance across repeated recovery');
  assert.equal(audit[0].payload.reason,'Second incident resolved');
  assert.equal(audit[0].payload.previous.attempts,7);
  assert.equal(audit[1].payload.reason,'Provider incident resolved');
  assert.equal(audit[1].payload.previous.attempts,5);
  const outboxCount=Number((await pool.query(`SELECT count(*) FROM outbox_events WHERE workspace_id=$1 AND topic='meeting.job.retried' AND aggregate_id=$2`,[owner.workspaceId,jobId])).rows[0].count);
  assert.equal(outboxCount,2);
});
