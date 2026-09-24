import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';
import { MemoryStore } from '../src/persistence/store.js';

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

// The cursor is built from the oldest row's createdAt. A driver hands that
// back as a Date, and a template literal stringifies a Date with toString():
// «Sun Sep 20 2026 00:58:40 GMT+0300 (Moscow Standard Time)». Re-parsing that
// silently drops the milliseconds, so the cursor landed before every message
// in the conversation and the second page came back empty — the entire history
// past the first page was unreachable.
test('the message cursor is an ISO instant that keeps milliseconds', async (t) => {
  const app = await createChatServer({ store: new MemoryStore() });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: 'Paging Co', ownerName: 'Owner', email: 'owner@paging.test', password: 'OwnerPassword42' },
  });
  const cookie = owner.cookie;

  const channel = await request(base, '/api/v1/conversations', {
    cookie, method: 'POST', body: { kind: 'channel', title: 'История', visibility: 'workspace' },
  });
  const id = channel.payload.conversation.id;

  const sent = [];
  for (let i = 0; i < 12; i += 1) {
    const created = await request(base, `/api/v1/conversations/${id}/messages`, {
      cookie, method: 'POST', body: { body: `Сообщение ${i + 1}` },
    });
    sent.push(created.payload.message.id);
  }

  const first = await request(base, `/api/v1/conversations/${id}/messages?limit=4`, { cookie });
  assert.equal(first.payload.items.length, 4);
  assert.ok(first.payload.nextCursor, 'полная страница обязана вернуть курсор');
  const [instant] = first.payload.nextCursor.split('|');
  assert.match(instant, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `курсор не ISO: ${instant}`);

  const second = await request(base, `/api/v1/conversations/${id}/messages?limit=4&before=${encodeURIComponent(first.payload.nextCursor)}`, { cookie });
  assert.equal(second.payload.items.length, 4, 'вторая страница пуста — курсор промахнулся мимо всей истории');

  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const query = `?limit=4${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`;
    const page = await request(base, `/api/v1/conversations/${id}/messages${query}`, { cookie });
    seen.push(...page.payload.items.map((m) => m.id));
    cursor = page.payload.nextCursor;
    assert.ok((pages += 1) < 20, 'курсор не сходится');
  } while (cursor);

  assert.equal(new Set(seen).size, sent.length, 'курсор не обошёл всю историю');
  assert.deepEqual(new Set(seen), new Set(sent));
});
