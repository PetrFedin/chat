import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';
import { LocalObjectStore } from '../src/storage/object-store.js';
import { PostgresStore } from '../src/persistence/store.js';
import { hashPassword } from '../src/security.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

async function request(base,path,{cookie,method='GET'}={}){
  const response=await fetch(`${base}${path}`,{method,headers:cookie?{cookie}:{}});
  const payload=await response.json().catch(()=>null);
  return{response,payload,cookie:response.headers.get('set-cookie')?.split(';')[0]??null};
}

async function startDemo(objectStore){
  const app=await createChatServer({
    databaseUrl,
    demoEnabled:true,
    objectStore,
    meetingWorkerEnabled:false,
    startMeetingWorker:false,
  });
  await new Promise((resolve)=>app.server.listen(0,'127.0.0.1',resolve));
  return{app,base:`http://127.0.0.1:${app.server.address().port}`};
}

async function demoCounts(pool,workspaceId){
  const queries=await Promise.all([
    pool.query('SELECT count(*)::int n FROM memberships WHERE workspace_id=$1',[workspaceId]),
    pool.query('SELECT count(*)::int n FROM commitments WHERE workspace_id=$1',[workspaceId]),
    pool.query('SELECT count(*)::int n FROM calendar_events WHERE workspace_id=$1',[workspaceId]),
    pool.query(`SELECT count(*)::int n FROM meeting_intelligence_runs
      WHERE workspace_id=$1 AND status='review_ready'
        AND (summary_json->>'syntheticDemo'='true' OR transcript_provider LIKE 'demo-fixture%' OR summary_provider LIKE 'demo-fixture%')`,[workspaceId]),
    pool.query(`SELECT count(*)::int n FROM files WHERE workspace_id=$1 AND name=ANY($2::text[])`,
      [workspaceId,['mobile-call-review.svg','release-checklist.md','launch-metrics.csv']]),
    pool.query("SELECT count(*)::int n FROM projects WHERE workspace_id=$1 AND name='Mobile Launch · Northstar Studio (demo)'",[workspaceId]),
    pool.query("SELECT count(*)::int n FROM project_tasks pt JOIN projects p ON p.id=pt.project_id WHERE p.workspace_id=$1 AND p.name='Mobile Launch · Northstar Studio (demo)'",[workspaceId]),
    pool.query("SELECT count(*)::int n FROM project_milestones m JOIN projects p ON p.id=m.project_id WHERE p.workspace_id=$1 AND p.name='Mobile Launch · Northstar Studio (demo)'",[workspaceId]),
    pool.query("SELECT count(*)::int n FROM project_discussions d JOIN projects p ON p.id=d.project_id WHERE p.workspace_id=$1 AND p.name='Mobile Launch · Northstar Studio (demo)'",[workspaceId]),
  ]);
  return{
    members:queries[0].rows[0].n,
    tasks:queries[1].rows[0].n,
    calendar:queries[2].rows[0].n,
    syntheticMeetings:queries[3].rows[0].n,
    demoFiles:queries[4].rows[0].n,
    investorProjects:queries[5].rows[0].n,
    investorProjectTasks:queries[6].rows[0].n,
    investorMilestones:queries[7].rows[0].n,
    investorDiscussions:queries[8].rows[0].n,
  };
}

test('Postgres preview demo survives restart without duplication and rehydrates local fixtures',{skip:!databaseUrl},async(t)=>{
  const root=await mkdtemp(join(tmpdir(),'chat-persistent-demo-'));
  const objectStore=new LocalObjectStore(root);
  const probe=new pg.Pool({connectionString:databaseUrl});
  let firstApp=null,secondApp=null;

  // Демонстрационное пространство заводится под одной и той же почтой, а
  // тестовая база живёт между прогонами. Убираем прошлый прогон целиком —
  // так же чисто, как на пустой базе в CI.
  // Demo project relations have restrictive composite FK to memberships:
  // delete their aggregate first so cleanup of a previously seeded test tenant
  // never weakens referential integrity or depends on cascade order.
  await probe.query(`DELETE FROM projects WHERE workspace_id IN (
    SELECT m.workspace_id FROM memberships m
    JOIN users u ON u.id=m.user_id WHERE u.email LIKE '%@northstar.example')`);
  await probe.query(`DELETE FROM organizations WHERE id IN (
    SELECT m.organization_id FROM memberships m
    JOIN users u ON u.id=m.user_id WHERE u.email LIKE '%@northstar.example')`);
  await probe.query("DELETE FROM users WHERE email LIKE '%@northstar.example'");

  const partialStore=new PostgresStore(probe);
  const partialPassword=hashPassword('DemoWorkspace2026');
  const partial=await partialStore.createCompany({
    companyName:'Northstar Studio',
    workspaceName:'Частично созданное пространство',
    ownerName:'Алексей Воронцов',
    email:'demo@northstar.example',
    passwordHash:partialPassword.hash,
    passwordSalt:partialPassword.salt,
  });
  const partialWorkspaceId=partial.workspace.id;
  assert.equal(Number((await probe.query('SELECT count(*) FROM memberships WHERE workspace_id=$1',[partialWorkspaceId])).rows[0].count),1);
  assert.equal(Number((await probe.query(`SELECT count(*) FROM audit_events
    WHERE workspace_id=$1 AND event_type='demo.seed.completed'`,[partialWorkspaceId])).rows[0].count),0);

  t.after(async()=>{
    if(firstApp)await firstApp.close().catch(()=>{});
    if(secondApp)await secondApp.close().catch(()=>{});
    await probe.end();
    await rm(root,{recursive:true,force:true});
  });

  const first=await startDemo(objectStore);firstApp=first.app;
  const healthOne=await request(first.base,'/healthz');
  assert.equal(healthOne.response.status,200);
  assert.equal(healthOne.payload.storageMode,'postgres');
  assert.equal(healthOne.payload.demo.enabled,true);
  assert.equal(healthOne.payload.demo.persistent,true);
  assert.equal(healthOne.payload.persistence.database.durable,true);
  assert.equal(healthOne.payload.persistence.objects.provider,'local');
  assert.equal(healthOne.payload.persistence.objects.durable,false);
  assert.equal(healthOne.payload.persistence.durabilityConfigured,false);

  const loginOne=await request(first.base,'/api/v1/auth/demo',{method:'POST'});
  assert.equal(loginOne.response.status,200);
  assert.ok(loginOne.cookie);
  assert.equal(loginOne.payload.session.role,'owner');
  assert.equal(loginOne.payload.session.organizationName,'Northstar Studio');
  const workspaceId=loginOne.payload.session.workspaceId;
  assert.notEqual(workspaceId,partialWorkspaceId,'incomplete seed without completion marker must be replaced');
  assert.equal(Number((await probe.query('SELECT count(*) FROM workspaces WHERE id=$1',[partialWorkspaceId])).rows[0].count),0);
  assert.equal(Number((await probe.query(`SELECT count(*) FROM audit_events
    WHERE workspace_id=$1 AND event_type='demo.seed.completed'`,[workspaceId])).rows[0].count),1);

  const bootstrapOne=await request(first.base,'/api/v1/bootstrap',{cookie:loginOne.cookie});
  assert.equal(bootstrapOne.response.status,200);
  assert.equal(bootstrapOne.payload.people.length,6);
  assert.ok(bootstrapOne.payload.conversations.some((item)=>item.title==='Запуск мобильной версии'));

  const tasksOne=await request(first.base,'/api/v1/tasks',{cookie:loginOne.cookie});
  assert.equal(tasksOne.response.status,200);
  assert.equal(tasksOne.payload.items.length,6);
  assert.ok(tasksOne.payload.items.some((item)=>item.status==='blocked'));
  assert.ok(tasksOne.payload.items.some((item)=>item.status==='in_review'));

  const meetingsOne=await request(first.base,'/api/v1/meetings?limit=20',{cookie:loginOne.cookie});
  assert.equal(meetingsOne.response.status,200);
  assert.ok(meetingsOne.payload.items.some((item)=>item.synthetic&&item.intelligenceStatus==='review_ready'));

  // Investor demo Project must be an actual permission-scoped canonical object.
  const apiProjects=await request(first.base,'/api/v1/projects',{cookie:loginOne.cookie});
  assert.equal(apiProjects.response.status,200);
  const investorProject=apiProjects.payload.items.find(item=>item.name==='Mobile Launch · Northstar Studio (demo)');
  assert.ok(investorProject?.id);
  const detailed=await request(first.base,'/api/v1/projects/'+investorProject.id,{cookie:loginOne.cookie});
  assert.equal(detailed.response.status,200);
  assert.equal(detailed.payload.project.metrics.visibleTasks,4);
  assert.equal(detailed.payload.project.milestones.length,2);
  assert.equal(detailed.payload.project.discussions.length,1);
  // Investor screenshots must capture the real scheduled Project graph, not
  // empty decorative Gantt bars. Seed remains idempotent on restart.
  assert.equal(detailed.payload.project.plan.phases.length,2);
  assert.equal(detailed.payload.project.plan.schedules.length,4);
  assert.equal(detailed.payload.project.plan.dependencies.length,3);
  assert.equal(detailed.payload.project.plan.forecast.status,'calculated');


  // Browser admission: investor path must be reachable by touch-sized navigation
  // and display source-derived data without pretending that ROI was measured.
  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(String(error)));
  await page.goto(first.base);
  await page.locator('#demo-login').waitFor({state:'visible'});
  await page.locator('#demo-login').click();
  await page.locator('#app-view').waitFor({state:'visible'});
  await page.locator('[data-nav="more"]:visible').click();
  await page.locator('[data-action="investor-tour"]').click();
  await page.locator('[data-investor-result]').waitFor({state:'visible',timeout:20000});
  assert.match(await page.locator('.investor-tour-hero').innerText(),/ДЕМО-ДАННЫЕ|DEMO/);
  assert.equal(await page.locator('.investor-tour-stats .investor-stat').count(),4);
  assert.ok(await page.locator('a[href="/#/projects/'+investorProject.id+'"]').count()>0);
  assert.match(await page.locator('[data-investor-result]').innerText(),/Расчёт появится только|Complete all inputs/);
  await page.locator('[data-investor-calculate]').click();
  assert.match(await page.locator('[data-investor-result]').innerText(),/Проверьте все допущения|Check all assumptions/);
  for (const [key,value] of Object.entries({
    people:'2',hoursPerWeek:'2',hourCost:'100',platformPerMonth:'200',
    implementationCost:'1200',months:'12',
  })) await page.locator('[data-investor-input="'+key+'"]').fill(value);
  await page.locator('[data-investor-calculate]').click();
  assert.match(await page.locator('[data-investor-result]').innerText(),/Условная валовая|Hypothetical gross/);
  assert.deepEqual(pageErrors,[],'investor modal should not raise browser errors');

  const firstCounts=await demoCounts(probe,workspaceId);
  assert.deepEqual(firstCounts,{members:6,tasks:6,calendar:4,syntheticMeetings:1,demoFiles:3,investorProjects:1,investorProjectTasks:4,investorMilestones:2,investorDiscussions:1});

  const file=(await probe.query(`SELECT storage_key "storageKey" FROM files
    WHERE workspace_id=$1 AND name='release-checklist.md' LIMIT 1`,[workspaceId])).rows[0];
  assert.ok(file?.storageKey);
  assert.equal((await objectStore.head(file.storageKey)).exists,true);
  await objectStore.delete(file.storageKey);
  assert.equal((await objectStore.head(file.storageKey)).exists,false);

  await firstApp.close();firstApp=null;

  const second=await startDemo(objectStore);secondApp=second.app;
  assert.equal((await objectStore.head(file.storageKey)).exists,true,'existing Postgres demo must rehydrate missing local fixture bytes');

  const loginTwo=await request(second.base,'/api/v1/auth/demo',{method:'POST'});
  assert.equal(loginTwo.response.status,200);
  assert.equal(loginTwo.payload.session.workspaceId,workspaceId,'restart must reuse the same persistent demo workspace');

  const secondCounts=await demoCounts(probe,workspaceId);
  assert.deepEqual(secondCounts,firstCounts,'restart must not duplicate seeded demo entities');
  const detailAgain=await request(second.base,'/api/v1/projects/'+investorProject.id,{cookie:loginTwo.cookie});
  assert.equal(detailAgain.response.status,200);
  assert.equal(detailAgain.payload.project.plan.phases.length,2);
  assert.equal(detailAgain.payload.project.plan.schedules.length,4);
  assert.equal(detailAgain.payload.project.plan.dependencies.length,3);


  const meetingsTwo=await request(second.base,'/api/v1/meetings?limit=20',{cookie:loginTwo.cookie});
  assert.equal(meetingsTwo.response.status,200);
  assert.equal(meetingsTwo.payload.items.filter((item)=>item.synthetic&&item.intelligenceStatus==='review_ready').length,1);
});
