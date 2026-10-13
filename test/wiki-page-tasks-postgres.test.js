import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createChatServer } from '../src/server.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const password = 'PageTaskRelationsPassword42';

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    payload: await response.json().catch(() => null),
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
  };
}

async function register(base, prefix) {
  const suffix = randomUUID().slice(0, 8);
  const result = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: {
      companyName: prefix + ' ' + suffix,
      ownerName: 'Owner',
      email: prefix.toLowerCase().replace(/\W/g, '') + '-' + suffix + '@example.test',
      password,
    },
  });
  assert.equal(result.status, 201);
  const boot = await request(base, '/api/v1/bootstrap', { cookie: result.cookie });
  assert.equal(boot.status, 200);
  return { ...result, session: boot.payload.session };
}

async function invite(base, ownerCookie, email, role = 'member') {
  const created = await request(base, '/api/v1/invitations', {
    cookie: ownerCookie, method: 'POST', body: { email, role },
  });
  assert.equal(created.status, 201);
  const token = new URL(created.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Colleague', password },
  });
  assert.equal(accepted.status, 201);
  const boot = await request(base, '/api/v1/bootstrap', { cookie: accepted.cookie });
  assert.equal(boot.status, 200);
  return { cookie: accepted.cookie, session: boot.payload.session };
}

test('Page <-> Task: canonical visibility, audit, duplicate, delete and tenant isolation',
  { skip: !databaseUrl }, async t => {
    const app = await createChatServer({ databaseUrl, startMeetingWorker: false });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    t.after(() => app.close());
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const pool = new pg.Pool({ connectionString: databaseUrl });
    t.after(() => pool.end());

    const owner = await register(base, 'Page Tasks');
    const teammate = await invite(base, owner.cookie, 'page-task-' + randomUUID().slice(0, 8) + '@example.test');
    const guest = await invite(base, owner.cookie, 'page-guest-' + randomUUID().slice(0, 8) + '@example.test', 'guest');
    const outsider = await register(base, 'Separate Workspace');

    const page = await request(base, '/api/v1/wiki/pages', {
      cookie: owner.cookie, method: 'POST',
      body: { title: 'Delivery brief', content: 'No copied task state' },
    });
    assert.equal(page.status, 201);
    const privateTask = await request(base, '/api/v1/tasks', {
      cookie: owner.cookie, method: 'POST',
      body: { title: 'Owner-only delivery', outcome: 'Private evidence' },
    });
    assert.equal(privateTask.status, 201);
    const sharedTask = await request(base, '/api/v1/tasks', {
      cookie: owner.cookie, method: 'POST',
      body: { title: 'Shared delivery', outcome: 'Team evidence', ownerId: teammate.session.userId },
    });
    assert.equal(sharedTask.status, 201);
    const foreignTask = await request(base, '/api/v1/tasks', {
      cookie: outsider.cookie, method: 'POST',
      body: { title: 'Foreign company secret' },
    });
    assert.equal(foreignTask.status, 201);

    const pageId = page.payload.id;
    const privateId = privateTask.payload.task.id;
    const sharedId = sharedTask.payload.task.id;

    const link = async (cookie, taskId) => request(base, `/api/v1/wiki/pages/${pageId}/tasks`, {
      cookie, method: 'POST', body: { taskId },
    });
    assert.equal((await link(owner.cookie, privateId)).status, 200);
    assert.equal((await link(owner.cookie, sharedId)).status, 200);

    const ownerRead = await request(base, `/api/v1/wiki/pages/${pageId}`, { cookie: owner.cookie });
    assert.deepEqual(ownerRead.payload.tasks.map(task => task.id).sort(), [privateId, sharedId].sort());
    assert.equal(ownerRead.payload.content, 'No copied task state');

    const teammateRead = await request(base, `/api/v1/wiki/pages/${pageId}`, { cookie: teammate.cookie });
    assert.equal(teammateRead.status, 200);
    assert.deepEqual(teammateRead.payload.tasks.map(task => task.id), [sharedId]);
    assert.equal((await link(teammate.cookie, privateId)).status, 404);
    const deniedUnlink = await request(base, `/api/v1/wiki/pages/${pageId}/tasks/${privateId}`, {
      cookie: teammate.cookie, method: 'DELETE',
    });
    assert.equal(deniedUnlink.status, 404);
    assert.equal((await link(owner.cookie, privateId)).status, 409, 'duplicate must be explicit');
    assert.equal((await link(owner.cookie, foreignTask.payload.task.id)).status, 404);
    assert.equal((await link(outsider.cookie, privateId)).status, 404, 'foreign page cannot be addressed');
    assert.equal((await request(base, `/api/v1/wiki/pages/${pageId}`, { cookie: guest.cookie })).status, 403);

    // PostgreSQL must enforce workspace isolation independently of the HTTP layer.
    await assert.rejects(pool.query(
      `INSERT INTO wiki_page_tasks(organization_id,workspace_id,page_id,commitment_id,linked_by)
       VALUES($1,$2,$3,$4,$5)`,
      [owner.session.organizationId, owner.session.workspaceId, pageId, foreignTask.payload.task.id, owner.session.userId],
    ), { code: '23503' });

    const removed = await request(base, `/api/v1/wiki/pages/${pageId}/tasks/${privateId}`, {
      cookie: owner.cookie, method: 'DELETE',
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.payload.tasks.map(task => task.id), [sharedId]);
    assert.equal((await request(base, `/api/v1/tasks/${privateId}`, { cookie: owner.cookie })).status, 200,
      'unlinking must not change or delete canonical Task');
    assert.equal((await request(base, `/api/v1/wiki/pages/${pageId}/tasks/${privateId}`, {
      cookie: owner.cookie, method: 'DELETE',
    })).status, 404);

    const audit = await pool.query(
      `SELECT event_type "type",payload FROM audit_events
        WHERE workspace_id=$1 AND aggregate_type='wiki_page' AND aggregate_id=$2
        ORDER BY created_at,id`, [owner.session.workspaceId, pageId],
    );
    assert.equal(audit.rows.filter(row => row.type === 'wiki.task_linked').length, 2);
    assert.equal(audit.rows.filter(row => row.type === 'wiki.task_unlinked').length, 1);
  });
