import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';
import { PostgresStore } from '../src/persistence/store.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

test('Project browser flow: create -> file -> milestone -> task -> board -> canonical task',{skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const store=new PostgresStore(pool);
  const app=await createChatServer({store,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;

  // Keep the milestone on the exact UTC day the Calendar initially opens.
  // The previous "Thursday" fixture jumped to next week once CI crossed into
  // Friday, while Calendar correctly stayed on the current week.
  const today=new Date();today.setUTCHours(0,0,0,0);
  const projectStart=today.toISOString().slice(0,10);
  const projectTarget=new Date(today);projectTarget.setUTCDate(projectTarget.getUTCDate()+45);
  const milestoneInput=new Date(Date.UTC(
    today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate(),12,0
  )).toISOString().slice(0,16);

  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'UTC'});
  t.after(()=>context.close());
  const page=await context.newPage();
  const pageErrors=[],consoleErrors=[],serverErrors=[];
  page.on('pageerror',error=>pageErrors.push(String(error)));
  page.on('console',msg=>{if(msg.type()==='error'&&!/^Failed to load resource/.test(msg.text()))consoleErrors.push(msg.text())});
  page.on('response',response=>{if(response.status()>=500&&response.url().includes('/api/'))serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`)});

  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('[data-auth-mode="register"]').click();
  const suffix=randomUUID().slice(0,8);
  await page.locator('#register-form [name="companyName"]').fill(`Project E2E ${suffix}`);
  await page.locator('#register-form [name="ownerName"]').fill('Project Owner');
  await page.locator('#register-form [name="email"]').fill(`project-e2e-${suffix}@test.invalid`);
  await page.locator('#register-form [name="password"]').fill('ProjectE2EPassword42');
  await page.locator('#register-form button[type="submit"]').click();
  await page.locator('#app-view').waitFor({state:'visible',timeout:10000});

  await page.locator('#desktop-nav [data-nav="projects"]').waitFor({state:'visible',timeout:5000});
  await page.locator('#desktop-nav [data-nav="projects"]').click();
  await page.locator('[data-project-new]').waitFor({state:'visible'});

  await page.locator('[data-project-new]').click();
  await page.locator('#project-form [name="name"]').fill('Investor Readiness');
  await page.locator('#project-form [name="goal"]').fill('Prove the complete corporate execution loop');
  await page.locator('#project-form [name="startAt"]').fill(projectStart);
  await page.locator('#project-form [name="targetAt"]').fill(projectTarget.toISOString().slice(0,10));
  await page.locator('#project-form button[type="submit"]').click();

  await page.locator('.project-home h2').filter({hasText:'Investor Readiness'}).waitFor({state:'visible',timeout:10000});
  assert.match(page.url(),/#\/projects\/[0-9a-f-]{36}/i);
  await page.locator('.project-progress-track').waitFor({state:'visible'});
  await page.locator('[data-project-column="planned"]').waitFor({state:'visible'});

  // Project Files is a relation surface: upload creates a canonical file first,
  // then Project links it. Opening the row must still go through /api/v1/files.
  await page.locator('[data-project-file-new]').click();
  await page.locator('#project-file-form').waitFor({state:'visible',timeout:5000});
  await page.locator('#project-file-form [name="upload"]').setInputFiles({
    name:'investor-brief.txt',
    mimeType:'text/plain',
    buffer:Buffer.from('Project file authority browser proof'),
  });
  await page.locator('#project-file-form button[type="submit"]').click();

  const fileRow=page.locator('[data-project-file-row]').filter({hasText:'investor-brief.txt'});
  await fileRow.waitFor({state:'visible',timeout:10000});
  const fileHref=await fileRow.locator('[data-project-file-open]').getAttribute('href');
  assert.match(fileHref,/^\/api\/v1\/files\/[0-9a-f-]{36}\/(preview|content)$/i,
    'Project must open the canonical File Authority route');
  const opened=await context.request.get(new URL(fileHref,base).href);
  assert.equal(opened.status(),200,'project-linked canonical file must open in the browser session');

  await page.locator('[data-project-milestone-new]').click();
  await page.locator('#project-milestone-form [name="title"]').fill('Golden path accepted');
  await page.locator('#project-milestone-form [name="targetAt"]').fill(milestoneInput);
  await page.locator('#project-milestone-form button[type="submit"]').click();
  await page.locator('.project-grid').getByText('Golden path accepted',{exact:true}).waitFor({state:'visible',timeout:5000});

  await page.locator('[data-project-task-new]').click();
  await page.locator('#project-task-form [name="title"]').fill('Prepare investor walkthrough');
  await page.locator('#project-task-form [name="outcome"]').fill('Walkthrough accepted');
  await page.locator('#project-task-form [name="priority"]').selectOption('high');
  await page.locator('#project-task-form button[type="submit"]').click();

  const card=page.locator('[data-project-column="planned"] .project-kanban-card').filter({hasText:'Prepare investor walkthrough'});
  await card.waitFor({state:'visible',timeout:10000});
  await card.locator('[data-task-open]').click();
  await page.locator('#modal-heading').waitFor({state:'visible',timeout:5000});
  assert.match(await page.locator('#modal-heading').textContent(),/Prepare investor walkthrough/);
  await page.locator('[data-close]').first().click();

  await page.locator('#desktop-nav [data-nav="calendar"]').click();
  const projectFilter=page.locator('[data-calendar-project-filter]');
  await projectFilter.waitFor({state:'visible',timeout:5000});
  await projectFilter.selectOption({label:'Investor Readiness'});
  const milestoneRow=page.locator('.calendar-event.layer.milestone').filter({hasText:'Golden path accepted'});
  await milestoneRow.waitFor({state:'visible',timeout:10000});
  assert.match(await milestoneRow.textContent(),/Investor Readiness/);
  assert.equal(await milestoneRow.locator('button').count(),0,'milestone projection must remain read-only in Calendar');

  assert.deepEqual(pageErrors,[],`page errors: ${pageErrors.join(' | ')}`);
  assert.deepEqual(consoleErrors,[],`console errors: ${consoleErrors.join(' | ')}`);
  assert.deepEqual(serverErrors,[],`API 5xx: ${serverErrors.join(' | ')}`);
});

test('Projects navigation stays adaptive: tablet work rail, phone More entry',{skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const store=new PostgresStore(pool);
  const app=await createChatServer({store,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const browser=await chromium.launch();
  t.after(()=>browser.close());

  async function register(viewport,label){
    const context=await browser.newContext({viewport,...(label==='phone'?{isMobile:true,hasTouch:true,deviceScaleFactor:3}:{hasTouch:true,deviceScaleFactor:2})});
    const page=await context.newPage();
    await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.locator('[data-auth-mode="register"]').click();
    const suffix=randomUUID().slice(0,8);
    await page.locator('#register-form [name="companyName"]').fill(`Project Nav ${label} ${suffix}`);
    await page.locator('#register-form [name="ownerName"]').fill('Owner');
    await page.locator('#register-form [name="email"]').fill(`project-nav-${label}-${suffix}@test.invalid`);
    await page.locator('#register-form [name="password"]').fill('ProjectNavPassword42');
    await page.locator('#register-form button[type="submit"]').click();
    await page.locator('#app-view').waitFor({state:'visible',timeout:10000});
    return{context,page};
  }

  const tablet=await register({width:834,height:1112},'tablet');
  assert.equal(await tablet.page.locator('.sidebar').evaluate(n=>getComputedStyle(n).display!=='none'),true);
  await tablet.page.locator('#desktop-nav [data-nav="projects"]').waitFor({state:'visible'});
  assert.equal(await tablet.page.locator('#mobile-nav').evaluate(n=>getComputedStyle(n).display!=='none'),false);
  await tablet.context.close();

  const phone=await register({width:390,height:844},'phone');
  assert.equal(await phone.page.locator('.sidebar').evaluate(n=>getComputedStyle(n).display!=='none'),false);
  assert.equal(await phone.page.locator('#mobile-nav [data-nav="projects"]').count(),0);
  await phone.page.locator('#mobile-nav [data-nav="more"]').click();
  await phone.page.locator('[data-action="projects"]').waitFor({state:'visible'});
  await phone.page.locator('[data-action="projects"]').click();
  await phone.page.locator('[data-project-new]').waitFor({state:'visible'});
  await phone.context.close();
});
