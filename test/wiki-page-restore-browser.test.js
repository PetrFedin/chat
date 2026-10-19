import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {createChatServer} from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

test('Page history restore works in the 390px browser UI and survives reload',{skip:!databaseUrl,timeout:90000},async t=>{
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
  await page.locator('#register-form [name="companyName"]').fill('Wiki Restore UI '+marker);
  await page.locator('#register-form [name="ownerName"]').fill('Owner');
  await page.locator('#register-form [name="email"]').fill('wiki-restore-ui-'+marker+'@example.test');
  await page.locator('#register-form [name="password"]').fill('WikiRestore42Password');
  await page.locator('#register-form button[type="submit"]').click();
  await page.locator('#app-view').waitFor({state:'visible'});
  const api=page.request;
  const created=await api.post(base+'/api/v1/wiki/pages',{data:{
    title:'Restore UI '+marker,content:'Original version '+marker,
  }});
  assert.equal(created.status(),201);
  const initial=await created.json();
  const updated=await api.patch(base+'/api/v1/wiki/pages/'+initial.id,{data:{
    title:'Updated UI '+marker,content:'Current version '+marker,expectedVersion:1,
  }});
  assert.equal(updated.status(),200);
  await page.locator('[data-nav="more"]:visible').click();
  await page.locator('[data-action="wiki"]').click();
  await page.locator('[data-wiki-open="'+initial.id+'"]').click();
  await page.locator('[data-wiki-view]').getByText('Current version '+marker).waitFor({state:'visible'});
  await page.locator('[data-wiki-history]').click();
  await page.locator('[data-wiki-restore="1"]').waitFor({state:'visible'});
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-wiki-restore="1"]').click();
  await page.locator('[data-wiki-view]').getByText('Original version '+marker).waitFor({state:'visible'});
  const restored=await (await api.get(base+'/api/v1/wiki/pages/'+initial.id)).json();
  assert.equal(restored.version,3);
  assert.equal(restored.content,'Original version '+marker);
  assert.equal(restored.title,'Restore UI '+marker);
  // Restoring is reversible: the displaced latest version remains available.
  const history=await (await api.get(base+'/api/v1/wiki/pages/'+initial.id+'/history')).json();
  assert.ok(history.items.some(v=>v.version===2&&v.content==='Current version '+marker));
  await page.reload();
  const reopened=await (await api.get(base+'/api/v1/wiki/pages/'+initial.id)).json();
  assert.equal(reopened.version,3);
  assert.equal(reopened.content,'Original version '+marker);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
});
