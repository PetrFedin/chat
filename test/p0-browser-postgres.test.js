import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';
import { PostgresStore } from '../src/persistence/store.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

async function openRegisteredWorkspace(browser,base,{viewport={width:1440,height:900},deviceScaleFactor=1,isMobile=false,hasTouch=false,label='desktop'}={}){
  const context=await browser.newContext({viewport,deviceScaleFactor,isMobile,hasTouch});
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

  const overflow=await page.evaluate(()=>({innerWidth:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth}));
  assert.ok(overflow.scrollWidth<=overflow.innerWidth+1,`${label}: document horizontal overflow ${overflow.scrollWidth}px > ${overflow.innerWidth}px`);
  assert.ok(overflow.bodyScrollWidth<=overflow.innerWidth+1,`${label}: body horizontal overflow ${overflow.bodyScrollWidth}px > ${overflow.innerWidth}px`);
  assert.deepEqual(pageErrors,[],`${label}: необработанная ошибка страницы: ${pageErrors.join(' | ')}`);
  assert.deepEqual(consoleErrors,[],`${label}: ошибка консоли: ${consoleErrors.join(' | ')}`);
  assert.deepEqual(serverErrors,[],`${label}: API вернул 5xx: ${serverErrors.join(' | ')}`);
  return {context,page};
}

test('P0 browser boots against PostgreSQL on phone, tablet and monitor',{skip:!databaseUrl},async(t)=>{
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

  const monitor=await openRegisteredWorkspace(browser,base,{viewport:{width:1440,height:900},label:'monitor'});
  await monitor.context.close();

  const tablet=await openRegisteredWorkspace(browser,base,{viewport:{width:834,height:1112},deviceScaleFactor:2,hasTouch:true,label:'tablet'});
  await tablet.context.close();

  const phone=await openRegisteredWorkspace(browser,base,{viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,label:'phone'});
  await phone.context.close();
});


test('Device Preview switches real app viewport between phone, tablet and monitor',{skip:!databaseUrl},async(t)=>{
  const pool=new pg.Pool({connectionString:databaseUrl});
  const store=new PostgresStore(pool);
  const app=await createChatServer({store,startMeetingWorker:false,frameAncestors:"'self'"});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;

  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1600,height:1200}});
  t.after(()=>context.close());
  const page=await context.newPage();
  await page.goto(`${base}/preview.html`,{waitUntil:'domcontentloaded'});
  await page.locator('#app').waitFor({state:'visible'});
  await page.frameLocator('#app').locator('#auth-view').waitFor({state:'visible'});

  for(const [device,width] of [['phone',390],['tablet',834],['monitor',1440]]){
    await page.locator(`[data-device="${device}"]`).click();
    await page.waitForFunction(expected=>document.querySelector('#device')?.style.width===expected+'px',width);
    const innerWidth=await page.locator('#app').evaluate(frameEl=>frameEl.contentWindow.innerWidth);
    assert.equal(innerWidth,width,`${device}: iframe viewport must be ${width}px`);
  }
});
