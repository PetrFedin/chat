import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

test('Page to accepted Decision picker, source detail and unlink on 390px viewport',
  {skip:!databaseUrl},async t=>{
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
  await page.locator('#register-form [name="companyName"]').fill('Wiki Board '+marker);
  await page.locator('#register-form [name="ownerName"]').fill('Owner');
  await page.locator('#register-form [name="email"]').fill('wiki-board-'+marker+'@example.test');
  await page.locator('#register-form [name="password"]').fill('WikiBoardBrowserPassword42');
  await page.locator('#register-form button[type="submit"]').click();
  await page.locator('#app-view').waitFor({state:'visible'});

  const eventCreated=await page.request.post(base+'/api/v1/calendar-events',{data:{
    kind:'meeting',title:'Review '+marker,
    startAt:new Date(Date.now()-3600000).toISOString(),
    endAt:new Date(Date.now()+3600000).toISOString(),
  }});
  assert.equal(eventCreated.status(),201);
  const event=(await eventCreated.json()).event;
  const title='Approve project '+marker;
  const notes=await page.request.put(base+'/api/v1/calendar-events/'+event.id+'/notes',{data:{
    title:'Review '+marker,decisions:[title],actionItems:[],
  }});
  assert.equal(notes.status(),200);
  const decisions=await page.request.get(base+'/api/v1/meetings/decisions?q='+marker);
  assert.equal(decisions.status(),200);
  const decision=(await decisions.json()).items.find(x=>x.title===title);
  assert.ok(decision);

  const pageCreated=await page.request.post(base+'/api/v1/wiki/pages',{data:{
    title:'Meeting brief '+marker,content:'Board documentation',
  }});
  assert.equal(pageCreated.status(),201);
  const wiki=await pageCreated.json();
  await page.locator('[data-nav="more"]:visible').click();
  await page.locator('[data-action="wiki"]').click();
  await page.locator('[data-wiki-open="'+wiki.id+'"]').click();
  await page.locator('[data-wiki-decision-new]').waitFor({state:'visible'});
  await page.locator('[data-wiki-decision-new]').click();
  await page.locator('[data-wiki-decision-filter]').fill(marker);
  await page.locator('[data-wiki-decision-select="'+decision.id+'"]').click();
  const linked=page.locator('[data-wiki-decision-row="'+decision.id+'"]');
  await linked.waitFor({state:'visible'});
  assert.match(await linked.textContent(),new RegExp(title));

  await linked.locator('[data-wiki-decision-open]').click();
  await page.getByRole('heading',{name:title}).waitFor({state:'visible'});
  assert.equal((await page.request.get(base+'/api/v1/meetings/decisions/'+decision.id)).status(),200);

  await page.keyboard.press('Escape');
  // The canonical Page projection remains stable after opening Decision detail.
  const persisted=await page.request.get(base+'/api/v1/wiki/pages/'+wiki.id);
  assert.equal(persisted.status(),200);
  assert.deepEqual((await persisted.json()).decisions.map(x=>x.id),[decision.id]);
  // Reopen Wiki from its menu to avoid relying on modal history timing.
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#app-view').waitFor({state:'visible'});
  await page.locator('[data-nav="more"]:visible').click();
  await page.locator('[data-action="wiki"]').click();
  await page.locator('[data-wiki-open="'+wiki.id+'"]').click();
  const afterReload=page.locator('[data-wiki-decision-row="'+decision.id+'"]');
  await afterReload.waitFor({state:'visible'});
  await afterReload.locator('[data-wiki-decision-remove]').click();
  await afterReload.waitFor({state:'detached'});
  const unlinked=await page.request.get(base+'/api/v1/wiki/pages/'+wiki.id);
  assert.equal(unlinked.status(),200);
  assert.deepEqual((await unlinked.json()).decisions,[]);
  assert.equal((await page.request.get(base+'/api/v1/meetings/decisions/'+decision.id)).status(),200);
  assert.deepEqual(errors,[]);
});
