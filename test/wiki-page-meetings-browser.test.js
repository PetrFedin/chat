import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

test('Page Meeting pickers link canonical Calendar meeting and recorded Call on 390px',
  {skip:!databaseUrl,timeout:90000},async t=>{
  const app=await createChatServer({databaseUrl,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(base);
  await page.locator('[data-auth-mode="register"]').click();
  const marker=randomUUID().slice(0,8);
  await page.locator('#register-form [name="companyName"]').fill('Meeting Pages '+marker);
  await page.locator('#register-form [name="ownerName"]').fill('Owner');
  await page.locator('#register-form [name="email"]').fill('meeting-pages-'+marker+'@example.test');
  await page.locator('#register-form [name="password"]').fill('MeetingPagesBrowserPassword42');
  await page.locator('#register-form button[type="submit"]').click();
  await page.locator('#app-view').waitFor({state:'visible'});

  const boot=await page.request.get(base+'/api/v1/bootstrap');
  assert.equal(boot.status(),200);
  const session=(await boot.json()).session;

  const meetingMade=await page.request.post(base+'/api/v1/calendar-events',{data:{
    kind:'meeting',title:'Planning '+marker,
    startAt:new Date(Date.now()+3600000).toISOString(),
    endAt:new Date(Date.now()+7200000).toISOString(),
    visibility:'participants',
  }});
  assert.equal(meetingMade.status(),201);
  const meeting=(await meetingMade.json()).event;

  const ownerCookie=(await page.context().cookies()).map(item=>`${item.name}=${item.value}`).join('; ');
  const inviteResponse=await fetch(base+'/api/v1/invitations',{
    method:'POST',headers:{cookie:ownerCookie,'content-type':'application/json'},
    body:JSON.stringify({email:'meeting-browser-member-'+marker+'@example.test',role:'member'}),
  });
  assert.equal(inviteResponse.status,201);
  const invitePayload=await inviteResponse.json();
  const token=new URL(invitePayload.invitation.inviteUrl).searchParams.get('invite');
  const acceptedResponse=await fetch(base+'/api/v1/invitations/accept',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({token,displayName:'Member',password:'MeetingPagesBrowserPassword42'}),
  });
  assert.equal(acceptedResponse.status,201);
  const memberCookie=acceptedResponse.headers.get('set-cookie')?.split(';')[0];
  const memberBoot=await fetch(base+'/api/v1/bootstrap',{headers:{cookie:memberCookie}});
  assert.equal(memberBoot.status,200);
  const memberId=(await memberBoot.json()).session.userId;

  const roomMade=await page.request.post(base+'/api/v1/conversations',{data:{
    kind:'channel',title:'Recorded room '+marker,visibility:'workspace',
  }});
  assert.equal(roomMade.status(),201);
  const room=(await roomMade.json()).conversation;
  const callMade=await page.request.post(base+`/api/v1/conversations/${room.id}/calls`,{data:{
    mode:'video',title:'Recorded review '+marker,participantIds:[session.userId,memberId],
  }});
  assert.equal(callMade.status(),201);
  const call=(await callMade.json()).call;

  await app.store.pool.query(
    `INSERT INTO call_recordings(
      organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,
      started_by,transcript_status,transcript,summary_status,ai_summary)
     VALUES($1,$2,$3,'livekit',$4,$5,'ready',$6,'ready',$7,'ready',$8)`,
    [session.organizationId,session.workspaceId,call.id,'browser-'+randomUUID(),
      'browser/'+randomUUID()+'.mp4',session.userId,'private transcript '+marker,'private summary '+marker],
  );
  await app.store.pool.query(
    "UPDATE call_sessions SET recording_status='ready' WHERE workspace_id=$1 AND id=$2",
    [session.workspaceId,call.id],
  );

  const pageMade=await page.request.post(base+'/api/v1/wiki/pages',{data:{
    title:'Meeting evidence '+marker,content:'Canonical relations only',
  }});
  assert.equal(pageMade.status(),201);
  const wiki=await pageMade.json();

  await page.evaluate(id=>window.ChatApp.openWikiPage(id),wiki.id);
  await page.locator('[data-wiki-meeting-new]').waitFor({state:'visible'});

  await page.locator('[data-wiki-meeting-new]').click();
  await page.locator('[data-wiki-meeting-filter]').fill(marker);
  await page.locator(`[data-wiki-meeting-select="${meeting.id}"]`).click();
  const meetingRow=page.locator(`[data-wiki-meeting-row="${meeting.id}"]`);
  await meetingRow.waitFor({state:'visible'});
  assert.match(await meetingRow.textContent(),new RegExp('Planning '+marker));

  // Existing Calendar surface remains the destination of the Page relation.
  await meetingRow.locator('[data-wiki-meeting-open]').click();
  await page.waitForTimeout(50);
  assert.equal((await page.request.get(base+`/api/v1/calendar-events/${meeting.id}`)).status(),200);
  await page.evaluate(id=>window.ChatApp.openWikiPage(id),wiki.id);
  await page.locator(`[data-wiki-meeting-row="${meeting.id}"]`).waitFor({state:'visible'});

  await page.locator('[data-wiki-call-new]').click();
  await page.locator('[data-wiki-call-filter]').fill(marker);
  await page.locator(`[data-wiki-call-select="${call.id}"]`).click();
  const callRow=page.locator(`[data-wiki-call-row="${call.id}"]`);
  await callRow.waitFor({state:'visible'});
  assert.match(await callRow.textContent(),new RegExp('Recorded review '+marker));

  const persisted=await page.request.get(base+`/api/v1/wiki/pages/${wiki.id}`);
  assert.equal(persisted.status(),200);
  const projection=await persisted.json();
  assert.deepEqual(projection.meetings.map(x=>x.id),[meeting.id]);
  assert.deepEqual(projection.calls.map(x=>x.id),[call.id]);
  assert.equal(JSON.stringify(projection).includes('private transcript'),false);
  assert.equal(JSON.stringify(projection).includes('private summary'),false);

  // The Call button points to the existing Call surface, not a copied Page view.
  await callRow.locator('[data-wiki-call-open]').click();
  await page.waitForFunction(id=>location.hash===`#/calls/${id}`,call.id);
  await page.evaluate(id=>window.ChatApp.openWikiPage(id),wiki.id);
  const restoredCall=page.locator(`[data-wiki-call-row="${call.id}"]`);
  await restoredCall.waitFor({state:'visible'});
  await restoredCall.locator('[data-wiki-call-remove]').click();
  await restoredCall.waitFor({state:'detached'});

  const restoredMeeting=page.locator(`[data-wiki-meeting-row="${meeting.id}"]`);
  await restoredMeeting.locator('[data-wiki-meeting-remove]').click();
  await restoredMeeting.waitFor({state:'detached'});
  const empty=await page.request.get(base+`/api/v1/wiki/pages/${wiki.id}`);
  const after=await empty.json();
  assert.deepEqual(after.meetings,[]);
  assert.deepEqual(after.calls,[]);
  assert.equal((await page.request.get(base+`/api/v1/calls/${call.id}`)).status(),200,
    'unlink must not delete the canonical Call');
  assert.deepEqual(errors,[]);
});
