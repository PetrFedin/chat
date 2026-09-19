import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clientAddress, serverOnlyMessageKinds, trustsProxy } from '../src/http/helpers.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * Regressions for defects found by the audit pass. Each one is a thing that
 * worked and should not have.
 */

test('X-Forwarded-For counts only where a proxy is declared', () => {
  const spoofed = { headers: { 'x-forwarded-for': '10.9.9.9' }, socket: { remoteAddress: '203.0.113.7' } };
  // Trusting the header unconditionally let a credential spray rotate it and
  // skip the per-address limiter entirely.
  assert.equal(clientAddress(spoofed, {}), '203.0.113.7', 'the real socket wins by default');
  assert.equal(clientAddress(spoofed, { TRUST_PROXY: 'true' }), '10.9.9.9', 'and the header wins only when declared');
  assert.equal(trustsProxy({}), false, 'the safe setting is the default');
  assert.equal(clientAddress({ headers: {}, socket: {} }, {}), null);
});

test('message kinds the server authors are refused from a client', async () => {
  assert.deepEqual([...serverOnlyMessageKinds].sort(), ['calendar', 'call', 'system', 'task']);
  const source = await read('src/http/messaging.js');
  assert.match(source, /serverOnlyMessageKinds\.has\(kind\)/);
  assert.match(source, /MESSAGE_KIND_RESERVED/, 'a member forging a system notice fabricates an audit-looking line');
});

test('a guest cannot administer a room they were let into', async () => {
  const source = await read('src/http/messaging.js');
  const guards = source.match(/GUEST_CANNOT_MANAGE/g) ?? [];
  assert.ok(guards.length >= 3, 'add, role change and removal all need the guard');
});

test('marking read creates the row it needs and rejects a foreign cursor', async () => {
  const source = await read('src/persistence/postgres-store.js');
  // Somebody reaching a channel by workspace visibility has no member row, so
  // the old bare UPDATE matched nothing and the unread badge never cleared.
  assert.match(source, /async markRead[\s\S]{0,700}INSERT INTO conversation_members/);
  assert.match(source, /MESSAGE_NOT_IN_CONVERSATION/);
});

test('a call nobody answered can be closed, and declining one works', async () => {
  const source = await read('src/media/call-repository.js');
  // ended_at without started_at violates a CHECK, so ending a ringing call
  // surfaced a driver error to the caller as "your input is invalid".
  assert.match(source, /state=CASE WHEN started_at IS NULL THEN 'cancelled' ELSE 'ended' END/);
  assert.match(source, /left_at=CASE WHEN joined_at IS NULL THEN left_at ELSE now\(\) END/);
});

test('recording consent belongs to one sitting and one recording', async () => {
  const source = await read('src/media/call-repository.js');
  assert.match(source, /recording_consented_at=CASE WHEN call_participants\.left_at IS NOT NULL THEN NULL/, 'leaving and returning asks again');
  assert.match(source, /UPDATE call_participants SET recording_consented_at=NULL WHERE workspace_id=\$1 AND call_id=\$2/, 'the next recording asks again');
});

test('a configuration 503 keeps its explanation', async () => {
  for (const path of ['src/media/livekit-provider.js', 'src/media/livekit-webhook.js']) {
    const source = await read(path);
    assert.match(source, /statusCode\s*=\s*503;\s*error\.expose = true;/, `${path} must not answer 503 with "Internal server error"`);
  }
});

test('a handler that already answered cannot take the process down', async () => {
  const source = await read('src/http/helpers.js');
  assert.match(source, /if\(res\.headersSent\)\{try\{res\.end\(\)\}catch\{\}return\}/);
  const server = await read('src/server.js');
  assert.match(server, /process\.on\('unhandledRejection'/);
  assert.match(server, /process\.on\('uncaughtException'/);
});

test('message bodies and direct titles are bounded on create as well as edit', async () => {
  const source = await read('src/http/messaging.js');
  assert.match(source, /MESSAGE_TOO_LONG/);
  assert.match(source, /kind==='direct'\?\(b\.title===undefined\|\|b\.title===null\?null:cleanText\(b\.title,120\)\)/);
});
