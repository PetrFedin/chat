import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const password='WikiRecoveryPassword42';

async function req(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(base+path,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return {
    status:response.status,
    payload:response.status===204?null:await response.json().catch(()=>null),
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null,
  };
}
async function register(base){
  const suffix=randomUUID().slice(0,8);
  const made=await req(base,'/api/v1/auth/register-company',{method:'POST',body:{
    companyName:'Wiki Recovery '+suffix,ownerName:'Workspace Owner',
    email:'wiki-recovery-owner-'+suffix+'@example.test',password,
  }});
  assert.equal(made.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:made.cookie});
  return {cookie:made.cookie,session:boot.payload.session};
}
async function invite(base,ownerCookie,name,role='member'){
  const suffix=randomUUID().slice(0,8);
  const made=await req(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{
    email:'wiki-recovery-'+suffix+'@example.test',role,
  }});
  assert.equal(made.status,201);
  const token=new URL(made.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await req(base,'/api/v1/invitations/accept',{method:'POST',body:{token,displayName:name,password}});
  assert.equal(accepted.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  return {cookie:accepted.cookie,session:boot.payload.session};
}

test('Page access ownership transfers normally and owner break-glass only recovers orphaned authority',
  {skip:!databaseUrl,timeout:90000},async t=>{
    const app=await createChatServer({databaseUrl,startMeetingWorker:false});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    t.after(()=>app.close());
    const base='http://127.0.0.1:'+app.server.address().port;
    const pool=app.store.pool;

    const owner=await register(base);
    const author=await invite(base,owner.cookie,'Author');
    const successor=await invite(base,owner.cookie,'Successor');
    const recovered=await invite(base,owner.cookie,'Recovery steward');
    const outsider=await invite(base,owner.cookie,'Ordinary member');

    const made=await req(base,'/api/v1/wiki/pages',{cookie:author.cookie,method:'POST',body:{
      title:'Restricted recovery dossier',content:'confidential recovery content',visibility:'restricted',
    }});
    assert.equal(made.status,201);
    const pageId=made.payload.id;
    assert.equal(made.payload.createdBy,author.session.userId);
    assert.equal(made.payload.accessOwnerId,author.session.userId);

    // Workspace owner is governance authority, not an automatic reader.
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:owner.cookie})).status,404);
    assert.deepEqual((await req(base,'/api/v1/wiki/access-recovery',{cookie:owner.cookie})).payload.items,[]);
    assert.equal((await req(base,'/api/v1/wiki/access-recovery',{cookie:outsider.cookie})).status,403);

    const activeRecovery=await req(base,'/api/v1/wiki/access-recovery',{cookie:owner.cookie,method:'POST',body:{
      pageId,userId:recovered.session.userId,
    }});
    assert.equal(activeRecovery.status,409);
    assert.equal(activeRecovery.payload.error.code,'WIKI_ACCESS_OWNER_ACTIVE');

    // Normal handoff is made by the current access owner; authorship is immutable.
    const transferred=await req(base,`/api/v1/wiki/pages/${pageId}/access/owner`,{
      cookie:author.cookie,method:'PUT',body:{userId:successor.session.userId},
    });
    assert.equal(transferred.status,200);
    assert.equal(transferred.payload.accessOwnerId,successor.session.userId);
    const authorPage=await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:author.cookie});
    assert.equal(authorPage.status,200);
    assert.equal(authorPage.payload.createdBy,author.session.userId);
    assert.equal(authorPage.payload.permissions.canManageAccess,false);
    const successorPage=await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:successor.cookie});
    assert.equal(successorPage.status,200);
    assert.equal(successorPage.payload.permissions.canManageAccess,true);
    assert.equal(successorPage.payload.permissions.canEdit,false,
      'access ownership must not silently grant content edit permission');

    // Creator cannot take management back unilaterally after transfer.
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/access/owner`,{
      cookie:author.cookie,method:'PUT',body:{userId:author.session.userId},
    })).status,404);

    // Deactivating the current access owner creates an orphaned governance record.
    assert.equal((await req(base,`/api/v1/people/${successor.session.userId}/deactivate`,{
      cookie:owner.cookie,method:'POST',
    })).status,200);
    const recoveryList=await req(base,'/api/v1/wiki/access-recovery',{cookie:owner.cookie});
    assert.equal(recoveryList.status,200);
    const orphan=recoveryList.payload.items.find(x=>x.id===pageId);
    assert.ok(orphan);
    assert.equal(orphan.title,'Restricted recovery dossier');
    assert.equal('content' in orphan,false);
    assert.equal('grants' in orphan,false);
    assert.equal('history' in orphan,false);
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:owner.cookie})).status,404,
      'seeing recovery metadata must not grant the workspace owner Page read access');

    const result=await req(base,'/api/v1/wiki/access-recovery',{cookie:owner.cookie,method:'POST',body:{
      pageId,userId:recovered.session.userId,
    }});
    assert.equal(result.status,200);
    assert.equal(result.payload.accessOwnerId,recovered.session.userId);
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:owner.cookie})).status,404);

    const recoveredPage=await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:recovered.cookie});
    assert.equal(recoveredPage.status,200);
    assert.equal(recoveredPage.payload.permissions.canManageAccess,true);
    assert.equal(recoveredPage.payload.permissions.canEdit,false);
    assert.deepEqual((await req(base,'/api/v1/wiki/access-recovery',{cookie:owner.cookie})).payload.items,[]);

    const audit=await pool.query(
      `SELECT event_type,payload FROM audit_events
        WHERE workspace_id=$1 AND aggregate_type='wiki_page' AND aggregate_id=$2
          AND event_type IN('wiki.access_owner_transferred','wiki.access_owner_recovered')
        ORDER BY sequence`,
      [owner.session.workspaceId,pageId],
    );
    assert.deepEqual(audit.rows.map(x=>x.event_type),[
      'wiki.access_owner_transferred','wiki.access_owner_recovered',
    ]);
    assert.equal(audit.rows[0].payload.toUserId,successor.session.userId);
    assert.equal(audit.rows[1].payload.fromUserId,successor.session.userId);
    assert.equal(audit.rows[1].payload.toUserId,recovered.session.userId);
    assert.equal(JSON.stringify(audit.rows).includes('confidential recovery content'),false);
  });
