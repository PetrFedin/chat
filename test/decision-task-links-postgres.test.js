import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createChatServer} from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const password='DecisionTaskLinks42Password';

async function req(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(base+path,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return {
    status:response.status,payload:await response.json().catch(()=>null),
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null,
  };
}
async function company(base,prefix){
  const marker=randomUUID().slice(0,8);
  const result=await req(base,'/api/v1/auth/register-company',{method:'POST',body:{
    companyName:prefix+' '+marker,ownerName:'Owner',email:'decision-task-'+marker+'@example.test',password,
  }});
  assert.equal(result.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:result.cookie});
  assert.equal(boot.status,200);
  return {cookie:result.cookie,session:boot.payload.session};
}
async function invited(base,owner,role){
  const result=await req(base,'/api/v1/invitations',{cookie:owner.cookie,method:'POST',body:{
    email:'decision-task-'+randomUUID().slice(0,8)+'@example.test',role,
  }});
  assert.equal(result.status,201);
  const token=new URL(result.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await req(base,'/api/v1/invitations/accept',{method:'POST',body:{
    token,displayName:'Participant',password,
  }});
  assert.equal(accepted.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  return {cookie:accepted.cookie,session:boot.payload.session};
}
async function makeDecision(base,cookie,marker){
  const event=await req(base,'/api/v1/calendar-events',{cookie,method:'POST',body:{
    kind:'meeting',title:'Decision review '+marker,
    startAt:new Date(Date.now()-3600000).toISOString(),
    endAt:new Date(Date.now()+3600000).toISOString(),
  }});
  assert.equal(event.status,201);
  const title='Accepted plan '+marker;
  const notes=await req(base,'/api/v1/calendar-events/'+event.payload.event.id+'/notes',{cookie,method:'PUT',
    body:{title:'Decision minutes',decisions:[title],actionItems:[]},
  });
  assert.equal(notes.status,200);
  const listed=await req(base,'/api/v1/meetings/decisions?q='+encodeURIComponent(marker),{cookie});
  assert.equal(listed.status,200);
  const decision=listed.payload.items.find(x=>x.title===title);
  assert.ok(decision);
  return {decision,event:event.payload.event};
}

test('Decision Task links: canonical visibility, audits, duplicates, tenant FKs, and unlink',
  {skip:!databaseUrl,timeout:120000},async t=>{
    const app=await createChatServer({databaseUrl,startMeetingWorker:false});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    t.after(()=>app.close());
    const base='http://127.0.0.1:'+app.server.address().port;
    const owner=await company(base,'Decision Task');
    const colleague=await invited(base,owner,'member');
    const guest=await invited(base,owner,'guest');
    const foreign=await company(base,'Foreign Decision Task');
    const marker='LinkTest'+randomUUID().slice(0,8);
    const {decision,event}=await makeDecision(base,owner.cookie,marker);
    const {decision:foreignDecision}=await makeDecision(base,foreign.cookie,'Foreign'+marker);
    const privateTask=await req(base,'/api/v1/tasks',{cookie:owner.cookie,method:'POST',
      body:{title:'Private Task '+marker,outcome:'Private acceptance'}});
    const sharedTask=await req(base,'/api/v1/tasks',{cookie:owner.cookie,method:'POST',
      body:{title:'Shared Task '+marker,outcome:'Shared acceptance',ownerId:colleague.session.userId}});
    const foreignTask=await req(base,'/api/v1/tasks',{cookie:foreign.cookie,method:'POST',
      body:{title:'Foreign Task '+marker}});
    for(const result of [privateTask,sharedTask,foreignTask])assert.equal(result.status,201);
    const secretId=privateTask.payload.task.id,sharedId=sharedTask.payload.task.id;
    const endpoint='/api/v1/meetings/decisions/'+decision.id+'/tasks';
    const link=(cookie,taskId,reason='Accepted delivery obligation')=>req(base,endpoint,{
      cookie,method:'POST',body:{taskId,reason},
    });
    assert.equal((await req(base,endpoint,{cookie:colleague.cookie})).status,404);
    assert.equal((await link(guest.cookie,sharedId)).status,404);
    assert.equal((await link(foreign.cookie,sharedId)).status,404);
    assert.equal((await link(owner.cookie,foreignTask.payload.task.id)).status,404);
    assert.equal((await req(base,'/api/v1/meetings/decisions/'+foreignDecision.id+'/tasks',
      {cookie:owner.cookie})).status,404);
    assert.equal((await link(owner.cookie,secretId,'')).status,400);
    assert.equal((await link(owner.cookie,'not-a-uuid')).status,400);
    assert.equal((await link(owner.cookie,secretId)).status,200);
    const concurrent=await Promise.all([link(owner.cookie,sharedId),link(owner.cookie,sharedId)]);
    assert.deepEqual(concurrent.map(r=>r.status).sort((a,b)=>a-b),[200,409]);
    const ownerRead=await req(base,endpoint,{cookie:owner.cookie});
    assert.equal(ownerRead.status,200);
    assert.deepEqual(ownerRead.payload.items.map(x=>x.id).sort(),[secretId,sharedId].sort());
    assert.ok(ownerRead.payload.items.every(x=>!('outcome' in x)&&!('evidence' in x)),
      'relations are references, not replicas of Task state');

    // Workspace participant does not inherit Decision access until the
    // Meeting Authority explicitly admits the participant.
    await app.store.pool.query(
      'INSERT INTO calendar_event_participants(organization_id,workspace_id,calendar_event_id,user_id,optional,invited_by) VALUES($1,$2,$3,$4,false,$5)',
      [owner.session.organizationId,owner.session.workspaceId,event.id,
        colleague.session.userId,owner.session.userId],
    );
    const colleagueRead=await req(base,endpoint,{cookie:colleague.cookie});
    assert.equal(colleagueRead.status,200);
    assert.deepEqual(colleagueRead.payload.items.map(x=>x.id),[sharedId],
      'a participant never discovers private Tasks through Decision relations');
    assert.equal((await link(colleague.cookie,secretId)).status,404);

    // The database independently enforces tenant isolation.
    await assert.rejects(app.store.pool.query(
      'INSERT INTO decision_task_links(organization_id,workspace_id,decision_id,commitment_id,linked_by,reason) VALUES($1,$2,$3,$4,$5,$6)',
      [owner.session.organizationId,owner.session.workspaceId,decision.id,
        foreignTask.payload.task.id,owner.session.userId,'Invalid tenant'],
    ),{code:'23503'});

    const removed=await req(base,endpoint+'/'+secretId,{cookie:owner.cookie,
      method:'DELETE',body:{reason:'No longer required'}});
    assert.equal(removed.status,200);
    assert.deepEqual(removed.payload.items.map(x=>x.id),[sharedId]);
    assert.equal((await req(base,'/api/v1/tasks/'+secretId,{cookie:owner.cookie})).status,200);
    assert.equal((await req(base,endpoint+'/'+secretId,{cookie:owner.cookie,
      method:'DELETE',body:{reason:'Duplicate'} })).status,404);

    const audit=await app.store.pool.query(
      "SELECT event_type,payload FROM audit_events WHERE workspace_id=$1 AND aggregate_type='decision' AND aggregate_id=$2 AND event_type LIKE 'decision.task_%'",
      [owner.session.workspaceId,decision.id],
    );
    assert.equal(audit.rows.filter(x=>x.event_type==='decision.task_linked').length,2);
    assert.equal(audit.rows.filter(x=>x.event_type==='decision.task_unlinked').length,1);

    // Revocation is effective at the next read; the link is still stored.
    await app.store.pool.query(
      'DELETE FROM calendar_event_participants WHERE workspace_id=$1 AND calendar_event_id=$2 AND user_id=$3',
      [owner.session.workspaceId,event.id,colleague.session.userId],
    );
    assert.equal((await req(base,endpoint,{cookie:colleague.cookie})).status,404);
  });
