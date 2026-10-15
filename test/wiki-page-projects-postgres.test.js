import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const PASSWORD='PagesProjectPassword42';

async function request(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(`${base}${path}`,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},
    body:body!==undefined?JSON.stringify(body):undefined,
  });
  const payload=response.status===204?null:await response.json().catch(()=>null);
  return{status:response.status,payload,cookie:response.headers.get('set-cookie')?.split(';')[0]??null};
}

async function join(base,ownerCookie,email){
  const invited=await request(base,'/api/v1/invitations',{
    cookie:ownerCookie,method:'POST',body:{email,role:'member'}});
  assert.equal(invited.status,201);
  const token=new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await request(base,'/api/v1/invitations/accept',{
    method:'POST',body:{token,displayName:'Member',password:PASSWORD}});
  assert.equal(accepted.status,201);
  const boot=await request(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  return{cookie:accepted.cookie,userId:boot.payload.session.userId};
}

test('Page <-> Project relation preserves Project Authority visibility',
  {skip:!databaseUrl},async(t)=>{
  const app=await createChatServer({databaseUrl,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const suffix=randomUUID().slice(0,8);

  const owner=await request(base,'/api/v1/auth/register-company',{method:'POST',body:{
    companyName:`Pages ${suffix}`,ownerName:'Owner',
    email:`pages-owner-${suffix}@t.test`,password:PASSWORD,
  }});
  assert.equal(owner.status,201);
  const member=await join(base,owner.cookie,`pages-member-${suffix}@t.test`);

  const projectCreated=await request(base,'/api/v1/projects',{
    cookie:owner.cookie,method:'POST',
    body:{name:`Private Page Project ${suffix}`,visibility:'members'},
  });
  assert.equal(projectCreated.status,201);
  const projectId=projectCreated.payload.project.id;

  const pageCreated=await request(base,'/api/v1/wiki/pages',{
    cookie:owner.cookie,method:'POST',
    body:{title:`Project brief ${suffix}`,content:'Canonical page body'},
  });
  assert.equal(pageCreated.status,201);
  const pageId=pageCreated.payload.id;

  const linked=await request(base,`/api/v1/wiki/pages/${pageId}/projects`,{
    cookie:owner.cookie,method:'POST',body:{projectId}});
  assert.equal(linked.status,200);
  assert.ok(linked.payload.projects.some(project=>project.id===projectId));

  const memberBefore=await request(base,`/api/v1/wiki/pages/${pageId}`,{cookie:member.cookie});
  assert.equal(memberBefore.status,200);
  assert.equal(memberBefore.payload.projects.some(project=>project.id===projectId),false);

  const guessed=await request(base,`/api/v1/wiki/pages/${pageId}/projects`,{
    cookie:member.cookie,method:'POST',body:{projectId}});
  assert.equal(guessed.status,404);
  assert.equal(guessed.payload.error.code,'PROJECT_NOT_FOUND');

  const admitted=await request(base,`/api/v1/projects/${projectId}/members`,{
    cookie:owner.cookie,method:'POST',body:{userId:member.userId,role:'member'}});
  assert.equal(admitted.status,200);

  const memberAfter=await request(base,`/api/v1/wiki/pages/${pageId}`,{cookie:member.cookie});
  assert.ok(memberAfter.payload.projects.some(project=>
    project.id===projectId&&project.name.includes('Private Page Project')));

  const unlinked=await request(base,`/api/v1/wiki/pages/${pageId}/projects/${projectId}`,{
    cookie:owner.cookie,method:'DELETE'});
  assert.equal(unlinked.status,200);
  assert.equal(unlinked.payload.projects.some(project=>project.id===projectId),false);

  assert.equal((await request(base,`/api/v1/projects/${projectId}`,{cookie:owner.cookie})).status,200);
  assert.equal((await request(base,`/api/v1/wiki/pages/${pageId}`,{cookie:owner.cookie})).status,200);
});
