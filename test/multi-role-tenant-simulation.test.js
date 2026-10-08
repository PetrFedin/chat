import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createChatServer } from '../src/server.js';
import { PostgresStore } from '../src/persistence/store.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const PASSWORD='TenantSimulation42';

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

async function join(base,ownerCookie,{email,name,role='member'}){
  const invited=await request(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{email,role}});
  assert.equal(invited.status,201,`invite ${role}`);
  const token=new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await request(base,'/api/v1/invitations/accept',{
    method:'POST',body:{token,displayName:name,password:PASSWORD}});
  assert.equal(accepted.status,201,`accept ${role}`);
  const boot=await request(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  assert.equal(boot.status,200);
  return {cookie:accepted.cookie,userId:boot.payload.session.userId,email,role:boot.payload.session.role};
}

async function login(base,email){
  const result=await request(base,'/api/v1/auth/login',{method:'POST',body:{email,password:PASSWORD}});
  assert.equal(result.status,200,`login ${email}`);
  return result.cookie;
}

test('Multi-role tenant simulation v1: customer team executes work without authority leaks',
  {skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const store=new PostgresStore(pool);
  const app=await createChatServer({store,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const suffix=randomUUID().slice(0,8);

  const nextWednesday=new Date(Date.now()+14*864e5);
  nextWednesday.setUTCHours(0,0,0,0);
  while(nextWednesday.getUTCDay()!==3)nextWednesday.setUTCDate(nextWednesday.getUTCDate()+1);
  const nextThursday=new Date(nextWednesday);nextThursday.setUTCDate(nextThursday.getUTCDate()+1);
  const at=(date,hour,minute=0)=>new Date(Date.UTC(
    date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),hour,minute)).toISOString();

  const owner=await request(base,'/api/v1/auth/register-company',{
    method:'POST',body:{companyName:`Tenant Simulation ${suffix}`,ownerName:'Owner',
      email:`owner-${suffix}@tenant.test`,password:PASSWORD}});
  assert.equal(owner.status,201);
  const ownerCookie=owner.cookie;

  const admin=await join(base,ownerCookie,{email:`admin-${suffix}@tenant.test`,name:'Admin',role:'admin'});
  const lead=await join(base,ownerCookie,{email:`lead-${suffix}@tenant.test`,name:'Project Lead',role:'manager'});
  const employee=await join(base,ownerCookie,{email:`employee-${suffix}@tenant.test`,name:'Employee'});
  const reviewer=await join(base,ownerCookie,{email:`reviewer-${suffix}@tenant.test`,name:'Reviewer'});
  const observer=await join(base,ownerCookie,{email:`observer-${suffix}@tenant.test`,name:'Observer'});
  const guest=await join(base,ownerCookie,{email:`guest-${suffix}@tenant.test`,name:'External Client',role:'guest'});

  const promoted=await request(base,`/api/v1/people/${employee.userId}/role`,{
    cookie:admin.cookie,method:'PUT',body:{role:'manager'}});
  assert.equal(promoted.status,200);
  assert.equal(promoted.payload.person.workspaceRole,'manager');
  assert.equal((await request(base,'/api/v1/me',{cookie:employee.cookie})).status,401);

  let employeeCookie=await login(base,employee.email);
  assert.equal((await request(base,'/api/v1/me',{cookie:employeeCookie})).payload.role,'manager');

  const demoted=await request(base,`/api/v1/people/${employee.userId}/role`,{
    cookie:admin.cookie,method:'PUT',body:{role:'member'}});
  assert.equal(demoted.status,200);
  assert.equal((await request(base,'/api/v1/me',{cookie:employeeCookie})).status,401);
  employeeCookie=await login(base,employee.email);

  const internalRoom=await request(base,'/api/v1/conversations',{
    cookie:ownerCookie,method:'POST',
    body:{kind:'group',title:'Launch execution',
      participantIds:[admin.userId,lead.userId,employee.userId,reviewer.userId,observer.userId]}});
  assert.equal(internalRoom.status,201);
  const roomId=internalRoom.payload.conversation.id;

  const clientRoom=await request(base,'/api/v1/conversations',{
    cookie:ownerCookie,method:'POST',
    body:{kind:'external',title:'Client delivery room',visibility:'private',
      participantIds:[guest.userId,lead.userId]}});
  assert.equal(clientRoom.status,201);
  assert.equal((await request(base,`/api/v1/conversations/${clientRoom.payload.conversation.id}/messages`,{
    cookie:guest.cookie,method:'POST',body:{body:'Please confirm the delivery date.'}})).status,201);

  const project=await request(base,'/api/v1/projects',{
    cookie:ownerCookie,method:'POST',
    body:{name:'Customer launch',goal:'Ship and get an accepted result',visibility:'members',status:'active',
      startAt:nextWednesday.toISOString().slice(0,10),
      targetAt:new Date(nextThursday.getTime()+21*864e5).toISOString().slice(0,10)}});
  assert.equal(project.status,201);
  const projectId=project.payload.project.id;

  for(const [actor,role] of [[lead,'lead'],[employee,'member'],[reviewer,'member'],[observer,'observer']]){
    const added=await request(base,`/api/v1/projects/${projectId}/members`,{
      cookie:ownerCookie,method:'POST',body:{userId:actor.userId,role}});
    assert.equal(added.status,200,`add project ${role}`);
  }

  assert.equal((await request(base,`/api/v1/projects/${projectId}`,{cookie:guest.cookie})).status,404);
  assert.equal((await request(base,`/api/v1/calendar-events?projectId=${projectId}`,{cookie:guest.cookie})).status,404);
  const observerProject=await request(base,`/api/v1/projects/${projectId}`,{cookie:observer.cookie});
  assert.equal(observerProject.status,200);
  assert.equal(observerProject.payload.project.canContribute,false);

  const source=await request(base,`/api/v1/conversations/${roomId}/messages`,{
    cookie:lead.cookie,method:'POST',
    body:{body:'Prepare the launch pack, reconcile it, and submit for acceptance.'}});
  assert.equal(source.status,201);
  const sourceId=source.payload.message.id;

  const createKey=`tenant-task-${suffix}`;
  const taskBody={title:'Prepare launch pack',outcome:'Reviewer accepts the reconciled launch pack',
    ownerId:employee.userId,acceptorId:reviewer.userId,priority:'high',
    promisedAt:at(nextThursday,16),sourceMessageId:sourceId};
  const taskFirst=await request(base,`/api/v1/projects/${projectId}/tasks`,{
    cookie:lead.cookie,method:'POST',body:taskBody,key:createKey});
  assert.equal(taskFirst.status,201);
  const taskReplay=await request(base,`/api/v1/projects/${projectId}/tasks`,{
    cookie:lead.cookie,method:'POST',body:taskBody,key:createKey});
  assert.equal(taskReplay.status,201);
  assert.equal(taskReplay.replay,'true');
  assert.equal(taskReplay.payload.task.id,taskFirst.payload.task.id);
  const taskId=taskFirst.payload.task.id;

  const proposedVersion=taskFirst.payload.task.version;
  const [acceptA,acceptB]=await Promise.all([
    request(base,`/api/v1/tasks/${taskId}/transitions`,{
      cookie:employeeCookie,method:'POST',body:{to:'accepted',expectedVersion:proposedVersion}}),
    request(base,`/api/v1/tasks/${taskId}/transitions`,{
      cookie:employeeCookie,method:'POST',body:{to:'accepted',expectedVersion:proposedVersion}}),
  ]);
  assert.deepEqual([acceptA.status,acceptB.status].sort((a,b)=>a-b),[200,409]);

  let task=(await request(base,`/api/v1/tasks/${taskId}`,{cookie:employeeCookie})).payload.task;
  assert.equal(task.status,'accepted');
  let version=task.version;

  const block=await request(base,'/api/v1/calendar-events',{
    cookie:employeeCookie,method:'POST',
    body:{kind:'task_block',title:'Work on launch pack',startAt:at(nextWednesday,10),
      endAt:at(nextWednesday,12),visibility:'private',commitmentId:taskId}});
  assert.equal(block.status,201);
  const projectCalendar=await request(base,
    `/api/v1/calendar-events?projectId=${projectId}&from=${encodeURIComponent(at(nextWednesday,0))}&to=${encodeURIComponent(at(nextThursday,23,59))}`,
    {cookie:lead.cookie});
  assert.equal(projectCalendar.status,200);
  assert.ok(projectCalendar.payload.items.some(item=>item.id===block.payload.event.id&&item.projectId===projectId));

  const milestone=await request(base,`/api/v1/projects/${projectId}/milestones`,{
    cookie:lead.cookie,method:'POST',body:{title:'Launch accepted',targetAt:at(nextThursday,17)}});
  assert.equal(milestone.status,201);
  const calendarAfterMilestone=await request(base,
    `/api/v1/calendar-events?projectId=${projectId}&from=${encodeURIComponent(at(nextWednesday,0))}&to=${encodeURIComponent(at(nextThursday,23,59))}`,
    {cookie:lead.cookie});
  assert.ok(calendarAfterMilestone.payload.items.some(item=>
    item.kind==='milestone'&&item.title==='Launch accepted'&&item.readOnly===true));

  const [milestoneA,milestoneB]=await Promise.all([
    request(base,`/api/v1/projects/${projectId}/milestones/${milestone.payload.milestone.id}`,{
      cookie:lead.cookie,method:'PATCH',body:{status:'reached',expectedVersion:milestone.payload.milestone.version}}),
    request(base,`/api/v1/projects/${projectId}/milestones/${milestone.payload.milestone.id}`,{
      cookie:lead.cookie,method:'PATCH',body:{title:'Conflicting edit',expectedVersion:milestone.payload.milestone.version}}),
  ]);
  assert.deepEqual([milestoneA.status,milestoneB.status].sort((a,b)=>a-b),[200,409]);

  let changed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:employeeCookie,method:'POST',body:{to:'in_progress',expectedVersion:version}});
  assert.equal(changed.status,200); version=changed.payload.task.version;

  changed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:employeeCookie,method:'POST',
    body:{to:'blocked',reason:'Waiting for pricing approval',expectedVersion:version}});
  assert.equal(changed.status,200); version=changed.payload.task.version;

  changed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:employeeCookie,method:'POST',body:{to:'in_progress',expectedVersion:version}});
  assert.equal(changed.status,200); version=changed.payload.task.version;

  let evidence=await request(base,`/api/v1/tasks/${taskId}/evidence`,{
    cookie:employeeCookie,method:'POST',
    body:{type:'note',value:'Launch pack v1 reconciled with current pricing.',expectedVersion:version}});
  assert.equal(evidence.status,201); version=evidence.payload.task.version;

  changed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:employeeCookie,method:'POST',body:{to:'in_review',expectedVersion:version}});
  assert.equal(changed.status,200); version=changed.payload.task.version;

  changed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:reviewer.cookie,method:'POST',
    body:{to:'in_progress',reason:'Add the signed pricing appendix.',expectedVersion:version}});
  assert.equal(changed.status,200); version=changed.payload.task.version;

  evidence=await request(base,`/api/v1/tasks/${taskId}/evidence`,{
    cookie:employeeCookie,method:'POST',
    body:{type:'note',value:'Signed pricing appendix added.',expectedVersion:version}});
  assert.equal(evidence.status,201); version=evidence.payload.task.version;

  changed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:employeeCookie,method:'POST',body:{to:'in_review',expectedVersion:version}});
  assert.equal(changed.status,200); version=changed.payload.task.version;

  changed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:reviewer.cookie,method:'POST',body:{to:'accepted_result',expectedVersion:version}});
  assert.equal(changed.status,200); version=changed.payload.task.version;

  const closed=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:ownerCookie,method:'POST',body:{to:'closed',expectedVersion:version}});
  assert.equal(closed.status,200);

  const reviewerInbox=await request(base,'/api/v1/notifications',{cookie:reviewer.cookie});
  assert.equal(reviewerInbox.status,200);
  const reviewNotice=reviewerInbox.payload.items.find(item=>
    item.type==='review.requested'&&item.commitmentId===taskId);
  assert.ok(reviewNotice);
  assert.equal(reviewNotice.url,`/#/tasks/${taskId}`);

  const employeeInbox=await request(base,'/api/v1/notifications',{cookie:employeeCookie});
  assert.equal(employeeInbox.status,200);
  assert.ok(employeeInbox.payload.items.some(item=>
    item.commitmentId===taskId&&item.url===`/#/tasks/${taskId}`));

  const finalTask=await request(base,`/api/v1/tasks/${taskId}`,{cookie:ownerCookie});
  assert.equal(finalTask.status,200);
  assert.equal(finalTask.payload.task.status,'closed');
  assert.equal(finalTask.payload.task.sourceMessageId,sourceId);
  assert.equal(finalTask.payload.task.evidence.length,2);

  const finalProject=await request(base,`/api/v1/projects/${projectId}`,{cookie:lead.cookie});
  assert.equal(finalProject.status,200);
  const projectedTask=finalProject.payload.project.tasks.find(item=>item.id===taskId);
  assert.equal(projectedTask.status,'closed');
  assert.ok(finalProject.payload.project.metrics.done>=1);

  assert.equal((await request(base,`/api/v1/projects/${projectId}`,{cookie:guest.cookie})).status,404);
  assert.equal((await request(base,`/api/v1/tasks/${taskId}`,{cookie:guest.cookie})).status,404);
});
