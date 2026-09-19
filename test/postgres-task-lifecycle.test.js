import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl=process.env.DATABASE_URL;

async function sessionFor(store,userId,workspaceId,label){
  const tokenHash=hashToken(`task-lifecycle-${label}-${randomUUID()}`);
  await store.createSession({userId,workspaceId,tokenHash,expiresAt:new Date(Date.now()+86400000).toISOString()});
  return store.getSession(tokenHash);
}

async function invite(store,owner,email,displayName,role='member'){
  const password=hashPassword('WorkspacePass42');
  const tokenHash=hashToken(`task-invite-${randomUUID()}`);
  await store.createInvitation(owner,{email,role,tokenHash,expiresAt:new Date(Date.now()+86400000).toISOString()});
  const accepted=await store.acceptInvitation({tokenHash,displayName,passwordHash:password.hash,passwordSalt:password.salt});
  return sessionFor(store,accepted.user.id,owner.workspaceId,email);
}

test('Postgres task lifecycle preserves authority, evidence and acceptance history',{skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  t.after(()=>pool.end());
  const store=new PostgresStore(pool),suffix=randomUUID().slice(0,8),password=hashPassword('WorkspacePass42');
  const created=await store.createCompany({
    companyName:`PG Task Cycle ${suffix}`,
    ownerName:'Owner',
    email:`pg-task-owner-${suffix}@example.com`,
    passwordHash:password.hash,
    passwordSalt:password.salt,
  });
  const owner=await sessionFor(store,created.user.id,created.workspace.id,`owner-${suffix}`);
  const worker=await invite(store,owner,`pg-task-worker-${suffix}@example.com`,'Worker');
  const reviewer=await invite(store,owner,`pg-task-reviewer-${suffix}@example.com`,'Reviewer');
  const outsider=await invite(store,owner,`pg-task-outsider-${suffix}@example.com`,'Outsider');

  const context=await store.createConversation(owner,{kind:'group',title:'Private source',slug:null,purpose:null,visibility:'private',participantIds:[worker.userId],announcementOnly:false});
  const source=await store.createMessage(owner,context.id,{kind:'text',body:'Confidential source instruction',replyToId:null,threadRootId:null,metadata:{},mentionedUserIds:[],clientRequestId:randomUUID()});
  await assert.rejects(()=>store.createTask(outsider,{title:'Leaked task',sourceMessageId:source.id}),{code:'TASK_SOURCE_NOT_FOUND'});

  const task=await store.createTask(owner,{
    title:'Prepare board pack',
    outcome:'Board pack accepted and ready for distribution',
    ownerId:worker.userId,
    acceptorId:reviewer.userId,
    priority:'urgent',
    promisedAt:'2026-09-26T09:00:00.000Z',
    sourceMessageId:source.id,
  });
  assert.equal(task.status,'proposed');
  assert.equal(task.version,1);
  assert.equal(task.sourceMessageId,source.id);
  assert.equal(await store.getTask(outsider,task.id),null);

  const accepted=await store.transitionTask(worker,task.id,{to:'accepted',expectedVersion:1});
  assert.equal(accepted.status,'accepted');
  assert.equal(accepted.version,2);

  await assert.rejects(
    ()=>store.transitionTask(worker,task.id,{to:'in_progress',expectedVersion:1}),
    {code:'STALE_TASK_ACTION'}
  );

  const rescheduled=await store.rescheduleTask(worker,task.id,{
    promisedAt:'2026-09-27T09:00:00.000Z',
    forecastAt:'2026-09-26T15:00:00.000Z',
    reason:'Source ledger moved by one day',
    expectedVersion:2,
  });
  assert.equal(rescheduled.version,3);
  await store.projectTaskLifecycleNotification(worker,rescheduled,{type:'task.rescheduled',title:'Task schedule changed'});
  const scheduleNotice=await pool.query("SELECT type,commitment_id FROM notifications WHERE workspace_id=$1 AND commitment_id=$2 AND type='task.rescheduled'",[owner.workspaceId,task.id]);
  assert.ok(scheduleNotice.rowCount>=1);

  const started=await store.transitionTask(worker,task.id,{to:'in_progress',expectedVersion:3});
  assert.equal(started.version,4);

  await assert.rejects(
    ()=>store.transitionTask(worker,task.id,{to:'in_review',expectedVersion:4}),
    {code:'TASK_EVIDENCE_REQUIRED'}
  );

  const firstEvidence=await store.addTaskEvidence(worker,task.id,{
    type:'note',
    value:'Checked totals and reconciled the final pack.',
    expectedVersion:4,
  });
  assert.equal(firstEvidence.task.version,5);
  assert.equal(firstEvidence.task.evidenceCount,1);

  const secondEvidence=await store.addTaskEvidence(worker,task.id,{
    type:'url',
    value:'https://example.invalid/board-pack',
    expectedVersion:5,
  });
  assert.equal(secondEvidence.task.version,6);
  assert.equal(secondEvidence.task.evidenceCount,2);

  const review=await store.transitionTask(worker,task.id,{to:'in_review',expectedVersion:6});
  assert.equal(review.status,'in_review');
  assert.equal(review.version,7);
  await store.projectTaskLifecycleNotification(worker,review,{type:'review.requested',title:'Result review requested'});
  const reviewNotice=await pool.query("SELECT type,recipient_user_id FROM notifications WHERE workspace_id=$1 AND commitment_id=$2 AND type='review.requested'",[owner.workspaceId,task.id]);
  assert.ok(reviewNotice.rows.some(row=>row.recipient_user_id===reviewer.userId));

  await assert.rejects(
    ()=>store.transitionTask(worker,task.id,{to:'accepted_result',expectedVersion:7}),
    {code:'TASK_ACTION_FORBIDDEN'}
  );

  const acceptedResult=await store.transitionTask(reviewer,task.id,{to:'accepted_result',expectedVersion:7});
  assert.equal(acceptedResult.status,'accepted_result');
  assert.equal(acceptedResult.version,8);
  await store.projectTaskLifecycleNotification(reviewer,acceptedResult,{type:'task.updated',title:'Result accepted'});
  const updateNotice=await pool.query("SELECT type FROM notifications WHERE workspace_id=$1 AND commitment_id=$2 AND type='task.updated'",[owner.workspaceId,task.id]);
  assert.ok(updateNotice.rowCount>=1);

  const closed=await store.transitionTask(owner,task.id,{to:'closed',expectedVersion:8});
  assert.equal(closed.status,'closed');
  assert.equal(closed.version,9);

  const detail=await store.getTaskDetail(owner,task.id);
  assert.equal(detail.evidence.length,2);
  assert.equal(detail.acceptances.length,1);
  assert.equal(detail.acceptances[0].decision,'accepted');
  assert.ok(detail.audit.some(x=>x.eventType==='commitment.created'));
  assert.equal(detail.audit.filter(x=>x.eventType==='evidence.added').length,2);
  assert.ok(detail.audit.filter(x=>x.eventType==='commitment.transitioned').length>=4);
});
