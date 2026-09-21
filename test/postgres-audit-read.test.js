import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

// Журнал вёлся с первого дня, а прочитать его было нельзя ниоткуда.
test('журнал рабочего пространства можно прочитать — и только тем, кто отвечает за порядок',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Журнал ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const join = async (tag, role) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: `${tag}-${suffix}@t.test`, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    return request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: tag, password: 'OwnerPassword42' } });
  };
  const chief = await join('chief', 'manager');
  const worker = await join('worker', 'member');
  const guest = await join('client', 'guest');

  const journal = await request(base, '/api/v1/audit', { cookie: owner.cookie });
  assert.equal(journal.status, 200);
  assert.ok(journal.payload.items.length >= 3, 'приглашения и приёмы в журнале есть');
  const first = journal.payload.items[0];
  assert.ok(first.eventType && first.createdAt && first.aggregateType);
  assert.ok('actorName' in first, 'кто сделал — видно по имени, а не по одному идентификатору');
  // Свежее сверху.
  assert.ok(journal.payload.items[0].sequence > journal.payload.items.at(-1).sequence);

  // Листается: страница по одной записи отдаёт курсор, и он ведёт дальше.
  const firstPage = await request(base, '/api/v1/audit?limit=1', { cookie: owner.cookie });
  assert.equal(firstPage.payload.items.length, 1);
  assert.ok(firstPage.payload.nextCursor);
  const second = await request(base, `/api/v1/audit?limit=1&cursor=${firstPage.payload.nextCursor}`, { cookie: owner.cookie });
  assert.notEqual(second.payload.items[0].id, firstPage.payload.items[0].id);

  // Отбор по виду записи.
  const invitesOnly = await request(base, '/api/v1/audit?type=membership', { cookie: owner.cookie });
  assert.ok(invitesOnly.payload.items.every((item) => item.aggregateType === 'membership'));

  // Руководитель отвечает за порядок и читает; рядовой и гость — нет.
  assert.equal((await request(base, '/api/v1/audit', { cookie: chief.cookie })).status, 200);
  assert.equal((await request(base, '/api/v1/audit', { cookie: worker.cookie })).status, 403);
  assert.equal((await request(base, '/api/v1/audit', { cookie: guest.cookie })).status, 403);

  // Чужое рабочее пространство в журнал не попадает.
  const other = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Соседи ${suffix}`, ownerName: 'Сосед', email: `nb-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const ours = new Set(journal.payload.items.map((item) => item.id));
  const theirs = await request(base, '/api/v1/audit', { cookie: other.cookie });
  assert.ok(theirs.payload.items.every((item) => !ours.has(item.id)));
});
