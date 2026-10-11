import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

async function req(base,path,{cookie,method='GET',body}={}){
  const r=await fetch(base+path,{method,headers:{
    ...(cookie?{cookie}:{}),
    ...(body!==undefined?{'content-type':'application/json'}:{}),
    'idempotency-key':randomUUID(),
  },body:body!==undefined?JSON.stringify(body):undefined});
  return{status:r.status,payload:r.status===204?null:await r.json().catch(()=>null),
    cookie:r.headers.get('set-cookie')?.split(';')[0]??null};
}

test('Decision Register gives accepted decisions stable canonical identity',{skip:!databaseUrl},async(t)=>{
  const app=await createChatServer({databaseUrl,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`,pool=app.store.pool;
  const suffix=randomUUID().slice(0,8),password='DecisionRegister42';
  const owner=await req(base,'/api/v1/auth/register-company',{method:'POST',body:{
    companyName:`Decisions ${suffix}`,ownerName:'Owner',
    email:`dec-${suffix}@test.local`,password}});
  assert.equal(owner.status,201);
  const boot=(await req(base,'/api/v1/bootstrap',{cookie:owner.cookie})).payload;
  const{userId:me,workspaceId:ws,organizationId:org}=boot.session;

  const event=(await req(base,'/api/v1/calendar-events',{cookie:owner.cookie,method:'POST',body:{
    kind:'meeting',title:`Manual ${suffix}`,
    startAt:new Date(Date.now()-3600000).toISOString(),endAt:new Date().toISOString()}})).payload.event;
  const a=`Choose A ${suffix}`,b=`Move May ${suffix}`;
  const save=(decisions)=>req(base,`/api/v1/calendar-events/${event.id}/notes`,{
    cookie:owner.cookie,method:'PUT',body:{title:`Manual ${suffix}`,decisions,actionItems:[]}});

  assert.equal((await save([a,b])).status,200);
  const list=async()=>((await req(base,`/api/v1/meetings/decisions?q=${suffix}`,{cookie:owner.cookie})).payload.items);
  const first=(await list()).filter(x=>x.sourceKind==='meeting_note');
  assert.equal(first.length,2);
  const ids=new Map(first.map(x=>[x.title,x.id]));
  assert.equal(new Set(ids.values()).size,2);

  assert.equal((await save([b,a])).status,200);
  const reordered=(await list()).filter(x=>x.sourceKind==='meeting_note');
  assert.equal(reordered.find(x=>x.title===a).id,ids.get(a));
  assert.equal(reordered.find(x=>x.title===b).id,ids.get(b));

  const corrected=`Choose B ${suffix}`;
  assert.equal((await save([b,corrected])).status,200);
  const changed=(await list()).filter(x=>x.sourceKind==='meeting_note');
  assert.equal(changed.find(x=>x.title===b).id,ids.get(b));
  assert.notEqual(changed.find(x=>x.title===corrected).id,ids.get(a));
  const old=(await pool.query('SELECT status FROM decisions WHERE workspace_id=$1 AND id=$2',[ws,ids.get(a)])).rows[0];
  assert.equal(old.status,'retracted');

  const conversation=boot.conversations[0];
  const{rows:[call]}=await pool.query(
    `INSERT INTO call_sessions(organization_id,workspace_id,conversation_id,created_by,title,mode,state,started_at,provider,provider_room_name)
     VALUES($1,$2,$3,$4,$5,'video','ended',now(),'livekit',$6) RETURNING id`,
    [org,ws,conversation.id,me,`Recorded ${suffix}`,`room-${suffix}`]);
  await pool.query(
    `INSERT INTO call_participants(organization_id,workspace_id,call_id,user_id,joined_at,connection_state)
     VALUES($1,$2,$3,$4,now(),'disconnected')`,[org,ws,call.id,me]);
  const{rows:[rec]}=await pool.query(
    `INSERT INTO call_recordings(organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,started_by,started_at)
     VALUES($1,$2,$3,'livekit',$4,$5,'ready',$6,now()) RETURNING id`,
    [org,ws,call.id,`rec-${suffix}`,`key-${suffix}`,me]);
  const{rows:[run]}=await pool.query(
    `INSERT INTO meeting_intelligence_runs(organization_id,workspace_id,call_id,recording_id,status)
     VALUES($1,$2,$3,$4,'review_ready') RETURNING id`,[org,ws,call.id,rec.id]);
  const{rows:[proposal]}=await pool.query(
    `INSERT INTO meeting_proposals(organization_id,workspace_id,run_id,proposal_type,title,status)
     VALUES($1,$2,$3,'decision',$4,'proposed') RETURNING id`,
    [org,ws,run.id,`Approve ${suffix}`]);
  await pool.query(
    `UPDATE meeting_proposals SET status='accepted',accepted_by=$3,accepted_at=now()
      WHERE workspace_id=$1 AND id=$2`,[ws,proposal.id,me]);
  const recorded=(await list()).find(x=>x.sourceKind==='meeting_proposal');
  assert.equal(recorded.id,proposal.id);

  const invite=await req(base,'/api/v1/invitations',{cookie:owner.cookie,method:'POST',
    body:{email:`out-${suffix}@test.local`,role:'member'}});
  const token=new URL(invite.payload.invitation.inviteUrl).searchParams.get('invite');
  const outsider=await req(base,'/api/v1/invitations/accept',{method:'POST',
    body:{token,displayName:'Outsider',password}});
  assert.equal((await req(base,`/api/v1/meetings/decisions?q=${suffix}`,{
    cookie:outsider.cookie})).payload.items.length,0);
});
