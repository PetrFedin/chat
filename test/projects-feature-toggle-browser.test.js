import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

test('Projects feature switch removes navigation, rejects deep links, then restores canonical project',
  { skip: !databaseUrl, timeout: 90000 }, async (t) => {
    const app = await createChatServer({ databaseUrl, startMeetingWorker: false });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    t.after(() => app.close());
    const base = 'http://127.0.0.1:' + app.server.address().port;

    const browser = await chromium.launch();
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    t.after(() => context.close());
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-auth-mode="register"]').click();
    const suffix = randomUUID().slice(0, 8);
    await page.locator('#register-form [name="companyName"]').fill('Feature browser ' + suffix);
    await page.locator('#register-form [name="ownerName"]').fill('Owner');
    await page.locator('#register-form [name="email"]').fill('feature-browser-' + suffix + '@example.test');
    await page.locator('#register-form [name="password"]').fill('FeatureBrowserPassword42');
    await page.locator('#register-form button[type="submit"]').click();
    await page.locator('#app-view').waitFor({ state: 'visible', timeout: 10000 });

    const created = await context.request.post(base + '/api/v1/projects', {
      data: { name: 'Persistent project ' + suffix, goal: 'Survive company feature switches' },
    });
    assert.equal(created.status(), 201);
    const project = (await created.json()).project;

    await page.locator('#desktop-nav [data-nav="projects"]').waitFor({ state: 'visible', timeout: 10000 });

    const off = await context.request.put(base + '/api/v1/features/projects', { data: { enabled: false } });
    assert.equal(off.status(), 200);
    await page.locator('#desktop-nav [data-nav="projects"]').waitFor({ state: 'detached', timeout: 10000 });

    await page.evaluate((id) => { location.hash = '#/projects/' + id; }, project.id);
    await page.waitForFunction(() => location.hash === '#/today', null, { timeout: 10000 });
    assert.equal(await page.locator('#desktop-nav [data-nav="projects"]').count(), 0);

    const hidden = await context.request.get(base + '/api/v1/projects/' + project.id);
    assert.equal(hidden.status(), 404);
    assert.equal((await hidden.json()).error.code, 'FEATURE_DISABLED');

    const on = await context.request.put(base + '/api/v1/features/projects', { data: { enabled: true } });
    assert.equal(on.status(), 200);
    await page.locator('#desktop-nav [data-nav="projects"]').waitFor({ state: 'visible', timeout: 10000 });

    const restored = await context.request.get(base + '/api/v1/projects/' + project.id);
    assert.equal(restored.status(), 200);
    assert.equal((await restored.json()).project.name, project.name);

    assert.deepEqual(pageErrors, [], 'feature switching must not raise an unhandled browser error');
  });
