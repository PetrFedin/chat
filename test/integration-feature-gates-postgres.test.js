import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';
import { featureForPath } from '../src/features/registry.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

async function call(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return {
    status: response.status,
    payload,
    code: payload?.error?.code,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
  };
}

test('Projects participates in company feature routing', () => {
  assert.equal(featureForPath('/api/v1/projects'), 'projects');
  assert.equal(featureForPath('/api/v1/projects/00000000-0000-0000-0000-000000000000'), 'projects');
});

test('Projects, Wiki and Topics survive OFF/ON without bypassing cross-feature admission',
  { skip: !databaseUrl, timeout: 90000 }, async (t) => {
    const app = await createChatServer({ databaseUrl, startMeetingWorker: false });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    t.after(() => app.close());
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const suffix = randomUUID().slice(0, 8);

    const owner = await call(base, '/api/v1/auth/register-company', {
      method: 'POST',
      body: {
        companyName: 'Feature integration ' + suffix,
        ownerName: 'Owner',
        email: 'feature-integration-' + suffix + '@example.test',
        password: 'FeatureIntegrationPassword42',
      },
    });
    assert.equal(owner.status, 201);

    const project = await call(base, '/api/v1/projects', {
      cookie: owner.cookie,
      method: 'POST',
      body: { name: 'Durable project ' + suffix, goal: 'Remain canonical across feature switches' },
    });
    assert.equal(project.status, 201);
    const projectId = project.payload.project.id;

    const page = await call(base, '/api/v1/wiki/pages', {
      cookie: owner.cookie,
      method: 'POST',
      body: { title: 'Durable page ' + suffix, content: 'Feature switches must not delete canonical data.' },
    });
    assert.equal(page.status, 201);
    const pageId = page.payload.id;

    const linked = await call(base, `/api/v1/wiki/pages/${pageId}/projects`, {
      cookie: owner.cookie,
      method: 'POST',
      body: { projectId },
    });
    assert.equal(linked.status, 200);

    const room = await call(base, '/api/v1/conversations', {
      cookie: owner.cookie,
      method: 'POST',
      body: { kind: 'channel', title: 'Durable topics ' + suffix, visibility: 'workspace' },
    });
    assert.equal(room.status, 201);
    const roomId = room.payload.conversation.id;
    const topic = await call(base, `/api/v1/conversations/${roomId}/topics`, {
      cookie: owner.cookie,
      method: 'POST',
      body: { title: 'Integration' },
    });
    assert.equal(topic.status, 201);
    const topicId = topic.payload.topic.id;

    // Projects OFF: canonical rows remain, but both direct Project API and the
    // Wiki↔Project cross-feature mutation become unavailable.
    const projectOff = await call(base, '/api/v1/features/projects', {
      cookie: owner.cookie, method: 'PUT', body: { enabled: false },
    });
    assert.equal(projectOff.status, 200);
    assert.equal(projectOff.payload.items.find((f) => f.id === 'projects').enabled, false);
    assert.equal((await call(base, '/api/v1/projects', { cookie: owner.cookie })).code, 'FEATURE_DISABLED');
    assert.equal((await call(base, `/api/v1/wiki/pages/${pageId}/projects/${projectId}`, {
      cookie: owner.cookie, method: 'DELETE',
    })).code, 'FEATURE_DISABLED', 'cross-feature endpoint must require Projects as well as Wiki');

    const projectOn = await call(base, '/api/v1/features/projects', {
      cookie: owner.cookie, method: 'PUT', body: { enabled: true },
    });
    assert.equal(projectOn.status, 200);
    const projectAgain = await call(base, `/api/v1/projects/${projectId}`, { cookie: owner.cookie });
    assert.equal(projectAgain.status, 200);
    assert.equal(projectAgain.payload.project.name, project.payload.project.name);

    // Wiki OFF independently blocks the same relation while Projects stays on.
    assert.equal((await call(base, '/api/v1/features/wiki', {
      cookie: owner.cookie, method: 'PUT', body: { enabled: false },
    })).status, 200);
    assert.equal((await call(base, '/api/v1/projects', { cookie: owner.cookie })).status, 200);
    assert.equal((await call(base, `/api/v1/wiki/pages/${pageId}/projects/${projectId}`, {
      cookie: owner.cookie, method: 'DELETE',
    })).code, 'FEATURE_DISABLED', 'cross-feature endpoint must also require Wiki');
    assert.equal((await call(base, '/api/v1/features/wiki', {
      cookie: owner.cookie, method: 'PUT', body: { enabled: true },
    })).status, 200);
    const pageAgain = await call(base, `/api/v1/wiki/pages/${pageId}`, { cookie: owner.cookie });
    assert.equal(pageAgain.status, 200);
    assert.ok(pageAgain.payload.projects.some((p) => p.id === projectId),
      'switching features must not delete the Page↔Project relation');

    // Topics OFF/ON must hide and restore the same canonical topic.
    assert.equal((await call(base, '/api/v1/features/topics', {
      cookie: owner.cookie, method: 'PUT', body: { enabled: false },
    })).status, 200);
    assert.equal((await call(base, `/api/v1/conversations/${roomId}/topics`, {
      cookie: owner.cookie,
    })).code, 'FEATURE_DISABLED');
    assert.equal((await call(base, '/api/v1/features/topics', {
      cookie: owner.cookie, method: 'PUT', body: { enabled: true },
    })).status, 200);
    const topicsAgain = await call(base, `/api/v1/conversations/${roomId}/topics`, { cookie: owner.cookie });
    assert.equal(topicsAgain.status, 200);
    assert.ok(topicsAgain.payload.items.some((item) => item.id === topicId),
      'switching Topics must not delete existing topic rows');
  });
