import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';
import { composeEmail } from '../src/email/email-mime.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const executablePath = process.env.CHATX_BROWSER_EXECUTABLE || undefined;
const artifacts = new URL('../artifacts/email/', import.meta.url);

async function register(page, base, suffix) {
  await page.goto(base, {waitUntil:'domcontentloaded'});
  await page.locator('[data-auth-mode="register"]').click();
  await page.locator('#register-form [name="companyName"]').fill('Email browser ' + suffix);
  await page.locator('#register-form [name="ownerName"]').fill('Мария Фёдорова');
  await page.locator('#register-form [name="email"]').fill('email-browser-' + suffix + '@example.test');
  await page.locator('#register-form [name="password"]').fill('EmailBrowserPassword42');
  await page.locator('#register-form button[type="submit"]').click();
  await page.locator('#app-view').waitFor({state:'visible'});
}

async function openEmail(page) {
  await page.locator('[data-nav="chats"]:visible').first().click();
  await page.locator('[data-message-source="email"]').click();
  await page.locator('[data-email-workspace]').waitFor({state:'visible'});
}

async function closeSheet(page) {
  const close = page.locator('[data-email-sheet-close]');
  if (await close.count()) await close.click();
  await page.locator('.cx-email-sheet').waitFor({state:'detached'});
}

const waitWrite = (page, path, method = 'POST') => page.waitForResponse(response =>
  response.request().method() === method && new URL(response.url()).pathname.endsWith(path));
const settleToasts = page => page.waitForFunction(() => !document.querySelector('#toast-root .toast'));

test('Email is usable in the real shell: EML → modes → draft → Task, recovery and responsive views',
  {skip:!databaseUrl,timeout:240000}, async t => {
    const app = await createChatServer({databaseUrl,startMeetingWorker:false,emailWorkerEnabled:false,emailAssistant:{status:() => ({enabled:false})},emailEncryptionKey:''});
    await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
    t.after(() => app.close());
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const browser = await chromium.launch({executablePath});
    t.after(() => browser.close());
    const context = await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'UTC'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error => errors.push(String(error)));
    const writes = [];
    page.on('request',request => {
      if (request.method() !== 'GET' && /\/api\/v1\/email\//.test(request.url())) writes.push({method:request.method(),path:new URL(request.url()).pathname});
    });
    const suffix = randomUUID().slice(0,8);
    await register(page,base,suffix);
    await openEmail(page);

    // Create a real local EML archive in the UI. It must never be labelled as
    // an authenticated external mailbox or allow outbound sending.
    await page.locator('.cx-email-sidebar [data-email-action="settings"]').click();
    const connection = page.locator('[data-email-connection-form]');
    await connection.locator('[name="providerId"]').selectOption('local');
    await connection.locator('[name="label"]').fill('Работа с заказчиками');
    await connection.locator('[name="address"]').fill('project-' + suffix + '@example.test');
    const createdMailbox = waitWrite(page,'/api/v1/mailbox-connections');
    await connection.locator('[type="submit"]').click();
    assert.equal((await createdMailbox).status(),201);
    await page.locator('[data-email-mailbox-row]').waitFor({state:'visible'});
    const mailboxId = await page.locator('[data-email-mailbox-row]').first().getAttribute('data-email-mailbox-row');
    assert.match(await page.locator('[data-email-mailbox-row]').first().textContent(),/Локальный архив|Local archive/);
    const boot = await (await page.request.get(base + '/api/v1/email/bootstrap')).json();
    assert.equal(boot.capabilities.canSend,false);
    assert.equal(boot.mailboxes.find(item => item.id === mailboxId).canSend,false);
    await closeSheet(page);

    const subject = 'Поставка оборудования · план и сроки';
    const raw = [
      'From: Anna Customer <anna@example.test>',
      'To: Project Team <project-' + suffix + '@example.test>',
      'Subject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=',
      'Date: Tue, 20 Oct 2026 10:30:00 +0000',
      'Message-ID: <customer-' + suffix + '@example.test>',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      'Мария, добрый день!',
      '',
      'Нужен обновлённый план поставки: сроки, состав оборудования и ответственный за согласование.',
      'Подготовьте, пожалуйста, проект к концу недели. После проверки согласуем встречу.',
      '',
      '> Ранее обсуждали базовую комплектацию без дополнительных модулей.',
      '> <script>window.__emailInjected = true</script>',
    ].join('\r\n');
    await page.locator('.cx-email-sidebar [data-email-action="import"]').click();
    await page.locator('.cx-email-sheet [name="eml"]').setInputFiles({name:'customer-request.eml',mimeType:'message/rfc822',buffer:Buffer.from(raw)});
    const imported = waitWrite(page,'/import');
    await page.locator('.cx-email-sheet button[type="submit"]').click();
    const importResponse = await imported;
    assert.equal(importResponse.status(),201);
    const importBody = await importResponse.json();
    const threadId = importBody.thread.id;
    const messageId = importBody.message.id;
    await page.locator('[data-email-message="' + messageId + '"]').waitFor({state:'visible'});
    assert.equal(await page.evaluate(() => Boolean(window.__emailInjected)),false);
    assert.equal(await page.locator('.cx-email-message script').count(),0);
    assert.match(await page.locator('.cx-email-reader-header h2').textContent(),/Поставка оборудования/);
    assert.equal(await page.locator('[data-nav]:visible').filter({has:page.locator('.nav-icon')}).count(),6);

    // Switching mode must not silently copy text from an external draft to a
    // team/private note. Publishing a note must retain the original draft.
    await page.locator('[data-email-action="reply"]').click();
    const composeText = page.locator('[data-email-field="compose-text"]');
    const reply = 'EXTERNAL-' + suffix + ': Подготовим проект плана и предложим время обсуждения.';
    await composeText.fill(reply);
    await page.locator('[data-email-compose-mode="private"]').click();
    assert.equal(await composeText.inputValue(),'');
    const privateNote = 'PRIVATE-' + suffix + ': Уточнить резерв бюджета перед ответом.';
    await composeText.fill(privateNote);
    const privateSaved = waitWrite(page,'/notes');
    await page.locator('[data-email-compose-form] button[type="submit"]').click();
    assert.equal((await privateSaved).status(),201);
    await page.locator('.cx-email-note.is-private').waitFor({state:'visible'});
    await page.locator('[data-email-action="reply"]').click();
    assert.equal(await composeText.inputValue(),reply);
    await page.locator('[data-email-compose-mode="internal"]').click();
    assert.equal(await composeText.inputValue(),'');
    const internalNote = 'TEAM-' + suffix + ': Коллеги, проверьте доступность оборудования.';
    await composeText.fill(internalNote);
    const teamSaved = waitWrite(page,'/notes');
    await page.locator('[data-email-compose-form] button[type="submit"]').click();
    assert.equal((await teamSaved).status(),201);
    await page.locator('.cx-email-note.is-internal').waitFor({state:'visible'});
    await page.locator('[data-email-action="reply"]').click();
    assert.equal(await composeText.inputValue(),reply);
    await page.locator('[data-email-action="save-draft"]').click();
    await page.locator('[data-email-save-state]').filter({hasText:/Сохранено|Saved/}).waitFor({state:'visible'});
    assert.equal(await page.locator('[data-email-compose-form] button[type="submit"]').isDisabled(),true);
    let detail = await (await page.request.get(base + '/api/v1/email/threads/' + threadId)).json();
    assert.equal(detail.drafts.length,1);
    assert.equal(detail.drafts[0].text,reply);
    assert.equal(detail.notes.filter(note => note.kind === 'private').length,1);
    assert.equal(detail.notes.filter(note => note.kind === 'internal').length,1);
    assert.ok(!detail.drafts[0].text.includes('PRIVATE-') && !detail.drafts[0].text.includes('TEAM-'));

    // Attachments use the email ACL endpoint and are actual uploaded bytes.
    const attached = waitWrite(page,'/attachments');
    await page.locator('[data-email-file-input]').setInputFiles({name:'delivery-checklist.txt',mimeType:'text/plain',buffer:Buffer.from('Check scope, stock and acceptance criteria.\n')});
    assert.equal((await attached).status(),201);
    await page.locator('.cx-email-draft-files').filter({hasText:'delivery-checklist.txt'}).waitFor({state:'visible'});
    await page.locator('[data-email-save-state]').filter({hasText:/Сохранено|Saved/}).waitFor({state:'visible'});
    await page.locator('[data-email-action="close-composer"]').click();

    // Waiting is a separate typed record. It does not create/accept a Task.
    await page.locator('[data-email-action="thread-options"]').click();
    await page.locator('.cx-email-sheet [data-email-action="waiting"]').click();
    await page.locator('.cx-email-sheet [name="title"]').fill('Ждём список согласующих');
    await page.locator('.cx-email-sheet [name="externalAddress"]').fill('anna@example.test');
    const waitingSaved = waitWrite(page,'/waiting');
    await page.locator('.cx-email-sheet button[type="submit"]').click();
    assert.equal((await waitingSaved).status(),201);
    await page.locator('[data-email-waiting]').waitFor({state:'visible'});
    detail = await (await page.request.get(base + '/api/v1/email/threads/' + threadId)).json();
    assert.equal(detail.waiting[0].status,'waiting');

    // Create and open an actual canonical Task with explicit audience consent.
    await page.locator('[data-email-message="' + messageId + '"] [data-email-action="message-actions"]').click();
    assert.equal(await page.locator('[data-email-action="assistant"]').isDisabled(),true);
    assert.equal(await page.locator('[data-email-action="booking"]').isDisabled(),true);
    await page.locator('[data-email-action="create-resource"][data-email-kind="task"]').click();
    await page.locator('[data-email-resource-form] [name="title"]').fill('Согласовать план поставки ' + suffix);
    await page.locator('[data-email-resource-form] [name="outcome"]').fill('Проверенный план с датами и составом оборудования');
    await page.locator('[data-email-resource-form] [name="confirmDisclosure"]').check();
    const createdTask = waitWrite(page,'/resource-links');
    await page.locator('[data-email-resource-form] button[type="submit"]').click();
    const taskResponse = await createdTask;
    assert.equal(taskResponse.status(),201);
    const taskResult = await taskResponse.json();
    assert.ok(taskResult.resource.id);
    await page.locator('#task-evidence-form').waitFor({state:'visible'});
    assert.equal((await page.request.get(base + '/api/v1/tasks/' + taskResult.resource.id)).status(),200);
    await page.keyboard.press('Escape');
    await page.locator('#task-evidence-form').waitFor({state:'detached'});
    await page.locator('[data-email-open-kind="task"]').waitFor({state:'visible'});

    // Recovery is opt-in, scoped by session, and never auto-transmits after an
    // offline edit or restoration. Server drafts and private notes remain apart.
    await page.locator('.cx-email-sidebar [data-email-action="settings"]').click();
    await page.locator('[data-email-setting-tab="preferences"]').click();
    await page.locator('[data-email-preferences-form] [name="localRecovery"]').check();
    const preferenceSaved = waitWrite(page,'/preferences','PUT');
    await page.locator('[data-email-preferences-form] button[type="submit"]').click();
    assert.equal((await preferenceSaved).status(),200);
    await page.locator('[data-email-preferences-form] [name="localRecovery"]:checked').waitFor({state:'visible'});
    await closeSheet(page);
    await page.locator('[data-email-action="reply"]').click();
    await context.setOffline(true);
    const offlineText = reply + '\nOFFLINE-' + suffix + ': Сверить спецификацию.';
    await composeText.fill(offlineText);
    assert.match(await page.locator('[data-email-save-state]').textContent(),/нет сети|offline/);
    const writeCount = writes.length;
    await context.setOffline(false);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('[data-email-action="restore-drafts"]').waitFor({state:'visible'});
    await page.locator('[data-email-action="restore-drafts"]').click();
    await page.locator('[data-email-recover]').first().click();
    await composeText.waitFor({state:'visible'});
    assert.equal(await composeText.inputValue(),offlineText);
    assert.equal(writes.slice(writeCount).filter(write => /\/drafts(?:\/|$)/.test(write.path) || /send-intents/.test(write.path)).length,0);
    await page.locator('[data-email-action="save-draft"]').click();
    await page.locator('[data-email-save-state]').filter({hasText:/Сохранено|Saved/}).waitFor({state:'visible'});
    await page.locator('[data-email-action="close-composer"]').click();

    await mkdir(artifacts,{recursive:true});
    await settleToasts(page);
    for (const width of [1440,768,390,375]) {
      await page.setViewportSize({width,height:width > 1000 ? 1000 : 844});
      await page.evaluate(() => window.scrollTo(0,0));
      await page.locator('.cx-email-reader-header').waitFor({state:'visible'});
      const fit = await page.evaluate(() => ({viewport:innerWidth,page:document.documentElement.scrollWidth,email:document.querySelector('#email-workspace').scrollWidth,container:document.querySelector('#email-workspace').clientWidth}));
      assert.ok(fit.page <= fit.viewport + 1,`page overflows at ${width}: ${JSON.stringify(fit)}`);
      assert.ok(fit.email <= fit.container + 1,`email overflows at ${width}: ${JSON.stringify(fit)}`);
      if (width < 981) assert.equal(await page.locator('#mobile-nav [data-nav]').count(),5);
      await page.screenshot({path:new URL('email-' + width + '.png',artifacts).pathname,fullPage:false});
    }

    // RU/EN strings belong to the email module and are not translated twice.
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => window.ChatPreferences.setLocale('en'));
    assert.equal(await page.locator('[data-email-action="thread-options"]').textContent(),'Actions');
    await page.screenshot({path:new URL('email-390-en.png',artifacts).pathname,fullPage:false});
    await page.evaluate(() => window.ChatPreferences.setLocale('ru'));
    await page.locator('[data-email-action="reply"]').click();
    await page.screenshot({path:new URL('email-compose-390.png',artifacts).pathname,fullPage:false});
    await page.locator('[data-email-action="close-composer"]').click();
    await page.locator('[data-email-action="thread-options"]').click();
    await page.locator('.cx-email-sheet [data-email-action="mailbox"]').click();
    await page.locator('[data-email-mailbox-form]').waitFor({state:'visible'});
    await page.screenshot({path:new URL('email-settings-390.png',artifacts).pathname,fullPage:false});
    await closeSheet(page);
    await page.setViewportSize({width:1440,height:1000});

    // Standalone drafts must be discoverable even before they have a thread.
    await page.locator('.cx-email-sidebar [data-email-action="new"]').click();
    await page.locator('[data-email-field="compose-to"]').fill('anna@example.test');
    await page.locator('[data-email-field="compose-subject"]').fill('Standalone ' + suffix);
    await composeText.fill('Новый черновик без входящего письма.');
    await page.locator('[data-email-action="save-draft"]').click();
    await page.locator('[data-email-save-state]').filter({hasText:/Сохранено|Saved/}).waitFor({state:'visible'});
    await page.locator('.cx-email-sidebar [data-email-folder="drafts"]').click();
    const standalone = page.locator('[data-email-draft]').filter({hasText:'Standalone ' + suffix});
    await standalone.waitFor({state:'visible'});
    await standalone.click();
    assert.equal(await page.locator('[data-email-field="compose-subject"]').inputValue(),'Standalone ' + suffix);

    // Reset used by logout clears both the RAM surface and opt-in local copy.
    assert.ok(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('chatx:email:draft-recovery:'))));
    await page.evaluate(() => window.ChatEmail.reset());
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('chatx:email:draft-recovery:'))),false);
    assert.deepEqual(errors,[]);
  });

test('Configured email extras have working UI: AI consent, booking slots and rule preview/CRUD',
  {skip:!databaseUrl,timeout:180000}, async t => {
    // The external model boundary is controlled by this test. All browser
    // requests, ACL admission, drafts, rules and booking records use the real
    // HTTP handlers and PostgreSQL; no email or model request leaves the test.
    const aiCalls = [];
    const assistant = {
      status:() => ({enabled:true,externalProcessing:true,provider:'test',model:'controlled'}),
      rewriteEmail:async input => { aiCalls.push(input); return {text:'Спасибо за запрос. Предлагаю согласовать состав оборудования.'}; },
    };
    const app = await createChatServer({databaseUrl,startMeetingWorker:false,emailWorkerEnabled:false,emailEncryptionKey:randomBytes(32).toString('base64'),emailAssistant:assistant});
    await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
    t.after(() => app.close());
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const browser = await chromium.launch({executablePath});
    t.after(() => browser.close());
    const context = await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'UTC'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error => errors.push(String(error)));
    const suffix = randomUUID().slice(0,8);
    await register(page,base,suffix);
    const mailboxResponse = await page.request.post(base + '/api/v1/mailbox-connections',{data:{providerId:'local',kind:'personal',label:'Заказчики',address:'extras-' + suffix + '@example.test'}});
    assert.equal(mailboxResponse.status(),201);
    const box = (await mailboxResponse.json()).mailbox;
    const source = await page.request.post(base + '/api/v1/mailbox-connections/' + box.id + '/import',{data:{raw:'From: Anna <anna@example.test>\r\nTo: ' + box.address + '\r\nSubject: Equipment review\r\nMessage-ID: <extras-' + suffix + '@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlease review the equipment list. PRIVATE-SOURCE-' + suffix}});
    assert.equal(source.status(),201);
    const imported = await source.json(), threadId = imported.thread.id, messageId = imported.message.id;
    await openEmail(page);
    await page.locator('[data-email-thread="' + threadId + '"]').click();
    const actions = async () => {
      await page.locator('[data-email-message="' + messageId + '"] [data-email-action="message-actions"]').click();
      await page.locator('[data-email-action="assistant"]').waitFor({state:'visible'});
    };

    await actions();
    assert.equal(await page.locator('[data-email-action="assistant"]').isDisabled(),false);
    assert.equal(await page.locator('[data-email-action="booking"]').isDisabled(),false);
    await page.locator('[data-email-action="assistant"]').click();
    await page.locator('.cx-email-sheet [name="mode"]').selectOption('rewrite');
    await page.locator('.cx-email-sheet [name="text"]').fill('Уточним комплектацию.');
    await page.locator('.cx-email-sheet [name="instruction"]').fill('Коротко, без обещания срока.');
    assert.equal(await page.locator('.cx-email-sheet [name="consent"]').evaluate(node => node.checkValidity()),false);
    assert.equal(aiCalls.length,0);
    await page.locator('.cx-email-sheet [name="consent"]').check();
    const suggestion = waitWrite(page,'/assistant');
    await page.locator('.cx-email-sheet form [type="submit"]').click();
    const suggestionResponse = await suggestion;
    assert.equal(suggestionResponse.status(),200);
    assert.deepEqual(aiCalls,[{text:'Уточним комплектацию.',instruction:'Коротко, без обещания срока.'}]);
    await page.locator('.cx-email-result-text').waitFor({state:'visible'});
    assert.equal((await (await page.request.get(base + '/api/v1/email/drafts')).json()).items.length,0);
    await page.locator('[data-email-action="use-suggestion"]').click();
    assert.equal(await page.locator('[data-email-field="compose-text"]').inputValue(),'Спасибо за запрос. Предлагаю согласовать состав оборудования.');
    await page.locator('[data-email-action="save-draft"]').click();
    await page.locator('[data-email-save-state]').filter({hasText:/Сохранено|Saved/}).waitFor({state:'visible'});
    await page.locator('[data-email-action="close-composer"]').click();

    await actions();
    await page.locator('[data-email-action="booking"]').click();
    assert.equal(await page.locator('.cx-email-sheet [name="title"]').inputValue(),'Встреча');
    await page.locator('.cx-email-sheet [name="title"]').fill('Обсуждение комплектации');
    await page.locator('.cx-email-sheet [name="durationMinutes"]').fill('60');
    await page.locator('.cx-email-sheet [name="title"]').click();
    await page.locator('.cx-email-sheet [name="confirmDisclosure"]').check();
    const booking = waitWrite(page,'/booking-links');
    await page.locator('.cx-email-sheet form [type="submit"]').click();
    const bookingResponse = await booking;
    assert.equal(bookingResponse.status(),201);
    const bookingRequest = bookingResponse.request().postDataJSON();
    assert.equal(bookingRequest.timezone,'UTC');
    assert.equal(bookingRequest.confirmDisclosure,true);
    assert.ok(bookingRequest.slots.every(slot => Date.parse(slot.endAt) - Date.parse(slot.startAt) === 3600000));
    const bookingResult = await bookingResponse.json();
    assert.equal(bookingResult.bookingLink.title,'Обсуждение комплектации');
    assert.equal(bookingResult.bookingLink.slots.length,2);
    await page.locator('[data-email-action="insert-link"]').waitFor({state:'visible'});
    await page.locator('[data-email-action="insert-link"]').click();
    assert.ok((await page.locator('[data-email-field="compose-text"]').inputValue()).includes(bookingResult.url));
    // The real public booking page exposes the deliberate title and slots, not
    // the email source. Confirmation itself is covered by the canonical test.
    const publicPage = await context.newPage();
    await publicPage.setViewportSize({width:390,height:844});
    await publicPage.goto(base + bookingResult.url);
    await publicPage.locator('#booking-form').waitFor({state:'visible'});
    assert.equal(await publicPage.locator('#booking-title').textContent(),'Обсуждение комплектации');
    assert.ok(!(await publicPage.locator('body').textContent()).includes('PRIVATE-SOURCE-' + suffix));
    await mkdir(artifacts,{recursive:true});
    await publicPage.screenshot({path:new URL('email-booking-390.png',artifacts).pathname,fullPage:false});
    await publicPage.close();
    await page.locator('[data-email-action="save-draft"]').click();
    await page.locator('[data-email-save-state]').filter({hasText:/Сохранено|Saved/}).waitFor({state:'visible'});
    await page.locator('[data-email-action="close-composer"]').click();

    await page.locator('[data-email-action="thread-options"]').click();
    await page.locator('.cx-email-sheet [data-email-action="mailbox"]').click();
    await page.locator('[data-email-action="rules"]').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-email-action="rules"]').isDisabled(),false);
    await page.locator('[data-email-action="rules"]').click();
    await page.locator('[data-email-action="new-rule"]').click();
    await page.locator('.cx-email-sheet [name="name"]').fill('Письма Анны');
    await page.locator('.cx-email-sheet [name="fromIncludes"]').fill('anna@example.test');
    await page.locator('.cx-email-sheet [name="archived"]').check();
    const preview = waitWrite(page,'/rules/preview');
    await page.locator('[data-email-action="preview-rule"]').click();
    assert.equal((await preview).status(),200);
    await page.locator('[data-email-rule-preview]').filter({hasText:'Совпадений: 1'}).waitFor({state:'visible'});
    assert.equal((await (await page.request.get(base + '/api/v1/email/threads/' + threadId)).json()).thread.archived,false);
    const ruleCreated = waitWrite(page,'/rules');
    await page.locator('.cx-email-sheet form [type="submit"]').click();
    assert.equal((await ruleCreated).status(),201);
    await page.locator('[data-email-action="edit-rule"]').click();
    await page.locator('.cx-email-sheet [name="name"]').fill('Письма Анны — обработка');
    await page.locator('.cx-email-sheet [name="enabled"]').uncheck();
    const ruleUpdated = page.waitForResponse(response => response.request().method() === 'PATCH' && /\/email\/rules\//.test(response.url()));
    await page.locator('.cx-email-sheet form [type="submit"]').click();
    assert.equal((await ruleUpdated).status(),200);
    await page.locator('.cx-email-template-list').filter({hasText:'Письма Анны — обработка'}).waitFor({state:'visible'});
    const rules = (await (await page.request.get(base + '/api/v1/email/mailboxes/' + box.id + '/rules')).json()).items;
    assert.equal(rules[0].enabled,false);
    assert.deepEqual(rules[0].condition,{fromIncludes:'anna@example.test'});
    assert.deepEqual(rules[0].action,{archived:true});
    const ruleDeleted = page.waitForResponse(response => response.request().method() === 'DELETE' && /\/email\/rules\//.test(response.url()));
    await page.locator('[data-email-action="delete-rule"]').click();
    assert.equal((await ruleDeleted).status(),200);
    await page.locator('[data-email-action="new-rule"]').waitFor({state:'visible'});
    assert.equal((await (await page.request.get(base + '/api/v1/email/mailboxes/' + box.id + '/rules')).json()).items.length,0);
    await closeSheet(page);

    // Deleting a draft reaches the versioned server command and preserves the
    // source email; the next open cannot silently resurrect that draft.
    await page.locator('[data-email-action="reply"]').click();
    await page.locator('[data-email-action="discard-draft"]').click();
    const deleted = page.waitForResponse(response => response.request().method() === 'DELETE' && /\/email\/drafts\//.test(response.url()));
    await page.locator('.cx-email-sheet form [type="submit"]').click();
    assert.equal((await deleted).status(),200);
    await page.locator('[data-email-action="reply"]').waitFor({state:'visible'});
    const detail = await (await page.request.get(base + '/api/v1/email/threads/' + threadId)).json();
    assert.equal(detail.drafts.length,0);
    assert.equal(detail.messages.length,1);
    assert.deepEqual(errors,[]);
  });

test('Remote mailbox UI verifies config, templates, version conflicts, queue/cancel and controlled dispatch',
  {skip:!databaseUrl,timeout:180000}, async t => {
    const suffix = randomUUID().slice(0,8), verifications = [];
    let syncs = 0, sends = 0, allowDispatch = false;
    const provider = {
      async verify(config) {
        verifications.push(config);
        return {address:config.email,aliases:[config.email],capabilities:{read:true,send:true},fromVerification:'test_authenticated'};
      },
      async sync(config) {
        syncs++;
        const subject = 'Состав оборудования для согласования';
        const raw = 'From: Anna <anna@example.test>\r\nTo: ' + config.email + '\r\nSubject: ' + subject + '\r\nMessage-ID: <remote-' + suffix + '@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nПожалуйста, уточните комплектацию перед встречей.';
        return {messages:[{subject,from:{name:'Anna',address:'anna@example.test'},to:[{address:config.email}],text:'Пожалуйста, уточните комплектацию перед встречей.',internetMessageId:'<remote-' + suffix + '@example.test>',providerMessageId:'imap:INBOX:1:1',remoteUid:1,raw:Buffer.from(raw),bodyStatus:'complete'}],cursor:{folder:'INBOX',uidValidity:'1',lastUid:1},hasMore:false};
      },
      async send(_config, payload) {
        sends++;
        assert.equal(allowDispatch,true,'A cancelled UI send must not reach the provider');
        return {status:'provider_accepted',providerMessageId:payload.messageId,partial:true,accepted:['anna@example.test'],rejected:['missing@example.test'],sentCopy:{status:'unknown',errorCode:'EMAIL_SENT_COPY_UNKNOWN'},...await composeEmail(payload)};
      },
    };
    const app = await createChatServer({databaseUrl,startMeetingWorker:false,emailWorkerEnabled:false,emailEncryptionKey:randomBytes(32).toString('base64'),emailProvider:provider,emailAssistant:{status:() => ({enabled:false})}});
    await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
    t.after(() => app.close());
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const browser = await chromium.launch({executablePath});
    t.after(() => browser.close());
    const context = await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'UTC'});
    const page = await context.newPage(), errors = [];
    page.on('pageerror',error => errors.push(String(error)));
    await register(page,base,suffix);
    await openEmail(page);
    await page.locator('.cx-email-sidebar [data-email-action="settings"]').click();
    const connection = page.locator('[data-email-connection-form]');
    await connection.locator('[name="providerId"]').selectOption('custom');
    await connection.locator('[name="label"]').fill('Рабочая почта · проверка интерфейса');
    const address = 'remote-ui-' + suffix + '@example.test';
    await connection.locator('[name="address"]').fill(address);
    await connection.locator('[name="username"]').fill(address);
    await connection.locator('[name="password"]').fill('controlled-test-app-password');
    await connection.locator('[name="imapHost"]').fill('imap.example.test');
    await connection.locator('[name="smtpHost"]').fill('smtp.example.test');
    await connection.locator('[name="imapPort"]').fill('143');
    await connection.locator('[name="smtpPort"]').fill('587');
    const connected = waitWrite(page,'/api/v1/mailbox-connections');
    await connection.locator('[type="submit"]').click();
    const connectedResponse = await connected;
    assert.equal(connectedResponse.status(),201);
    const connectedBody = await connectedResponse.json(), box = connectedBody.mailbox;
    assert.equal(box.connectionState,'connected');
    assert.equal(box.canSend,true);
    assert.equal(JSON.stringify(connectedBody).includes('controlled-test-app-password'),false);
    assert.equal(verifications.length,1);
    assert.deepEqual(verifications[0],{username:address,password:'controlled-test-app-password',imap:{host:'imap.example.test',port:143,secure:false},smtp:{host:'smtp.example.test',port:587,secure:false},provider:'custom',email:address,displayName:'Рабочая почта · проверка интерфейса'});
    await page.locator('[data-email-mailbox-row="' + box.id + '"]').waitFor({state:'visible'});
    const synced = waitWrite(page,'/sync');
    await page.locator('[data-email-mailbox-row="' + box.id + '"] [data-email-action="sync-mailbox"]').click();
    assert.equal((await synced).status(),200);
    assert.equal(syncs,1);
    await page.locator('[data-email-mailbox-row="' + box.id + '"]').filter({hasText:'Последняя синхронизация'}).waitFor({state:'visible'});

    const signature = 'Мария Фёдорова\nКоманда проекта';
    await page.locator('[data-email-setting-tab="preferences"]').click();
    await page.locator('[data-email-preferences-form] [name="signature"]').fill(signature);
    const savedPreferences = waitWrite(page,'/preferences','PUT');
    await page.locator('[data-email-preferences-form] button[type="submit"]').click();
    assert.equal((await savedPreferences).status(),200);
    await page.locator('[data-email-setting-tab="templates"]').click();
    await page.locator('[data-email-action="new-template"]').click();
    await page.locator('.cx-email-sheet [name="name"]').fill('Согласование комплектации');
    await page.locator('.cx-email-sheet [name="language"]').selectOption('es');
    await page.locator('.cx-email-sheet [name="subject"]').fill('План обсуждения');
    const templateText = 'Gracias por su mensaje. Revisaremos la lista de equipos.';
    await page.locator('.cx-email-sheet [name="text"]').fill(templateText);
    const savedTemplate = waitWrite(page,'/templates');
    await page.locator('.cx-email-sheet form [type="submit"]').click();
    assert.equal((await savedTemplate).status(),201);
    await page.locator('.cx-email-template-list').filter({hasText:'Согласование комплектации'}).waitFor({state:'visible'});
    await closeSheet(page);

    await page.locator('.cx-email-sidebar [data-email-action="new"]').click();
    assert.equal(await page.locator('[data-email-compose-form] button[type="submit"]').isDisabled(),false);
    await page.locator('[data-email-action="templates"]').click();
    await page.locator('[data-email-use-template]').filter({hasText:'Согласование комплектации'}).click();
    assert.equal(await page.locator('[data-email-field="compose-text"]').inputValue(),templateText);
    assert.equal(await page.locator('[data-email-field="compose-subject"]').inputValue(),'План обсуждения');
    await page.locator('[data-email-field="compose-to"]').fill('"Customer, Anna" <anna@example.test>');
    await page.locator('[data-email-action="show-cc"]').click();
    await page.locator('[data-email-field="compose-cc"]').fill('team@example.test');
    await page.locator('[data-email-field="compose-bcc"]').fill('archive@example.test');
    await page.locator('[data-email-action="signature"]').click();
    assert.equal(await page.locator('[data-email-field="compose-text"]').inputValue(),templateText + '\n\n' + signature);
    await page.locator('[data-email-action="save-draft"]').click();
    await page.locator('[data-email-save-state]').filter({hasText:/Сохранено|Saved/}).waitFor({state:'visible'});
    const drafts = (await (await page.request.get(base + '/api/v1/email/drafts')).json()).items;
    assert.equal(drafts[0].fromAddress,address);
    assert.deepEqual(drafts[0].to,[{address:'anna@example.test',name:'Customer, Anna'}]);
    assert.equal(drafts[0].cc[0].address,'team@example.test');
    assert.equal(drafts[0].bcc[0].address,'archive@example.test');
    assert.equal(drafts[0].threadId,null);
    assert.equal(drafts[0].text,templateText + '\n\n' + signature);

    await page.locator('[data-email-action="schedule"]').click();
    assert.match(await page.locator('.cx-email-send-review').textContent(),/archive@example.test/);
    const scheduled = waitWrite(page,'/send-intents');
    await page.locator('.cx-email-sheet form [type="submit"]').click();
    const scheduledResponse = await scheduled;
    assert.equal(scheduledResponse.status(),202);
    const scheduledIntent = (await scheduledResponse.json()).sendIntent;
    assert.equal(scheduledIntent.status,'scheduled');
    await page.locator('[data-email-send-intent="' + scheduledIntent.id + '"]').filter({hasText:'Запланировано'}).waitFor({state:'visible'});
    await settleToasts(page);
    await mkdir(artifacts,{recursive:true});
    await page.screenshot({path:new URL('email-send-queue-1440.png',artifacts).pathname,fullPage:false});
    const cancelledSchedule = waitWrite(page,'/cancel');
    await page.locator('[data-email-send-intent="' + scheduledIntent.id + '"] [data-email-action="cancel-send"]').click();
    assert.equal((await cancelledSchedule).status(),200);
    await page.locator('[data-email-send-intent="' + scheduledIntent.id + '"]').filter({hasText:'Отменено'}).waitFor({state:'visible'});

    const threads = (await (await page.request.get(base + '/api/v1/email/threads?mailboxId=' + box.id)).json()).items;
    const thread = threads.find(item => item.subject === 'Состав оборудования для согласования');
    assert.ok(thread);
    await page.locator('.cx-email-sidebar [data-email-folder="inbox"]').click();
    await page.locator('[data-email-thread="' + thread.id + '"]').click();
    await page.locator('[data-email-action="reply"]').click();
    assert.match(await page.locator('[data-email-field="compose-to"]').inputValue(),/anna@example.test/);
    await page.locator('[data-email-field="compose-text"]').fill('Согласуем комплектацию на встрече.');
    await page.locator('[data-email-compose-mode="private"]').click();
    await page.locator('[data-email-field="compose-text"]').fill('Неопубликованная личная заметка.');
    await page.locator('[data-email-compose-mode="external"]').click();
    assert.equal(await page.locator('[data-email-field="compose-text"]').inputValue(),'Согласуем комплектацию на встрече.');
    await page.locator('[data-email-action="save-draft"]').click();
    await page.locator('[data-email-save-state]').filter({hasText:/Сохранено|Saved/}).waitFor({state:'visible'});
    const replyDraft = (await (await page.request.get(base + '/api/v1/email/threads/' + thread.id)).json()).drafts[0];
    assert.ok(replyDraft.replyToMessageId);
    // A stale local version cannot silently replace the remote one or send.
    const changed = await page.request.patch(base + '/api/v1/email/drafts/' + replyDraft.id,{data:{expectedVersion:replyDraft.version,text:'Версия из другого окна.'}});
    assert.equal(changed.status(),200);
    await page.locator('[data-email-field="compose-text"]').fill('Проверенная версия ответа.');
    const conflict = waitWrite(page,'/drafts/' + replyDraft.id,'PATCH');
    await page.locator('[data-email-action="save-draft"]').click();
    assert.equal((await conflict).status(),409);
    await page.locator('[data-email-action="resolve-draft"]').click();
    await page.locator('.cx-email-compare').filter({hasText:'Версия из другого окна.'}).waitFor({state:'visible'});
    await page.locator('[data-email-action="keep-local"]').click();
    await page.locator('.cx-email-sheet').waitFor({state:'detached'});
    await page.locator('[data-email-save-state]').filter({hasText:/Сохранено|Saved/}).waitFor({state:'visible'});
    await page.locator('[data-email-compose-form] button[type="submit"]').click();
    const queued = waitWrite(page,'/send-intents');
    await page.locator('.cx-email-sheet form [type="submit"]').click();
    const queuedResponse = await queued;
    assert.equal(queuedResponse.status(),202);
    const intent = (await queuedResponse.json()).sendIntent;
    assert.equal(intent.status,'queued');
    await page.evaluate(async ({intentId,mailboxId}) => window.ChatEmail.openQueue({intentId,mailboxId}),{intentId:intent.id,mailboxId:box.id});
    await page.locator('[data-email-send-intent="' + intent.id + '"]').filter({hasText:'В очереди'}).waitFor({state:'visible'});
    const cancelled = waitWrite(page,'/cancel');
    await page.locator('[data-email-send-intent="' + intent.id + '"] [data-email-action="cancel-send"]').click();
    assert.equal((await cancelled).status(),200);
    const finalIntent = (await (await page.request.get(base + '/api/v1/email/send-intents/' + intent.id)).json()).sendIntent;
    assert.equal(finalIntent.status,'cancelled');
    assert.equal(sends,0);
    await page.evaluate(id => window.ChatEmail.openThread(id),thread.id);
    assert.equal(await page.locator('[data-email-compose-mode="private"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-email-field="compose-text"]').inputValue(),'Неопубликованная личная заметка.');

    // Dispatch only this workspace through the real durable outbox. The
    // controlled provider returns actual composed MIME and a partial outcome;
    // no external network call is made and other test workspaces are untouched.
    allowDispatch = true; app.email.undoMs = 0;
    await page.locator('.cx-email-sidebar [data-email-action="new"]').click();
    await page.locator('[data-email-field="compose-to"]').fill('anna@example.test, missing@example.test');
    await page.locator('[data-email-field="compose-subject"]').fill('Проверка статуса отправки');
    await page.locator('[data-email-field="compose-text"]').fill('Проверяем принятие провайдером и копию в отправленных отдельно.');
    await page.locator('[data-email-compose-form] button[type="submit"]').click();
    const dispatchQueued = waitWrite(page,'/send-intents');
    await page.locator('.cx-email-sheet form [type="submit"]').click();
    const dispatchResponse = await dispatchQueued;
    assert.equal(dispatchResponse.status(),202);
    const dispatchIntent = (await dispatchResponse.json()).sendIntent;
    const session = (await (await page.request.get(base + '/api/v1/bootstrap')).json()).session;
    assert.deepEqual(await app.email.processOutbox({workspaceId:session.workspaceId}),{processed:1});
    assert.equal(sends,1);
    await page.locator('[data-email-send-intent="' + dispatchIntent.id + '"] [data-email-action="check-send"]').click();
    const resultCard = page.locator('[data-email-send-intent="' + dispatchIntent.id + '"]');
    await resultCard.filter({hasText:'Принято только для части адресатов'}).waitFor({state:'visible'});
    assert.match(await resultCard.textContent(),/anna@example.test/);
    assert.match(await resultCard.textContent(),/Отклонены: missing@example.test/);
    assert.match(await resultCard.textContent(),/Сохранение копии в отправленных не подтверждено/);
    assert.equal(await resultCard.locator('[data-email-action="cancel-send"]').count(),0);
    const queueRow = page.locator('[data-email-intent="' + dispatchIntent.id + '"]');
    assert.match(await queueRow.textContent(),/Частичный приём/);
    assert.doesNotMatch(await queueRow.textContent(),/В очереди/);
    const completedIntent = (await (await page.request.get(base + '/api/v1/email/send-intents/' + dispatchIntent.id)).json()).sendIntent;
    assert.equal(completedIntent.status,'provider_accepted');
    assert.ok(completedIntent.sentMessageId);
    const original = await page.request.get(base + '/api/v1/email/messages/' + completedIntent.sentMessageId + '/original');
    assert.equal(original.status(),200);
    assert.match(await original.text(),/MIME-Version: 1.0/);
    await settleToasts(page);
    await page.screenshot({path:new URL('email-send-result-1440.png',artifacts).pathname,fullPage:false});
    assert.deepEqual(errors,[]);
  });
