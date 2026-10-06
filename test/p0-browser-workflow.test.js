import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';
import { PostgresStore } from '../src/persistence/store.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

async function api(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(`${base}${path}`,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},
    body:body!==undefined?JSON.stringify(body):undefined,
  });
  const payload=response.status===204?null:await response.json().catch(()=>null);
  return {response,payload,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}

async function inviteWorker(base,ownerCookie,suffix){
  const email=`ui-worker-${suffix}@p0.test`;
  const password='P0WorkerPassword42';
  const invitation=await api(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{email,role:'member'}});
  assert.equal(invitation.response.status,201);
  const token=new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted=await api(base,'/api/v1/invitations/accept',{method:'POST',body:{token,displayName:'UI Worker',password}});
  assert.equal(accepted.response.status,201);
  const boot=await api(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
  return {email,password,userId:boot.payload.session.userId};
}

async function registerOwner(page,base,suffix){
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('#auth-view').waitFor({state:'visible'});
  await page.locator('[data-auth-mode="register"]').click();
  await page.locator('#register-form [name="companyName"]').fill(`P0 UI ${suffix}`);
  await page.locator('#register-form [name="ownerName"]').fill('UI Owner');
  await page.locator('#register-form [name="email"]').fill(`ui-owner-${suffix}@p0.test`);
  await page.locator('#register-form [name="password"]').fill('P0OwnerPassword42');
  await page.locator('#register-form button[type="submit"]').click();
  await page.locator('#app-view').waitFor({state:'visible',timeout:10000});
}

async function login(page,base,email,password){
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('#login-form').waitFor({state:'visible'});
  await page.locator('#login-form [name="email"]').fill(email);
  await page.locator('#login-form [name="password"]').fill(password);
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator('#app-view').waitFor({state:'visible',timeout:10000});
}

async function openTask(page,title){
  await page.locator('[data-nav="tasks"]:visible').first().click();
  const row=page.locator('[data-task-open]').filter({hasText:title}).first();
  await row.waitFor({state:'visible',timeout:10000});
  await row.click();
  await page.locator('#modal-heading').waitFor({state:'visible'});
}

async function transition(page,to,reason=null){
  const post=page.waitForResponse(r=>r.request().method()==='POST'&&/\/api\/v1\/tasks\/[^/]+\/transitions$/.test(new URL(r.url()).pathname));
  const refresh=page.waitForResponse(r=>r.request().method()==='GET'&&/\/api\/v1\/tasks\/[^/]+$/.test(new URL(r.url()).pathname));
  await page.locator(`[data-task-transition="${to}"]`).click();
  if(reason!==null){
    await page.locator('#task-transition-form textarea[name="reason"]').fill(reason);
    await page.locator('#task-transition-form button.button.primary').click();
  }
  assert.equal((await post).status(),200);
  assert.equal((await refresh).status(),200);
  await page.locator('#modal-heading').waitFor({state:'visible',timeout:10000});
}

async function addEvidence(page,value){
  const form=page.locator('#task-evidence-form');
  await form.locator('textarea[name="value"]').fill(value);
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&/\/api\/v1\/tasks\/[^/]+\/evidence$/.test(new URL(r.url()).pathname));
  await form.locator('button.button.secondary').click();
  assert.equal((await response).status(),201);
  await page.locator('[data-task-transition="in_review"]').waitFor({state:'visible',timeout:10000});
}

test('P0 headed UI workflow: group -> message -> task -> return -> resubmit -> close',{skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const store=new PostgresStore(pool);
  const app=await createChatServer({store,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const suffix=randomUUID().slice(0,8);

  const headed=process.env.P0_HEADED==='true';
  const slowMo=Math.max(0,Number(process.env.P0_SLOW_MO??0)||0);
  const browser=await chromium.launch({headless:!headed,slowMo});
  t.after(()=>browser.close());

  const ownerContext=await browser.newContext({viewport:{width:1440,height:1000}});
  const ownerPage=await ownerContext.newPage();
  await registerOwner(ownerPage,base,suffix);

  const cookies=await ownerContext.cookies(base);
  const ownerCookie=cookies.map(c=>`${c.name}=${c.value}`).join('; ');
  const worker=await inviteWorker(base,ownerCookie,suffix);

  await ownerPage.reload({waitUntil:'domcontentloaded'});
  await ownerPage.locator('#app-view').waitFor({state:'visible'});
  await ownerPage.locator('[data-nav="chats"]:visible').first().click();
  await ownerPage.locator('[data-action="group"]:visible').click();
  await ownerPage.locator('#group-form [name="title"]').fill('P0 UI execution');
  await ownerPage.locator(`#group-form input[name="participant"][value="${worker.userId}"]`).check();
  await ownerPage.locator('#group-form button.button.primary').click();

  await ownerPage.locator('.message-pane h2').filter({hasText:'P0 UI execution'}).waitFor({state:'visible',timeout:10000});
  await ownerPage.locator('#message-input').fill('P0 UI source message');
  await ownerPage.locator('[data-action="send"]').click();
  await ownerPage.locator('#message-stream').getByText('P0 UI source message').waitFor({state:'visible'});

  const quickTaskTool=ownerPage.locator('[data-quick-task]').last();
  await quickTaskTool.locator('xpath=ancestor::article[1]').hover();
  await quickTaskTool.click();
  await ownerPage.locator('#quick-task [name="title"]').fill('P0 UI task');
  await ownerPage.locator('#quick-task [name="ownerId"]').selectOption(worker.userId);
  await ownerPage.locator('#quick-task button.button.primary').click();
  await ownerPage.locator('#modal-heading').waitFor({state:'hidden'});

  const workerContext=await browser.newContext({viewport:{width:1280,height:900}});
  const workerPage=await workerContext.newPage();
  await login(workerPage,base,worker.email,worker.password);
  await openTask(workerPage,'P0 UI task');

  await transition(workerPage,'accepted');
  await transition(workerPage,'in_progress');
  await transition(workerPage,'blocked','Waiting for UI fixture');
  await transition(workerPage,'in_progress');
  await addEvidence(workerPage,'First UI evidence');
  await transition(workerPage,'in_review');

  await ownerPage.reload({waitUntil:'domcontentloaded'});
  await ownerPage.locator('#app-view').waitFor({state:'visible'});
  await openTask(ownerPage,'P0 UI task');
  await transition(ownerPage,'in_progress','Please add second UI evidence');

  await workerPage.reload({waitUntil:'domcontentloaded'});
  await workerPage.locator('#app-view').waitFor({state:'visible'});
  await openTask(workerPage,'P0 UI task');
  await addEvidence(workerPage,'Second UI evidence after return');
  await transition(workerPage,'in_review');

  await ownerPage.reload({waitUntil:'domcontentloaded'});
  await ownerPage.locator('#app-view').waitFor({state:'visible'});
  await openTask(ownerPage,'P0 UI task');
  await transition(ownerPage,'accepted_result');
  await transition(ownerPage,'closed');

  await ownerPage.locator('#modal-heading').getByText('P0 UI task').waitFor({state:'visible'});
  await assert.doesNotReject(ownerPage.getByText('Закрыта',{exact:false}).first().waitFor({state:'visible',timeout:5000}));

  await workerContext.close();
  await ownerContext.close();
});
