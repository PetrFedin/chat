import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';
import { MemoryStore } from '../src/persistence/store.js';

async function request(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(`${base}${path}`,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},
    body:body!==undefined?JSON.stringify(body):undefined,
  });
  const payload=response.status===204?null:await response.json().catch(()=>null);
  return {response,payload,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}

async function invite(base,ownerCookie,email,name,role='member'){
  const created=await request(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{email,role}});
  assert.equal(created.response.status,201);
  const token=new URL(created.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await request(base,'/api/v1/invitations/accept',{method:'POST',body:{token,displayName:name,password:'StrongPassword42'}});
  assert.equal(accepted.response.status,201);
  const boot=await request(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  return {cookie:accepted.cookie,userId:boot.payload.session.userId};
}

test('task lifecycle is authoritative from assignment through accepted close',async(t)=>{
  const app=await createChatServer({store:new MemoryStore()});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;

  const owner=await request(base,'/api/v1/auth/register-company',{method:'POST',body:{companyName:'Work Cycle Co',ownerName:'Owner',email:'owner@work-cycle.test',password:'OwnerPassword42'}});
  assert.equal(owner.response.status,201);
  const ownerCookie=owner.cookie;
  const worker=await invite(base,ownerCookie,'worker@work-cycle.test','Worker');
  const reviewer=await invite(base,ownerCookie,'reviewer@work-cycle.test','Reviewer');
  const outsider=await invite(base,ownerCookie,'outsider@work-cycle.test','Outsider');

  const privateGroup=await request(base,'/api/v1/conversations',{cookie:ownerCookie,method:'POST',body:{kind:'group',title:'Private task context',participantIds:[worker.userId]}});
  assert.equal(privateGroup.response.status,201);
  const source=await request(base,`/api/v1/conversations/${privateGroup.payload.conversation.id}/messages`,{cookie:ownerCookie,method:'POST',body:{body:'Prepare the monthly report from this confidential context.'}});
  assert.equal(source.response.status,201);
  const forbiddenSource=await request(base,'/api/v1/tasks',{cookie:outsider.cookie,method:'POST',body:{title:'Leaked source task',sourceMessageId:source.payload.message.id}});
  assert.equal(forbiddenSource.response.status,404);
  assert.equal(forbiddenSource.payload.error.code,'TASK_SOURCE_NOT_FOUND');

  const created=await request(base,'/api/v1/tasks',{cookie:ownerCookie,method:'POST',body:{
    title:'Close the monthly report',
    outcome:'Approved report is ready for distribution',
    ownerId:worker.userId,
    acceptorId:reviewer.userId,
    priority:'high',
    promisedAt:'2026-09-25T12:00:00.000Z',
    sourceMessageId:source.payload.message.id,
  }});
  assert.equal(created.response.status,201);
  assert.equal(created.payload.task.status,'proposed');
  assert.equal(created.payload.task.version,1);
  assert.equal(created.payload.task.sourceMessageId,source.payload.message.id);
  const taskId=created.payload.task.id;

  const outsiderRead=await request(base,`/api/v1/tasks/${taskId}`,{cookie:outsider.cookie});
  assert.equal(outsiderRead.response.status,404);
  assert.equal(outsiderRead.payload.error.code,'TASK_NOT_FOUND');

  const accepted=await request(base,`/api/v1/tasks/${taskId}/transitions`,{cookie:worker.cookie,method:'POST',body:{to:'accepted',expectedVersion:1}});
  assert.equal(accepted.response.status,200);
  assert.equal(accepted.payload.task.status,'accepted');
  assert.equal(accepted.payload.task.version,2);

  const stale=await request(base,`/api/v1/tasks/${taskId}/transitions`,{cookie:worker.cookie,method:'POST',body:{to:'in_progress',expectedVersion:1}});
  assert.equal(stale.response.status,409);
  assert.equal(stale.payload.error.code,'STALE_TASK_ACTION');

  const started=await request(base,`/api/v1/tasks/${taskId}/transitions`,{cookie:worker.cookie,method:'POST',body:{to:'in_progress',expectedVersion:2}});
  assert.equal(started.response.status,200);
  assert.equal(started.payload.task.status,'in_progress');
  assert.equal(started.payload.task.version,3);

  const prematureReview=await request(base,`/api/v1/tasks/${taskId}/transitions`,{cookie:worker.cookie,method:'POST',body:{to:'in_review',expectedVersion:3}});
  assert.equal(prematureReview.response.status,409);
  assert.equal(prematureReview.payload.error.code,'TASK_EVIDENCE_REQUIRED');

  const evidence=await request(base,`/api/v1/tasks/${taskId}/evidence`,{cookie:worker.cookie,method:'POST',body:{
    type:'note',
    value:'Final report checked against source ledger and attached to the work record.',
    expectedVersion:3,
  }});
  assert.equal(evidence.response.status,201);
  assert.equal(evidence.payload.task.version,4);
  assert.equal(evidence.payload.task.evidenceCount,1);
  assert.ok(evidence.payload.task.allowedTransitions.includes('in_review'));

  const review=await request(base,`/api/v1/tasks/${taskId}/transitions`,{cookie:worker.cookie,method:'POST',body:{to:'in_review',expectedVersion:4}});
  assert.equal(review.response.status,200);
  assert.equal(review.payload.task.status,'in_review');
  assert.equal(review.payload.task.version,5);

  const reviewerInbox=await request(base,'/api/v1/notifications?status=unread',{cookie:reviewer.cookie});
  assert.equal(reviewerInbox.response.status,200);
  assert.ok(reviewerInbox.payload.items.some(item=>item.type==='review.requested'&&item.commitmentId===taskId));

  const workerCannotAccept=await request(base,`/api/v1/tasks/${taskId}/transitions`,{cookie:worker.cookie,method:'POST',body:{to:'accepted_result',expectedVersion:5}});
  assert.equal(workerCannotAccept.response.status,403);
  assert.equal(workerCannotAccept.payload.error.code,'TASK_ACTION_FORBIDDEN');

  const returnWithoutReason=await request(base,`/api/v1/tasks/${taskId}/transitions`,{cookie:reviewer.cookie,method:'POST',body:{to:'in_progress',expectedVersion:5}});
  assert.equal(returnWithoutReason.response.status,400);
  assert.equal(returnWithoutReason.payload.error.code,'TASK_REASON_REQUIRED');

  const resultAccepted=await request(base,`/api/v1/tasks/${taskId}/transitions`,{cookie:reviewer.cookie,method:'POST',body:{to:'accepted_result',expectedVersion:5}});
  assert.equal(resultAccepted.response.status,200);
  assert.equal(resultAccepted.payload.task.status,'accepted_result');
  assert.equal(resultAccepted.payload.task.version,6);

  const closed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{cookie:ownerCookie,method:'POST',body:{to:'closed',expectedVersion:6}});
  assert.equal(closed.response.status,200);
  assert.equal(closed.payload.task.status,'closed');
  assert.equal(closed.payload.task.version,7);

  const workerInbox=await request(base,'/api/v1/notifications?status=unread',{cookie:worker.cookie});
  assert.equal(workerInbox.response.status,200);
  assert.ok(workerInbox.payload.items.some(item=>item.type==='task.updated'&&item.commitmentId===taskId&&item.metadata?.status==='closed'));

  const detail=await request(base,`/api/v1/tasks/${taskId}`,{cookie:ownerCookie});
  assert.equal(detail.response.status,200);
  assert.equal(detail.payload.task.evidence.length,1);
  assert.equal(detail.payload.task.acceptances.length,1);
  assert.equal(detail.payload.task.acceptances[0].decision,'accepted');
  assert.ok(detail.payload.task.audit.some(x=>x.eventType==='commitment.created'));
  assert.ok(detail.payload.task.audit.some(x=>x.eventType==='evidence.added'));
  assert.ok(detail.payload.task.audit.filter(x=>x.eventType==='commitment.transitioned').length>=4);
});

test('task blocking and rescheduling require explicit reasons',async(t)=>{
  const app=await createChatServer({store:new MemoryStore()});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;

  const owner=await request(base,'/api/v1/auth/register-company',{method:'POST',body:{companyName:'Reason Co',ownerName:'Owner',email:'owner@reason.test',password:'OwnerPassword42'}});
  const created=await request(base,'/api/v1/tasks',{cookie:owner.cookie,method:'POST',body:{title:'Prepare decision memo',ownerId:(await request(base,'/api/v1/bootstrap',{cookie:owner.cookie})).payload.session.userId}});
  const id=created.payload.task.id;

  const accepted=await request(base,`/api/v1/tasks/${id}/transitions`,{cookie:owner.cookie,method:'POST',body:{to:'accepted',expectedVersion:1}});
  const started=await request(base,`/api/v1/tasks/${id}/transitions`,{cookie:owner.cookie,method:'POST',body:{to:'in_progress',expectedVersion:accepted.payload.task.version}});

  const blockNoReason=await request(base,`/api/v1/tasks/${id}/transitions`,{cookie:owner.cookie,method:'POST',body:{to:'blocked',expectedVersion:started.payload.task.version}});
  assert.equal(blockNoReason.response.status,400);
  assert.equal(blockNoReason.payload.error.code,'TASK_REASON_REQUIRED');

  const blocked=await request(base,`/api/v1/tasks/${id}/transitions`,{cookie:owner.cookie,method:'POST',body:{to:'blocked',reason:'Waiting for finance source data',expectedVersion:started.payload.task.version}});
  assert.equal(blocked.response.status,200);

  const noReasonSchedule=await request(base,`/api/v1/tasks/${id}/schedule`,{cookie:owner.cookie,method:'PATCH',body:{promisedAt:'2026-10-01T10:00:00.000Z',expectedVersion:blocked.payload.task.version}});
  assert.equal(noReasonSchedule.response.status,400);
  assert.equal(noReasonSchedule.payload.error.code,'TASK_REASON_REQUIRED');

  const rescheduled=await request(base,`/api/v1/tasks/${id}/schedule`,{cookie:owner.cookie,method:'PATCH',body:{promisedAt:'2026-10-01T10:00:00.000Z',reason:'Finance source moved by two days',expectedVersion:blocked.payload.task.version}});
  assert.equal(rescheduled.response.status,200);
  assert.equal(rescheduled.payload.task.version,blocked.payload.task.version+1);
  assert.equal(new Date(rescheduled.payload.task.promisedAt).toISOString(),'2026-10-01T10:00:00.000Z');
});
