import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const PASSWORD='ProjectDecisionsPassword42';

async function request(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(`${base}${path}`,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),
      'idempotency-key':randomUUID()},
    body:body!==undefined?JSON.stringify(body):undefined,
  });
  const payload=response.status===204?null:await response.json().catch(()=>null);
  return{status:response.status,payload,cookie:response.headers.get('set-cookie')?.split(';')[0]??null};
}

async function join(base,ownerCookie,email,name){
  const invited=await request(base,'/api/v1/invitations',{
    cookie:ownerCookie,method:'POST',body:{email,role:'member'}});
  assert.equal(invited.status,201);
  const token=new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await request(base,'/api/v1/invitations/accept',{
    method:'POST',body:{token,displayName:name,password:PASSWORD}});
  assert.equal(accepted.status,201);
  const boot=await request(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  return{cookie:accepted.cookie,userId:boot.payload.session.userId};
}

test('Project <-> Decision composes canonical Decision Authority without ACL escalation',
  {skip:!databaseUrl},async(t)=>{
  const app=await createChatServer({databaseUrl,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const pool=app.store.pool,suffix=randomUUID().slice(0,8);

  const owner=await request(base,'/api/v1/auth/register-company',{method:'POST',body:{
    companyName:`Project Decisions ${suffix}`,ownerName:'Owner',
    email:`owner-${suffix}@pd.test`,password:PASSWORD,
  }});
  assert.equal(owner.status,201);
  const boot=(await request(base,'/api/v1/bootstrap',{cookie:owner.cookie})).payload;
  const member=await join(base,owner.cookie,`member-${suffix}@pd.test`,'Member');

  const created=await request(base,'/api/v1/projects',{
    cookie:owner.cookie,method:'POST',body:{name:`Decision project ${suffix}`,visibility:'members'}});
  assert.equal(created.status,201);
  const projectId=created.payload.project.id;
  assert.equal((await request(base,`/api/v1/projects/${projectId}/members`,{
    cookie:owner.cookie,method:'POST',body:{userId:member.userId,role:'member'}})).status,200);

  const event=await request(base,'/api/v1/calendar-events',{cookie:owner.cookie,method:'POST',body:{
    kind:'meeting',title:`Steering ${suffix}`,
    startAt:new Date(Date.now()-3600000).toISOString(),endAt:new Date().toISOString(),
  }});
  assert.equal(event.status,201);
  const title=`Approve rollout ${suffix}`;
  assert.equal((await request(base,`/api/v1/calendar-events/${event.payload.event.id}/notes`,{
    cookie:owner.cookie,method:'PUT',body:{title:`Steering ${suffix}`,decisions:[title],actionItems:[]},
  })).status,200);
  const canonical=(await request(base,`/api/v1/meetings/decisions?q=${suffix}`,{
    cookie:owner.cookie})).payload.items.find(row=>row.title===title);
  assert.ok(canonical?.id);

  const linked=await request(base,`/api/v1/projects/${projectId}/decisions`,{
    cookie:owner.cookie,method:'POST',body:{decisionId:canonical.id}});
  assert.equal(linked.status,200);
  assert.ok(linked.payload.project.decisions.some(row=>row.id===canonical.id));
  assert.ok(linked.payload.project.activity.some(row=>row.eventType==='project.decision_linked'));

  const duplicate=await request(base,`/api/v1/projects/${projectId}/decisions`,{
    cookie:owner.cookie,method:'POST',body:{decisionId:canonical.id}});
  assert.equal(duplicate.status,409);
  assert.equal(duplicate.payload.error.code,'PROJECT_DECISION_ALREADY_LINKED');

  const memberProject=await request(base,`/api/v1/projects/${projectId}`,{cookie:member.cookie});
  assert.equal(memberProject.status,200);
  assert.equal(memberProject.payload.project.decisions.some(row=>row.id===canonical.id),false);
  const guessed=await request(base,`/api/v1/projects/${projectId}/decisions`,{
    cookie:member.cookie,method:'POST',body:{decisionId:canonical.id}});
  assert.equal(guessed.status,404);
  assert.equal(guessed.payload.error.code,'DECISION_NOT_FOUND');

  await pool.query(
    `INSERT INTO calendar_event_participants(
       organization_id,workspace_id,calendar_event_id,user_id,response_status,invited_by)
     VALUES($1,$2,$3,$4,'invited',$5)`,
    [boot.session.organizationId,boot.session.workspaceId,event.payload.event.id,member.userId,boot.session.userId]);
  const admitted=await request(base,`/api/v1/projects/${projectId}`,{cookie:member.cookie});
  assert.ok(admitted.payload.project.decisions.some(row=>row.id===canonical.id&&row.title===title));

  const unlinked=await request(base,`/api/v1/projects/${projectId}/decisions/${canonical.id}`,{
    cookie:owner.cookie,method:'DELETE'});
  assert.equal(unlinked.status,200);
  assert.equal(unlinked.payload.project.decisions.some(row=>row.id===canonical.id),false);
  assert.ok(unlinked.payload.project.activity.some(row=>row.eventType==='project.decision_unlinked'));

  const stillCanonical=(await request(base,`/api/v1/meetings/decisions?q=${suffix}`,{
    cookie:owner.cookie})).payload.items;
  assert.ok(stillCanonical.some(row=>row.id===canonical.id));

  const relation=await pool.query(
    'SELECT count(*)::int c FROM project_decisions WHERE project_id=$1 AND decision_id=$2',
    [projectId,canonical.id]);
  assert.equal(relation.rows[0].c,0);
});
