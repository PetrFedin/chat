import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

test('Page Channel picker on phone can link, unlink and open a visible channel',
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
  const suffix=randomUUID().slice(0,8);
  await page.locator('#register-form [name="companyName"]').fill('Page Channel '+suffix);
  await page.locator('#register-form [name="ownerName"]').fill('Owner');
  await page.locator('#register-form [name="email"]').fill('page-channel-'+suffix+'@example.test');
  await page.locator('#register-form [name="password"]').fill('PageChannelBrowserPassword42');
  await page.locator('#register-form button[type="submit"]').click();
  await page.locator('#app-view').waitFor({state:'visible'});

  const created=await page.request.post(base+'/api/v1/conversations',{
    data:{kind:'channel',title:'Delivery channel '+suffix,visibility:'private'},
  });
  assert.equal(created.status(),201);
  const channel=(await created.json()).conversation;
  const wikiCreated=await page.request.post(base+'/api/v1/wiki/pages',{
    data:{title:'Delivery notes '+suffix,content:'Canonical channel reference'},
  });
  assert.equal(wikiCreated.status(),201);
  const wiki=await wikiCreated.json();

  await page.locator('[data-nav="more"]:visible').click();
  await page.locator('[data-action="wiki"]').click();
  await page.locator('[data-wiki-open="'+wiki.id+'"]').click();
  await page.locator('[data-wiki-channel-new]').click();
  await page.locator('[data-wiki-channel-filter]').fill('Delivery channel '+suffix);
  const select=page.locator('[data-wiki-channel-select="'+channel.id+'"]');
  await select.waitFor({state:'visible'});
  await select.click();

  const linked=page.locator('[data-wiki-channel-row="'+channel.id+'"]');
  await linked.waitFor({state:'visible'});
  await linked.locator('[data-wiki-channel-open]').click();
  await page.waitForURL(/#\/chats$/);
  await page.locator('.message-pane .message-header h2')
    .filter({hasText:'Delivery channel '+suffix})
    .waitFor({state:'visible'});

  // Channel state is independent of the Wiki relation.
  await page.locator('[data-nav="more"]:visible').click();
  await page.locator('[data-action="wiki"]').click();
  await page.locator('[data-wiki-open="'+wiki.id+'"]').click();
  const linkedAgain=page.locator('[data-wiki-channel-row="'+channel.id+'"]');
  await linkedAgain.waitFor({state:'visible'});
  await linkedAgain.locator('[data-wiki-channel-remove]').click();
  await linkedAgain.waitFor({state:'detached'});
  const unchanged=await page.request.get(base+'/api/v1/conversations/'+channel.id+'/members');
  assert.equal(unchanged.status(),200);
  const reloadedPage=await page.request.get(base+'/api/v1/wiki/pages/'+wiki.id);
  assert.equal(reloadedPage.status(),200);
  assert.equal((await reloadedPage.json()).channels.some(c=>c.id===channel.id),false);
  assert.deepEqual(errors,[]);
});
