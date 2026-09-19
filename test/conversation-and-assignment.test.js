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
  return { status: response.status, payload, cookie: response.headers.get('set-cookie')?.split(';')[0], code: payload?.error?.code };
}

async function fixture(t) {
  const app = await createChatServer({ store: new MemoryStore() });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: 'Гранит', ownerName: 'Владелец', email: 'owner@granit.test', password: 'OwnerPassword42' },
  });
  const join = async (email, displayName, role) => {
    const invitation = await request(base, '/api/v1/invitations', { cookie: owner.cookie, method: 'POST', body: { email, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const accepted = await request(base, '/api/v1/invitations/accept', { method: 'POST', body: { token, displayName, password: 'OwnerPassword42' } });
    const boot = await request(base, '/api/v1/bootstrap', { cookie: accepted.cookie });
    return { cookie: accepted.cookie, userId: boot.payload.session.userId };
  };
  return { base, owner, join };
}

// Removing yourself needed management rights, so a person invited into a
// channel stayed in it for good.
test('a room can be left, and the rules about leaving hold', async (t) => {
  const { base, owner, join } = await fixture(t);
  const worker = await join('worker@granit.test', 'Сотрудник', 'member');

  const group = await request(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST', body: { kind: 'group', title: 'Изыскания', participantIds: [worker.userId] },
  });
  const id = group.payload.conversation.id;

  const left = await request(base, `/api/v1/conversations/${id}/leave`, { cookie: worker.cookie, method: 'POST' });
  assert.equal(left.status, 200, 'выйти нельзя');
  const theirs = await request(base, '/api/v1/conversations', { cookie: worker.cookie });
  assert.ok(!theirs.payload.items.some((c) => c.id === id), 'беседа осталась в списке');
  const ours = await request(base, '/api/v1/conversations', { cookie: owner.cookie });
  assert.ok(ours.payload.items.some((c) => c.id === id), 'беседа исчезла у остальных');

  // The last owner walking out would strand the room.
  const alone = await request(base, `/api/v1/conversations/${id}/leave`, { cookie: owner.cookie, method: 'POST' });
  assert.equal(alone.code, 'LAST_CONVERSATION_OWNER');

  // An open channel is membership by visibility; there is nothing to leave.
  const [channel] = ours.payload.items.filter((c) => c.visibility === 'workspace');
  assert.ok(channel, 'в компании нет открытого канала');
  const notMember = await request(base, `/api/v1/conversations/${channel.id}/leave`, { cookie: worker.cookie, method: 'POST' });
  assert.ok(['NOT_A_MEMBER', 'LAST_CONVERSATION_OWNER'].includes(notMember.code) || notMember.status === 200);
});

// The title, the purpose and the announcement-only flag were fixed at creation.
test('a room can be renamed by whoever runs it, and only by them', async (t) => {
  const { base, owner, join } = await fixture(t);
  const worker = await join('worker@granit.test', 'Сотрудник', 'member');
  const channel = await request(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST', body: { kind: 'channel', title: 'Объект', visibility: 'workspace' },
  });
  const id = channel.payload.conversation.id;

  const renamed = await request(base, `/api/v1/conversations/${id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { title: 'Объект «Набережная»', purpose: 'Первая очередь', announcementOnly: true },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.payload.conversation.title, 'Объект «Набережная»');
  assert.equal(renamed.payload.conversation.announcementOnly, true);

  const refused = await request(base, `/api/v1/conversations/${id}`, { cookie: worker.cookie, method: 'PATCH', body: { title: 'Моё' } });
  assert.equal(refused.status, 403);

  const empty = await request(base, `/api/v1/conversations/${id}`, { cookie: owner.cookie, method: 'PATCH', body: {} });
  assert.equal(empty.code, 'EMPTY_PATCH');
});

// A room whose visibility is «the whole company» is exactly the room an
// outsider must not be in: everyone writing there is addressing colleagues.
test('a guest cannot be placed in a company-wide room', async (t) => {
  const { base, owner, join } = await fixture(t);
  const guest = await join('client@zakaz.test', 'Заказчик', 'guest');

  const open = await request(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST', body: { kind: 'channel', title: 'Общий канал', visibility: 'workspace' },
  });
  const refused = await request(base, `/api/v1/conversations/${open.payload.conversation.id}/members`, {
    cookie: owner.cookie, method: 'POST', body: { userIds: [guest.userId] },
  });
  assert.equal(refused.code, 'GUEST_NOT_IN_OPEN_ROOM', 'гость попал в общий канал компании');

  // A room made for the client is exactly where they belong.
  const room = await request(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST', body: { kind: 'group', title: 'С заказчиком', participantIds: [guest.userId] },
  });
  assert.equal(room.status, 201);

  const app = await read('public/app.js');
  assert.match(app, /openRoom\|\|p\.role!=='guest'/, 'экран всё ещё предлагает гостя');
});

// Owner, requester and acceptor were fixed at creation, so the cure for
// «Нина ушла в отпуск» was to cancel the task and lose its evidence chain.
test('a commitment can change hands, keeping its history', async (t) => {
  const { base, owner, join } = await fixture(t);
  const first = await join('first@granit.test', 'Первый', 'member');
  const second = await join('second@granit.test', 'Второй', 'member');
  const guest = await join('client@zakaz.test', 'Заказчик', 'guest');

  const created = await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST', body: { title: 'Отчёт по скважинам', ownerId: first.userId },
  });
  const task = created.payload.task;
  const hand = (body, cookie = owner.cookie) => request(base, `/api/v1/tasks/${task.id}/assignment`, { cookie, method: 'PATCH', body });

  assert.equal((await hand({ ownerId: second.userId, expectedVersion: task.version })).code, 'TASK_REASON_REQUIRED');
  assert.equal((await hand({ reason: 'нет', expectedVersion: task.version })).code, 'TASK_NOTHING_TO_CHANGE');
  assert.equal((await hand({ ownerId: guest.userId, reason: 'клиенту', expectedVersion: task.version })).code, 'GUEST_CANNOT_HOLD_TASK');
  assert.equal((await hand({ ownerId: second.userId, reason: 'хочу', expectedVersion: task.version }, first.cookie)).status, 403,
    'ответственный передал задачу сам себе за спиной постановщика');

  const moved = await hand({ ownerId: second.userId, reason: 'Первый в отпуске до 5 октября', expectedVersion: task.version });
  assert.equal(moved.status, 200);
  assert.equal(moved.payload.task.ownerId, second.userId);
  // A new owner has accepted nothing yet.
  assert.equal(moved.payload.task.status, 'proposed', 'новому ответственному не дали выбора');
  assert.equal(moved.payload.task.version, task.version + 1);

  const detail = await request(base, `/api/v1/tasks/${task.id}`, { cookie: owner.cookie });
  const entry = (detail.payload.task.audit || []).find((a) => a.eventType === 'commitment.reassigned');
  assert.ok(entry, 'передача не записана в журнал');
  assert.equal(entry.payload.reason, 'Первый в отпуске до 5 октября');
  assert.equal(entry.payload.previousOwnerId, first.userId);
});

import { readFile } from 'node:fs/promises';
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
