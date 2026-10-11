import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

test('Pages Tiptap browser: formatting survives save/reopen and stale version preserves local edits',{skip:!databaseUrl},async t=>{
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
  await page.locator('#register-form [name="companyName"]').fill('Rich pages '+suffix);
  await page.locator('#register-form [name="ownerName"]').fill('Owner');
  await page.locator('#register-form [name="email"]').fill('wiki-rich-'+suffix+'@t.test');
  await page.locator('#register-form [name="password"]').fill('WikiRichPassword42');
  await page.locator('#register-form button[type="submit"]').click();
  await page.locator('#app-view').waitFor({state:'visible'});
  const api=page.request;
  const create=await api.post(base+'/api/v1/wiki/pages',{data:{title:'Legacy rich '+suffix,content:'Legacy text'}});
  assert.equal(create.status(),201);
  const initial=await create.json();
  await page.locator('[data-nav="more"]:visible').click();
  await page.locator('[data-action="wiki"]').click();
  await page.locator('[data-wiki-open="'+initial.id+'"]').click();
  await page.locator('[data-wiki-edit]').click();
  await page.locator('.wiki-editor-host .tiptap').waitFor({state:'visible'});
  await page.locator('.wiki-editor-host .tiptap').fill('Formatted page');
  await page.locator('.wiki-editor-host .tiptap').press('ControlOrMeta+A');
  await page.locator('[data-format="bold"]').click();
  await page.locator('[data-wiki-save]').click();
  await page.waitForTimeout(400);
  let saved=await (await api.get(base+'/api/v1/wiki/pages/'+initial.id)).json();
  assert.equal(saved.version,2);
  assert.equal(saved.content,'Formatted page');
  assert.ok(JSON.stringify(saved.document).includes('"bold"'),'bold mark must persist to PostgreSQL');
  await page.locator('[data-wiki-view] strong').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-wiki-view] strong').textContent(),'Formatted page');
  await page.locator('[data-wiki-edit]').click();
  await page.locator('.wiki-editor-host .tiptap').waitFor({state:'visible'});
  assert.match(await page.locator('.wiki-editor-host .tiptap').innerHTML(),/<strong>Formatted page<\/strong>/);
  await page.locator('.wiki-editor-host .tiptap').fill('Local changes must survive');
  const concurrent=await api.patch(base+'/api/v1/wiki/pages/'+initial.id,{data:{
    expectedVersion:saved.version,title:saved.title,
    document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Remote changes'}]}]},
  }});
  assert.equal(concurrent.status(),200);
  await page.locator('[data-wiki-save]').click();
  await page.locator('[data-wiki-conflict]:not([hidden])').waitFor({state:'visible'});
  assert.match(await page.locator('[data-local-version]').textContent(),/Local changes must survive/);
  assert.match(await page.locator('[data-server-version]').textContent(),/Remote changes/);
  const latest=await (await api.get(base+'/api/v1/wiki/pages/'+initial.id)).json();
  assert.equal(latest.content,'Remote changes','409 must never silently overwrite the remote version');
  // Rendering uses safe DOM nodes; markup-looking text stays inert,
  // and a forged javascript: URL does not become a clickable link.
  const security=await page.evaluate(async()=>{
    const {renderPageDocument}=await import('/wiki-document-view.js');
    const root=document.createElement('div');
    document.body.appendChild(root);
    renderPageDocument(root,{type:'doc',content:[{type:'paragraph',content:[
      {type:'text',text:'<img src=x onerror=alert(1)>'},
      {type:'text',text:' unsafe',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]},
    ]}]});
    const result={
      images:root.querySelectorAll('img').length,
      anchors:root.querySelectorAll('a').length,
      literal:root.textContent.includes('<img src=x onerror=alert(1)>'),
    };
    root.remove();
    return result;
  });
  assert.deepEqual(security,{images:0,anchors:0,literal:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'mobile editor should not overflow at 390px');
  assert.deepEqual(errors,[]);
});

