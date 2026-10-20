import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {createChatServer} from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

test('Decision cockpit opens from More, filters and drills down to canonical Task at 390px',
  {skip:!databaseUrl,timeout:120000},async t=>{
    const app=await createChatServer({databaseUrl,startMeetingWorker:false});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    t.after(()=>app.close());
    const base='http://127.0.0.1:'+app.server.address().port;
    const browser=await chromium.launch();
    t.after(()=>browser.close());
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(base);
    await page.locator('[data-auth-mode="register"]').click();
    const marker=randomUUID().slice(0,8);
    await page.locator('#register-form [name="companyName"]').fill('Decision Board '+marker);
    await page.locator('#register-form [name="ownerName"]').fill('Owner');
    await page.locator('#register-form [name="email"]').fill('decision-board-'+marker+'@example.test');
    await page.locator('#register-form [name="password"]').fill('DecisionBoardPassword42');
    await page.locator('#register-form button[type="submit"]').click();
    await page.locator('#app-view').waitFor({state:'visible'});

    const event=await page.request.post(base+'/api/v1/calendar-events',{data:{
      kind:'meeting',title:'Executive review '+marker,
      startAt:new Date(Date.now()-3600000).toISOString(),
      endAt:new Date(Date.now()+3600000).toISOString(),
    }});
    assert.equal(event.status(),201);
    const meeting=(await event.json()).event;
    const title='Approve delivery '+marker;
    const notes=await page.request.put(base+'/api/v1/calendar-events/'+meeting.id+'/notes',{data:{
      title:'Executive review '+marker,decisions:[title],actionItems:[],
    }});
    assert.equal(notes.status(),200);
    const listed=await page.request.get(base+'/api/v1/meetings/decisions?q='+marker);
    assert.equal(listed.status(),200);
    const decision=(await listed.json()).items.find(x=>x.title===title);
    assert.ok(decision);

    const task=await page.request.post(base+'/api/v1/tasks',{data:{
      title:'Complete evidence '+marker,outcome:'Reviewed delivery package',
    }});
    assert.equal(task.status(),201);
    const taskId=(await task.json()).task.id;
    const linked=await page.request.post(base+'/api/v1/meetings/decisions/'+decision.id+'/tasks',{data:{
      taskId,reason:'Accepted decision delivery',
    }});
    assert.equal(linked.status(),200);

    await page.locator('[data-nav="more"]:visible').click();
    await page.locator('[data-action="decision-execution"]').click();
    await page.locator('[data-decision-cockpit]').waitFor({state:'visible'});
    const search=page.locator('#decision-execution-search [name="q"]');
    await search.fill(marker);
    await search.press('Enter');
    await page.locator('[data-decision-cockpit-row="'+decision.id+'"]').waitFor({state:'visible'});
    const card=page.locator('[data-decision-cockpit-row="'+decision.id+'"]');
    assert.match(await card.textContent(),new RegExp(title));
    assert.match(await card.textContent(),/Видимые задачи: 1|Visible tasks: 1/);
    assert.match(await page.locator('[data-decision-cockpit-metrics]').textContent(),
      /Решений в выборке: 1|Decisions on this page: 1/);
    await card.locator('[data-decision-cockpit-open]').click();
    await page.locator('[data-decision-execution]').waitFor({state:'visible'});
    const target=page.locator('[data-decision-task-open="'+taskId+'"]');
    await target.waitFor({state:'visible'});
    await target.click();
    await page.locator('#task-evidence-form').waitFor({state:'visible'});
    assert.equal((await page.request.get(base+'/api/v1/tasks/'+taskId)).status(),200);
    assert.deepEqual(errors,[]);
  });
