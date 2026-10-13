import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const password='WikiDecisionAdmissionPassword42';

async function req(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(base+path,{
    method,headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return {status:response.status,payload:await response.json().catch(()=>null),
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null};
}
async function createCompany(base,prefix){
  const suffix=randomUUID().slice(0,8);
  const result=await req(base,'/api/v1/auth/register-company',{method:'POST',body:{
    companyName:prefix+' '+suffix,ownerName:'Owner',
    email:prefix.toLowerCase().replace(/\W/g,'')+'-'+suffix+'@example.test',password,
  }});
  assert.equal(result.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:result.cookie});
  assert.equal(boot.status,200);
  return {cookie:result.cookie,session:boot.payload.session};
}
async function invite(base,ownerCookie,role='member'){
  const result=await req(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{
    email:'wiki-decision-'+randomUUID().slice(0,8)+'@example.test',role,
  }});
  assert.equal(result.status,201);
  const token=new URL(result.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await req(base,'/api/v1/invitations/accept',{method:'POST',body:{
    token,displayName:'Colleague',password,
  }});
  assert.equal(accepted.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  return {cookie:accepted.cookie,session:boot.payload.session};
}
async function acceptedMeetingDecisions(base,cookie,marker){
  const eventResult=await req(base,'/api/v1/calendar-events',{cookie,method:'POST',body:{
    kind:'meeting',title:'Board review '+marker,
    startAt:new Date(Date.now()-3600000).toISOString(),
    endAt:new Date(Date.now()+3600000).toISOString(),
  }});
  assert.equal(eventResult.status,201);
  const event=eventResult.payload.event;
  const names=['Approval '+marker,'Budget '+marker];
  const note=await req(base,`/api/v1/calendar-events/${event.id}/notes`,{
    cookie,method:'PUT',body:{title:'Board review '+marker,decisions:names,actionItems:[]},
  });
  assert.equal(note.status,200);
  const decisions=await req(base,'/api/v1/meetings/decisions?q='+encodeURIComponent(marker),{cookie});
  assert.equal(decisions.status,200);
  return {event,decisions:names.map(title=>{
    const entry=decisions.payload.items.find(x=>x.title===title);
    assert.ok(entry,'canonical accepted Decision missing: '+title);
    return entry;
  })};
}

test('Page-Decision: access changes, retraction, tenant FKs and audit without copying decision body',
  {skip:!databaseUrl},async t=>{
    const app=await createChatServer({databaseUrl,startMeetingWorker:false});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    t.after(()=>app.close());
    const base='http://127.0.0.1:'+app.server.address().port;
    const pool=app.store.pool;
    const owner=await createCompany(base,'Page Decision');
    const colleague=await invite(base,owner.cookie);
    const guest=await invite(base,owner.cookie,'guest');
    const foreign=await createCompany(base,'Foreign Decision');
    const marker='DecisionProof'+randomUUID().slice(0,8);
    const {event,decisions:[first,second]}=await acceptedMeetingDecisions(base,owner.cookie,marker);
    const {decisions:[outsiderDecision]}=await acceptedMeetingDecisions(
      base,foreign.cookie,'ForeignProof'+randomUUID().slice(0,8));

    const page=await req(base,'/api/v1/wiki/pages',{cookie:owner.cookie,method:'POST',body:{
      title:'Executive paper '+marker,content:'The Page stores only Decision identifiers.',
    }});
    assert.equal(page.status,201);
    const pageId=page.payload.id;
    const link=(cookie,decisionId)=>req(base,`/api/v1/wiki/pages/${pageId}/decisions`,{
      cookie,method:'POST',body:{decisionId},
    });
    const unlink=(cookie,decisionId)=>req(base,
      `/api/v1/wiki/pages/${pageId}/decisions/${decisionId}`,{cookie,method:'DELETE'});
    const pageFor=(cookie)=>req(base,`/api/v1/wiki/pages/${pageId}`,{cookie});

    assert.equal((await link(owner.cookie,first.id)).status,200);
    // Two simultaneous link requests must create exactly one relation and
    // one audit entry. The other must receive explicit 409, not a duplicate.
    const concurrent=await Promise.all([
      link(owner.cookie,second.id),link(owner.cookie,second.id),
    ]);
    assert.deepEqual(concurrent.map(x=>x.status).sort((a,b)=>a-b),[200,409]);
    assert.equal((await link(owner.cookie,first.id)).status,409);
    assert.equal((await link(owner.cookie,randomUUID())).status,404);
    assert.equal((await link(owner.cookie,outsiderDecision.id)).status,404);

    const ownerPage=await pageFor(owner.cookie);
    assert.equal(ownerPage.status,200);
    assert.deepEqual(ownerPage.payload.decisions.map(x=>x.id).sort(),[first.id,second.id].sort());
    assert.ok(ownerPage.payload.decisions.every(x=>!('body' in x) && !('sourceId' in x)),
      'Page projections must never copy confidential Decision text or meeting sources');
    const reverse=(cookie,id)=>req(base,`/api/v1/wiki/decisions/${id}/pages`,{cookie});
    assert.deepEqual((await reverse(owner.cookie,first.id)).payload.items.map(x=>x.id),[pageId]);
    assert.equal((await reverse(owner.cookie,outsiderDecision.id)).status,404);
    assert.equal((await reverse(owner.cookie,randomUUID())).status,404);

    const otherPage=await pageFor(colleague.cookie);
    assert.equal(otherPage.status,200);
    assert.deepEqual(otherPage.payload.decisions,[],
      'meeting nonparticipant must not see decision ID, title or count');
    assert.equal((await reverse(colleague.cookie,first.id)).status,404);
    assert.equal((await link(colleague.cookie,first.id)).status,404);
    assert.equal((await unlink(colleague.cookie,first.id)).status,404);
    assert.equal((await pageFor(guest.cookie)).status,404);
    assert.equal((await pageFor(foreign.cookie)).status,404);
    assert.equal((await link(foreign.cookie,first.id)).status,404);

    await assert.rejects(pool.query(
      `INSERT INTO wiki_page_decisions(organization_id,workspace_id,page_id,decision_id,linked_by)
       VALUES($1,$2,$3,$4,$5)`,
      [owner.session.organizationId,owner.session.workspaceId,pageId,outsiderDecision.id,owner.session.userId],
    ),{code:'23503'});

    // Canonical meeting attendance, not Page membership, controls subsequent visibility.
    await pool.query(
      `INSERT INTO calendar_event_participants(
         organization_id,workspace_id,calendar_event_id,user_id,optional,invited_by)
       VALUES($1,$2,$3,$4,false,$5)`,
      [owner.session.organizationId,owner.session.workspaceId,event.id,
        colleague.session.userId,owner.session.userId],
    );
    const admitted=await pageFor(colleague.cookie);
    assert.deepEqual(admitted.payload.decisions.map(x=>x.id).sort(),[first.id,second.id].sort());
    assert.deepEqual((await reverse(colleague.cookie,first.id)).payload.items.map(x=>x.id),[pageId]);

    // Remove access after linking: a shared Page must immediately conceal
    // a Decision, without changing any canonical Decision state.
    await pool.query(
      'DELETE FROM calendar_event_participants WHERE workspace_id=$1 AND calendar_event_id=$2 AND user_id=$3',
      [owner.session.workspaceId,event.id,colleague.session.userId],
    );
    assert.deepEqual((await pageFor(colleague.cookie)).payload.decisions,[]);
    assert.equal((await reverse(colleague.cookie,first.id)).status,404);

    assert.equal((await unlink(owner.cookie,second.id)).status,200);
    assert.equal((await unlink(owner.cookie,second.id)).status,404);
    assert.equal((await req(base,'/api/v1/meetings/decisions/'+second.id,
      {cookie:owner.cookie})).status,200,'unlink must not delete canonical Decision');

    // Canonical retraction hides a previously linked Decision immediately.
    await pool.query(
      `UPDATE decisions SET status='retracted',retracted_by=$3,
       retracted_at=now(),updated_at=now()
       WHERE workspace_id=$1 AND id=$2`,
      [owner.session.workspaceId,first.id,owner.session.userId],
    );
    const retracted=await pageFor(owner.cookie);
    assert.deepEqual(retracted.payload.decisions,[]);
    assert.equal((await reverse(owner.cookie,first.id)).status,404);
    assert.equal((await reverse(owner.cookie,second.id)).status,200);
    assert.deepEqual((await reverse(owner.cookie,second.id)).payload.items,[]);
    assert.equal((await link(owner.cookie,first.id)).status,404);
    assert.equal((await unlink(owner.cookie,first.id)).status,404);

    const history=await pool.query(
      `SELECT event_type,payload FROM audit_events
        WHERE workspace_id=$1 AND aggregate_type='wiki_page' AND aggregate_id=$2`,
      [owner.session.workspaceId,pageId],
    );
    assert.equal(history.rows.filter(x=>x.event_type==='wiki.decision_linked').length,2);
    assert.equal(history.rows.filter(x=>x.event_type==='wiki.decision_unlinked').length,1);
    assert.ok(history.rows.every(x=>!JSON.stringify(x.payload).includes(marker)));

    const archived=await req(base,`/api/v1/wiki/pages/${pageId}`,{
      cookie:owner.cookie,method:'DELETE',
    });
    assert.equal(archived.status,200);
    assert.equal((await link(owner.cookie,second.id)).status,404,
      'archived Page must reject new relationships');
  });
