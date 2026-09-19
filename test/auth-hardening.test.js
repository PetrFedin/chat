import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';
import { createAuthThrottle, createRateLimiter } from '../src/rate-limit.js';
import { MemoryStore } from '../src/persistence/store.js';

const OWNER = { companyName: 'Northstar', ownerName: 'Vera', email: 'vera@northstar.test', password: 'Workspace2026pass' };

async function startServer(options = {}) {
  const app = await createChatServer({ store: new MemoryStore(), startMeetingWorker: false, ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const call = (path, init = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  return { app, call, close: () => app.close() };
}

test('fixed-window limiter releases the caller once the window rolls over', () => {
  let clock = 0;
  const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: () => clock });
  assert.equal(limiter.check('k').allowed, true);
  assert.equal(limiter.check('k').allowed, true);
  assert.equal(limiter.check('k').allowed, false);
  clock += 1001;
  assert.equal(limiter.check('k').allowed, true);
});

test('login throttles a single account before the password is ever checked', async (t) => {
  const throttle = createAuthThrottle({ AUTH_RATE_LIMIT_MAX_PER_IP: '100', AUTH_RATE_LIMIT_MAX_PER_IDENTITY: '3' });
  const { call, close } = await startServer({ authThrottle: throttle });
  t.after(close);

  const register = await call('/api/v1/auth/register-company', { method: 'POST', body: JSON.stringify(OWNER) });
  assert.equal(register.status, 201);

  const attempt = () => call('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: OWNER.email, password: 'wrong-password-1' }),
  });

  assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 401);

  const blocked = await attempt();
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error.code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0, 'a throttled caller is told when to come back');
});

test('a successful login clears the account counter', async (t) => {
  const throttle = createAuthThrottle({ AUTH_RATE_LIMIT_MAX_PER_IP: '100', AUTH_RATE_LIMIT_MAX_PER_IDENTITY: '3' });
  const { call, close } = await startServer({ authThrottle: throttle });
  t.after(close);

  await call('/api/v1/auth/register-company', { method: 'POST', body: JSON.stringify(OWNER) });
  await call('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: OWNER.email, password: 'nope-nope-1234' }) });

  const good = await call('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: OWNER.email, password: OWNER.password }) });
  assert.equal(good.status, 200);

  for (let i = 0; i < 3; i += 1) {
    const retry = await call('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: OWNER.email, password: 'nope-nope-1234' }) });
    assert.equal(retry.status, 401, 'counter restarted from zero after the success');
  }
});

test('login rejects a workspace the account does not belong to', async (t) => {
  const { call, close } = await startServer();
  t.after(close);

  await call('/api/v1/auth/register-company', { method: 'POST', body: JSON.stringify(OWNER) });
  const response = await call('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: OWNER.email, password: OWNER.password, workspaceId: '00000000-0000-4000-8000-000000000000' }),
  });

  assert.equal(response.status, 401, 'a foreign workspaceId is a credential failure, not a 500');
  assert.equal((await response.json()).error.code, 'INVALID_CREDENTIALS');
  assert.equal(response.headers.get('set-cookie'), null, 'no session cookie is issued');
});

test('an unknown email costs the same work as a known one', async (t) => {
  const { call, close } = await startServer();
  t.after(close);

  await call('/api/v1/auth/register-company', { method: 'POST', body: JSON.stringify(OWNER) });

  const time = async (email) => {
    const started = process.hrtime.bigint();
    await call('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'wrong-password-1' }) });
    return Number(process.hrtime.bigint() - started) / 1e6;
  };

  const known = await time(OWNER.email);
  const unknown = await time('ghost@northstar.test');
  const ratio = Math.max(known, unknown) / Math.max(1, Math.min(known, unknown));
  assert.ok(ratio < 4, `timings must stay comparable, got known=${known.toFixed(1)}ms unknown=${unknown.toFixed(1)}ms`);
});

test('every response carries the security header set', async (t) => {
  const { call, close } = await startServer();
  t.after(close);

  const response = await call('/healthz');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' blob:/);
  assert.doesNotMatch(csp, /unsafe-inline[^;]*script/, 'inline script must stay blocked');
  assert.match(csp, /frame-ancestors 'none'/);
});

test('the served page has no inline script for CSP to block', async (t) => {
  const { call, close } = await startServer();
  t.after(close);

  const html = await (await call('/')).text();
  assert.doesNotMatch(html, /<script>/, 'theme bootstrap moved to /theme-boot.js');
  assert.match(html, /<script src="\/theme-boot\.js"><\/script>/);
  assert.equal((await call('/theme-boot.js')).status, 200);
});
