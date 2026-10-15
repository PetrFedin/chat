import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

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

test('ветки внутри беседы: создание, отправка в ветку, перенос, права и архив', { skip }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = randomUUID().slice(0, 8);
  const owner = await call(base, '/api/v1/auth/register-company', { method: 'POST',
    body: { companyName: `Ветки ${suffix}`, ownerName: 'Владелец', email: `t-owner-${suffix}@t.test`, password: 'OwnerPassword42' } });
  const people = { owner };
  for (const key of ['alice', 'bob']) {
    const invited = await call(base, '/api/v1/invitations', { cookie: owner.cookie, method: 'POST', body: { email: `t-${key}-${suffix}@t.test`, role: 'member' } });
    const accepted = await call(base, '/api/v1/invitations/accept', { method: 'POST',
      body: { token: new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite'), displayName: key, password: 'MemberPassword42' } });
    assert.equal(accepted.status, 201, `${invited.status} ${JSON.stringify(invited.payload)} / ${JSON.stringify(accepted.payload)}`);
    people[key] = accepted;
    people[key].id = (await call(base, '/api/v1/bootstrap', { cookie: accepted.cookie })).payload.session.userId;
  }
  const room = await call(base, '/api/v1/conversations', { cookie: owner.cookie, method: 'POST',
    body: { kind: 'channel', title: 'Проект', visibility: 'workspace', participantIds: [people.alice.id, people.bob.id] } });
  assert.equal(room.status, 201);
  const roomId = room.payload.conversation.id;
  const topics = `/api/v1/conversations/${roomId}/topics`;

  const created = await call(base, topics, { cookie: people.alice.cookie, method: 'POST', body: { title: 'Договоры' } });
  assert.equal(created.status, 201);
  const topicId = created.payload.topic.id;
  assert.equal((await call(base, topics, { cookie: people.bob.cookie, method: 'POST', body: { title: 'договоры' } })).code, 'TOPIC_EXISTS', 'название без учёта регистра');
  assert.equal((await call(base, topics, { cookie: people.bob.cookie, method: 'POST', body: { title: '   ' } })).code, 'INVALID_TOPIC');

  // Сообщение в ветку и в общую ленту.
  const inTopic = await call(base, `/api/v1/conversations/${roomId}/messages`, { cookie: people.alice.cookie, method: 'POST', body: { body: 'Подписали', topicId } });
  assert.equal(inTopic.status, 201);
  assert.equal(inTopic.payload.message.topicId, topicId);
  const general = await call(base, `/api/v1/conversations/${roomId}/messages`, { cookie: people.bob.cookie, method: 'POST', body: { body: 'Обсудим закупки' } });
  assert.equal(general.payload.message.topicId ?? null, null);

  let list = await call(base, topics, { cookie: people.bob.cookie });
  assert.equal(list.payload.items[0].messageCount, 1);
  assert.equal(list.payload.generalCount, 1);
  const feed = await call(base, `/api/v1/conversations/${roomId}/topics/${topicId}/messages`, { cookie: people.bob.cookie });
  assert.deepEqual(feed.payload.items.map((m) => m.body), ['Подписали']);

  // Перенос: чужое сообщение двигает только ведущий беседы; автор — своё.
  const moved = await call(base, `/api/v1/messages/${general.payload.message.id}/topic`, { cookie: people.bob.cookie, method: 'PATCH', body: { topicId } });
  assert.equal(moved.payload.message.topicId, topicId);
  assert.equal((await call(base, `/api/v1/messages/${general.payload.message.id}/topic`, { cookie: people.alice.cookie, method: 'PATCH', body: { topicId: null } })).status, 403, 'чужое сообщение не двигают');
  assert.equal((await call(base, `/api/v1/messages/${general.payload.message.id}/topic`, { cookie: owner.cookie, method: 'PATCH', body: { topicId: null } })).payload.message.topicId, null);

  // Переименовывает создатель или ведущий; посторонний — нет.
  assert.equal((await call(base, `${topics}/${topicId}`, { cookie: people.bob.cookie, method: 'PATCH', body: { title: 'Чужое' } })).status, 403);
  assert.equal((await call(base, `${topics}/${topicId}`, { cookie: people.alice.cookie, method: 'PATCH', body: { title: 'Договоры 2026', pinned: true } })).payload.topic.title, 'Договоры 2026');

  // Архивная ветка закрыта для новых сообщений.
  await call(base, `${topics}/${topicId}`, { cookie: owner.cookie, method: 'PATCH', body: { archived: true } });
  assert.equal((await call(base, `/api/v1/conversations/${roomId}/messages`, { cookie: people.alice.cookie, method: 'POST', body: { body: 'ещё', topicId } })).code, 'TOPIC_ARCHIVED');
  assert.equal((await call(base, topics, { cookie: people.alice.cookie })).payload.items.length, 0, 'архивные не в списке');
  assert.equal((await call(base, `${topics}?archived=1`, { cookie: people.alice.cookie })).payload.items.length, 1);

  // Ветка чужой беседы или выдуманная.
  assert.equal((await call(base, `/api/v1/conversations/${roomId}/messages`, { cookie: people.alice.cookie, method: 'POST', body: { body: 'x', topicId: randomUUID() } })).status, 404);

  // Отключили функцию — ветки закрыты и для API.
  await call(base, '/api/v1/features/topics', { cookie: owner.cookie, method: 'PUT', body: { enabled: false } });
  assert.equal((await call(base, topics, { cookie: people.alice.cookie })).code, 'FEATURE_DISABLED');
});
