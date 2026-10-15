import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createChatServer } from '../src/server.js';
import { PostgresStore } from '../src/persistence/store.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const PASSWORD='ProjectFilesPassword42';

async function request(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(`${base}${path}`,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},
    body:body!==undefined?JSON.stringify(body):undefined,
  });
  const payload=response.status===204?null:await response.json().catch(()=>null);
  return{status:response.status,payload,cookie:response.headers.get('set-cookie')?.split(';')[0]??null};
}
async function join(base,ownerCookie,email,name,role='member'){
  const invited=await request(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{email,role}});
  assert.equal(invited.status,201);
  const token=new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await request(base,'/api/v1/invitations/accept',{
    method:'POST',body:{token,displayName:name,password:PASSWORD}});
  assert.equal(accepted.status,201);
  const boot=await request(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  assert.equal(boot.status,200);
  return{cookie:accepted.cookie,userId:boot.payload.session.userId};
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

test('Project <-> Files composes canonical File Authority without duplicating ACL',
  {skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const store=new PostgresStore(pool);
  const app=await createChatServer({store,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const suffix=randomUUID().slice(0,8);
  const token=`projectfile${suffix.replace(/-/g,'')}`;

  const owner=await request(base,'/api/v1/auth/register-company',{method:'POST',body:{
    companyName:`Project Files ${suffix}`,
    ownerName:'Owner',
    email:`owner-${suffix}@pf.test`,
    password:PASSWORD,
  }});
  assert.equal(owner.status,201);

  const lead=await join(base,owner.cookie,`lead-${suffix}@pf.test`,'Lead','manager');
  const member=await join(base,owner.cookie,`member-${suffix}@pf.test`,'Member');
  const observer=await join(base,owner.cookie,`observer-${suffix}@pf.test`,'Observer');
  const removed=await join(base,owner.cookie,`removed-${suffix}@pf.test`,'Removed');
  const outsider=await join(base,owner.cookie,`outside-${suffix}@pf.test`,'Outside');
  const guest=await join(base,owner.cookie,`guest-${suffix}@pf.test`,'Guest','guest');

  const created=await request(base,'/api/v1/projects',{
    cookie:owner.cookie,method:'POST',body:{name:`Private files ${suffix}`,visibility:'members'}});
  assert.equal(created.status,201);
  const projectId=created.payload.project.id;

  for(const [person,role] of [[lead,'lead'],[member,'member'],[observer,'observer'],[removed,'member']]){
    const added=await request(base,`/api/v1/projects/${projectId}/members`,{
      cookie:owner.cookie,method:'POST',body:{userId:person.userId,role}});
    assert.equal(added.status,200);
  }

  // A UUID is not a capability: an actor may only re-share a file they can
  // already open through canonical File Authority.
  const foreign=await upload(base,outsider.cookie,`foreign-${suffix}.txt`,'must stay foreign');
  const guessed=await request(base,`/api/v1/projects/${projectId}/files`,{
    cookie:lead.cookie,method:'POST',body:{fileId:foreign.id}});
  assert.equal(guessed.status,404);
  assert.equal(guessed.payload.error.code,'FILE_NOT_FOUND');

  const file=await upload(
    base,member.cookie,`brief-${token}.txt`,
    `insidecontent${token} canonical project evidence`);
  const linked=await request(base,`/api/v1/projects/${projectId}/files`,{
    cookie:member.cookie,method:'POST',body:{fileId:file.id}});
  assert.equal(linked.status,200);
  assert.ok(linked.payload.project.files.some(row=>row.id===file.id));
  assert.ok(linked.payload.project.activity.some(row=>row.eventType==='project.file_linked'));

  const duplicate=await request(base,`/api/v1/projects/${projectId}/files`,{
    cookie:member.cookie,method:'POST',body:{fileId:file.id}});
  assert.equal(duplicate.status,409);
  assert.equal(duplicate.payload.error.code,'PROJECT_FILE_ALREADY_LINKED');

  // Observer gets the file only because the visible Project relation grants it.
  const observerDetail=await request(base,`/api/v1/projects/${projectId}`,{cookie:observer.cookie});
  assert.equal(observerDetail.status,200);
  assert.equal(observerDetail.payload.project.canContribute,false);
  assert.ok(observerDetail.payload.project.files.some(row=>row.id===file.id));
  assert.equal((await fetch(`${base}/api/v1/files/${file.id}/content`,{
    headers:{cookie:observer.cookie}})).status,200);
  assert.equal((await fetch(`${base}/api/v1/files/${file.id}/preview`,{
    headers:{cookie:observer.cookie}})).status,200);

  const observerFiles=await request(base,`/api/v1/files?q=${encodeURIComponent(token)}`,{
    cookie:observer.cookie});
  assert.ok(observerFiles.payload.items.some(row=>
    row.id===file.id&&row.context?.type==='project'&&row.context?.projectId===projectId));

  const observerSearch=await request(
    base,`/api/v1/search?q=${encodeURIComponent(token)}&types=file`,{cookie:observer.cookie});
  assert.ok(observerSearch.payload.items.some(row=>row.id===file.id));

  const insideToken=`insidecontent${token}`;
  const insideSearch=await request(
    base,`/api/v1/search?q=${encodeURIComponent(insideToken)}&types=file`,{cookie:observer.cookie});
  assert.ok(insideSearch.payload.items.some(row=>row.id===file.id&&row.insideFile===true),
    'extracted file text must inherit project visibility');

  const observerLink=await request(base,`/api/v1/projects/${projectId}/files`,{
    cookie:observer.cookie,method:'POST',body:{fileId:file.id}});
  assert.equal(observerLink.status,403);
  assert.equal(observerLink.payload.error.code,'PROJECT_FORBIDDEN');

  for(const actor of [outsider,guest]){
    assert.equal((await fetch(`${base}/api/v1/files/${file.id}/content`,{
      headers:{cookie:actor.cookie}})).status,404);
    const hidden=await request(
      base,`/api/v1/search?q=${encodeURIComponent(token)}&types=file`,{cookie:actor.cookie});
    assert.equal(hidden.payload.items.some(row=>row.id===file.id),false);
  }

  // Removing Project membership revokes this access path without changing the file.
  assert.equal((await fetch(`${base}/api/v1/files/${file.id}/content`,{
    headers:{cookie:removed.cookie}})).status,200);
  const revoked=await request(base,`/api/v1/projects/${projectId}/members/${removed.userId}`,{
    cookie:owner.cookie,method:'DELETE'});
  assert.equal(revoked.status,200);
  assert.equal((await fetch(`${base}/api/v1/files/${file.id}/content`,{
    headers:{cookie:removed.cookie}})).status,404);

  const removedFiles=await request(base,`/api/v1/files?q=${encodeURIComponent(token)}`,{
    cookie:removed.cookie});
  assert.equal(removedFiles.payload.items.some(row=>row.id===file.id),false);
  const removedSearch=await request(
    base,`/api/v1/search?q=${encodeURIComponent(token)}&types=file`,{cookie:removed.cookie});
  assert.equal(removedSearch.payload.items.some(row=>row.id===file.id),false);

  // Contributors can add resources, but only Project managers curate removal.
  const memberUnlink=await request(base,`/api/v1/projects/${projectId}/files/${file.id}`,{
    cookie:member.cookie,method:'DELETE'});
  assert.equal(memberUnlink.status,403);

  const unlinked=await request(base,`/api/v1/projects/${projectId}/files/${file.id}`,{
    cookie:lead.cookie,method:'DELETE'});
  assert.equal(unlinked.status,200);
  assert.equal(unlinked.payload.project.files.some(row=>row.id===file.id),false);
  assert.ok(unlinked.payload.project.activity.some(row=>row.eventType==='project.file_unlinked'));

  assert.equal((await fetch(`${base}/api/v1/files/${file.id}/content`,{
    headers:{cookie:observer.cookie}})).status,404);
  assert.equal((await fetch(`${base}/api/v1/files/${file.id}/content`,{
    headers:{cookie:member.cookie}})).status,200,
    'the uploader keeps canonical access after Project unlink');

  // Canonical delete owns lifecycle: the relation disappears with it.
  const relink=await request(base,`/api/v1/projects/${projectId}/files`,{
    cookie:member.cookie,method:'POST',body:{fileId:file.id}});
  assert.equal(relink.status,200);
  const deleted=await request(base,`/api/v1/files/${file.id}`,{
    cookie:member.cookie,method:'DELETE'});
  assert.equal(deleted.status,204);

  const afterDelete=await request(base,`/api/v1/projects/${projectId}`,{cookie:lead.cookie});
  assert.equal(afterDelete.payload.project.files.some(row=>row.id===file.id),false);
  const relation=await pool.query(
    'SELECT count(*)::int c FROM project_files WHERE project_id=$1 AND file_id=$2',
    [projectId,file.id]);
  assert.equal(relation.rows[0].c,0);
});
