import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

test('Page Task picker on 390px browser links, unlinks and opens canonical Task',
  { skip: !databaseUrl }, async t => {
    const app = await createChatServer({ databaseUrl, startMeetingWorker: false });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    t.after(() => app.close());
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));

    await page.goto(base);
    await page.locator('[data-auth-mode="register"]').click();
    const suffix = randomUUID().slice(0, 8);
    await page.locator('#register-form [name="companyName"]').fill('Task picker ' + suffix);
    await page.locator('#register-form [name="ownerName"]').fill('Owner');
    await page.locator('#register-form [name="email"]').fill('task-picker-' + suffix + '@example.test');
    await page.locator('#register-form [name="password"]').fill('TaskPickerPassword42');
    await page.locator('#register-form button[type="submit"]').click();
    await page.locator('#app-view').waitFor({ state: 'visible' });

    const taskResponse = await page.request.post(base + '/api/v1/tasks', {
      data: { title: 'Page-linked task ' + suffix, outcome: 'Proof that Task remains canonical' },
    });
    assert.equal(taskResponse.status(), 201);
    const task = (await taskResponse.json()).task;
    const pageResponse = await page.request.post(base + '/api/v1/wiki/pages', {
      data: { title: 'Execution page ' + suffix, content: 'Task relation browser flow' },
    });
    assert.equal(pageResponse.status(), 201);
    const wiki = await pageResponse.json();

    await page.locator('[data-nav="more"]:visible').click();
    await page.locator('[data-action="wiki"]').click();
    await page.locator('[data-wiki-open="' + wiki.id + '"]').click();
    await page.locator('[data-wiki-task-new]').waitFor({ state: 'visible' });
    await page.locator('[data-wiki-task-new]').click();
    const candidate = page.locator('[data-wiki-task-select="' + task.id + '"]');
    await candidate.waitFor({ state: 'visible' });
    await candidate.click();

    const relation = page.locator('[data-wiki-task-row="' + task.id + '"]');
    await relation.waitFor({ state: 'visible' });
    assert.match(await relation.textContent(), new RegExp('Page-linked task ' + suffix));

    // Removing a relation must not delete the actual commitment.
    await relation.locator('[data-wiki-task-remove]').click();
    await relation.waitFor({ state: 'detached' });
    const afterUnlink = await page.request.get(base + '/api/v1/tasks/' + task.id);
    assert.equal(afterUnlink.status(), 200);

    // The selector must be usable a second time, including its async state.
    await page.locator('[data-wiki-task-new]').click();
    await page.locator('[data-wiki-task-select="' + task.id + '"]').click();
    await page.locator('[data-wiki-task-row="' + task.id + '"]').waitFor({ state: 'visible' });
    await page.locator('[data-wiki-task-open="' + task.id + '"]').click();
    await page.getByText('Page-linked task ' + suffix).first().waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
  });
