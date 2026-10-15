import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';
import { FEATURES, dependentsOf, requirementsOf, planChange, featureForPath, featuresForPath } from '../src/features/registry.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const skip = !DATABASE_URL && 'нет базы';

async function call(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

test('граф функций: зависимости не циклические и ссылаются на существующее', () => {
  const ids = new Set(FEATURES.map((f) => f.id));
  for (const f of FEATURES) for (const need of f.requires) assert.ok(ids.has(need), `${f.id} требует несуществующее ${need}`);
  for (const f of FEATURES) assert.ok(!requirementsOf(f.id).includes(f.id), `цикл в ${f.id}`);
  assert.deepEqual(dependentsOf('tasks').sort(), ['dashboard', 'projects', 'time_tracking']);
  assert.deepEqual(dependentsOf('calls').sort(), ['decisions', 'meetings']);
  assert.deepEqual(requirementsOf('decisions').sort(), ['calendar', 'calls', 'meetings']);
});

test('отключение тянет зависимые, включение сначала возвращает нужное и то, что выключилось вместе', () => {
  const state = new Map();
  const off = planChange(state, 'calls', false);
  assert.deepEqual(off.map((c) => c.id).sort(), ['calls', 'decisions', 'meetings']);
  assert.ok(off.filter((c) => c.id !== 'calls').every((c) => c.cascadeFrom === 'calls'));
  for (const c of off) state.set(c.id, { enabled: false, cascadeFrom: c.cascadeFrom });
  // Включить «Решения» при выключенных звонках: сначала звонки и итоги, потом сами решения.
  const on = planChange(state, 'decisions', true).map((c) => c.id);
  assert.deepEqual(on.sort(), ['calls', 'decisions', 'meetings']);
  // Просто вернули «Звонки»: вместе с ними возвращается то, что ушло из-за них.
  const back = planChange(state, 'calls', true).map((c) => c.id).sort();
  assert.deepEqual(back, ['calls', 'decisions', 'meetings']);
  assert.throws(() => planChange(state, 'nope', true), (e) => e.code === 'UNKNOWN_FEATURE');
});

test('маршруты принадлежат функциям', () => {
  assert.equal(featureForPath('/api/v1/tasks/abc/time-entries'), 'time_tracking');
  assert.equal(featureForPath('/api/v1/tasks/report'), 'dashboard');
  assert.equal(featureForPath('/api/v1/tasks/abc'), 'tasks');
  assert.equal(featureForPath('/api/v1/projects/abc'), 'projects');
  assert.deepEqual(featuresForPath('/api/v1/wiki/pages/00000000-0000-0000-0000-000000000000/projects'), ['wiki', 'projects']);
  assert.deepEqual(featuresForPath('/api/v1/projects/00000000-0000-0000-0000-000000000000/tasks'), ['projects', 'tasks']);
  assert.equal(featureForPath('/api/v1/meetings/decisions'), 'decisions');
  assert.equal(featureForPath('/api/v1/requests/queue'), 'requests');
  assert.equal(featureForPath('/api/v1/conversations/x/assistant/summarize'), 'assistant');
  assert.equal(featureForPath('/api/v1/conversations'), null);
  assert.equal(featureForPath('/api/v1/bootstrap'), null);
});

test('выключили задачи — API закрылся вместе с зависимыми, список объяснил что и почему, включили — вернулось', { skip }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = randomUUID().slice(0, 8);
  const owner = await call(base, '/api/v1/auth/register-company', { method: 'POST',
    body: { companyName: `Feat ${suffix}`, ownerName: 'Владелец', email: `f-owner-${suffix}@t.test`, password: 'OwnerPassword42' } });
  const invited = await call(base, '/api/v1/invitations', { cookie: owner.cookie, method: 'POST', body: { email: `f-m-${suffix}@t.test`, role: 'member' } });
  const accepted = await call(base, '/api/v1/invitations/accept', { method: 'POST', body: { token: new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite'), displayName: 'Сотрудник', password: 'MemberPassword42' } });

  assert.equal((await call(base, '/api/v1/tasks', { cookie: owner.cookie })).status, 200);
  const boot = await call(base, '/api/v1/bootstrap', { cookie: owner.cookie });
  assert.equal(boot.payload.features.tasks, true);

  assert.equal((await call(base, '/api/v1/features/tasks', { cookie: accepted.cookie, method: 'PUT', body: { enabled: false } })).status, 403, 'менять может не каждый');
  const preview = await call(base, '/api/v1/features/tasks', { cookie: owner.cookie, method: 'PUT', body: { enabled: false, dryRun: true } });
  assert.deepEqual(preview.payload.changes.map((c) => c.id).sort(), ['dashboard', 'projects', 'tasks', 'time_tracking']);
  assert.equal((await call(base, '/api/v1/tasks', { cookie: owner.cookie })).status, 200, 'предпросмотр ничего не меняет');

  const off = await call(base, '/api/v1/features/tasks', { cookie: owner.cookie, method: 'PUT', body: { enabled: false } });
  assert.equal(off.status, 200);
  const list = off.payload.items;
  assert.equal(list.find((f) => f.id === 'dashboard').enabled, false);
  assert.equal(list.find((f) => f.id === 'dashboard').cascadeFrom, 'tasks');
  const closed = await call(base, '/api/v1/tasks', { cookie: accepted.cookie });
  assert.equal(closed.status, 404);
  assert.equal(closed.code, 'FEATURE_DISABLED');
  assert.equal((await call(base, '/api/v1/dashboard', { cookie: owner.cookie })).code, 'FEATURE_DISABLED');
  assert.equal((await call(base, '/api/v1/bootstrap', { cookie: accepted.cookie })).payload.features.time_tracking, false);
  assert.equal((await call(base, '/api/v1/conversations', { cookie: owner.cookie })).status, 200, 'ядро работает');

  const on = await call(base, '/api/v1/features/tasks', { cookie: owner.cookie, method: 'PUT', body: { enabled: true } });
  assert.deepEqual(on.payload.changes.map((c) => c.id).sort(), ['dashboard', 'projects', 'tasks', 'time_tracking']);
  assert.equal((await call(base, '/api/v1/tasks', { cookie: accepted.cookie })).status, 200);

  // Включение зависимой при выключенной основе включает и основу.
  await call(base, '/api/v1/features/calls', { cookie: owner.cookie, method: 'PUT', body: { enabled: false } });
  const decisions = await call(base, '/api/v1/features/decisions', { cookie: owner.cookie, method: 'PUT', body: { enabled: true } });
  assert.ok(decisions.payload.changes.some((c) => c.id === 'calls' && c.because === 'decisions'));
});
