import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

test('Unified search on mobile opens exact Page, Project and Decision without duplicate records',
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
  const nonce=randomUUID().slice(0,8);
  await page.locator('#register-form [name="companyName"]').fill('Authority Search '+nonce);
  await page.locator('#register-form [name="ownerName"]').fill('Owner');
  await page.locator('#register-form [name="email"]').fill('search-browser-'+nonce+'@example.test');
  await page.locator('#register-form [name="password"]').fill('AuthoritySearchBrowserPassword42');
  await page.locator('#register-form button[type="submit"]').click();
  await page.locator('#app-view').waitFor({state:'visible'});
  const pageCreated=await page.request.post(base+'/api/v1/wiki/pages',{
    data:{title:'Find Page '+nonce,content:'Page search excerpt'},
  });
  assert.equal(pageCreated.status(),201);
  const wiki=await pageCreated.json();
  const projectCreated=await page.request.post(base+'/api/v1/projects',{
    data:{name:'Find Project '+nonce,visibility:'members'},
  });
  assert.equal(projectCreated.status(),201);
  const project=(await projectCreated.json()).project;
  const eventCreated=await page.request.post(base+'/api/v1/calendar-events',{
    data:{kind:'meeting',title:'Search meeting '+nonce,
      startAt:new Date(Date.now()-3600e3).toISOString(),
      endAt:new Date(Date.now()+3600e3).toISOString()},
  });
  assert.equal(eventCreated.status(),201);
  const event=(await eventCreated.json()).event;
  const noteCreated=await page.request.put(base+'/api/v1/calendar-events/'+event.id+'/notes',{
    data:{title:'Search meeting '+nonce,decisions:['Find Decision '+nonce],actionItems:[]},
  });
  assert.equal(noteCreated.status(),200);

  const startSearch=async(type)=>{
    await page.evaluate(()=>window.ChatDailyWork.openSearch());
    await page.locator('[data-dwc-search-type="'+type+'"]').click();
    await page.locator('#dwc-search-input').fill(nonce);
  };
  await startSearch('page');
  await page.locator('[data-dwc-search-result]').filter({hasText:'Find Page '+nonce}).click();
  await page.locator('[data-wiki-view]').waitFor({state:'visible'});
  await page.getByText('Page search excerpt').first().waitFor({state:'visible'});
  // Close the Wiki overlay through its regular back mechanism.
  await page.keyboard.press('Escape');
  await startSearch('project');
  await page.locator('[data-dwc-search-result]').filter({hasText:'Find Project '+nonce}).click();
  await page.waitForURL(new RegExp('#/projects/'+project.id+'$'));
  await page.locator('.project-home h2').filter({hasText:'Find Project '+nonce})
    .waitFor({state:'visible'});
  await startSearch('decision');
  await page.locator('[data-dwc-search-result]').filter({hasText:'Find Decision '+nonce}).click();
  await page.getByText('Принятое решение').first().waitFor({state:'visible'});
  await page.getByText('Find Decision '+nonce).first().waitFor({state:'visible'});
  assert.deepEqual(errors,[]);
});
