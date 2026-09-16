import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';

async function request(base, path, { cookie, method = 'GET' } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: cookie ? { cookie } : {},
  });
  const payload = await response.json().catch(() => null);
  return {
    response,
    payload,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
  };
}

test('preview demo is seeded and opens a populated owner workspace in one click', async (t) => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  t.after(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  const app = await createChatServer({ demoEnabled: true });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const status = await request(base, '/api/v1/demo');
  assert.equal(status.response.status, 200);
  assert.equal(status.payload.enabled, true);
  assert.equal(status.payload.label, 'Northstar Studio');

  const login = await request(base, '/api/v1/auth/demo', { method: 'POST' });
  assert.equal(login.response.status, 200);
  assert.ok(login.cookie);
  assert.equal(login.payload.session.role, 'owner');
  assert.equal(login.payload.session.organizationName, 'Northstar Studio');

  const bootstrap = await request(base, '/api/v1/bootstrap', { cookie: login.cookie });
  assert.equal(bootstrap.response.status, 200);
  assert.equal(bootstrap.payload.people.length, 6);
  assert.ok(bootstrap.payload.conversations.length >= 6);
  assert.ok(bootstrap.payload.conversations.some((item) => item.slug === 'product'));
  assert.ok(bootstrap.payload.conversations.some((item) => item.kind === 'direct'));

  const tasks = await request(base, '/api/v1/tasks', { cookie: login.cookie });
  assert.equal(tasks.response.status, 200);
  assert.equal(tasks.payload.items.length, 6);
  assert.ok(tasks.payload.items.some((item) => item.status === 'blocked'));
  assert.ok(tasks.payload.items.some((item) => item.priority === 'urgent'));

  const calendar = await request(base, '/api/v1/calendar-events', { cookie: login.cookie });
  assert.equal(calendar.response.status, 200);
  assert.equal(calendar.payload.items.length, 4);

  const product = bootstrap.payload.conversations.find((item) => item.slug === 'product');
  const messages = await request(base, `/api/v1/conversations/${product.id}/messages`, { cookie: login.cookie });
  assert.equal(messages.response.status, 200);
  assert.ok(messages.payload.items.some((item) => item.kind === 'file'));
  assert.ok(messages.payload.items.some((item) => item.kind === 'voice'));
});

test('demo login stays unavailable unless demo mode is explicitly enabled', async (t) => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  t.after(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  const app = await createChatServer({ demoEnabled: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const status = await request(base, '/api/v1/demo');
  assert.equal(status.response.status, 200);
  assert.equal(status.payload.enabled, false);

  const login = await request(base, '/api/v1/auth/demo', { method: 'POST' });
  assert.equal(login.response.status, 404);
  assert.equal(login.payload.error.code, 'DEMO_DISABLED');
});
