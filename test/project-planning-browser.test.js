import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
test('Project Gantt browser: phases, task schedule, dependencies and 390px reload',
  {skip:!databaseUrl,timeout:120000},async t=>{
    const app=await createChatServer({databaseUrl,startMeetingWorker:false});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    t.after(()=>app.close());
    const base='http://127.0.0.1:'+app.server.address().port;
    const browser=await chromium.launch();
    t.after(()=>browser.close());
    const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'UTC'});
    t.after(()=>context.close());
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(base);
    await page.locator('[data-auth-mode="register"]').click();
    const suffix=randomUUID().slice(0,8);
    await page.locator('#register-form [name="companyName"]').fill('Gantt browser '+suffix);
    await page.locator('#register-form [name="ownerName"]').fill('Owner');
    await page.locator('#register-form [name="email"]').fill('gantt-'+suffix+'@example.test');
    await page.locator('#register-form [name="password"]').fill('PlanningBrowserPassword42');
    await page.locator('#register-form button[type="submit"]').click();
    await page.locator('#app-view').waitFor({state:'visible'});
    const api=page.request;
    const created=await api.post(base+'/api/v1/projects',{data:{
      name:'Product launch',goal:'Ship reliable product',visibility:'members',
      startAt:'2026-11-01',targetAt:'2026-12-31',
    }});
    assert.equal(created.status(),201);
    const projectId=(await created.json()).project.id;
    async function task(title){
      const made=await api.post(base+'/api/v1/projects/'+projectId+'/tasks',{data:{
        title,outcome:'Result accepted',
      }});
      assert.equal(made.status(),201);
      return (await made.json()).task;
    }
    const design=await task('Product design');
    const delivery=await task('Release candidate');
    await page.locator('#desktop-nav [data-nav="projects"]').click();
    await page.locator('[data-project-open="'+projectId+'"]').click();
    await page.locator('.project-roadmap-section').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-project-plan-task]').count(),2);

    await page.locator('[data-project-plan-new-phase]').click();
    await page.locator('#project-plan-phase-form [name="title"]').fill('Build');
    await page.locator('#project-plan-phase-form [name="startAt"]').fill('2026-11-01');
    await page.locator('#project-plan-phase-form [name="endAt"]').fill('2026-12-15');
    await page.locator('#project-plan-phase-form [type="submit"]').click();
    await page.locator('.project-roadmap-phase').filter({hasText:'Build'}).waitFor({state:'visible'});
    const plan=await api.get(base+'/api/v1/projects/'+projectId+'/plan');
    assert.equal(plan.status(),200);
    const phase=(await plan.json()).plan.phases[0];

    await page.locator('[data-project-plan-task="'+design.id+'"]').click();
    await page.locator('#project-plan-task-form [name="phaseId"]').selectOption(phase.id);
    await page.locator('#project-plan-task-form [name="plannedStart"]').fill('2026-11-03');
    await page.locator('#project-plan-task-form [name="plannedEnd"]').fill('2026-11-20');
    await page.locator('#project-plan-task-form [name="estimateMinutes"]').fill('600');
    await page.locator('#project-plan-task-form [type="submit"]').click();
    await page.locator('.project-roadmap-task').filter({hasText:'Product design'}).waitFor({state:'visible'});

    await page.locator('[data-project-plan-task="'+delivery.id+'"]').click();
    await page.locator('#project-plan-task-form [name="plannedStart"]').fill('2026-11-22');
    await page.locator('#project-plan-task-form [name="plannedEnd"]').fill('2026-12-05');
    await page.locator('#project-plan-task-form [type="submit"]').click();
    await page.locator('.project-roadmap-task').filter({hasText:'Release candidate'}).waitFor({state:'visible'});

    await page.locator('[data-project-plan-dependency]').click();
    await page.locator('#project-plan-dep-form [name="predecessorTaskId"]').selectOption(design.id);
    await page.locator('#project-plan-dep-form [name="successorTaskId"]').selectOption(delivery.id);
    await page.locator('#project-plan-dep-form [type="submit"]').click();
    await page.locator('.project-roadmap-dep').waitFor({state:'visible'});
    const beforeReload=(await (await api.get(base+'/api/v1/projects/'+projectId+'/plan')).json()).plan;
    assert.equal(beforeReload.schedules.length,2);
    assert.equal(beforeReload.dependencies.length,1);
    assert.equal(beforeReload.violations.length,0);

    await page.reload();
    await page.locator('.project-roadmap-dep').waitFor({state:'visible'});
    assert.ok(await page.locator('.project-roadmap-bar-task').count()>=2);
    // Geometric audit: an 18-day task must occupy its proportional duration,
    // not 3 complete week cells or an entire month cell.
    const width=async()=>page.locator(
      '[data-project-roadmap-row="'+design.id+'"] .project-roadmap-bar-task'
    ).evaluate(element=>element.getBoundingClientRect().width);
    const zoom=page.locator('[data-project-roadmap-scale]');
    await zoom.selectOption('week');
    const weekWidth=await width();
    assert.ok(weekWidth>110&&weekWidth<130,
      '18 calendar days should occupy ~119 CSS px on a 48px/week scale, got '+weekWidth);
    await zoom.selectOption('month');
    const monthWidth=await width();
    assert.ok(monthWidth>25&&monthWidth<40,
      '18 November days should occupy ~32 CSS px on a 60px/month scale, got '+monthWidth);
    await zoom.selectOption('day');
    const dayWidth=await width();
    assert.ok(dayWidth>560&&dayWidth<585,
      '18 calendar days should occupy ~572 CSS px on a 32px/day scale, got '+dayWidth);
    assert.equal(await page.locator('[data-project-roadmap-scale]').inputValue(),'day');
    assert.equal(await page.locator('.project-roadmap-task.critical-path').count()>0,true,
      'critical work should be highlighted without creating duplicate Task statuses');
    assert.equal((await (await api.get(base+'/api/v1/projects/'+projectId+'/plan')).json())
      .plan.schedules.length,2,'zoom must not write to the plan');

    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('.project-roadmap-scroll').evaluate(
      el=>el.scrollWidth>el.clientWidth),true,
      'timeline must scroll horizontally on phone');
    await page.locator('[data-project-roadmap-scale]').selectOption('week');
    assert.equal(await page.locator('.project-roadmap-scroll').evaluate(
      el=>el.scrollWidth>el.clientWidth),true,
      'changing zoom must retain the touch-scrolling region');
    assert.equal(await page.locator('[data-project-roadmap-scale]').inputValue(),'week');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),
      true,'timeline must not overflow the entire 390px page');
    assert.deepEqual(errors,[]);
  });
