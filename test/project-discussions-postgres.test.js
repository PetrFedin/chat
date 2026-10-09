import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createChatServer } from '../src/server.js';
import { PostgresStore } from '../src/persistence/store.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const PASSWORD='ProjectDiscussionPassword42';

async function request(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(`${base}${path}`,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},
    body:body!==undefined?JSON.stringify(body):undefined,
  });
  const payload=response.status===204?null:await response.json().catch(()=>null);
  return{
    status:response.status,
    payload,
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null,
    code:payload?.error?.code,
  };
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
  return{cookie:accepted.cookie,userId:boot.payload.session.userId};
}

test('Project <-> Discussion keeps Conversation Authority canonical',
  {skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const store=new PostgresStore(pool);
  const app=await createChatServer({store,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const suffix=randomUUID().slice(0,8);

  const owner=await request(base,'/api/v1/auth/register-company',{method:'POST',body:{
    companyName:`Project Discussion ${suffix}`,
    ownerName:'Owner',
    email:`owner-${suffix}@discussion.test`,
    password:PASSWORD,
  }});
  assert.equal(owner.status,201);

  const lead=await join(base,owner.cookie,`lead-${suffix}@discussion.test`,'Lead','manager');
  const member=await join(base,owner.cookie,`member-${suffix}@discussion.test`,'Member');
  const observer=await join(base,owner.cookie,`observer-${suffix}@discussion.test`,'Observer');
  const outsider=await join(base,owner.cookie,`outside-${suffix}@discussion.test`,'Outside');
  const guest=await join(base,owner.cookie,`guest-${suffix}@discussion.test`,'Guest','guest');

  const projectCreated=await request(base,'/api/v1/projects',{
    cookie:owner.cookie,method:'POST',body:{name:`Private project ${suffix}`,visibility:'members'}});
  assert.equal(projectCreated.status,201);
  const projectId=projectCreated.payload.project.id;

  for(const [person,role] of [[lead,'lead'],[member,'member'],[observer,'observer']]){
    const added=await request(base,`/api/v1/projects/${projectId}/members`,{
      cookie:owner.cookie,method:'POST',body:{userId:person.userId,role}});
    assert.equal(added.status,200);
  }

  // A private discussion contains owner/member/lead, but not the Project observer.
  const room=await request(base,'/api/v1/conversations',{
    cookie:owner.cookie,method:'POST',
    body:{kind:'group',title:`Steering room ${suffix}`,participantIds:[lead.userId,member.userId]}});
  assert.equal(room.status,201);
  const conversationId=room.payload.conversation.id;

  const linked=await request(base,`/api/v1/projects/${projectId}/discussions`,{
    cookie:member.cookie,method:'POST',body:{conversationId}});
  assert.equal(linked.status,200);
  assert.ok(linked.payload.project.discussions.some(row=>row.id===conversationId));
  assert.ok(linked.payload.project.activity.some(row=>row.eventType==='project.discussion_linked'));

  const duplicate=await request(base,`/api/v1/projects/${projectId}/discussions`,{
    cookie:member.cookie,method:'POST',body:{conversationId}});
  assert.equal(duplicate.status,409);
  assert.equal(duplicate.code,'PROJECT_DISCUSSION_ALREADY_LINKED');

  // Project membership alone must not grant Conversation access.
  const observerProject=await request(base,`/api/v1/projects/${projectId}`,{cookie:observer.cookie});
  assert.equal(observerProject.status,200);
  assert.equal(observerProject.payload.project.discussions.some(row=>row.id===conversationId),false,
    'linked private discussion leaked through Project membership');
  const observerMessages=await request(base,`/api/v1/conversations/${conversationId}/messages`,{
    cookie:observer.cookie});
  assert.equal(observerMessages.status,404);

  // An inaccessible conversation UUID cannot be linked by a Project contributor.
  const foreignRoom=await request(base,'/api/v1/conversations',{
    cookie:outsider.cookie,method:'POST',
    body:{kind:'group',title:`Foreign room ${suffix}`,participantIds:[]}});
  assert.equal(foreignRoom.status,201);
  const guessed=await request(base,`/api/v1/projects/${projectId}/discussions`,{
    cookie:member.cookie,method:'POST',body:{conversationId:foreignRoom.payload.conversation.id}});
  assert.equal(guessed.status,404);
  assert.equal(guessed.code,'CONVERSATION_NOT_FOUND');

  // Conversation Authority admits the observer; the existing Project relation
  // becomes visible without any Project ACL mutation.
  const admitted=await request(base,`/api/v1/conversations/${conversationId}/members`,{
    cookie:owner.cookie,method:'POST',body:{userIds:[observer.userId],role:'member'}});
  assert.equal(admitted.status,200);

  const observerAfterAdmission=await request(base,`/api/v1/projects/${projectId}`,{
    cookie:observer.cookie});
  assert.ok(observerAfterAdmission.payload.project.discussions.some(row=>
    row.id===conversationId&&row.memberRole==='member'));
  assert.equal((await request(base,`/api/v1/conversations/${conversationId}/messages`,{
    cookie:observer.cookie})).status,200);

  // Removing them from the conversation revokes only that authority path.
  const removed=await request(base,`/api/v1/conversations/${conversationId}/members/${observer.userId}`,{
    cookie:owner.cookie,method:'DELETE'});
  assert.equal(removed.status,200);

  const observerAfterRemoval=await request(base,`/api/v1/projects/${projectId}`,{
    cookie:observer.cookie});
  assert.equal(observerAfterRemoval.status,200);
  assert.equal(observerAfterRemoval.payload.project.discussions.some(row=>row.id===conversationId),false);
  assert.equal((await request(base,`/api/v1/conversations/${conversationId}/messages`,{
    cookie:observer.cookie})).status,404);

  // The relation itself still exists: Conversation Authority, not Project,
  // controls whether a particular viewer sees it.
  const relation=await pool.query(
    'SELECT count(*)::int c FROM project_discussions WHERE project_id=$1 AND conversation_id=$2',
    [projectId,conversationId]);
  assert.equal(relation.rows[0].c,1);

  // Project outsider/guest cannot use the Project relation as an existence oracle.
  assert.equal((await request(base,`/api/v1/projects/${projectId}`,{cookie:outsider.cookie})).status,404);
  assert.equal((await request(base,`/api/v1/projects/${projectId}`,{cookie:guest.cookie})).status,404);

  const observerUnlink=await request(
    base,`/api/v1/projects/${projectId}/discussions/${conversationId}`,{
      cookie:observer.cookie,method:'DELETE'});
  assert.equal(observerUnlink.status,403);

  const unlinked=await request(
    base,`/api/v1/projects/${projectId}/discussions/${conversationId}`,{
      cookie:lead.cookie,method:'DELETE'});
  assert.equal(unlinked.status,200);
  assert.equal(unlinked.payload.project.discussions.some(row=>row.id===conversationId),false);
  assert.ok(unlinked.payload.project.activity.some(row=>row.eventType==='project.discussion_unlinked'));

  const afterUnlink=await pool.query(
    'SELECT count(*)::int c FROM project_discussions WHERE project_id=$1 AND conversation_id=$2',
    [projectId,conversationId]);
  assert.equal(afterUnlink.rows[0].c,0);
});
