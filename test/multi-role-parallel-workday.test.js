import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createChatServer } from '../src/server.js';
import { PostgresStore } from '../src/persistence/store.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const PASSWORD='ParallelWorkday42';

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
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null};
}

async function join(base,ownerCookie,email,name,role='member'){
  const invited=await request(base,'/api/v1/invitations',{
    cookie:ownerCookie,method:'POST',body:{email,role}
  });
  assert.equal(invited.status,201);
  const token=new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await request(base,'/api/v1/invitations/accept',{
    method:'POST',body:{token,displayName:name,password:PASSWORD}
  });
  assert.equal(accepted.status,201);
  const boot=await request(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  assert.equal(boot.status,200);
  return {cookie:accepted.cookie,userId:boot.payload.session.userId,email};
}

async function addProjectMember(base,ownerCookie,projectId,userId,role){
  const added=await request(base,`/api/v1/projects/${projectId}/members`,{
    cookie:ownerCookie,method:'POST',body:{userId,role}
  });
  assert.equal(added.status,200);
}

test('Parallel Workday: several people and projects execute concurrently without cross-project corruption',
  {skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const app=await createChatServer({store:new PostgresStore(pool),startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const suffix=randomUUID().slice(0,8);

  const workday=new Date(Date.now()+14*864e5);
  workday.setUTCHours(0,0,0,0);
  while(workday.getUTCDay()!==2)workday.setUTCDate(workday.getUTCDate()+1);
  const at=(hour,minute=0)=>new Date(Date.UTC(
    workday.getUTCFullYear(),workday.getUTCMonth(),workday.getUTCDate(),hour,minute)).toISOString();

  const owner=await request(base,'/api/v1/auth/register-company',{
    method:'POST',
    body:{companyName:`Parallel Workday ${suffix}`,ownerName:'Owner',
      email:`owner-${suffix}@parallel.test`,password:PASSWORD}
  });
  assert.equal(owner.status,201);
  const ownerCookie=owner.cookie;

  const lead=await join(base,ownerCookie,`lead-${suffix}@parallel.test`,'Lead','manager');
  const alice=await join(base,ownerCookie,`alice-${suffix}@parallel.test`,'Alice');
  const bob=await join(base,ownerCookie,`bob-${suffix}@parallel.test`,'Bob');
  const reviewer=await join(base,ownerCookie,`reviewer-${suffix}@parallel.test`,'Reviewer');

  const [roomA,roomB]=await Promise.all([
    request(base,'/api/v1/conversations',{cookie:ownerCookie,method:'POST',
      body:{kind:'group',title:'Project Alpha room',participantIds:[lead.userId,alice.userId,bob.userId,reviewer.userId]}}),
    request(base,'/api/v1/conversations',{cookie:ownerCookie,method:'POST',
      body:{kind:'group',title:'Project Beta room',participantIds:[lead.userId,alice.userId,reviewer.userId]}}),
  ]);
  assert.equal(roomA.status,201);
  assert.equal(roomB.status,201);

  const [projectA,projectB]=await Promise.all([
    request(base,'/api/v1/projects',{cookie:ownerCookie,method:'POST',
      body:{name:'Project Alpha',goal:'Ship alpha deliverables',visibility:'members',status:'active',
        startAt:workday.toISOString().slice(0,10)}}),
    request(base,'/api/v1/projects',{cookie:ownerCookie,method:'POST',
      body:{name:'Project Beta',goal:'Ship beta deliverables',visibility:'members',status:'active',
        startAt:workday.toISOString().slice(0,10)}}),
  ]);
  assert.equal(projectA.status,201);
  assert.equal(projectB.status,201);
  const alphaId=projectA.payload.project.id;
  const betaId=projectB.payload.project.id;

  for(const [projectId,members] of [
    [alphaId,[[lead.userId,'lead'],[alice.userId,'member'],[bob.userId,'member'],[reviewer.userId,'member']]],
    [betaId,[[lead.userId,'lead'],[alice.userId,'member'],[reviewer.userId,'member']]],
  ]){
    for(const [userId,role] of members) await addProjectMember(base,ownerCookie,projectId,userId,role);
  }

  const [alphaMessage,betaMessage]=await Promise.all([
    request(base,`/api/v1/conversations/${roomA.payload.conversation.id}/messages`,{
      cookie:lead.cookie,method:'POST',body:{body:'Alice: alpha pack. Bob: alpha QA. Both due today.'}}),
    request(base,`/api/v1/conversations/${roomB.payload.conversation.id}/messages`,{
      cookie:lead.cookie,method:'POST',body:{body:'Alice: prepare beta launch note after alpha pack.'}}),
  ]);
  assert.equal(alphaMessage.status,201);
  assert.equal(betaMessage.status,201);

  const [alphaAlice,alphaBob,betaAlice]=await Promise.all([
    request(base,`/api/v1/projects/${alphaId}/tasks`,{cookie:lead.cookie,method:'POST',
      body:{title:'Alpha pack',outcome:'Reviewed alpha pack',ownerId:alice.userId,acceptorId:reviewer.userId,
        promisedAt:at(15),sourceMessageId:alphaMessage.payload.message.id}}),
    request(base,`/api/v1/projects/${alphaId}/tasks`,{cookie:lead.cookie,method:'POST',
      body:{title:'Alpha QA',outcome:'QA checklist accepted',ownerId:bob.userId,acceptorId:reviewer.userId,
        promisedAt:at(15),sourceMessageId:alphaMessage.payload.message.id}}),
    request(base,`/api/v1/projects/${betaId}/tasks`,{cookie:lead.cookie,method:'POST',
      body:{title:'Beta launch note',outcome:'Launch note accepted',ownerId:alice.userId,acceptorId:reviewer.userId,
        promisedAt:at(16),sourceMessageId:betaMessage.payload.message.id}}),
  ]);
  for(const created of [alphaAlice,alphaBob,betaAlice]) assert.equal(created.status,201);

  const duplicateLink=await request(base,`/api/v1/projects/${betaId}/tasks`,{
    cookie:lead.cookie,method:'POST',body:{taskId:alphaAlice.payload.task.id}
  });
  assert.equal(duplicateLink.status,409);
  assert.equal(duplicateLink.code,'TASK_ALREADY_IN_PROJECT');

  const accepted=await Promise.all([
    request(base,`/api/v1/tasks/${alphaAlice.payload.task.id}/transitions`,{
      cookie:alice.cookie,method:'POST',
      body:{to:'accepted',expectedVersion:alphaAlice.payload.task.version}}),
    request(base,`/api/v1/tasks/${alphaBob.payload.task.id}/transitions`,{
      cookie:bob.cookie,method:'POST',
      body:{to:'accepted',expectedVersion:alphaBob.payload.task.version}}),
    request(base,`/api/v1/tasks/${betaAlice.payload.task.id}/transitions`,{
      cookie:alice.cookie,method:'POST',
      body:{to:'accepted',expectedVersion:betaAlice.payload.task.version}}),
  ]);
  accepted.forEach(result=>assert.equal(result.status,200));

  const [alphaAliceBlock,alphaBobBlock]=await Promise.all([
    request(base,'/api/v1/calendar-events',{cookie:alice.cookie,method:'POST',
      body:{kind:'task_block',title:'Alpha pack work',startAt:at(9),endAt:at(10),
        visibility:'private',commitmentId:alphaAlice.payload.task.id}}),
    request(base,'/api/v1/calendar-events',{cookie:bob.cookie,method:'POST',
      body:{kind:'task_block',title:'Alpha QA work',startAt:at(9),endAt:at(10),
        visibility:'private',commitmentId:alphaBob.payload.task.id}}),
  ]);
  assert.equal(alphaAliceBlock.status,201,'different employees may work at the same time');
  assert.equal(alphaBobBlock.status,201,'different employees may work at the same time');

  const aliceOverlap=await request(base,'/api/v1/calendar-events',{cookie:alice.cookie,method:'POST',
    body:{kind:'task_block',title:'Beta launch note work',startAt:at(9,30),endAt:at(10,30),
      visibility:'private',commitmentId:betaAlice.payload.task.id}});
  assert.equal(aliceOverlap.status,409,'one employee cannot silently double-book across projects');
  assert.equal(aliceOverlap.code,'CALENDAR_CONFLICT');

  const betaAliceBlock=await request(base,'/api/v1/calendar-events',{cookie:alice.cookie,method:'POST',
    body:{kind:'task_block',title:'Beta launch note work',startAt:at(10),endAt:at(11),
      visibility:'private',commitmentId:betaAlice.payload.task.id}});
  assert.equal(betaAliceBlock.status,201);

  let versions={
    alphaAlice:accepted[0].payload.task.version,
    alphaBob:accepted[1].payload.task.version,
    betaAlice:accepted[2].payload.task.version,
  };

  const started=await Promise.all([
    request(base,`/api/v1/tasks/${alphaAlice.payload.task.id}/transitions`,{
      cookie:alice.cookie,method:'POST',body:{to:'in_progress',expectedVersion:versions.alphaAlice}}),
    request(base,`/api/v1/tasks/${alphaBob.payload.task.id}/transitions`,{
      cookie:bob.cookie,method:'POST',body:{to:'in_progress',expectedVersion:versions.alphaBob}}),
    request(base,`/api/v1/tasks/${betaAlice.payload.task.id}/transitions`,{
      cookie:alice.cookie,method:'POST',body:{to:'in_progress',expectedVersion:versions.betaAlice}}),
  ]);
  started.forEach(result=>assert.equal(result.status,200));
  versions={
    alphaAlice:started[0].payload.task.version,
    alphaBob:started[1].payload.task.version,
    betaAlice:started[2].payload.task.version,
  };

  const evidences=await Promise.all([
    request(base,`/api/v1/tasks/${alphaAlice.payload.task.id}/evidence`,{cookie:alice.cookie,method:'POST',
      body:{type:'note',value:'Alpha pack ready.',expectedVersion:versions.alphaAlice}}),
    request(base,`/api/v1/tasks/${alphaBob.payload.task.id}/evidence`,{cookie:bob.cookie,method:'POST',
      body:{type:'note',value:'Alpha QA complete.',expectedVersion:versions.alphaBob}}),
    request(base,`/api/v1/tasks/${betaAlice.payload.task.id}/evidence`,{cookie:alice.cookie,method:'POST',
      body:{type:'note',value:'Beta launch note ready.',expectedVersion:versions.betaAlice}}),
  ]);
  evidences.forEach(result=>assert.equal(result.status,201));

  const reviews=await Promise.all([
    request(base,`/api/v1/tasks/${alphaAlice.payload.task.id}/transitions`,{cookie:alice.cookie,method:'POST',
      body:{to:'in_review',expectedVersion:evidences[0].payload.task.version}}),
    request(base,`/api/v1/tasks/${alphaBob.payload.task.id}/transitions`,{cookie:bob.cookie,method:'POST',
      body:{to:'in_review',expectedVersion:evidences[1].payload.task.version}}),
    request(base,`/api/v1/tasks/${betaAlice.payload.task.id}/transitions`,{cookie:alice.cookie,method:'POST',
      body:{to:'in_review',expectedVersion:evidences[2].payload.task.version}}),
  ]);
  reviews.forEach(result=>assert.equal(result.status,200));

  const acceptedResults=await Promise.all(reviews.map((review,index)=>
    request(base,`/api/v1/tasks/${[alphaAlice,alphaBob,betaAlice][index].payload.task.id}/transitions`,{
      cookie:reviewer.cookie,method:'POST',
      body:{to:'accepted_result',expectedVersion:review.payload.task.version}})
  ));
  acceptedResults.forEach(result=>assert.equal(result.status,200));

  const closed=await Promise.all(acceptedResults.map((acceptedResult,index)=>
    request(base,`/api/v1/tasks/${[alphaAlice,alphaBob,betaAlice][index].payload.task.id}/transitions`,{
      cookie:lead.cookie,method:'POST',
      body:{to:'closed',expectedVersion:acceptedResult.payload.task.version}})
  ));
  closed.forEach(result=>assert.equal(result.status,200));

  const [alphaDetail,betaDetail]=await Promise.all([
    request(base,`/api/v1/projects/${alphaId}`,{cookie:lead.cookie}),
    request(base,`/api/v1/projects/${betaId}`,{cookie:lead.cookie}),
  ]);
  assert.equal(alphaDetail.status,200);
  assert.equal(betaDetail.status,200);
  assert.equal(alphaDetail.payload.project.metrics.visibleTasks,2);
  assert.equal(alphaDetail.payload.project.metrics.done,2);
  assert.equal(betaDetail.payload.project.metrics.visibleTasks,1);
  assert.equal(betaDetail.payload.project.metrics.done,1);

  const aliceCalendar=await request(base,
    `/api/v1/calendar-events?from=${encodeURIComponent(at(8))}&to=${encodeURIComponent(at(18))}`,
    {cookie:alice.cookie});
  assert.equal(aliceCalendar.status,200);
  assert.ok(aliceCalendar.payload.items.some(item=>item.id===alphaAliceBlock.payload.event.id));
  assert.ok(aliceCalendar.payload.items.some(item=>item.id===betaAliceBlock.payload.event.id));
});
