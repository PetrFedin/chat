import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryMeetingRepository } from '../src/meeting/meeting-repository.js';
import { createProcessingAwareMeetingRepository } from '../src/meeting/processing-repository.js';
import { MemoryMeetingOperationsRepository } from '../src/meeting/operations-repository.js';
import { Permission, hasPermission } from '../src/rbac.js';

function session(role='owner'){
  return{organizationId:randomUUID(),workspaceId:randomUUID(),userId:randomUUID(),role};
}

test('price catalog uses the latest effective immutable version and computes provider usage components',async()=>{
  const actor=session();
  const meeting=createProcessingAwareMeetingRepository(new MemoryMeetingRepository());
  const ops=new MemoryMeetingOperationsRepository(meeting);
  const first=await ops.createPriceVersion(actor,{
    provider:'openai',model:'gpt-5.6',kind:'summarize',currency:'USD',effectiveFrom:'2026-01-01T00:00:00Z',
    sourceRef:'fixture-v1',items:[
      {metricName:'input_tokens',usagePath:'input_tokens',unitQuantity:1000,unitPrice:0.002},
      {metricName:'output_tokens',usagePath:'output_tokens',unitQuantity:1000,unitPrice:0.01},
    ],
  });
  await ops.createPriceVersion(actor,{
    provider:'openai',model:'gpt-5.6',kind:'summarize',currency:'USD',effectiveFrom:'2026-07-01T00:00:00Z',
    sourceRef:'fixture-v2',items:[
      {metricName:'input_tokens',usagePath:'input_tokens',unitQuantity:1000,unitPrice:0.004},
      {metricName:'output_tokens',usagePath:'output_tokens',unitQuantity:1000,unitPrice:0.02},
    ],
  });
  meeting.providerCalls.set(randomUUID(),{
    id:randomUUID(),organizationId:actor.organizationId,workspaceId:actor.workspaceId,runId:randomUUID(),jobId:randomUUID(),kind:'summarize',attemptNumber:1,
    provider:'openai',model:'gpt-5.6',status:'succeeded',usage:{input_tokens:1000,output_tokens:200},startedAt:'2026-03-01T00:00:00Z',finishedAt:'2026-03-01T00:00:01Z',latencyMs:1000,
  });
  const report=await ops.costReport(actor,{});
  assert.equal(report.calls.length,1);
  assert.equal(report.calls[0].pricing.priceVersionId,first.id);
  assert.equal(report.calls[0].pricing.priced,true);
  assert.equal(report.calls[0].pricing.amount,'0.004');
  assert.equal(report.rollup.currencies[0].amount,'0.004');
  assert.equal(report.rollup.pricedCalls,1);
  assert.equal(report.rollup.unpricedCalls,0);
});

test('financial rollups cover the full period, include failed usage and avoid IEEE-754 artifacts',async()=>{
  const actor=session();
  const meeting=createProcessingAwareMeetingRepository(new MemoryMeetingRepository());
  const ops=new MemoryMeetingOperationsRepository(meeting);
  await ops.createPriceVersion(actor,{
    provider:'fixture',model:'decimal-v1',kind:'summarize',currency:'USD',effectiveFrom:'2026-01-01T00:00:00Z',
    items:[{metricName:'units',usagePath:'units',unitQuantity:1,unitPrice:0.1}],
  });
  for(const [index,units] of [1,2,3].entries()){
    const id=randomUUID();
    meeting.providerCalls.set(id,{
      id,organizationId:actor.organizationId,workspaceId:actor.workspaceId,runId:randomUUID(),jobId:randomUUID(),kind:'summarize',attemptNumber:1,
      provider:'fixture',model:'decimal-v1',status:index===1?'failed':'succeeded',usage:{units},startedAt:`2026-03-0${index+1}T00:00:00Z`,finishedAt:`2026-03-0${index+1}T00:00:01Z`,latencyMs:1000,
      errorCode:index===1?'PROVIDER_TIMEOUT':null,
    });
  }
  const report=await ops.costReport(actor,{limit:1});
  assert.equal(report.calls.length,1,'detail limit must not truncate the period rollup');
  assert.equal(report.rollup.totalCalls,3);
  assert.equal(report.rollup.pricedCalls,3);
  assert.equal(report.rollup.currencies[0].amount,'0.6');
  assert.equal(report.rollup.providers[0].amount,'0.6');
});

test('unpriced or incompatible usage stays explicit instead of being reported as zero cost',async()=>{
  const actor=session();
  const meeting=createProcessingAwareMeetingRepository(new MemoryMeetingRepository());
  const ops=new MemoryMeetingOperationsRepository(meeting);
  await ops.createPriceVersion(actor,{
    provider:'openai',model:'gpt-4o-transcribe-diarize',kind:'transcribe',currency:'USD',effectiveFrom:'2026-01-01T00:00:00Z',
    items:[{metricName:'duration',usagePath:'seconds',unitQuantity:60,unitPrice:0.1}],
  });
  meeting.providerCalls.set('call',{
    id:'call',organizationId:actor.organizationId,workspaceId:actor.workspaceId,runId:randomUUID(),jobId:randomUUID(),kind:'transcribe',attemptNumber:1,
    provider:'openai',model:'gpt-4o-transcribe-diarize',status:'succeeded',usage:{input_tokens:123},startedAt:'2026-03-01T00:00:00Z',finishedAt:'2026-03-01T00:00:01Z',latencyMs:1000,
  });
  const report=await ops.costReport(actor,{});
  assert.equal(report.calls[0].pricing.priced,false);
  assert.equal(report.calls[0].pricing.reason,'usage_schema_mismatch');
  assert.equal(report.calls[0].pricing.amount,null);
  assert.equal(report.rollup.unpricedCalls,1);

  meeting.providerCalls.set('failed-without-usage',{
    id:'failed-without-usage',organizationId:actor.organizationId,workspaceId:actor.workspaceId,runId:randomUUID(),jobId:randomUUID(),kind:'transcribe',attemptNumber:2,
    provider:'openai',model:'gpt-4o-transcribe-diarize',status:'failed',usage:null,startedAt:'2026-03-02T00:00:00Z',finishedAt:'2026-03-02T00:00:01Z',latencyMs:1000,errorCode:'PROVIDER_TIMEOUT',
  });
  const withFailure=await ops.costReport(actor,{});
  const missingUsage=withFailure.calls.find((call)=>call.id==='failed-without-usage');
  assert.equal(missingUsage.pricing.priced,false);
  assert.equal(missingUsage.pricing.reason,'usage_unavailable');
  assert.equal(withFailure.rollup.unpricedCalls,2);
});

test('manual dead-letter retry preserves attempt history and monotonically sequences repeated recovery audit',async()=>{
  const actor=session();
  const base=new MemoryMeetingRepository();
  const meeting=createProcessingAwareMeetingRepository(base);
  const ops=new MemoryMeetingOperationsRepository(meeting);
  const runId=randomUUID(),jobId=randomUUID(),recordingId=randomUUID(),callId=randomUUID();
  base.runs.set(runId,{id:runId,organizationId:actor.organizationId,workspaceId:actor.workspaceId,callId,recordingId,status:'failed',errorCode:'MEETING_JOB_DEAD_LETTER',errorMessage:'provider failed',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  base.jobs.set(jobId,{id:jobId,organizationId:actor.organizationId,workspaceId:actor.workspaceId,runId,kind:'transcribe',status:'dead_letter',attempts:5,maxAttempts:5,availableAt:new Date().toISOString(),lastError:'provider failed',finishedAt:new Date().toISOString(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  base.recordings.set('provider-id',{id:recordingId,organizationId:actor.organizationId,workspaceId:actor.workspaceId,callId,providerRecordingId:'provider-id',storageKey:'recordings/test.mp4',status:'ready',transcriptStatus:'failed',summaryStatus:'not_requested'});

  const first=await ops.retryJob(actor,jobId,{reason:'Provider incident resolved',extraAttempts:2});
  assert.equal(first.status,'pending');
  assert.equal(first.attempts,5,'past attempt count must never be reset');
  assert.equal(first.maxAttempts,7,'manual retry adds bounded future budget');
  assert.equal(base.runs.get(runId).status,'queued');
  assert.equal(base.recordings.get('provider-id').transcriptStatus,'queued');
  await assert.rejects(()=>ops.retryJob(actor,jobId,{reason:'double click'}),(err)=>err.code==='JOB_NOT_RETRYABLE'&&err.statusCode===409);

  const job=base.jobs.get(jobId);
  job.status='dead_letter';job.attempts=7;job.maxAttempts=7;job.lastError='second provider incident';job.finishedAt=new Date().toISOString();job.updatedAt=new Date().toISOString();
  const run=base.runs.get(runId);run.status='failed';run.errorCode='MEETING_JOB_DEAD_LETTER';run.errorMessage='second provider incident';
  base.recordings.get('provider-id').transcriptStatus='failed';

  const second=await ops.retryJob(actor,jobId,{reason:'Second incident resolved',extraAttempts:1});
  assert.equal(second.status,'pending');
  assert.equal(second.attempts,7);
  assert.equal(second.maxAttempts,8);
  const audit=await ops.jobAudit(actor,jobId);
  assert.equal(audit.length,2);
  assert.ok(Number(audit[0].sequence)>Number(audit[1].sequence),'recovery audit sequence must be monotonic');
  assert.equal(audit[0].payload.reason,'Second incident resolved');
  assert.equal(audit[0].payload.previous.attempts,7);
  assert.equal(audit[1].payload.reason,'Provider incident resolved');
  assert.equal(audit[1].payload.previous.attempts,5);
});

test('meeting operations and cost permissions stay owner/admin only',()=>{
  for(const permission of [Permission.MEETING_OPS_MANAGE,Permission.MEETING_COST_READ,Permission.MEETING_COST_MANAGE]){
    assert.equal(hasPermission('owner',permission),true);
    assert.equal(hasPermission('admin',permission),true);
    assert.equal(hasPermission('manager',permission),false);
    assert.equal(hasPermission('member',permission),false);
    assert.equal(hasPermission('guest',permission),false);
  }
});
