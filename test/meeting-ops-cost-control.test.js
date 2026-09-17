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
  assert.equal(Number(report.calls[0].pricing.amount).toFixed(6),'0.004000');
  assert.equal(report.rollup.pricedCalls,1);
  assert.equal(report.rollup.unpricedCalls,0);
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
});

test('manual dead-letter retry preserves attempt history and only extends bounded future budget',async()=>{
  const actor=session();
  const base=new MemoryMeetingRepository();
  const meeting=createProcessingAwareMeetingRepository(base);
  const ops=new MemoryMeetingOperationsRepository(meeting);
  const runId=randomUUID(),jobId=randomUUID(),recordingId=randomUUID(),callId=randomUUID();
  base.runs.set(runId,{id:runId,organizationId:actor.organizationId,workspaceId:actor.workspaceId,callId,recordingId,status:'failed',errorCode:'MEETING_JOB_DEAD_LETTER',errorMessage:'provider failed',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  base.jobs.set(jobId,{id:jobId,organizationId:actor.organizationId,workspaceId:actor.workspaceId,runId,kind:'transcribe',status:'dead_letter',attempts:5,maxAttempts:5,availableAt:new Date().toISOString(),lastError:'provider failed',finishedAt:new Date().toISOString(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  base.recordings.set('provider-id',{id:recordingId,organizationId:actor.organizationId,workspaceId:actor.workspaceId,callId,providerRecordingId:'provider-id',storageKey:'recordings/test.mp4',status:'ready',transcriptStatus:'failed',summaryStatus:'not_requested'});

  const retried=await ops.retryJob(actor,jobId,{reason:'Provider incident resolved',extraAttempts:2});
  assert.equal(retried.status,'pending');
  assert.equal(retried.attempts,5,'past attempt count must never be reset');
  assert.equal(retried.maxAttempts,7,'manual retry adds bounded future budget');
  assert.equal(base.runs.get(runId).status,'queued');
  assert.equal(base.recordings.get('provider-id').transcriptStatus,'queued');
  const audit=await ops.jobAudit(actor,jobId);
  assert.equal(audit.length,1);
  assert.equal(audit[0].eventType,'meeting.job.retried');
  assert.equal(audit[0].payload.previous.attempts,5);
  assert.equal(audit[0].payload.reason,'Provider incident resolved');

  await assert.rejects(()=>ops.retryJob(actor,jobId,{reason:'double click'}),(error)=>error.code==='JOB_NOT_RETRYABLE'&&error.statusCode===409);
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
