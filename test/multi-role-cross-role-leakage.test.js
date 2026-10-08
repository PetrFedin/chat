import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createChatServer } from '../src/server.js';
import { PostgresStore } from '../src/persistence/store.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const PASSWORD='CrossRoleLeakage42';

async function request(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(`${base}${path}`,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},
    body:body!==undefined?JSON.stringify(body):undefined,
  });
  const payload=response.status===204?null:await response.json().catch(()=>null);
  return {status:response.status,payload,code:payload?.error?.code??null,
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null};
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

async function upload(base,cookie,name,body){
  const response=await fetch(`${base}/api/v1/files`,{
    method:'POST',
    headers:{cookie,'content-type':'text/plain','x-file-name':encodeURIComponent(name)},
    body,
  });
  const payload=await response.json();
  assert.equal(response.status,201);
  return payload.file;
}

function assertNoRefs(payload,{projectId,taskId,conversationId,messageId,fileId,secret},label){
  const text=JSON.stringify(payload??{});
  for(const [kind,value] of Object.entries({projectId,taskId,conversationId,messageId,fileId,secret})){
    if(!value)continue;
    assert.equal(text.includes(String(value)),false,`${label} leaked ${kind}: ${value}`);
  }
}

test('Cross-role Leakage: stale IDs and deep links reveal no inaccessible work metadata',
  {skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const uploads=await mkdtemp(pathJoin(tmpdir(),'chatx-cross-role-'));
  const app=await createChatServer({
    store:new PostgresStore(pool),uploadsRoot:uploads,startMeetingWorker:false
  });
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();await rm(uploads,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const suffix=randomUUID().slice(0,8);
  const secret=`VANTA-${suffix}`;

  const owner=await request(base,'/api/v1/auth/register-company',{
    method:'POST',body:{companyName:`Leakage ${suffix}`,ownerName:'Owner',
      email:`owner-${suffix}@leak.test`,password:PASSWORD}});
  assert.equal(owner.status,201);
  const ownerCookie=owner.cookie;

  const lead=await join(base,ownerCookie,`lead-${suffix}@leak.test`,'Lead','manager');
  const observer=await join(base,ownerCookie,`observer-${suffix}@leak.test`,'Observer');
  const removed=await join(base,ownerCookie,`removed-${suffix}@leak.test`,'Removed Member');
  const guest=await join(base,ownerCookie,`guest-${suffix}@leak.test`,'Guest','guest');

  const project=await request(base,'/api/v1/projects',{cookie:ownerCookie,method:'POST',
    body:{name:`${secret} Project`,goal:`${secret} private launch`,visibility:'members',status:'active'}});
  assert.equal(project.status,201);
  const projectId=project.payload.project.id;
  for(const [person,role] of [[lead,'lead'],[observer,'observer'],[removed,'member']]){
    const added=await request(base,`/api/v1/projects/${projectId}/members`,{
      cookie:ownerCookie,method:'POST',body:{userId:person.userId,role}});
    assert.equal(added.status,200);
  }

  const room=await request(base,'/api/v1/conversations',{cookie:ownerCookie,method:'POST',
    body:{kind:'group',title:`${secret} room`,visibility:'private',
      participantIds:[lead.userId,removed.userId]}});
  assert.equal(room.status,201);
  const conversationId=room.payload.conversation.id;

  const file=await upload(base,lead.cookie,`${secret}-evidence.txt`,
    Buffer.from(`${secret} confidential attachment`));
  const fileId=file.id;

  const message=await request(base,`/api/v1/conversations/${conversationId}/messages`,{
    cookie:lead.cookie,method:'POST',
    body:{body:`${secret} confidential project discussion`,metadata:{fileId}}});
  assert.equal(message.status,201);
  const messageId=message.payload.message.id;

  const task=await request(base,`/api/v1/projects/${projectId}/tasks`,{
    cookie:lead.cookie,method:'POST',
    body:{title:`${secret} execution task`,outcome:`${secret} accepted proof`,
      ownerId:lead.userId,acceptorId:lead.userId}});
  assert.equal(task.status,201);
  const taskId=task.payload.task.id;

  // Evidence must really exist before we test non-disclosure. Otherwise a 404 on
  // the task would prove only that no task is visible, not that its submitted
  // result is protected as part of the same authority boundary.
  const accepted=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:lead.cookie,method:'POST',
    body:{to:'accepted',expectedVersion:task.payload.task.version}});
  assert.equal(accepted.status,200);
  const started=await request(base,`/api/v1/tasks/${taskId}/transitions`,{
    cookie:lead.cookie,method:'POST',
    body:{to:'in_progress',expectedVersion:accepted.payload.task.version}});
  assert.equal(started.status,200);
  const evidence=await request(base,`/api/v1/tasks/${taskId}/evidence`,{
    cookie:lead.cookie,method:'POST',
    body:{type:'note',value:`${secret} evidence payload`,
      expectedVersion:started.payload.task.version}});
  assert.equal(evidence.status,201);
  const evidenceVersion=evidence.payload.task.version;
  const protectedTask=await request(base,`/api/v1/tasks/${taskId}`,{cookie:lead.cookie});
  assert.equal(protectedTask.status,200);
  assert.ok(protectedTask.payload.task.evidence.some(item=>item.value===`${secret} evidence payload`),
    'precondition: canonical task detail really contains protected evidence');

  const milestone=await request(base,`/api/v1/projects/${projectId}/milestones`,{
    cookie:lead.cookie,method:'POST',
    body:{title:`${secret} milestone`,targetAt:new Date(Date.now()+7*864e5).toISOString()}});
  assert.equal(milestone.status,201);

  const block=await request(base,'/api/v1/calendar-events',{cookie:lead.cookie,method:'POST',
    body:{kind:'task_block',title:`${secret} private work block`,commitmentId:taskId,
      startAt:new Date(Date.now()+2*864e5).toISOString(),
      endAt:new Date(Date.now()+2*864e5+3600000).toISOString(),
      visibility:'private'}});
  assert.equal(block.status,201);

  // Before revocation, the future removed member can reach the private room/file/project.
  assert.equal((await request(base,`/api/v1/projects/${projectId}`,{cookie:removed.cookie})).status,200);
  assert.equal((await request(base,`/api/v1/conversations/${conversationId}/messages?around=${messageId}`,
    {cookie:removed.cookie})).status,200);
  assert.equal((await fetch(`${base}/api/v1/files/${fileId}/content`,{
    headers:{cookie:removed.cookie}})).status,200);
  const beforeNotices=await request(base,'/api/v1/notifications',{cookie:removed.cookie});
  assert.equal(beforeNotices.status,200);
  assert.ok(beforeNotices.payload.items.some(item=>item.conversationId===conversationId),
    'precondition: member received a room notification before revocation');

  // Observer may inspect project/milestone context, but project membership alone must not
  // grant canonical task, private discussion or attachment access.
  const observerProject=await request(base,`/api/v1/projects/${projectId}`,{cookie:observer.cookie});
  assert.equal(observerProject.status,200);
  assert.equal(observerProject.payload.project.canContribute,false);
  assert.equal(observerProject.payload.project.tasks.some(item=>item.id===taskId),false);
  assert.equal((await request(base,`/api/v1/tasks/${taskId}`,{cookie:observer.cookie})).status,404);
  assert.equal((await request(base,`/api/v1/conversations/${conversationId}/messages?around=${messageId}`,
    {cookie:observer.cookie})).status,404);
  assert.equal((await fetch(`${base}/api/v1/files/${fileId}/content`,{
    headers:{cookie:observer.cookie}})).status,404);

  // Remove the member from both current authorities. Old browser state keeps all IDs.
  const roomRemoval=await request(base,`/api/v1/conversations/${conversationId}/members/${removed.userId}`,{
    cookie:ownerCookie,method:'DELETE'});
  assert.equal(roomRemoval.status,200);
  const projectRemoval=await request(base,`/api/v1/projects/${projectId}/members/${removed.userId}`,{
    cookie:ownerCookie,method:'DELETE'});
  assert.equal(projectRemoval.status,200);

  const actors=[
    ['removed member',removed.cookie],
    ['guest',guest.cookie],
  ];
  for(const [label,cookie] of actors){
    const projectDirect=await request(base,`/api/v1/projects/${projectId}`,{cookie});
    assert.equal(projectDirect.status,404,`${label}: stale project id`);

    const taskDirect=await request(base,`/api/v1/tasks/${taskId}`,{cookie});
    assert.equal(taskDirect.status,404,`${label}: stale task id`);

    const history=await request(base,`/api/v1/conversations/${conversationId}/messages?around=${messageId}`,{cookie});
    assert.equal(history.status,404,`${label}: stale message history/deep link`);

    const messageDirect=await request(base,`/api/v1/messages/${messageId}/reactions`,{
      cookie,method:'POST',body:{emoji:'👍'}});
    assert.equal(messageDirect.status,404,`${label}: stale message id`);

    const evidenceDirect=await request(base,`/api/v1/tasks/${taskId}/evidence`,{
      cookie,method:'POST',
      body:{type:'note',value:'unauthorised stale-id probe',expectedVersion:evidenceVersion}});
    assert.equal(evidenceDirect.status,404,`${label}: stale task evidence route`);

    const content=await fetch(`${base}/api/v1/files/${fileId}/content`,{headers:{cookie}});
    assert.equal(content.status,404,`${label}: stale file route`);

    const filtered=await request(base,
      `/api/v1/calendar-events?projectId=${projectId}&from=${encodeURIComponent(new Date(Date.now()-864e5).toISOString())}&to=${encodeURIComponent(new Date(Date.now()+10*864e5).toISOString())}`,
      {cookie});
    assert.equal(filtered.status,404,`${label}: stale Calendar project filter`);

    const search=await request(base,`/api/v1/search?q=${encodeURIComponent(secret)}`,{cookie});
    assert.equal(search.status,200,`${label}: search endpoint remains usable`);
    assertNoRefs(search.payload?.items??[],{projectId,taskId,conversationId,messageId,fileId,secret},`${label} search results`);

    const files=await request(base,`/api/v1/files?q=${encodeURIComponent(secret)}`,{cookie});
    assert.equal(files.status,200,`${label}: file list remains usable`);
    assertNoRefs(files.payload,{projectId,taskId,conversationId,messageId,fileId,secret},`${label} file list`);

    const notices=await request(base,'/api/v1/notifications',{cookie});
    assert.equal(notices.status,200,`${label}: notifications remain usable`);
    assertNoRefs(notices.payload,{projectId,taskId,conversationId,messageId,fileId,secret},`${label} notifications`);
  }

  // Observer still has the project by design, so only inaccessible subordinate
  // authorities must disappear from discovery surfaces.
  const observerSearch=await request(base,`/api/v1/search?q=${encodeURIComponent(secret)}`,{cookie:observer.cookie});
  assert.equal(observerSearch.status,200);
  assertNoRefs(observerSearch.payload?.items??[],{taskId,conversationId,messageId,fileId,secret:`${secret} confidential`},'observer search results');
  const observerNotices=await request(base,'/api/v1/notifications',{cookie:observer.cookie});
  assert.equal(observerNotices.status,200);
  assertNoRefs(observerNotices.payload,{taskId,conversationId,messageId,fileId,secret:`${secret} confidential`},'observer notifications');
});
