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

test('Projects are a native work context over canonical Task authority',{skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const store=new PostgresStore(pool);
  const app=await createChatServer({store});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const suffix=randomUUID().slice(0,8);

  const owner=await request(base,'/api/v1/auth/register-company',{method:'POST',body:{companyName:`Projects ${suffix}`,ownerName:'Owner',email:`owner-${suffix}@projects.test`,password:'OwnerPassword42'}});
  assert.equal(owner.response.status,201);
  const ownerCookie=owner.cookie;
  const lead=await invite(base,ownerCookie,`lead-${suffix}@projects.test`,'Lead','manager');
  const member=await invite(base,ownerCookie,`member-${suffix}@projects.test`,'Member');
  const outsider=await invite(base,ownerCookie,`outside-${suffix}@projects.test`,'Outside');

  const projectCreated=await request(base,'/api/v1/projects',{cookie:ownerCookie,method:'POST',body:{
    name:'Investor readiness',goal:'Close the execution loop for the investor demo',visibility:'members',status:'active',
    startAt:'2026-10-07',targetAt:'2026-11-15'
  }});
  assert.equal(projectCreated.response.status,201);
  const projectId=projectCreated.payload.project.id;

  const hidden=await request(base,`/api/v1/projects/${projectId}`,{cookie:outsider.cookie});
  assert.equal(hidden.response.status,404);

  const addLead=await request(base,`/api/v1/projects/${projectId}/members`,{cookie:ownerCookie,method:'POST',body:{userId:lead.userId,role:'lead'}});
  assert.equal(addLead.response.status,200);
  const addMember=await request(base,`/api/v1/projects/${projectId}/members`,{cookie:lead.cookie,method:'POST',body:{userId:member.userId,role:'member'}});
  assert.equal(addMember.response.status,200);

  const milestone=await request(base,`/api/v1/projects/${projectId}/milestones`,{cookie:lead.cookie,method:'POST',body:{title:'Golden path accepted',targetAt:'2026-10-20T12:00:00.000Z'}});
  assert.equal(milestone.response.status,201);

  const createdTask=await request(base,`/api/v1/projects/${projectId}/tasks`,{cookie:lead.cookie,method:'POST',body:{
    title:'Prepare investor walkthrough',outcome:'Walkthrough is accepted by owner',ownerId:member.userId,acceptorId:lead.userId,priority:'high',
    promisedAt:'2026-10-18T12:00:00.000Z'
  }});
  assert.equal(createdTask.response.status,201);
  const taskId=createdTask.payload.task.id;

  const detail=await request(base,`/api/v1/projects/${projectId}`,{cookie:lead.cookie});
  assert.equal(detail.response.status,200);
  assert.ok(detail.payload.project.tasks.some(task=>task.id===taskId));
  assert.equal(detail.payload.project.metrics.visibleTasks,1);
  assert.equal(detail.payload.project.metrics.done,0);
  assert.equal(detail.payload.project.metrics.progress,0);
  assert.ok(detail.payload.project.workload.some(row=>row.userId===member.userId&&row.total===1));
  assert.ok(detail.payload.project.milestones.some(row=>row.id===milestone.payload.milestone.id));

  const taskDetail=await request(base,`/api/v1/tasks/${taskId}`,{cookie:member.cookie});
  assert.equal(taskDetail.response.status,200);
  assert.equal(taskDetail.payload.task.id,taskId);

  const secondProject=await request(base,'/api/v1/projects',{cookie:ownerCookie,method:'POST',body:{name:'Second context',goal:'Must not steal the same task'}});
  assert.equal(secondProject.response.status,201);
  const duplicateLink=await request(base,`/api/v1/projects/${secondProject.payload.project.id}/tasks`,{cookie:ownerCookie,method:'POST',body:{taskId}});
  assert.equal(duplicateLink.response.status,409);
  assert.equal(duplicateLink.payload.error.code,'TASK_ALREADY_IN_PROJECT');

  const outsiderList=await request(base,'/api/v1/projects',{cookie:outsider.cookie});
  assert.equal(outsiderList.response.status,200);
  assert.ok(!outsiderList.payload.items.some(project=>project.id===projectId));

  const leadList=await request(base,'/api/v1/projects',{cookie:lead.cookie});
  assert.ok(leadList.payload.items.some(project=>project.id===projectId));
});
