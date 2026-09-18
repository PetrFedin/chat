import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createChatServer } from '../src/server.js';
import { LocalObjectStore } from '../src/storage/object-store.js';

const databaseUrl=process.env.DATABASE_URL;

async function request(base,path,{cookie,method='GET'}={}){
  const response=await fetch(`${base}${path}`,{method,headers:cookie?{cookie}:{}});
  const payload=await response.json().catch(()=>null);
  return{response,payload,cookie:response.headers.get('set-cookie')?.split(';')[0]??null};
}

async function startDemo(objectStore){
  const app=await createChatServer({
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
  ]);
  return{
    members:queries[0].rows[0].n,
    tasks:queries[1].rows[0].n,
    calendar:queries[2].rows[0].n,
    syntheticMeetings:queries[3].rows[0].n,
    demoFiles:queries[4].rows[0].n,
  };
}

test('Postgres preview demo survives restart without duplication and rehydrates local fixtures',{skip:!databaseUrl},async(t)=>{
  const root=await mkdtemp(join(tmpdir(),'chat-persistent-demo-'));
  const objectStore=new LocalObjectStore(root);
  const probe=new pg.Pool({connectionString:databaseUrl});
  let firstApp=null,secondApp=null;
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

  const firstCounts=await demoCounts(probe,workspaceId);
  assert.deepEqual(firstCounts,{members:6,tasks:6,calendar:4,syntheticMeetings:1,demoFiles:3});

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

  const meetingsTwo=await request(second.base,'/api/v1/meetings?limit=20',{cookie:loginTwo.cookie});
  assert.equal(meetingsTwo.response.status,200);
  assert.equal(meetingsTwo.payload.items.filter((item)=>item.synthetic&&item.intelligenceStatus==='review_ready').length,1);
});
