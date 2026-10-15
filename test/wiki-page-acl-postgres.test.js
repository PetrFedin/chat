import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const password='WikiAclPassword42';

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
async function register(base,prefix){
  const suffix=randomUUID().slice(0,8);
  const made=await req(base,'/api/v1/auth/register-company',{method:'POST',body:{
    companyName:prefix+' '+suffix,ownerName:'Owner',
    email:prefix.toLowerCase().replace(/\W/g,'')+'-'+suffix+'@example.test',password,
  }});
  assert.equal(made.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:made.cookie});
  assert.equal(boot.status,200);
  return {cookie:made.cookie,session:boot.payload.session};
}
async function invite(base,ownerCookie,role='member',name='Colleague'){
  const made=await req(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{
    email:'wiki-acl-'+role+'-'+randomUUID().slice(0,8)+'@example.test',role,
  }});
  assert.equal(made.status,201);
  const token=new URL(made.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await req(base,'/api/v1/invitations/accept',{method:'POST',body:{
    token,displayName:name,password,
  }});
  assert.equal(accepted.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  assert.equal(boot.status,200);
  return {cookie:accepted.cookie,session:boot.payload.session};
}
async function acceptedDecision(base,cookie,userId,marker){
  const eventMade=await req(base,'/api/v1/calendar-events',{cookie,method:'POST',body:{
    kind:'meeting',title:'ACL decision source '+marker,
    startAt:new Date(Date.now()-3600000).toISOString(),
    endAt:new Date(Date.now()+3600000).toISOString(),
    visibility:'participants',
  }});
  assert.equal(eventMade.status,201);
  const event=eventMade.payload.event;
  const inviteResult=await req(base,`/api/v1/calendar-events/${event.id}/participants`,{
    cookie,method:'POST',body:{userId},
  });
  assert.equal(inviteResult.status,201);
  const title='ACL accepted '+marker;
  const notes=await req(base,`/api/v1/calendar-events/${event.id}/notes`,{
    cookie,method:'PUT',body:{title:'ACL decisions',decisions:[title],actionItems:[]},
  });
  assert.equal(notes.status,200);
  const decisions=await req(base,'/api/v1/meetings/decisions?q='+encodeURIComponent(marker),{cookie});
  const decision=decisions.payload.items.find(x=>x.title===title);
  assert.ok(decision);
  return decision;
}

test('Page ACL: restricted hierarchy, view/edit separation and no reverse/search leakage',
  {skip:!databaseUrl,timeout:120000},async t=>{
    const app=await createChatServer({databaseUrl,startMeetingWorker:false});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    t.after(()=>app.close());
    const base='http://127.0.0.1:'+app.server.address().port;
    const pool=app.store.pool;

    const owner=await register(base,'Wiki ACL');
    const viewer=await invite(base,owner.cookie,'member','Viewer');
    const editor=await invite(base,owner.cookie,'member','Editor');
    const guest=await invite(base,owner.cookie,'guest','Guest');
    const foreign=await register(base,'Foreign ACL');
    const marker='AclSecret'+randomUUID().slice(0,8);

    // Existing/default workspace Pages retain the pre-ACL collaboration model.
    const publicPage=await req(base,'/api/v1/wiki/pages',{cookie:owner.cookie,method:'POST',body:{
      title:'Workspace page '+marker,content:'ordinary collaboration',
    }});
    assert.equal(publicPage.status,201);
    assert.equal((await req(base,`/api/v1/wiki/pages/${publicPage.payload.id}`,{cookie:viewer.cookie})).status,200);
    const publicDetail=await req(base,`/api/v1/wiki/pages/${publicPage.payload.id}`,{cookie:viewer.cookie});
    assert.equal(publicDetail.payload.permissions.canEdit,true);

    const pageMade=await req(base,'/api/v1/wiki/pages',{cookie:owner.cookie,method:'POST',body:{
      title:'Restricted '+marker,content:'hidden-'+marker,visibility:'restricted',
    }});
    assert.equal(pageMade.status,201);
    const pageId=pageMade.payload.id;

    // Non-disclosure: direct ID, tree and full-text search all conceal the Page.
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:viewer.cookie})).status,404);
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/history`,{cookie:viewer.cookie})).status,404);
    const roots=await req(base,'/api/v1/wiki/pages',{cookie:viewer.cookie});
    assert.equal(roots.payload.items.some(x=>x.id===pageId),false);
    const search=await req(base,'/api/v1/wiki/search?q='+encodeURIComponent(marker),{cookie:viewer.cookie});
    assert.equal(search.payload.items.some(x=>x.id===pageId),false);

    const access=(cookie)=>req(base,`/api/v1/wiki/pages/${pageId}/access`,{cookie});
    assert.equal((await access(viewer.cookie)).status,404);
    assert.equal((await access(owner.cookie)).status,200);

    // Guests can never receive Wiki grants because workspace RBAC is the ceiling.
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/access`,{
      cookie:owner.cookie,method:'POST',body:{userId:guest.session.userId,access:'view'},
    })).status,404);
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/access`,{
      cookie:owner.cookie,method:'POST',body:{userId:foreign.session.userId,access:'view'},
    })).status,404);

    // View grant exposes content/history/search, but not content mutation or ACL management.
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/access`,{
      cookie:owner.cookie,method:'POST',body:{userId:viewer.session.userId,access:'view'},
    })).status,200);
    let visible=await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:viewer.cookie});
    assert.equal(visible.status,200);
    assert.equal(visible.payload.permissions.canEdit,false);
    assert.equal(visible.payload.permissions.canManageAccess,false);
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/history`,{cookie:viewer.cookie})).status,200);
    assert.equal((await req(base,'/api/v1/wiki/search?q='+encodeURIComponent(marker),{cookie:viewer.cookie}))
      .payload.items.some(x=>x.id===pageId),true);
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}`,{
      cookie:viewer.cookie,method:'PATCH',body:{title:'forbidden',expectedVersion:1},
    })).status,404);
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/access`,{
      cookie:viewer.cookie,method:'PUT',body:{visibility:'workspace'},
    })).status,404);

    // Upgrade the same explicit grant to edit.
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/access`,{
      cookie:owner.cookie,method:'POST',body:{userId:viewer.session.userId,access:'edit'},
    })).status,200);
    visible=await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:viewer.cookie});
    assert.equal(visible.payload.permissions.canEdit,true);
    const edited=await req(base,`/api/v1/wiki/pages/${pageId}`,{
      cookie:viewer.cookie,method:'PATCH',body:{content:'edited safely',expectedVersion:1},
    });
    assert.equal(edited.status,200);

    // Restricted parent is part of effective access. A child grant alone must
    // not reveal a Page through a hidden ancestor.
    const child=await req(base,'/api/v1/wiki/pages',{cookie:owner.cookie,method:'POST',body:{
      title:'Child '+marker,parentId:pageId,content:'nested secret',
    }});
    assert.equal(child.status,201);
    assert.equal(child.payload.visibility,'restricted');
    assert.equal((await req(base,`/api/v1/wiki/pages/${child.payload.id}/access`,{
      cookie:owner.cookie,method:'POST',body:{userId:editor.session.userId,access:'edit'},
    })).status,200);
    assert.equal((await req(base,`/api/v1/wiki/pages/${child.payload.id}`,{cookie:editor.cookie})).status,404,
      'child grant cannot bypass a restricted ancestor');
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/access`,{
      cookie:owner.cookie,method:'POST',body:{userId:editor.session.userId,access:'view'},
    })).status,200);
    const childVisible=await req(base,`/api/v1/wiki/pages/${child.payload.id}`,{cookie:editor.cookie});
    assert.equal(childVisible.status,200);
    assert.equal(childVisible.payload.permissions.canEdit,true);

    // Reverse Decision -> Pages must apply Page ACL after Decision Authority.
    const decision=await acceptedDecision(base,owner.cookie,editor.session.userId,marker);
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/decisions`,{
      cookie:owner.cookie,method:'POST',body:{decisionId:decision.id},
    })).status,200);
    const reverseEditor=await req(base,`/api/v1/wiki/decisions/${decision.id}/pages`,{cookie:editor.cookie});
    assert.equal(reverseEditor.status,200);
    assert.deepEqual(reverseEditor.payload.items.map(x=>x.id),[pageId],
      'parent view grant admits the restricted parent to reverse relation');

    // Revoke is immediate across detail, search and reverse relations.
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/access/${editor.session.userId}`,{
      cookie:owner.cookie,method:'DELETE',
    })).status,200);
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:editor.cookie})).status,404);
    assert.equal((await req(base,'/api/v1/wiki/search?q='+encodeURIComponent(marker),{cookie:editor.cookie}))
      .payload.items.some(x=>x.id===pageId),false);
    const reverseAfter=await req(base,`/api/v1/wiki/decisions/${decision.id}/pages`,{cookie:editor.cookie});
    assert.equal(reverseAfter.status,200);
    assert.deepEqual(reverseAfter.payload.items,[]);

    // Viewer still has edit access until separately revoked; revocation hides it immediately.
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/access/${viewer.session.userId}`,{
      cookie:owner.cookie,method:'DELETE',
    })).status,200);
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:viewer.cookie})).status,404);

    const audit=await pool.query(
      `SELECT event_type,payload FROM audit_events
        WHERE workspace_id=$1 AND aggregate_type='wiki_page' AND aggregate_id=$2
          AND event_type LIKE 'wiki.access_%'`,
      [owner.session.workspaceId,pageId],
    );
    assert.ok(audit.rows.some(x=>x.event_type==='wiki.access_granted'));
    assert.ok(audit.rows.some(x=>x.event_type==='wiki.access_revoked'));
    assert.ok(audit.rows.every(x=>!JSON.stringify(x.payload).includes(marker)),
      'ACL audit stores identifiers/levels, never Page text');

    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:foreign.cookie})).status,404);
  });
