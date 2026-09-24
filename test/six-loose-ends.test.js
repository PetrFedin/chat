import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
process.env.VAULT_KEY ||= randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

async function call(base, path, { cookie, method = 'GET', body, raw } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(raw ? { 'content-type': 'text/plain', 'x-file-name': encodeURIComponent(raw.name) } : {}),
      'idempotency-key': randomUUID(),
    },
    body: raw ? raw.text : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function company(t, suffix) {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const owner = await call(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Хвосты ${suffix}`, ownerName: 'Владелец', email: `tail-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invitation = await call(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mate-${suffix}@t.test`, role: 'member' } });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const mate = await call(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Коллега', password: 'MemberPassword42' } });
  const mateId = (await call(base, '/api/v1/bootstrap', { cookie: mate.cookie })).payload.session.userId;
  const general = (await call(base, '/api/v1/conversations', { cookie: owner.cookie }))
    .payload.items.find((item) => item.slug === 'general');
  return { base, owner, mate, mateId, general };
}

/**
 * Разобранное убирается с глаз.
 *
 * Список извещений рос бесконечно: единственным способом его разгрести
 * было «прочитать всё», после чего прочитанное оставалось лежать тем же
 * списком. Колонка под архив была с самого начала — заполнять её было
 * нечем.
 */
test('прочитанные извещения уходят в архив и находятся там',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const { base, owner, mate, mateId, general } = await company(t, suffix);
  for (const text of ['первое', 'второе', 'третье']) {
    await call(base, `/api/v1/conversations/${general.id}/messages`, {
      cookie: owner.cookie, method: 'POST', body: { kind: 'text', body: text, mentionedUserIds: [mateId] } });
  }
  const unread = (await call(base, '/api/v1/notifications?status=unread', { cookie: mate.cookie })).payload.items;
  assert.equal(unread.length, 3);

  // Одно — поштучно; оно при этом становится прочитанным.
  const one = await call(base, `/api/v1/notifications/${unread[0].id}/archive`, { cookie: mate.cookie, method: 'POST', body: {} });
  assert.equal(one.status, 200);
  assert.equal(one.payload.notification.status, 'read');

  await call(base, '/api/v1/notifications/read-all', { cookie: mate.cookie, method: 'POST', body: {} });
  const swept = await call(base, '/api/v1/notifications/archive-read', { cookie: mate.cookie, method: 'POST', body: {} });
  assert.equal(swept.payload.count, 2, 'остальные прочитанные не ушли в архив');

  assert.equal((await call(base, '/api/v1/notifications', { cookie: mate.cookie })).payload.items.length, 0, 'архив всё ещё на виду');
  const archived = (await call(base, '/api/v1/notifications?status=archived', { cookie: mate.cookie })).payload.items;
  assert.equal(archived.length, 3, 'архив пуст, хотя туда убрали три извещения');
  // Чужое в архив не убрать.
  assert.equal((await call(base, `/api/v1/notifications/${unread[1].id}/archive`, { cookie: owner.cookie, method: 'POST', body: {} })).status, 404);
});

/**
 * Правка беседы — с оглядкой на то, что видел правящий.
 *
 * Двое, открывшие «Настройки канала» одновременно, сохраняли по очереди,
 * побеждал последний, и первому никто не говорил, что его правку стёрли.
 * У задач эта защита есть с первого дня; здесь её не было.
 */
test('правка беседы из второй вкладки не ложится поверх первой молча',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const { base, owner } = await company(t, suffix);
  const room = (await call(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST', body: { kind: 'group', title: `Две вкладки ${suffix}` } })).payload.conversation;
  const seen = (await call(base, '/api/v1/conversations', { cookie: owner.cookie })).payload.items.find((c) => c.id === room.id);
  assert.equal(seen.version, 1, 'версия беседы не отдаётся в списке — вкладке не с чем сверяться');

  const first = await call(base, `/api/v1/conversations/${room.id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { title: 'Вкладка Анны', expectedVersion: 1 } });
  assert.equal(first.status, 200);
  assert.equal(first.payload.conversation.version, 2);

  const second = await call(base, `/api/v1/conversations/${room.id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { title: 'Вкладка Игоря', expectedVersion: 1 } });
  assert.equal(second.code, 'STALE_CONVERSATION', `вторая вкладка стёрла первую: ${second.status}`);
  assert.match(second.payload.error.message, /другом окне/);

  // Без версии — как раньше: старые клиенты её не шлют.
  assert.equal((await call(base, `/api/v1/conversations/${room.id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { purpose: 'без версии' } })).status, 200);
  const now = (await call(base, '/api/v1/conversations', { cookie: owner.cookie })).payload.items.find((c) => c.id === room.id);
  assert.equal(now.title, 'Вкладка Анны');
});

/**
 * Список файлов листается.
 *
 * Он обрывался на сотне и молчал об этом: после сто первого файла
 * остальные были недостижимы с экрана. Сообщения, задачи и журнал
 * курсоры имели — здесь его просто не было.
 */
test('файлы листаются курсором без повторов и пропусков',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const { base, owner } = await company(t, suffix);
  for (let i = 1; i <= 5; i += 1) {
    assert.equal((await call(base, '/api/v1/files', {
      cookie: owner.cookie, method: 'POST', raw: { name: `файл-${i}.txt`, text: `содержимое ${i}` } })).status, 201);
  }
  const seen = [];
  let cursor = null;
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: '2' });
    if (cursor) query.set('cursor', cursor);
    const answer = (await call(base, `/api/v1/files?${query}`, { cookie: owner.cookie })).payload;
    seen.push(...answer.items.map((f) => f.name));
    cursor = answer.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(seen, ['файл-5.txt', 'файл-4.txt', 'файл-3.txt', 'файл-2.txt', 'файл-1.txt']);
});

/**
 * Звонок, который никто не взял, — «никто не пришёл», а не «отменён».
 *
 * Отменяет тот, кто передумал; здесь люди просто не подошли. В
 * отчётности эти два случая смешивались.
 */
test('положенная трубка при непринятом звонке даёт «никто не пришёл»',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const { base, owner, mateId, general } = await company(t, suffix);
  const started = (await call(base, `/api/v1/conversations/${general.id}/calls`, {
    cookie: owner.cookie, method: 'POST', body: { mode: 'audio', title: 'Никто не подошёл', participantIds: [mateId] } })).payload.call;
  const ended = await call(base, `/api/v1/calls/${started.id}/end`, { cookie: owner.cookie, method: 'POST', body: {} });
  assert.equal(ended.payload.call.state, 'missed', `состояние ${ended.payload.call.state}`);
  assert.equal(ended.payload.call.endedAt, null, 'у звонка, который не начинался, не может быть окончания');
});
