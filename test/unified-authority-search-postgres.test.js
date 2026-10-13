import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const password='UnifiedAuthoritySearchPassword42';

async function req(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(base+path,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return {status:response.status,payload:await response.json().catch(()=>null),
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null};
}
async function company(base,prefix){
  const suffix=randomUUID().slice(0,8);
  const created=await req(base,'/api/v1/auth/register-company',{
    method:'POST',body:{companyName:prefix+' '+suffix,ownerName:'Owner',
      email:prefix.replace(/\W/g,'').toLowerCase()+'-'+suffix+'@example.test',password},
  });
  assert.equal(created.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:created.cookie});
  return {cookie:created.cookie,session:boot.payload.session};
}
async function invite(base,cookie,role='member'){
  const created=await req(base,'/api/v1/invitations',{
    cookie,method:'POST',
    body:{email:'search-'+randomUUID().slice(0,8)+'@example.test',role},
  });
  assert.equal(created.status,201);
  const token=new URL(created.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await req(base,'/api/v1/invitations/accept',{
    method:'POST',body:{token,displayName:'Colleague',password},
  });
  assert.equal(accepted.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  return {cookie:accepted.cookie,session:boot.payload.session};
}
test('Unified search reuses Pages, Projects and Decision Authority access rules',
  {skip:!databaseUrl},async t=>{
    const app=await createChatServer({databaseUrl,startMeetingWorker:false});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    t.after(()=>app.close());
    const base='http://127.0.0.1:'+app.server.address().port;
    const owner=await company(base,'Search Authority');
    const member=await invite(base,owner.cookie);
    const guest=await invite(base,owner.cookie,'guest');
    const foreign=await company(base,'Foreign Search');
    const token='SearchProof'+randomUUID().slice(0,8);
    const wiki=await req(base,'/api/v1/wiki/pages',{
      cookie:owner.cookie,method:'POST',body:{title:'Page '+token,content:'Search evidence for '+token},
    });
    assert.equal(wiki.status,201);
    const createProject=(name,visibility)=>req(base,'/api/v1/projects',{
      cookie:owner.cookie,method:'POST',body:{name,goal:'Workspace proof '+token,visibility},
    });
    const publicProject=await createProject('Shared '+token,'workspace');
    const privateProject=await createProject('Secret '+token,'members');
    assert.equal(publicProject.status,201);
    assert.equal(privateProject.status,201);
    const start=new Date(Date.now()-3600e3),end=new Date(Date.now()+3600e3);
    const event=await req(base,'/api/v1/calendar-events',{
      cookie:owner.cookie,method:'POST',body:{
        kind:'meeting',title:'Decision meeting '+token,
        startAt:start.toISOString(),endAt:end.toISOString(),
      },
    });
    assert.equal(event.status,201);
    const saved=await req(base,`/api/v1/calendar-events/${event.payload.event.id}/notes`,{
      cookie:owner.cookie,method:'PUT',
      body:{title:'Decision meeting '+token,decisions:['Approve '+token],actionItems:[]},
    });
    assert.equal(saved.status,200);

    const search=(cookie,types=null,other='')=>req(base,'/api/v1/search?q='+encodeURIComponent(token)+
      (types?'&types='+encodeURIComponent(types):'')+other,{cookie});
    const all=await search(owner.cookie);
    assert.equal(all.status,200);
    assert.ok(all.payload.items.some(x=>x.type==='page'&&x.id===wiki.payload.id));
    assert.ok(all.payload.items.some(x=>x.type==='project'&&x.id===publicProject.payload.project.id));
    assert.ok(all.payload.items.some(x=>x.type==='project'&&x.id===privateProject.payload.project.id));
    const decision=all.payload.items.find(x=>x.type==='decision'&&x.title==='Approve '+token);
    assert.ok(decision,'accepted meeting decision must be searchable');

    const memberResult=await search(member.cookie,'page,project,decision');
    assert.equal(memberResult.status,200);
    assert.ok(memberResult.payload.items.some(x=>x.type==='page'&&x.id===wiki.payload.id));
    assert.ok(memberResult.payload.items.some(x=>x.type==='project'&&x.id===publicProject.payload.project.id));
    assert.ok(!memberResult.payload.items.some(x=>x.type==='project'&&x.id===privateProject.payload.project.id),
      'nonmembers must not infer private project titles');
    assert.ok(!memberResult.payload.items.some(x=>x.type==='decision'));
    assert.deepEqual((await search(guest.cookie,'page,project,decision')).payload.items,[]);
    assert.deepEqual((await search(foreign.cookie,'page,project,decision')).payload.items,[]);

    const detail=await req(base,'/api/v1/meetings/decisions/'+decision.id,{cookie:owner.cookie});
    assert.equal(detail.status,200);
    assert.equal(detail.payload.decision.id,decision.id);
    assert.equal((await req(base,'/api/v1/meetings/decisions/'+decision.id,{cookie:member.cookie})).status,404);

    assert.deepEqual((await search(owner.cookie,'page')).payload.items.map(x=>x.type),['page']);
    assert.ok((await search(owner.cookie,'decision')).payload.items.every(x=>x.type==='decision'));
    const future='&from='+encodeURIComponent(new Date(Date.now()+86400000).toISOString());
    assert.deepEqual((await search(owner.cookie,'page,project,decision',future)).payload.items,[]);
    const memberAdded=await req(base,`/api/v1/projects/${privateProject.payload.project.id}/members`,{
      cookie:owner.cookie,method:'POST',body:{userId:member.session.userId,role:'member'},
    });
    assert.equal(memberAdded.status,200);
    assert.ok((await search(member.cookie,'project')).payload.items
      .some(x=>x.id===privateProject.payload.project.id),
      'search visibility must follow changed canonical Project membership');
  });
