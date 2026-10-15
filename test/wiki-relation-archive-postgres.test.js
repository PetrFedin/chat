import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createChatServer } from '../src/server.js';
import { createWikiRepository } from '../src/wiki/wiki-repository.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return {
    status: response.status,
    payload: await response.json().catch(() => null),
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
  };
}

async function register(base) {
  const nonce = randomUUID().slice(0, 8);
  const registered = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: {
      companyName: 'Wiki archive admission ' + nonce,
      ownerName: 'Owner',
      email: 'wiki-archive-' + nonce + '@example.test',
      password: 'WikiArchiveAdmissionPassword42',
    },
  });
  assert.equal(registered.status, 201);
  const boot = await request(base, '/api/v1/bootstrap', { cookie: registered.cookie });
  assert.equal(boot.status, 200);
  return { cookie: registered.cookie, session: boot.payload.session };
}

async function targets(base, cookie) {
  const post = (path, body) => request(base, path, { cookie, method: 'POST', body });
  const task = await post('/api/v1/tasks', { title: 'Archive-safe task', outcome: 'Preserve canonical task' });
  assert.equal(task.status, 201);
  const channel = await post('/api/v1/conversations', {
    kind: 'channel', title: 'Archive-safe channel', visibility: 'private',
  });
  assert.equal(channel.status, 201);
  const project = await post('/api/v1/projects', {
    name: 'Archive-safe project', goal: 'Preserve canonical project', visibility: 'workspace',
  });
  assert.equal(project.status, 201);
  const event = await post('/api/v1/calendar-events', {
    kind: 'meeting', title: 'Archive admission meeting',
    startAt: new Date(Date.now() - 3600000).toISOString(),
    endAt: new Date(Date.now() + 3600000).toISOString(),
  });
  assert.equal(event.status, 201);
  const title = 'Archive approval ' + randomUUID().slice(0, 8);
  const notes = await request(base, `/api/v1/calendar-events/${event.payload.event.id}/notes`, {
    cookie, method: 'PUT', body: { title: 'Archive admission', decisions: [title], actionItems: [] },
  });
  assert.equal(notes.status, 200);
  const decisions = await request(base, '/api/v1/meetings/decisions?q=' + encodeURIComponent(title), { cookie });
  assert.equal(decisions.status, 200);
  const decision = decisions.payload.items.find(item => item.title === title);
  assert.ok(decision, 'accepted Decision fixture must come from canonical meeting notes');
  return [
    { kind: 'projects', field: 'projectId', id: project.payload.project.id,
      table: 'wiki_page_projects', method: 'linkProject', canonical: '/api/v1/projects/' + project.payload.project.id },
    { kind: 'tasks', field: 'taskId', id: task.payload.task.id,
      table: 'wiki_page_tasks', method: 'linkTask', canonical: '/api/v1/tasks/' + task.payload.task.id },
    { kind: 'channels', field: 'conversationId', id: channel.payload.conversation.id,
      table: 'wiki_page_channels', method: 'linkChannel', canonical: '/api/v1/conversations/' + channel.payload.conversation.id + '/members' },
    { kind: 'decisions', field: 'decisionId', id: decision.id,
      table: 'wiki_page_decisions', method: 'linkDecision', canonical: '/api/v1/meetings/decisions/' + decision.id },
  ];
}

// Observe an actual PostgreSQL lock wait; elapsed time is never a success signal.
async function observedBlock(pool, blockerPid, isSettled) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const { rows } = await pool.query(
      'SELECT pid FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))',
      [blockerPid],
    );
    if (rows.length) return true;
    if (isSettled()) return false;
    await delay(10);
  }
  return false;
}

test('Page relations: archive admission is atomic for Project, Task, Channel and Decision',
  { skip: !databaseUrl, timeout: 90000 }, async t => {
    const app = await createChatServer({ databaseUrl, startMeetingWorker: false });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    t.after(() => app.close());
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const pool = app.store.pool;
    const owner = await register(base);
    const fixtures = await targets(base, owner.cookie);
    const page = async title => {
      const created = await request(base, '/api/v1/wiki/pages', {
        cookie: owner.cookie, method: 'POST', body: { title, content: 'Canonical entities remain independent.' },
      });
      assert.equal(created.status, 201);
      return created.payload.id;
    };
    const archive = id => request(base, `/api/v1/wiki/pages/${id}`, { cookie: owner.cookie, method: 'DELETE' });
    const link = (id, target) => request(base, `/api/v1/wiki/pages/${id}/${target.kind}`, {
      cookie: owner.cookie, method: 'POST', body: { [target.field]: target.id },
    });
    const snapshot = async (id, target) => {
      // Table names come exclusively from the fixed descriptors above, never HTTP input.
      const relations = await pool.query(
        `SELECT count(*)::int count FROM ${target.table} WHERE workspace_id=$1 AND page_id=$2`,
        [owner.session.workspaceId, id],
      );
      const audit = await pool.query(
        `SELECT count(*)::int count FROM audit_events
         WHERE workspace_id=$1 AND aggregate_type='wiki_page' AND aggregate_id=$2`,
        [owner.session.workspaceId, id],
      );
      return { relations: relations.rows[0].count, audit: audit.rows[0].count };
    };

    for (const target of fixtures) {
      await t.test(target.kind + ': archived Page rejects writes but permits unlink cleanup', async () => {
        const id = await page('Archive boundary ' + target.kind);
        assert.equal((await link(id, target)).status, 200);
        assert.equal((await link(id, target)).status, 409, 'active duplicate must remain explicit');
        const before = await snapshot(id, target);
        assert.equal(before.relations, 1);
        assert.equal((await archive(id)).status, 200);
        assert.equal((await link(id, target)).status, 404, 'archive takes precedence over duplicate disclosure');
        assert.equal((await link(randomUUID(), target)).status, 404, 'missing and archived admission use the same status');
        assert.deepEqual(await snapshot(id, target), before, 'rejected addition must not write a relation or audit event');
        assert.equal((await request(base, `/api/v1/wiki/pages/${id}/${target.kind}/${target.id}`, {
          cookie: owner.cookie, method: 'DELETE',
        })).status, 200, 'authorized cleanup of an existing relation remains possible');
        assert.equal((await snapshot(id, target)).relations, 0);
        assert.equal((await request(base, target.canonical, { cookie: owner.cookie })).status, 200,
          'archive and unlink must not remove the canonical entity');
      });

      await t.test(target.kind + ': archive committed during link admission wins the race', async () => {
        const id = await page('Concurrent archive ' + target.kind);
        const blocker = await pool.connect();
        let pending;
        let committed = false;
        let settled = false;
        try {
          const pid = (await blocker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
          await blocker.query('BEGIN');
          await blocker.query(
            'UPDATE wiki_pages SET archived_at=now() WHERE workspace_id=$1 AND id=$2',
            [owner.session.workspaceId, id],
          );
          // The preflight SELECT sees the last committed active row. The
          // relation transaction must wait and recheck the updated row.
          pending = link(id, target).then(
            value => { settled = true; return value; },
            error => { settled = true; return { failure: error }; },
          );
          const blocked = await observedBlock(pool, pid, () => settled);
          await blocker.query('COMMIT');
          committed = true;
          const result = await pending;
          assert.ok(blocked, 'relation write must serialize with archive on the Page row');
          if (result.failure) throw result.failure;
          assert.equal(result.status, 404, 'post-wait recheck must reject the now-archived Page');
          assert.deepEqual(await snapshot(id, target), { relations: 0, audit: 0 },
            'losing the race must roll back without a phantom relation or audit event');
          assert.equal((await request(base, target.canonical, { cookie: owner.cookie })).status, 200);
        } finally {
          if (!committed) await blocker.query('ROLLBACK').catch(() => {});
          blocker.release();
          if (pending) await pending;
        }
      });

      await t.test(target.kind + ': archived preflight never resolves target metadata', async () => {
        const id = await page('No metadata lookup ' + target.kind);
        assert.equal((await archive(id)).status, 200);
        const forbidden = async () => { throw new Error('target authority must not run for an archived Page'); };
        const wiki = createWikiRepository(pool, { get: forbidden },
          { getTask: forbidden, conversationPolicy: forbidden }, { getDecision: forbidden });
        await assert.rejects(wiki[target.method](owner.session, id, target.id), {
          code: 'WIKI_PAGE_NOT_FOUND', statusCode: 404,
        });
        assert.deepEqual(await snapshot(id, target), { relations: 0, audit: 0 });
      });
    }
  });
