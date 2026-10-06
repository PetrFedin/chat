import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';
import { PostgresStore } from '../src/persistence/store.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

async function openRegisteredWorkspace(browser,base,{mobile=false,label='desktop'}={}){
  const context=await browser.newContext(mobile?{
    viewport:{width:390,height:844},
    deviceScaleFactor:3,
    isMobile:true,
    hasTouch:true,
  }:{viewport:{width:1440,height:1000}});
  const page=await context.newPage();
  const pageErrors=[];
  const consoleErrors=[];
  const serverErrors=[];
  page.on('pageerror',error=>pageErrors.push(String(error)));
  page.on('response',response=>{
    if(response.status()<500||!response.url().includes('/api/')) return;
    const url=new URL(response.url());
    serverErrors.push(`${response.status()} ${url.pathname}`);
  });
  page.on('console',msg=>{
    if(msg.type()!=='error') return;
    if(/^Failed to load resource/.test(msg.text())) return;
    consoleErrors.push(msg.text());
  });

  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('#auth-view').waitFor({state:'visible'});
  await page.locator('[data-auth-mode="register"]').click();
  await page.locator('#register-form').waitFor({state:'visible'});

  const suffix=randomUUID().slice(0,8);
  await page.locator('#register-form [name="companyName"]').fill(`P0 browser ${label} ${suffix}`);
  await page.locator('#register-form [name="ownerName"]').fill('P0 Owner');
  await page.locator('#register-form [name="email"]').fill(`p0-browser-${label}-${suffix}@test.invalid`);
  await page.locator('#register-form [name="password"]').fill('P0BrowserPassword42');
  await page.locator('#register-form button[type="submit"]').click();

  await page.locator('#app-view').waitFor({state:'visible',timeout:10000});
  await page.locator('#auth-view').waitFor({state:'hidden'});

  for(const view of ['chats','tasks','calendar']){
    await page.locator(`[data-nav="${view}"]:visible`).first().click();
    await page.locator(`[data-nav="${view}"].active:visible`).first().waitFor({state:'visible',timeout:5000});
  }

  assert.deepEqual(pageErrors,[],`${label}: необработанная ошибка страницы: ${pageErrors.join(' | ')}`);
  assert.deepEqual(consoleErrors,[],`${label}: ошибка консоли: ${consoleErrors.join(' | ')}`);
  assert.deepEqual(serverErrors,[],`${label}: API вернул 5xx: ${serverErrors.join(' | ')}`);
  return {context,page};
}

test('P0 browser boots against PostgreSQL on desktop and mobile',{skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const store=new PostgresStore(pool);
  const app=await createChatServer({store,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;

  const headed=process.env.P0_HEADED==='true';
  const slowMo=Math.max(0,Number(process.env.P0_SLOW_MO??0)||0);
  const browser=await chromium.launch({headless:!headed,slowMo});
  t.after(()=>browser.close());

  const desktop=await openRegisteredWorkspace(browser,base,{label:'desktop'});
  await desktop.context.close();

  const mobile=await openRegisteredWorkspace(browser,base,{mobile:true,label:'mobile'});
  const box=await mobile.page.locator('#app-view').boundingBox();
  assert.ok(box&&box.width<=390,'mobile workspace overflows the requested viewport');
  await mobile.context.close();
});
