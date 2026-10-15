import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;

test('Page ACL creator manages restricted access on 390px without exposing edit controls to viewers',
  {skip:!databaseUrl,timeout:90000},async t=>{
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
  await page.locator('#register-form [name="companyName"]').fill('ACL Browser '+marker);
  await page.locator('#register-form [name="ownerName"]').fill('Owner');
  await page.locator('#register-form [name="email"]').fill('acl-browser-'+marker+'@example.test');
  await page.locator('#register-form [name="password"]').fill('AclBrowserPassword42');
  await page.locator('#register-form button[type="submit"]').click();
  await page.locator('#app-view').waitFor({state:'visible'});

  const ownerCookie=(await page.context().cookies()).map(item=>`${item.name}=${item.value}`).join('; ');
  const invite=await fetch(base+'/api/v1/invitations',{
    method:'POST',headers:{cookie:ownerCookie,'content-type':'application/json'},
    body:JSON.stringify({email:'acl-member-'+marker+'@example.test',role:'member'}),
  });
  assert.equal(invite.status,201);
  const token=new URL((await invite.json()).invitation.inviteUrl).searchParams.get('invite');
  const accepted=await fetch(base+'/api/v1/invitations/accept',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({token,displayName:'ACL Member '+marker,password:'AclBrowserPassword42'}),
  });
  assert.equal(accepted.status,201);
  const memberCookie=accepted.headers.get('set-cookie')?.split(';')[0];
  const memberBoot=await fetch(base+'/api/v1/bootstrap',{headers:{cookie:memberCookie}});
  assert.equal(memberBoot.status,200);
  const member=(await memberBoot.json()).session;

  const made=await page.request.post(base+'/api/v1/wiki/pages',{data:{
    title:'Restricted browser '+marker,content:'secret browser content',visibility:'restricted',
  }});
  assert.equal(made.status(),201);
  const wiki=await made.json();

  await page.evaluate(id=>window.ChatApp.openWikiPage(id),wiki.id);
  await page.locator('[data-wiki-access]').waitFor({state:'visible'});
  await page.getByText(/Ограниченный доступ|Restricted/).first().waitFor({state:'visible'});
  await page.locator('[data-wiki-access]').click();
  await page.locator('[data-wiki-access-visibility]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-wiki-access-visibility]').inputValue(),'restricted');

  await page.locator('[data-wiki-grant-user]').selectOption(member.userId);
  await page.locator('[data-wiki-grant-level]').selectOption('edit');
  await page.locator('[data-wiki-grant-add]').click();
  await page.locator(`[data-wiki-grant-row="${member.userId}"]`).waitFor({state:'visible'});
  assert.match(await page.locator(`[data-wiki-grant-row="${member.userId}"]`).textContent(),/Редактирование|Edit/);

  let memberRead=await fetch(base+`/api/v1/wiki/pages/${wiki.id}`,{headers:{cookie:memberCookie}});
  assert.equal(memberRead.status,200);
  assert.equal((await memberRead.json()).permissions.canEdit,true);

  await page.locator(`[data-wiki-grant-remove="${member.userId}"]`).click();
  await page.waitForTimeout(250);
  memberRead=await fetch(base+`/api/v1/wiki/pages/${wiki.id}`,{headers:{cookie:memberCookie}});
  assert.equal(memberRead.status,404,'revocation must take effect immediately');

  // Workspace visibility opens the same canonical Page without recreating it.
  await page.locator('[data-wiki-access-visibility]').selectOption('workspace');
  await page.locator('[data-wiki-access-save]').click();
  await page.waitForTimeout(250);
  memberRead=await fetch(base+`/api/v1/wiki/pages/${wiki.id}`,{headers:{cookie:memberCookie}});
  assert.equal(memberRead.status,200);
  assert.equal((await memberRead.json()).title,'Restricted browser '+marker);

  // Return to restricted through the same UI; no explicit grant remains.
  await page.evaluate(id=>window.ChatApp.openWikiPage(id),wiki.id);
  await page.locator('[data-wiki-access]').click();
  await page.locator('[data-wiki-access-visibility]').selectOption('restricted');
  await page.locator('[data-wiki-access-save]').click();
  await page.waitForTimeout(250);
  memberRead=await fetch(base+`/api/v1/wiki/pages/${wiki.id}`,{headers:{cookie:memberCookie}});
  assert.equal(memberRead.status,404);

  const canonical=await page.request.get(base+`/api/v1/wiki/pages/${wiki.id}`);
  assert.equal(canonical.status(),200);
  assert.equal((await canonical.json()).content,'secret browser content',
    'visibility changes must never recreate or replace Page content');
  assert.deepEqual(errors,[]);
});
