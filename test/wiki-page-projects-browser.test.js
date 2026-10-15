import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

test('Page browser flow links, opens and unlinks canonical Project relation',
  {skip:!databaseUrl},async(t)=>{
  const app=await createChatServer({databaseUrl,startMeetingWorker:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;

  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const context=await browser.newContext();
  const page=await context.newPage();
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(String(error)));

  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('[data-auth-mode="register"]').click();
  const suffix=randomUUID().slice(0,8);
  await page.locator('#register-form [name="companyName"]').fill(`Pages Browser ${suffix}`);
  await page.locator('#register-form [name="ownerName"]').fill('Owner');
  await page.locator('#register-form [name="email"]').fill(`pages-browser-${suffix}@t.test`);
  await page.locator('#register-form [name="password"]').fill('PagesBrowserPassword42');
  await page.locator('#register-form button[type="submit"]').click();
  await page.locator('#app-view').waitFor({state:'visible',timeout:10000});

  const projectRes=await context.request.post(`${base}/api/v1/projects`,{data:{
    name:`Canonical Project ${suffix}`,visibility:'members',
  }});
  assert.equal(projectRes.status(),201);
  const project=(await projectRes.json()).project;

  const wikiRes=await context.request.post(`${base}/api/v1/wiki/pages`,{data:{
    title:`Project brief ${suffix}`,content:'Page relation browser proof',
  }});
  assert.equal(wikiRes.status(),201);
  const wiki=await wikiRes.json();

  await page.locator('[data-nav="more"]').first().click();
  await page.locator('[data-action="wiki"]').click();
  await page.locator(`[data-wiki-open="${wiki.id}"]`).click();
  await page.locator('[data-wiki-project-new]').waitFor({state:'visible',timeout:5000});

  await page.locator('[data-wiki-project-new]').click();
  const form=page.locator('#wiki-project-form');
  await form.waitFor({state:'visible',timeout:5000});
  await form.locator('[name="projectId"]').selectOption(project.id);
  await form.locator('button[type="submit"]').click();

  const relation=page.locator(`[data-wiki-project-row="${project.id}"]`);
  await relation.waitFor({state:'visible',timeout:10000});
  assert.match(await relation.textContent(),new RegExp(`Canonical Project ${suffix}`));

  await relation.locator('[data-wiki-project-open]').click();
  await page.waitForURL(new RegExp(`#/projects/${project.id}$`),{timeout:10000});
  await page.locator('.project-home h2').filter({hasText:`Canonical Project ${suffix}`})
    .waitFor({state:'visible',timeout:10000});

  // Re-open Wiki and verify the same relation can be curated away without
  // mutating the canonical Project.
  await page.locator('[data-nav="more"]').first().click();
  await page.locator('[data-action="wiki"]').click();
  await page.locator(`[data-wiki-open="${wiki.id}"]`).click();
  const linkedAgain=page.locator(`[data-wiki-project-row="${project.id}"]`);
  await linkedAgain.waitFor({state:'visible',timeout:5000});
  await linkedAgain.locator('[data-wiki-project-remove]').click();
  await linkedAgain.waitFor({state:'detached',timeout:5000});

  const canonical=await context.request.get(`${base}/api/v1/projects/${project.id}`);
  assert.equal(canonical.status(),200,'unlinking a Page relation must not mutate Project Authority');
  assert.deepEqual(pageErrors,[],'Page relation UI must not raise an unhandled browser error');
});
