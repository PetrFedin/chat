import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createChatServer } from '../src/server.js';
import { PostgresStore } from '../src/persistence/store.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const PASSWORD='FailureRecovery42';

async function request(base,path,{cookie,method='GET',body,key}={}){
  const response=await fetch(`${base}${path}`,{
    method,
    headers:{
      ...(cookie?{cookie}:{}),
      ...(body!==undefined?{'content-type':'application/json'}:{}),
      ...(key?{'idempotency-key':key}:{})
    },
    body:body!==undefined?JSON.stringify(body):undefined,
  });
  const payload=response.status===204?null:await response.json().catch(()=>null);
  return {status:response.status,payload,code:payload?.error?.code??null,
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null,
    replay:response.headers.get('idempotent-replay')};
}

async function join(base,ownerCookie,email,name,role='member'){
  const invited=await request(base,'/api/v1/invitations',{
    cookie:ownerCookie,method:'POST',body:{email,role}});
  assert.equal(invited.status,201);
  const token=new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await request(base,'/api/v1/invitations/accept',{
    method:'POST',body:{token,displayName:name,password:PASSWORD}});
  assert.equal(accepted.status,201);
  const boot=await request(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  assert.equal(boot.status,200);
  return {cookie:accepted.cookie,userId:boot.payload.session.userId,email};
}

async function login(base,email){
  const logged=await request(base,'/api/v1/auth/login',{
    method:'POST',body:{email,password:PASSWORD}});
  assert.equal(logged.status,200);
  return logged.cookie;
}

test('Failure & Recovery: retries, stale tabs, session expiry and project removal stay recoverable',
  {skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const app=await createChatServer({store:new PostgresStore(pool),startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const suffix=randomUUID().slice(0,8);

  const due=new Date(Date.now()+14*864e5);
  due.setUTCHours(15,0,0,0);

  const owner=await request(base,'/api/v1/auth/register-company',{
    method:'POST',
    body:{companyName:`Recovery ${suffix}`,ownerName:'Owner',
      email:`owner-${suffix}@recovery.test`,password:PASSWORD}});
  assert.equal(owner.status,201);
  const ownerCookie=owner.cookie;

  const lead=await join(base,ownerCookie,`lead-${suffix}@recovery.test`,'Lead','manager');
  const worker=await join(base,ownerCookie,`worker-${suffix}@recovery.test`,'Worker');
  const reviewer=await join(base,ownerCookie,`reviewer-${suffix}@recovery.test`,'Reviewer');
  const observer=await join(base,ownerCookie,`observer-${suffix}@recovery.test`,'Observer');

  const project=await request(base,'/api/v1/projects',{cookie:ownerCookie,method:'POST',
    body:{name:'Recovery project',goal:'Prove recovery semantics',visibility:'members',status:'active'}});
  assert.equal(project.status,201);
  const projectId=project.payload.project.id;
  for(const [person,role] of [[lead,'lead'],[worker,'member'],[reviewer,'member'],[observer,'observer']]){
    const added=await request(base,`/api/v1/projects/${projectId}/members`,{
      cookie:ownerCookie,method:'POST',body:{userId:person.userId,role}});
    assert.equal(added.status,200);
  }

  const room=await request(base,'/api/v1/conversations',{cookie:ownerCookie,method:'POST',
    body:{kind:'group',title:'Recovery room',participantIds:[lead.userId,worker.userId,reviewer.userId]}});
  assert.equal(room.status,201);
  const source=await request(base,`/api/v1/conversations/${room.payload.conversation.id}/messages`,{
    cookie:lead.cookie,method:'POST',body:{body:'Prepare the recovery proof and submit it.'}});
  assert.equal(source.status,201);

  // Client sends the command, loses the HTTP response, then retries with the same key.
  // The server must replay the first committed answer instead of creating duplicate work.
  const key=`lost-response-${suffix}`;
  const body={title:'Recovery proof',outcome:'Reviewer accepts recovery proof',
    ownerId:worker.userId,acceptorId:reviewer.userId,promisedAt:due.toISOString(),
    sourceMessageId:source.payload.message.id};
  const committed=await request(base,`/api/v1/projects/${projectId}/tasks`,{
    cookie:lead.cookie,method:'POST',body,key});
  assert.equal(committed.status,201);
  const retry=await request(base,`/api/v1/projects/${projectId}/tasks`,{
    cookie:lead.cookie,method:'POST',body,key});
  assert.equal(retry.status,201);
  assert.equal(retry.replay,'true');
  assert.equal(retry.payload.task.id,committed.payload.task.id);
  const taskId=committed.payload.task.id;

  const projectAfterRetry=await request(base,`/api/v1/projects/${projectId}`,{cookie:lead.cookie});
  assert.equal(projectAfterRetry.payload.project.tasks.filter(task=>task.id===taskId).length,1);

  // Two browser tabs hold the same version. One succeeds; the stale one must fail,
  // then recover by reloading canonical state and continuing.
  const staleVersion=committed.payload.task.version;
  const tabA=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:worker.cookie,method:'POST',body:{to:'accepted',expectedVersion:staleVersion}});
  assert.equal(tabA.status,200);
  const tabB=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:worker.cookie,method:'POST',body:{to:'accepted',expectedVersion:staleVersion}});
  assert.equal(tabB.status,409);
  assert.equal(tabB.code,'STALE_TASK_ACTION');

  let canonical=await request(base,`/api/v1/tasks/${taskId}`,{cookie:worker.cookie});
  assert.equal(canonical.status,200);
  assert.equal(canonical.payload.task.status,'accepted');
  const resumedFromReload=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:worker.cookie,method:'POST',
    body:{to:'in_progress',expectedVersion:canonical.payload.task.version}});
  assert.equal(resumedFromReload.status,200);

  // Project membership is part of project authority. Removing a participant who
  // still owns an unfinished canonical project task would create contradictory truth:
  // Task says they own work; Project says they do not belong to the project.
  const activeRemoval=await request(base,`/api/v1/projects/${projectId}/members/${worker.userId}`,{
    cookie:lead.cookie,method:'DELETE'});
  assert.equal(activeRemoval.status,409,
    'active task participant must not be removable from the project');
  assert.equal(activeRemoval.code,'PROJECT_MEMBER_HAS_ACTIVE_TASKS');

  // A non-participating observer can be removed immediately and must lose project access.
  const observerRemoval=await request(base,`/api/v1/projects/${projectId}/members/${observer.userId}`,{
    cookie:lead.cookie,method:'DELETE'});
  assert.equal(observerRemoval.status,200);
  assert.equal((await request(base,`/api/v1/projects/${projectId}`,{cookie:observer.cookie})).status,404);

  // Expired browser session is refused on the next request, not after a background sweep.
  await pool.query(
    'UPDATE user_sessions SET expires_at=now()-interval \'1 minute\' WHERE user_id=$1 AND revoked_at IS NULL',
    [worker.userId]);
  assert.equal((await request(base,'/api/v1/me',{cookie:worker.cookie})).status,401);

  const workerCookie=await login(base,worker.email);
  canonical=await request(base,`/api/v1/tasks/${taskId}`,{cookie:workerCookie});
  assert.equal(canonical.status,200);
  assert.equal(canonical.payload.task.status,'in_progress');

  // Recovery continues from canonical state; expiration did not lose or duplicate work.
  let evidence=await request(base,`/api/v1/tasks/${taskId}/evidence`,{
    cookie:workerCookie,method:'POST',
    body:{type:'note',value:'Recovered session, work result preserved.',
      expectedVersion:canonical.payload.task.version}});
  assert.equal(evidence.status,201);

  let changed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:workerCookie,method:'POST',
    body:{to:'in_review',expectedVersion:evidence.payload.task.version}});
  assert.equal(changed.status,200);

  changed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:reviewer.cookie,method:'POST',
    body:{to:'accepted_result',expectedVersion:changed.payload.task.version}});
  assert.equal(changed.status,200);

  const closed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:lead.cookie,method:'POST',
    body:{to:'closed',expectedVersion:changed.payload.task.version}});
  assert.equal(closed.status,200);

  // Once work is terminal, removing the former participant is safe: history stays,
  // but current project membership disappears.
  const completedRemoval=await request(base,`/api/v1/projects/${projectId}/members/${worker.userId}`,{
    cookie:lead.cookie,method:'DELETE'});
  assert.equal(completedRemoval.status,200);
  assert.equal((await request(base,`/api/v1/projects/${projectId}`,{cookie:workerCookie})).status,404);

  const ownerProject=await request(base,`/api/v1/projects/${projectId}`,{cookie:ownerCookie});
  assert.equal(ownerProject.status,200);
  const historical=ownerProject.payload.project.tasks.find(task=>task.id===taskId);
  assert.equal(historical.status,'closed','completed work remains in project history');
});
