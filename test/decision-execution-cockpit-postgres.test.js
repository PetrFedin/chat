import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createChatServer} from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const password='DecisionCockpit42Password';

async function req(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(base+path,{
    method,headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return{status:response.status,payload:await response.json().catch(()=>null),
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null};
}
async function register(base){
  const marker=randomUUID().slice(0,8);
  const response=await req(base,'/api/v1/auth/register-company',{method:'POST',body:{
    companyName:'Cockpit '+marker,ownerName:'Owner',
    email:'cockpit-owner-'+marker+'@example.test',password,
  }});
  assert.equal(response.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:response.cookie});
  assert.equal(boot.status,200);
  return{cookie:response.cookie,session:boot.payload.session};
}
async function invite(base,owner,role){
  const marker=randomUUID().slice(0,8);
  const made=await req(base,'/api/v1/invitations',{cookie:owner.cookie,method:'POST',
    body:{email:'cockpit-'+marker+'@example.test',role}});
  assert.equal(made.status,201);
  const token=new URL(made.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await req(base,'/api/v1/invitations/accept',{method:'POST',
    body:{token,displayName:'Colleague',password}});
  assert.equal(accepted.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  assert.equal(boot.status,200);
  return{cookie:accepted.cookie,session:boot.payload.session};
}
test('Decision cockpit reauthorizes source meeting and target Task after each access change',
  {skip:!databaseUrl,timeout:120000},async t=>{
    const app=await createChatServer({databaseUrl,startMeetingWorker:false});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    t.after(()=>app.close());
    const base='http://127.0.0.1:'+app.server.address().port;
    const owner=await register(base);
    const member=await invite(base,owner,'member');
    const guest=await invite(base,owner,'guest');
    const foreign=await register(base);
    const marker=randomUUID().slice(0,8);
    const meeting=await req(base,'/api/v1/calendar-events',{cookie:owner.cookie,method:'POST',body:{
      kind:'meeting',title:'Execution '+marker,
      startAt:new Date(Date.now()-3600000).toISOString(),
      endAt:new Date(Date.now()+3600000).toISOString(),
    }});
    assert.equal(meeting.status,201);
    const event=meeting.payload.event;
    const first='Deliver '+marker,second='Research '+marker;
    const notes=await req(base,'/api/v1/calendar-events/'+event.id+'/notes',{
      cookie:owner.cookie,method:'PUT',body:{title:'Execution '+marker,decisions:[first,second],actionItems:[]},
    });
    assert.equal(notes.status,200);
    const list=await req(base,'/api/v1/meetings/decisions?q='+marker,{cookie:owner.cookie});
    assert.equal(list.status,200);
    const decision=list.payload.items.find(x=>x.title===first);
    assert.ok(decision);

    const privateTask=await req(base,'/api/v1/tasks',{cookie:owner.cookie,method:'POST',
      body:{title:'Confidential '+marker,outcome:'Private outcome',promisedAt:'2026-10-01T12:00:00.000Z'}});
    const visibleTask=await req(base,'/api/v1/tasks',{cookie:owner.cookie,method:'POST',
      body:{title:'Shared '+marker,outcome:'Shared outcome',ownerId:member.session.userId}});
    assert.equal(privateTask.status,201);assert.equal(visibleTask.status,201);
    const endpoint='/api/v1/meetings/decisions/'+decision.id+'/tasks';
    for(const task of [privateTask,visibleTask]){
      const linked=await req(base,endpoint,{cookie:owner.cookie,method:'POST',
        body:{taskId:task.payload.task.id,reason:'Track execution'}});
      assert.equal(linked.status,200);
    }
    const path='/api/v1/meetings/decisions/execution?q='+marker;
    const ownerView=await req(base,path,{cookie:owner.cookie});
    assert.equal(ownerView.status,200);
    assert.equal(ownerView.payload.scope,'accessible_accepted_decisions_and_visible_tasks_only');
    assert.equal(ownerView.payload.window.complete,false);
    assert.equal(ownerView.payload.items.length,2);
    const ownEntry=ownerView.payload.items.find(x=>x.decision.id===decision.id);
    assert.equal(ownEntry.execution.visibleCount,2);
    assert.equal(ownEntry.execution.overdueCount,1);
    const emptyEntry=ownerView.payload.items.find(x=>x.decision.title===second);
    assert.equal(emptyEntry.execution.state,'no_visible_tasks');

    assert.equal((await req(base,path,{cookie:member.cookie})).payload.items.length,0);
    assert.equal((await req(base,path,{cookie:guest.cookie})).status,404);
    assert.equal((await req(base,path,{cookie:foreign.cookie})).payload.items.length,0);
    await app.store.pool.query(
      'INSERT INTO calendar_event_participants(organization_id,workspace_id,calendar_event_id,user_id,optional,invited_by) VALUES($1,$2,$3,$4,false,$5)',
      [owner.session.organizationId,owner.session.workspaceId,event.id,member.session.userId,owner.session.userId],
    );
    const sharedView=await req(base,path,{cookie:member.cookie});
    assert.equal(sharedView.status,200);
    const entry=sharedView.payload.items.find(x=>x.decision.id===decision.id);
    assert.equal(entry.execution.visibleCount,1);
    assert.equal(entry.execution.overdueCount,0);
    assert.equal(JSON.stringify(sharedView.payload).includes(privateTask.payload.task.id),false);
    assert.equal(JSON.stringify(sharedView.payload).includes('Confidential '+marker),false);
    assert.equal(JSON.stringify(sharedView.payload).includes('Private outcome'),false);

    await app.store.pool.query(
      'DELETE FROM calendar_event_participants WHERE workspace_id=$1 AND calendar_event_id=$2 AND user_id=$3',
      [owner.session.workspaceId,event.id,member.session.userId],
    );
    const revoked=await req(base,path,{cookie:member.cookie});
    assert.equal(revoked.status,200);
    assert.deepEqual(revoked.payload.items,[]);

    const disable=await req(base,'/api/v1/features/tasks',{cookie:owner.cookie,method:'PUT',body:{enabled:false}});
    assert.equal(disable.status,200);
    const hidden=await req(base,path,{cookie:owner.cookie});
    assert.equal(hidden.status,404);
    assert.equal(hidden.payload?.error?.code,'FEATURE_DISABLED');
    assert.equal((await req(base,'/api/v1/features/tasks',{cookie:owner.cookie,method:'PUT',
      body:{enabled:true}})).status,200);
    const restored=await req(base,path,{cookie:owner.cookie});
    assert.equal(restored.status,200);
    assert.equal(restored.payload.items.find(x=>x.decision.id===decision.id).execution.visibleCount,2);
  });
