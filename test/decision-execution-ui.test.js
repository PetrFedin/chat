import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {createChatServer} from '../src/server.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

test('Decision Execution UI has linked canonical Task navigation and visibility-safe fallbacks',()=>{
  assert.ok(source.includes('data-decision-execution'));
  assert.ok(source.includes('data-decision-task-open'));
  assert.ok(source.includes('data-decision-visible-progress'));
  assert.ok(source.includes('data-decision-open'));
  assert.ok(source.includes("$$('[data-decision-task-open]').forEach"));
  assert.ok(source.includes("$$('[data-decision-open]').forEach"));
  assert.ok(source.includes('openTask(taskId)'));
  assert.ok(source.includes('linkedTasks===null'));
  assert.ok(source.includes('tasksPanel'));
});

test('Decision register opens linked canonical Task on 390px and hides projection with feature OFF',
  {skip:!databaseUrl,timeout:120000},async t=>{
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
    await page.locator('#register-form [name="companyName"]').fill('Decision Execution '+marker);
    await page.locator('#register-form [name="ownerName"]').fill('Owner');
    await page.locator('#register-form [name="email"]').fill('execution-'+marker+'@example.test');
    await page.locator('#register-form [name="password"]').fill('DecisionExecutionPassword42');
    await page.locator('#register-form button[type="submit"]').click();
    await page.locator('#app-view').waitFor({state:'visible'});

    const meetingMade=await page.request.post(base+'/api/v1/calendar-events',{data:{
      kind:'meeting',title:'Execution review '+marker,
      startAt:new Date(Date.now()-3600000).toISOString(),
      endAt:new Date(Date.now()+3600000).toISOString(),
    }});
    assert.equal(meetingMade.status(),201);
    const event=(await meetingMade.json()).event;
    const decisionTitle='Ship milestone '+marker;
    const notes=await page.request.put(base+'/api/v1/calendar-events/'+event.id+'/notes',{data:{
      title:'Execution review '+marker,decisions:[decisionTitle],actionItems:[],
    }});
    assert.equal(notes.status(),200);
    const register=await page.request.get(base+'/api/v1/meetings/decisions?q='+marker);
    assert.equal(register.status(),200);
    const decision=(await register.json()).items.find(item=>item.title===decisionTitle);
    assert.ok(decision);

    const taskTitle='Prove delivery '+marker;
    const made=await page.request.post(base+'/api/v1/tasks',{data:{title:taskTitle,outcome:'Accepted deliverable'}});
    assert.equal(made.status(),201);
    const task=(await made.json()).task;
    const taskLinked=await page.request.post(base+'/api/v1/meetings/decisions/'+decision.id+'/tasks',{
      data:{taskId:task.id,reason:'Decision implementation'},
    });
    assert.equal(taskLinked.status(),200);
    assert.deepEqual((await taskLinked.json()).items.map(x=>x.id),[task.id]);

    await page.locator('[data-nav="more"]:visible').click();
    await page.locator('[data-action="decisions"]').click();
    await page.locator('[data-decision-open="'+decision.id+'"]').click();
    await page.locator('[data-decision-execution]').waitFor({state:'visible'});
    assert.equal((await page.locator('[data-decision-visible-progress]').textContent()).trim(),'0 / 1');
    const taskLink=page.locator('[data-decision-task-open="'+task.id+'"]');
    await taskLink.waitFor({state:'visible'});
    assert.match(await taskLink.textContent(),new RegExp(taskTitle));
    await taskLink.click();
    await page.locator('#task-evidence-form').waitFor({state:'visible'});
    assert.equal((await page.request.get(base+'/api/v1/tasks/'+task.id)).status(),200,
      'execution view must navigate to the canonical task');

    const disabled=await page.request.put(base+'/api/v1/features/tasks',{data:{enabled:false}});
    assert.equal(disabled.status(),200);
    await page.evaluate(id=>window.ChatApp.openDecision(id),decision.id);
    await page.getByRole('heading',{name:decisionTitle}).last().waitFor({state:'visible'});
    assert.equal(await page.locator('[data-decision-execution]').count(),0,
      'feature OFF must hide the relation projection, not reveal hidden metadata');
    assert.deepEqual(errors,[]);
  });
