import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createChatServer} from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const password='WikiGovernance42Password';

async function request(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(base+path,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return {
    status:response.status,
    data:await response.json().catch(()=>null),
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null,
  };
}
async function register(base){
  const marker=randomUUID().slice(0,8);
  const registered=await request(base,'/api/v1/auth/register-company',{method:'POST',body:{
    companyName:'Governance Restore '+marker,ownerName:'Owner',
    email:'wiki-gov-'+marker+'@example.test',password,
  }});
  assert.equal(registered.status,201);
  const boot=await request(base,'/api/v1/bootstrap',{cookie:registered.cookie});
  assert.equal(boot.status,200);
  return {cookie:registered.cookie,userId:boot.data.session.userId,workspaceId:boot.data.session.workspaceId};
}
async function invite(base,ownerCookie,name){
  const email='wiki-gov-'+randomUUID().slice(0,8)+'@example.test';
  const created=await request(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{email,role:'member'}});
  assert.equal(created.status,201);
  const token=new URL(created.data.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await request(base,'/api/v1/invitations/accept',{method:'POST',body:{token,displayName:name,password}});
  assert.equal(accepted.status,201);
  const boot=await request(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  return {cookie:accepted.cookie,userId:boot.data.session.userId};
}

test('Page restore respects transferred access ownership and never resets its ACL',{skip:!databaseUrl,timeout:90000},async t=>{
  const app=await createChatServer({databaseUrl,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const owner=await register(base);
  const author=await invite(base,owner.cookie,'Author');
  const steward=await invite(base,owner.cookie,'Steward');
  const outsider=await register(base);
  const created=await request(base,'/api/v1/wiki/pages',{cookie:author.cookie,method:'POST',body:{
    title:'Original governance',content:'private v1',visibility:'restricted',
  }});
  assert.equal(created.status,201);
  const id=created.data.id,endpoint='/api/v1/wiki/pages/'+id;
  assert.equal((await request(base,endpoint,{cookie:owner.cookie})).status,404);
  assert.equal((await request(base,endpoint,{cookie:outsider.cookie})).status,404);
  const revised=await request(base,endpoint,{cookie:author.cookie,method:'PATCH',body:{
    title:'Updated governance',content:'private v2',expectedVersion:1,
  }});
  assert.equal(revised.status,200);
  const transfer=await request(base,endpoint+'/access/owner',{cookie:author.cookie,method:'PUT',body:{
    userId:steward.userId,
  }});
  assert.equal(transfer.status,200);
  const stewardRead=await request(base,endpoint,{cookie:steward.cookie});
  assert.equal(stewardRead.status,200);
  assert.equal(stewardRead.data.permissions.canManageAccess,true);
  assert.equal(stewardRead.data.permissions.canEdit,false);
  assert.equal((await request(base,endpoint+'/restore',{cookie:steward.cookie,method:'POST',body:{
    version:1,expectedVersion:2,
  }})).status,404,'access management alone cannot rewrite Page history');
  assert.equal((await request(base,endpoint+'/restore',{cookie:owner.cookie,method:'POST',body:{
    version:1,expectedVersion:2,
  }})).status,404,'workspace owner cannot bypass private Page ACL');
  const restored=await request(base,endpoint+'/restore',{cookie:author.cookie,method:'POST',body:{
    version:1,expectedVersion:2,
  }});
  assert.equal(restored.status,200);
  assert.equal(restored.data.version,3);
  assert.equal(restored.data.content,'private v1');
  assert.equal(restored.data.visibility,'restricted');
  assert.equal((await request(base,endpoint,{cookie:steward.cookie})).data.accessOwnerId,steward.userId);
  const selfEdit=await request(base,endpoint+'/access',{cookie:steward.cookie,method:'POST',body:{
    userId:steward.userId,access:'edit',
  }});
  assert.equal(selfEdit.status,200);
  const stale=await request(base,endpoint+'/restore',{cookie:steward.cookie,method:'POST',body:{
    version:2,expectedVersion:2,
  }});
  assert.equal(stale.status,409);
  const reverse=await request(base,endpoint+'/restore',{cookie:steward.cookie,method:'POST',body:{
    version:2,expectedVersion:3,
  }});
  assert.equal(reverse.status,200);
  assert.equal(reverse.data.version,4);
  assert.equal(reverse.data.content,'private v2');
  assert.equal((await request(base,endpoint+'/restore',{cookie:outsider.cookie,method:'POST',body:{
    version:1,expectedVersion:4,
  }})).status,404);
  const audit=await app.store.pool.query(
    `SELECT payload FROM audit_events WHERE workspace_id=$1 AND aggregate_type='wiki_page'
       AND aggregate_id=$2 AND event_type='wiki.page_restored'`,
    [owner.workspaceId,id],
  );
  assert.equal(audit.rows.length,2);
  assert.ok(audit.rows.every(row=>!JSON.stringify(row.payload).includes('private v')));
});
