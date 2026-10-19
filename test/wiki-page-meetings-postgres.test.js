import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const password='WikiMeetingRelationPassword42';

async function req(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(base+path,{
    method,headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return {status:response.status,payload:response.status===204?null:await response.json().catch(()=>null),
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null};
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
async function invite(base,ownerCookie,role='member'){
  const made=await req(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{
    email:'page-meeting-'+randomUUID().slice(0,8)+'@example.test',role,
  }});
  assert.equal(made.status,201);
  const token=new URL(made.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await req(base,'/api/v1/invitations/accept',{method:'POST',body:{
    token,displayName:'Colleague',password,
  }});
  assert.equal(accepted.status,201);
  const boot=await req(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  assert.equal(boot.status,200);
  return {cookie:accepted.cookie,session:boot.payload.session};
}

test('Page Meeting relations preserve Calendar/Call authority, privacy and tenant integrity',
  {skip:!databaseUrl,timeout:90000},async t=>{
    const app=await createChatServer({databaseUrl,startMeetingWorker:false});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    t.after(()=>app.close());
    const base='http://127.0.0.1:'+app.server.address().port;
    const pool=app.store.pool;

    const owner=await register(base,'Page Meetings');
    const colleague=await invite(base,owner.cookie);
    const foreign=await register(base,'Foreign Meetings');
    const marker='MeetLink'+randomUUID().slice(0,8);

    const pageMade=await req(base,'/api/v1/wiki/pages',{cookie:owner.cookie,method:'POST',body:{
      title:'Meeting evidence '+marker,content:'Relations only. No transcript or media copied.',
    }});
    assert.equal(pageMade.status,201);
    const pageId=pageMade.payload.id;

    const meetingMade=await req(base,'/api/v1/calendar-events',{cookie:owner.cookie,method:'POST',body:{
      kind:'meeting',title:'Private board '+marker,
      startAt:new Date(Date.now()+3600000).toISOString(),
      endAt:new Date(Date.now()+7200000).toISOString(),
      visibility:'workspace',
    }});
    assert.equal(meetingMade.status,201);
    const event=meetingMade.payload.event;

    const focusMade=await req(base,'/api/v1/calendar-events',{cookie:owner.cookie,method:'POST',body:{
      kind:'focus',title:'Not a meeting '+marker,
      startAt:new Date(Date.now()+10800000).toISOString(),
      endAt:new Date(Date.now()+14400000).toISOString(),
      visibility:'workspace',
    }});
    assert.equal(focusMade.status,201);

    const linkMeeting=(cookie,eventId)=>req(base,`/api/v1/wiki/pages/${pageId}/calendar-meetings`,{
      cookie,method:'POST',body:{eventId},
    });
    assert.equal((await linkMeeting(colleague.cookie,event.id)).status,404,
      'busy-only workspace visibility must not reveal/link the named meeting');
    assert.equal((await linkMeeting(owner.cookie,focusMade.payload.event.id)).status,404,
      'non-meeting Calendar events are not Page Meeting relations');
    assert.equal((await linkMeeting(owner.cookie,event.id)).status,200);
    assert.equal((await linkMeeting(owner.cookie,event.id)).status,409);

    let page=await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:owner.cookie});
    assert.deepEqual(page.payload.meetings.map(x=>x.id),[event.id]);
    assert.ok(page.payload.meetings.every(x=>!('participants' in x)&&!('description' in x)&&!('conversationId' in x)));

    // Admission to Calendar Authority makes the already-linked relation visible.
    const invited=await req(base,`/api/v1/calendar-events/${event.id}/participants`,{
      cookie:owner.cookie,method:'POST',body:{userId:colleague.session.userId},
    });
    assert.equal(invited.status,201);
    const colleaguePage=await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:colleague.cookie});
    assert.deepEqual(colleaguePage.payload.meetings.map(x=>x.id),[event.id]);

    // Create one canonical call inside a conversation and add a recording row.
    const room=await req(base,'/api/v1/conversations',{cookie:owner.cookie,method:'POST',body:{
      kind:'channel',title:'Recorded board '+marker,visibility:'workspace',
    }});
    assert.equal(room.status,201);
    const conversationId=room.payload.conversation.id;
    const callMade=await req(base,`/api/v1/conversations/${conversationId}/calls`,{
      cookie:owner.cookie,method:'POST',body:{mode:'video',title:'Recorded board '+marker,
        participantIds:[owner.session.userId,colleague.session.userId]},
    });
    assert.equal(callMade.status,201);
    const call=callMade.payload.call;

    const noRecording=await req(base,`/api/v1/wiki/pages/${pageId}/calls`,{
      cookie:owner.cookie,method:'POST',body:{callId:call.id},
    });
    assert.equal(noRecording.status,404,'a Call is not a Recorded Call before media exists');

    const secretTranscript='confidential-'+marker;
    await pool.query(
      `INSERT INTO call_recordings(
        organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,
        started_by,transcript_status,transcript,summary_status,ai_summary)
       VALUES($1,$2,$3,'livekit',$4,$5,'ready',$6,'ready',$7,'ready',$8)`,
      [owner.session.organizationId,owner.session.workspaceId,call.id,
        'rec-'+randomUUID(),'meeting/'+randomUUID()+'.mp4',owner.session.userId,
        secretTranscript,'private summary '+marker],
    );
    await pool.query(
      "UPDATE call_sessions SET recording_status='ready' WHERE workspace_id=$1 AND id=$2",
      [owner.session.workspaceId,call.id],
    );

    const linkedCall=await req(base,`/api/v1/wiki/pages/${pageId}/calls`,{
      cookie:owner.cookie,method:'POST',body:{callId:call.id},
    });
    assert.equal(linkedCall.status,200);
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/calls`,{
      cookie:owner.cookie,method:'POST',body:{callId:call.id},
    })).status,409);

    page=await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:owner.cookie});
    assert.deepEqual(page.payload.calls.map(x=>x.id),[call.id]);
    const serialized=JSON.stringify(page.payload.calls);
    assert.equal(serialized.includes(secretTranscript),false);
    assert.equal(serialized.includes('private summary'),false);
    assert.ok(page.payload.calls.every(x=>!('participants' in x)&&!('recordings' in x)&&!('transcript' in x)),
      'Page projection must not copy participants, recording objects or transcript');

    // Feature OFF hides projections without deleting relation rows; ON restores
    // the same canonical references.
    assert.equal((await req(base,'/api/v1/features/meetings',{
      cookie:owner.cookie,method:'PUT',body:{enabled:false},
    })).status,200);
    let switched=await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:owner.cookie});
    assert.deepEqual(switched.payload.calls,[]);
    assert.equal(Number((await pool.query(
      'SELECT count(*) n FROM wiki_page_calls WHERE workspace_id=$1 AND page_id=$2',
      [owner.session.workspaceId,pageId],
    )).rows[0].n),1);
    assert.equal((await req(base,'/api/v1/features/meetings',{
      cookie:owner.cookie,method:'PUT',body:{enabled:true},
    })).status,200);
    switched=await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:owner.cookie});
    assert.deepEqual(switched.payload.calls.map(x=>x.id),[call.id]);

    assert.equal((await req(base,'/api/v1/features/calendar',{
      cookie:owner.cookie,method:'PUT',body:{enabled:false},
    })).status,200);
    switched=await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:owner.cookie});
    assert.deepEqual(switched.payload.meetings,[]);
    assert.deepEqual(switched.payload.calls,[],
      'Meetings is a Calendar dependent and its Page projection must cascade off too');
    assert.equal((await req(base,'/api/v1/features/calendar',{
      cookie:owner.cookie,method:'PUT',body:{enabled:true},
    })).status,200);
    switched=await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:owner.cookie});
    assert.deepEqual(switched.payload.meetings.map(x=>x.id),[event.id]);
    assert.deepEqual(switched.payload.calls.map(x=>x.id),[call.id]);

    const foreignMeeting=await req(base,'/api/v1/calendar-events',{cookie:foreign.cookie,method:'POST',body:{
      kind:'meeting',title:'Foreign '+marker,
      startAt:new Date(Date.now()+18000000).toISOString(),
      endAt:new Date(Date.now()+21600000).toISOString(),
    }});
    assert.equal(foreignMeeting.status,201);
    assert.equal((await linkMeeting(owner.cookie,foreignMeeting.payload.event.id)).status,404);
    await assert.rejects(pool.query(
      `INSERT INTO wiki_page_calendar_meetings(
         organization_id,workspace_id,page_id,calendar_event_id,linked_by)
       VALUES($1,$2,$3,$4,$5)`,
      [owner.session.organizationId,owner.session.workspaceId,pageId,
        foreignMeeting.payload.event.id,owner.session.userId],
    ),{code:'23503'});

    // Removing a relation never deletes the canonical Call or its recording.
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/calls/${call.id}`,{
      cookie:owner.cookie,method:'DELETE',
    })).status,200);
    assert.equal((await req(base,`/api/v1/calls/${call.id}`,{cookie:owner.cookie})).status,200);
    assert.equal(Number((await pool.query(
      'SELECT count(*) n FROM call_recordings WHERE workspace_id=$1 AND call_id=$2',
      [owner.session.workspaceId,call.id],
    )).rows[0].n),1);

    // If media disappears later, Page must conceal the former Recorded Call
    // while still allowing the authorized relation to be cleaned up.
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/calls`,{
      cookie:owner.cookie,method:'POST',body:{callId:call.id},
    })).status,200);
    await pool.query('DELETE FROM call_recordings WHERE workspace_id=$1 AND call_id=$2',
      [owner.session.workspaceId,call.id]);
    assert.deepEqual((await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:owner.cookie})).payload.calls,[]);
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/calls/${call.id}`,{
      cookie:owner.cookie,method:'DELETE',
    })).status,200,'missing media must not strand an otherwise authorized relation');

    // Calendar cancellation deletes its canonical event; FK cascade removes only the Page relation.
    assert.equal((await req(base,`/api/v1/calendar-events/${event.id}`,{
      cookie:owner.cookie,method:'DELETE',
    })).status,204);
    page=await req(base,`/api/v1/wiki/pages/${pageId}`,{cookie:owner.cookie});
    assert.deepEqual(page.payload.meetings,[]);
    assert.equal(Number((await pool.query(
      'SELECT count(*) n FROM wiki_page_calendar_meetings WHERE workspace_id=$1 AND page_id=$2',
      [owner.session.workspaceId,pageId],
    )).rows[0].n),0);

    const audit=await pool.query(
      `SELECT event_type,payload FROM audit_events
        WHERE workspace_id=$1 AND aggregate_type='wiki_page' AND aggregate_id=$2`,
      [owner.session.workspaceId,pageId],
    );
    assert.equal(audit.rows.filter(x=>x.event_type==='wiki.meeting_linked').length,1);
    assert.equal(audit.rows.filter(x=>x.event_type==='wiki.call_linked').length,2);
    assert.equal(audit.rows.filter(x=>x.event_type==='wiki.call_unlinked').length,2);
    assert.ok(audit.rows.every(x=>!JSON.stringify(x.payload).includes(marker)),
      'relation audit stores canonical IDs only, not meeting/transcript text');

    const archived=await req(base,`/api/v1/wiki/pages/${pageId}`,{
      cookie:owner.cookie,method:'DELETE',
    });
    assert.equal(archived.status,200);
    assert.equal((await req(base,`/api/v1/wiki/pages/${pageId}/calls`,{
      cookie:owner.cookie,method:'POST',body:{callId:call.id},
    })).status,404,'archived Page must reject new recorded-call links before target metadata matters');
  });
