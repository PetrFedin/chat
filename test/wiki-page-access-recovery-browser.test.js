import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';

const databaseUrl=process.env.POSTGRES_TEST_URL||process.env.DATABASE_URL;
const password='RecoveryBrowserPassword42';

async function apiFetch(base,path,{cookie,method='GET',body}={}){
  const response=await fetch(base+path,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return {
    response,
    payload:response.status===204?null:await response.json().catch(()=>null),
    cookie:response.headers.get('set-cookie')?.split(';')[0]??null,
  };
}

test('Page access recovery owner flow works on 390px without opening recovered Page content',
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
  await page.locator('#register-form [name="companyName"]').fill('Recovery Browser '+marker);
  await page.locator('#register-form [name="ownerName"]').fill('Owner');
  await page.locator('#register-form [name="email"]').fill('recovery-owner-'+marker+'@example.test');
  await page.locator('#register-form [name="password"]').fill(password);
  await page.locator('#register-form button[type="submit"]').click();
  await page.locator('#app-view').waitFor({state:'visible'});
  const ownerCookie=(await page.context().cookies()).map(item=>`${item.name}=${item.value}`).join('; ');

  async function invite(name){
    const made=await apiFetch(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{
      email:'recovery-'+name.toLowerCase()+'-'+marker+'@example.test',role:'member',
    }});
    assert.equal(made.response.status,201);
    const token=new URL(made.payload.invitation.inviteUrl).searchParams.get('invite');
    const accepted=await apiFetch(base,'/api/v1/invitations/accept',{method:'POST',body:{token,displayName:name,password}});
    assert.equal(accepted.response.status,201);
    const boot=await apiFetch(base,'/api/v1/bootstrap',{cookie:accepted.cookie});
    return {cookie:accepted.cookie,session:boot.payload.session};
  }

  const author=await invite('Author');
  const successor=await invite('Successor');
  const steward=await invite('Steward');

  const made=await apiFetch(base,'/api/v1/wiki/pages',{cookie:author.cookie,method:'POST',body:{
    title:'Orphaned recovery '+marker,content:'private body '+marker,visibility:'restricted',
  }});
  assert.equal(made.response.status,201);
  const wiki=made.payload;

  const transfer=await apiFetch(base,`/api/v1/wiki/pages/${wiki.id}/access/owner`,{
    cookie:author.cookie,method:'PUT',body:{userId:successor.session.userId},
  });
  assert.equal(transfer.response.status,200);
  const disabled=await apiFetch(base,`/api/v1/people/${successor.session.userId}/deactivate`,{
    cookie:ownerCookie,method:'POST',
  });
  assert.equal(disabled.response.status,200);

  await page.locator('[data-nav="more"]:visible').click();
  await page.locator('[data-action="wiki"]').click();
  await page.locator('[data-wiki-access-recovery]').waitFor({state:'visible'});
  await page.locator('[data-wiki-access-recovery]').click();
  const row=page.locator(`[data-wiki-recovery-row="${wiki.id}"]`);
  await row.waitFor({state:'visible'});
  assert.match(await row.textContent(),new RegExp('Orphaned recovery '+marker));
  assert.doesNotMatch(await row.textContent(),new RegExp('private body '+marker));

  await page.locator(`[data-wiki-recovery-user="${wiki.id}"]`).selectOption(steward.session.userId);
  await page.locator(`[data-wiki-recover="${wiki.id}"]`).click();
  await page.locator('[data-wiki-access-recovery]').waitFor({state:'visible'});

  const ownerRead=await apiFetch(base,`/api/v1/wiki/pages/${wiki.id}`,{cookie:ownerCookie});
  assert.equal(ownerRead.response.status,404,'break-glass must not grant workspace owner Page read access');
  const stewardRead=await apiFetch(base,`/api/v1/wiki/pages/${wiki.id}`,{cookie:steward.cookie});
  assert.equal(stewardRead.response.status,200);
  assert.equal(stewardRead.payload.permissions.canManageAccess,true);
  assert.equal(stewardRead.payload.content,'private body '+marker);

  await page.locator('[data-wiki-access-recovery]').click();
  await page.getByText(/Страниц без активного владельца доступа нет|No Pages need access recovery/).waitFor({state:'visible'}).catch(()=>{});
  const recovery=await apiFetch(base,'/api/v1/wiki/access-recovery',{cookie:ownerCookie});
  assert.deepEqual(recovery.payload.items,[]);
  assert.deepEqual(errors,[]);
});
