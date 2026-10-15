import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createChatServer } from '../src/server.js';
import { PostgresStore } from '../src/persistence/store.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

async function request(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(`${base}${path}`,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},
    body:body!==undefined?JSON.stringify(body):undefined,
  });
  const payload=response.status===204?null:await response.json().catch(()=>null);
  return{response,payload,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}

async function invite(base,ownerCookie,email,name,role='member'){
  const created=await request(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{email,role}});
  assert.equal(created.response.status,201);
  const token=new URL(created.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await request(base,'/api/v1/invitations/accept',{method:'POST',body:{token,displayName:name,password:'StrongPassword42'}});
  assert.equal(accepted.response.status,201);
  const boot=await request(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  return{cookie:accepted.cookie,userId:boot.payload.session.userId};
}

test('Project milestones project into Calendar while task blocks stay Calendar authority',{skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const store=new PostgresStore(pool);
  const app=await createChatServer({store,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const suffix=randomUUID().slice(0,8);

  const owner=await request(base,'/api/v1/auth/register-company',{method:'POST',body:{
    companyName:`Project Calendar ${suffix}`,ownerName:'Owner',email:`owner-${suffix}@project-calendar.test`,password:'OwnerPassword42'
  }});
  assert.equal(owner.response.status,201);
  const lead=await invite(base,owner.cookie,`lead-${suffix}@project-calendar.test`,'Lead','manager');
  const outsider=await invite(base,owner.cookie,`outside-${suffix}@project-calendar.test`,'Outside');

  const created=await request(base,'/api/v1/projects',{cookie:owner.cookie,method:'POST',body:{
    name:'Calendar authority project',goal:'Prove projection without duplicated dates',visibility:'members',status:'active'
  }});
  assert.equal(created.response.status,201);
  const projectId=created.payload.project.id;
  await request(base,`/api/v1/projects/${projectId}/members`,{cookie:owner.cookie,method:'POST',body:{userId:lead.userId,role:'lead'}});

  const milestone=await request(base,`/api/v1/projects/${projectId}/milestones`,{cookie:lead.cookie,method:'POST',body:{
    title:'Investor acceptance',targetAt:'2026-10-20T12:00:00.000Z'
  }});
  assert.equal(milestone.response.status,201);
  const milestoneId=milestone.payload.milestone.id;

  const task=await request(base,`/api/v1/projects/${projectId}/tasks`,{cookie:lead.cookie,method:'POST',body:{
    title:'Prepare acceptance pack',outcome:'Acceptance pack is ready',ownerId:lead.userId,acceptorId:lead.userId,
    promisedAt:'2026-10-19T18:00:00.000Z'
  }});
  assert.equal(task.response.status,201);
  const taskId=task.payload.task.id;

  const block=await request(base,'/api/v1/calendar-events',{cookie:lead.cookie,method:'POST',body:{
    kind:'task_block',title:'Acceptance pack work',commitmentId:taskId,
    startAt:'2026-10-19T09:00:00.000Z',endAt:'2026-10-19T11:00:00.000Z',
    timezone:'UTC',visibility:'participants',participantIds:[outsider.userId]
  }});
  assert.equal(block.response.status,201);
  const blockId=block.payload.event.id;

  const filtered=await request(base,`/api/v1/calendar-events?from=2026-10-18T00:00:00.000Z&to=2026-10-23T23:59:59.000Z&projectId=${projectId}`,{cookie:lead.cookie});
  assert.equal(filtered.response.status,200);
  const milestoneProjection=filtered.payload.items.find(item=>item.milestoneId===milestoneId);
  assert.ok(milestoneProjection,'project milestone must appear in Calendar');
  assert.equal(milestoneProjection.kind,'milestone');
  assert.equal(milestoneProjection.projectId,projectId);
  assert.equal(milestoneProjection.projectProjection,true);
  assert.equal(milestoneProjection.readOnly,true);
  assert.equal(milestoneProjection.startAt,'2026-10-20T12:00:00.000Z');

  const taskBlock=filtered.payload.items.find(item=>item.id===blockId);
  assert.ok(taskBlock,'project task block must appear in filtered Calendar');
  assert.equal(taskBlock.commitmentId,taskId);
  assert.equal(taskBlock.projectId,projectId);
  assert.equal(taskBlock.projectName,'Calendar authority project');

  const outsiderCalendar=await request(base,'/api/v1/calendar-events?from=2026-10-18T00:00:00.000Z&to=2026-10-23T23:59:59.000Z',{cookie:outsider.cookie});
  const outsiderBlock=outsiderCalendar.payload.items.find(item=>item.id===blockId);
  assert.ok(outsiderBlock,'calendar participation may expose the block itself');
  assert.equal(outsiderBlock.projectId,null,'private project id must not leak through a visible calendar block');
  assert.equal(outsiderBlock.projectName,null,'private project name must not leak through a visible calendar block');

  const outsiderFiltered=await request(base,`/api/v1/calendar-events?from=2026-10-18T00:00:00.000Z&to=2026-10-23T23:59:59.000Z&projectId=${projectId}`,{cookie:outsider.cookie});
  assert.equal(outsiderFiltered.response.status,404);
  assert.equal(outsiderFiltered.payload.error.code,'PROJECT_NOT_FOUND');

  const moved=await request(base,`/api/v1/projects/${projectId}/milestones/${milestoneId}`,{cookie:lead.cookie,method:'PATCH',body:{
    targetAt:'2026-10-22T15:30:00.000Z',expectedVersion:milestone.payload.milestone.version
  }});
  assert.equal(moved.response.status,200);
  assert.equal(moved.payload.milestone.targetAt,'2026-10-22T15:30:00.000Z');

  const afterMove=await request(base,`/api/v1/calendar-events?from=2026-10-18T00:00:00.000Z&to=2026-10-23T23:59:59.000Z&projectId=${projectId}`,{cookie:lead.cookie});
  assert.equal(afterMove.response.status,200);
  const projectedAfterMove=afterMove.payload.items.find(item=>item.milestoneId===milestoneId);
  assert.equal(projectedAfterMove.startAt,'2026-10-22T15:30:00.000Z');
  assert.equal(afterMove.payload.items.filter(item=>item.milestoneId===milestoneId).length,1,'milestone projection must not create a duplicate calendar truth');

  const unfiltered=await request(base,'/api/v1/calendar-events?from=2026-10-18T00:00:00.000Z&to=2026-10-23T23:59:59.000Z',{cookie:lead.cookie});
  assert.ok(unfiltered.payload.items.some(item=>item.milestoneId===milestoneId),'visible project milestone should appear in the ordinary Calendar layer');
});
