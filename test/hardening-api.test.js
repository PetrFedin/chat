import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const skip = !DATABASE_URL && 'нет базы';

async function call(base, path, { cookie, method = 'GET', body, headers = {}, raw } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

/** Компания с владельцем и по человеку каждой роли: всё, что нужно для проверок прав. */
async function workspace(t) {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = randomUUID().slice(0, 8);
  const owner = await call(base, '/api/v1/auth/register-company', {
    method: 'POST', body: { companyName: `Hard ${suffix}`, ownerName: 'Владелец', email: `h-owner-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const people = { owner: { cookie: owner.cookie } };
  for (const [key, role] of [['manager', 'manager'], ['admin', 'admin'], ['alice', 'member'], ['bob', 'member'], ['carol', 'member']]) {
    const invited = await call(base, '/api/v1/invitations', { cookie: owner.cookie, method: 'POST', body: { email: `h-${key}-${suffix}@t.test`, role } });
    const token = new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite');
    const accepted = await call(base, '/api/v1/invitations/accept', { method: 'POST', body: { token, displayName: key, password: 'MemberPassword42' } });
    people[key] = { cookie: accepted.cookie };
  }
  for (const key of Object.keys(people)) {
    const boot = await call(base, '/api/v1/bootstrap', { cookie: people[key].cookie });
    people[key].id = boot.payload.session.userId;
  }
  return { app, base, people, suffix };
}

test('владелец беседы: модератор не может ни назначить, ни понизить, ни вывести владельца', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  const created = await call(base, '/api/v1/conversations', {
    cookie: people.manager.cookie, method: 'POST',
    body: { kind: 'channel', title: 'Проверка прав', visibility: 'private', participantIds: [people.alice.id, people.bob.id] },
  });
  assert.equal(created.status, 201);
  const id = created.payload.conversation.id;
  const members = `/api/v1/conversations/${id}/members`;

  const promote = await call(base, `${members}/${people.alice.id}`, { cookie: people.manager.cookie, method: 'PATCH', body: { role: 'moderator' } });
  assert.equal(promote.status, 200, 'владелец беседы назначает модератора');

  const toOwner = await call(base, `${members}/${people.bob.id}`, { cookie: people.alice.cookie, method: 'PATCH', body: { role: 'owner' } });
  assert.equal(toOwner.status, 403, 'модератор не делает владельцем');
  const demote = await call(base, `${members}/${people.manager.id}`, { cookie: people.alice.cookie, method: 'PATCH', body: { role: 'member' } });
  assert.equal(demote.status, 403, 'модератор не понижает владельца');
  const remove = await call(base, `${members}/${people.manager.id}`, { cookie: people.alice.cookie, method: 'DELETE' });
  assert.equal(remove.status, 403, 'модератор не выводит владельца');
  const add = await call(base, members, { cookie: people.alice.cookie, method: 'POST', body: { userIds: [people.carol.id], role: 'owner' } });
  assert.equal(add.status, 403, 'модератор не добавляет владельца');

  const ok = await call(base, `${members}/${people.bob.id}`, { cookie: people.alice.cookie, method: 'PATCH', body: { role: 'moderator' } });
  assert.equal(ok.status, 200, 'назначить модератора модератор вправе');
});

test('комнаты на всё пространство заводят только те, кому разрешены каналы; группа доступна всем', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  for (const kind of ['team', 'project', 'channel']) {
    const denied = await call(base, '/api/v1/conversations', { cookie: people.alice.cookie, method: 'POST', body: { kind, title: kind, visibility: 'workspace' } });
    assert.equal(denied.status, 403, `${kind}/workspace у сотрудника`);
  }
  const group = await call(base, '/api/v1/conversations', { cookie: people.alice.cookie, method: 'POST', body: { kind: 'group', title: 'Своя группа', participantIds: [people.bob.id] } });
  assert.equal(group.status, 201);
  const nullBody = await call(base, '/api/v1/conversations', { cookie: people.alice.cookie, method: 'POST', raw: 'null', headers: { 'content-type': 'application/json' } });
  assert.equal(nullBody.status, 400);
  assert.equal(nullBody.code, 'INVALID_JSON');
});

test('ссылка на смену пароля выдаётся только тому, кто стоит выше по рангу', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  const reset = (actor, target) => call(base, '/api/v1/password-resets', { cookie: people[actor].cookie, method: 'POST', body: { userId: people[target].id } });
  assert.equal((await reset('manager', 'owner')).status, 403);
  assert.equal((await reset('manager', 'admin')).status, 403);
  assert.equal((await reset('manager', 'alice')).status, 201);
  assert.equal((await reset('admin', 'manager')).status, 201);
  assert.equal((await reset('owner', 'admin')).status, 201);
});

test('удалённое сообщение стёрто в базе вместе с правками', { skip }, async (t) => {
  const { app, base, people } = await workspace(t);
  const boot = await call(base, '/api/v1/bootstrap', { cookie: people.alice.cookie });
  const general = boot.payload.conversations.find((c) => c.slug === 'general');
  const sent = await call(base, `/api/v1/conversations/${general.id}/messages`, { cookie: people.alice.cookie, method: 'POST', body: { body: 'секретная фраза до правки' } });
  const id = sent.payload.message.id;
  await call(base, `/api/v1/messages/${id}`, { cookie: people.alice.cookie, method: 'PATCH', body: { body: 'секретная фраза после правки' } });
  const del = await call(base, `/api/v1/messages/${id}`, { cookie: people.alice.cookie, method: 'DELETE' });
  assert.equal(del.status, 200);
  const row = (await app.store.pool.query('SELECT body, metadata FROM messages WHERE id=$1', [id])).rows[0];
  assert.doesNotMatch(String(row.body), /секретная/);
  assert.deepEqual(row.metadata, {});
  const versions = await app.store.pool.query('SELECT 1 FROM message_versions WHERE message_id=$1', [id]);
  assert.equal(versions.rowCount, 0);
});

test('файлы: удаляет автор или админ, чужому 404; чужой файл во вложение не берётся', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  const upload = (who, name) => call(base, '/api/v1/files', { cookie: people[who].cookie, method: 'POST', raw: Buffer.from('данные'), headers: { 'content-type': 'text/plain', 'x-file-name': encodeURIComponent(name) } });
  const mine = await upload('alice', 'моё.txt');
  const fileId = mine.payload.file.id;
  assert.equal('storageKey' in mine.payload.file, false, 'путь в хранилище наружу не отдаётся');

  const boot = await call(base, '/api/v1/bootstrap', { cookie: people.bob.cookie });
  const general = boot.payload.conversations.find((c) => c.slug === 'general');
  const stolen = await call(base, `/api/v1/conversations/${general.id}/messages`, {
    cookie: people.bob.cookie, method: 'POST', body: { kind: 'file', body: 'вложение', metadata: { fileId } },
  });
  assert.equal(stolen.status, 404, 'вложить файл, который не можешь читать, нельзя');

  assert.equal((await call(base, `/api/v1/files/${fileId}`, { cookie: people.bob.cookie, method: 'DELETE' })).status, 404);
  assert.equal((await call(base, `/api/v1/files/${fileId}`, { cookie: people.alice.cookie, method: 'DELETE' })).status, 204);
  assert.equal((await call(base, `/api/v1/files/${fileId}/content`, { cookie: people.alice.cookie })).status, 404);

  const second = (await upload('alice', 'второй.txt')).payload.file.id;
  assert.equal((await call(base, `/api/v1/files/${second}`, { cookie: people.admin.cookie, method: 'DELETE' })).status, 204, 'админ удаляет чужой файл');
});

test('события и напоминания не привязываются к тому, чего человек не видит', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  const priv = await call(base, '/api/v1/conversations', { cookie: people.alice.cookie, method: 'POST', body: { kind: 'group', title: 'Закрытая', participantIds: [people.bob.id] } });
  const conversationId = priv.payload.conversation.id;
  const start = new Date(Date.now() + 3 * 86400000);
  const when = { startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600000).toISOString() };

  const stranger = await call(base, '/api/v1/calendar-events', { cookie: people.carol.cookie, method: 'POST', body: { title: 'Подсадка', kind: 'meeting', conversationId, ...when } });
  assert.equal(stranger.status, 404, 'встречу нельзя подсадить в чужую беседу');
  const member = await call(base, '/api/v1/calendar-events', { cookie: people.bob.cookie, method: 'POST', body: { title: 'Своя', kind: 'meeting', conversationId, ...when } });
  assert.equal(member.status, 201);

  const task = await call(base, '/api/v1/tasks', { cookie: people.alice.cookie, method: 'POST', body: { title: 'Личная', outcome: 'x', ownerId: people.alice.id } });
  const remindAt = new Date(Date.now() + 3600000).toISOString();
  const spy = await call(base, '/api/v1/reminders', { cookie: people.carol.cookie, method: 'POST', body: { title: 'x', remindAt, sourceType: 'task', sourceId: task.payload.task.id } });
  assert.equal(spy.status, 404, 'напоминание на чужую задачу');
  const own = await call(base, '/api/v1/reminders', { cookie: people.alice.cookie, method: 'POST', body: { title: 'x', remindAt, sourceType: 'task', sourceId: task.payload.task.id } });
  assert.equal(own.status, 201);
});

test('вебхук нельзя направить во внутреннюю сеть, в том числе через IPv6-запись', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  for (const url of ['http://[::127.0.0.1]/', 'http://127.0.0.1/', 'http://[::ffff:7f00:1]/']) {
    const response = await call(base, '/api/v1/integrations/webhooks', { cookie: people.owner.cookie, method: 'POST', body: { label: 'ssrf', url, topics: [] } });
    assert.equal(response.status, 400, url);
  }
});

test('подталкивание: срок задачи и близкая встреча порождают по одному уведомлению', { skip }, async (t) => {
  const { app, base, people } = await workspace(t);
  const due = new Date(Date.now() + 5 * 3600000).toISOString();
  const created = await call(base, '/api/v1/tasks', { cookie: people.manager.cookie, method: 'POST', body: { title: 'Срочное дело', outcome: 'x', ownerId: people.alice.id, promisedAt: due } });
  const { id, version } = created.payload.task;
  const accepted = await call(base, `/api/v1/tasks/${id}/transitions`, { cookie: people.alice.cookie, method: 'POST', body: { to: 'accepted', expectedVersion: version } });
  assert.equal(accepted.status, 200);

  const start = new Date(Date.now() + 10 * 60000);
  await call(base, '/api/v1/calendar-events', {
    cookie: people.manager.cookie, method: 'POST',
    body: { title: 'Скоро созвон', kind: 'meeting', startAt: start.toISOString(), endAt: new Date(start.getTime() + 1800000).toISOString(), participantIds: [people.alice.id] },
  });

  await app.reminders.nudge();
  await app.reminders.nudge(); // второй проход ничего не добавляет
  const inbox = await call(base, '/api/v1/notifications?limit=50', { cookie: people.alice.cookie });
  const items = inbox.payload.items;
  assert.equal(items.filter((n) => n.type === 'task.due' && n.title === 'Срочное дело').length, 1);
  assert.equal(items.filter((n) => n.type === 'calendar.reminder' && n.title === 'Скоро созвон').length, 1);
});

test('WebSocket: чужой и пустой Origin отклоняются, без Origin и свой проходят', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  const url = base.replace('http', 'ws') + '/ws';
  const attempt = (origin) => new Promise((resolve) => {
    const headers = { cookie: people.alice.cookie, ...(origin === undefined ? {} : { origin }) };
    const socket = new WebSocket(url, { headers });
    socket.on('open', () => { socket.close(); resolve(101); });
    socket.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    socket.on('error', () => resolve(0));
  });
  assert.equal(await attempt('https://evil.example'), 403);
  assert.equal(await attempt(''), 403);
  assert.equal(await attempt(undefined), 101);
  assert.equal(await attempt(base), 101);
});

test('ошибки сервера приходят по-русски, а мусорные параметры дают 400, не 500', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  const anonymous = await call(base, '/api/v1/me');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.payload.error.message, 'Нужно войти в систему');
  const missing = await call(base, '/api/v1/tasks/00000000-0000-4000-8000-000000000000', { cookie: people.alice.cookie });
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.error.message, 'Задача не найдена');
  const negative = await call(base, '/api/v1/stories/archive?limit=-1', { cookie: people.alice.cookie });
  assert.equal(negative.status, 400);
  const object = await call(base, '/api/v1/tasks', { cookie: people.alice.cookie, method: 'POST', body: { title: { a: 1 }, outcome: 'x' } });
  assert.equal(object.status, 400);
});

test('загрузка файла крупнее лимита JSON проходит и с заголовком Idempotency-Key', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  const big = Buffer.alloc(2 * 1024 * 1024, 65);
  const response = await call(base, '/api/v1/files', {
    cookie: people.alice.cookie, method: 'POST', raw: big,
    headers: { 'content-type': 'text/plain', 'x-file-name': 'big.txt', 'idempotency-key': randomUUID() },
  });
  assert.equal(response.status, 201, 'раньше такая загрузка падала с 413');
});

test('напоминание с исчезнувшим источником не останавливает остальные', { skip }, async (t) => {
  const { app, base, people } = await workspace(t);
  const boot = await call(base, '/api/v1/bootstrap', { cookie: people.alice.cookie });
  const general = boot.payload.conversations.find((c) => c.slug === 'general');
  const remindAt = new Date(Date.now() + 3600000).toISOString();

  // Через API ставить напоминание на несуществующее сообщение нельзя.
  const ghost = await call(base, '/api/v1/reminders', {
    cookie: people.alice.cookie, method: 'POST',
    body: { title: 'призрак', remindAt, sourceType: 'message', sourceId: randomUUID(), conversationId: general.id },
  });
  assert.equal(ghost.status, 404);

  // А если источник исчез уже после постановки (или строка попала в базу иначе), доставка идёт дальше.
  const ws = (await app.store.pool.query('SELECT workspace_id, organization_id FROM memberships WHERE user_id=$1', [people.alice.id])).rows[0];
  const insert = (title, sourceType, sourceId) => app.store.pool.query(
    `INSERT INTO reminders(organization_id,workspace_id,user_id,title,remind_at,source_type,source_id,conversation_id)
     VALUES($1,$2,$3,$4,now() - interval '1 minute',$5,$6,$7)`,
    [ws.organization_id, ws.workspace_id, people.alice.id, title, sourceType, sourceId, general.id],
  );
  await insert('отравленное', 'message', randomUUID());
  await insert('обычное', null, null);
  // В общей базе набора могут ждать чужие напоминания старше наших: идём по пачкам, пока обе наши строки не обработаны.
  for (let round = 0; round < 20; round += 1) {
    const { rows } = await app.store.pool.query(`SELECT count(*)::int n FROM reminders WHERE user_id=$1 AND status='pending'`, [people.alice.id]);
    if (!rows[0].n) break;
    await app.reminders.due({ limit: 200 });
  }
  const inbox = await call(base, '/api/v1/notifications?limit=50', { cookie: people.alice.cookie });
  const titles = inbox.payload.items.filter((n) => n.type === 'calendar.reminder').map((n) => n.title);
  assert.ok(titles.includes('обычное'), 'обычное напоминание пришло');
  assert.ok(titles.includes('отравленное'), 'отравленное тоже пришло — без ссылки на исчезнувший источник');
});

test('метрики в production без токена закрыты, в том числе заголовком «Bearer undefined»', { skip }, async (t) => {
  const previous = { env: process.env.NODE_ENV, token: process.env.METRICS_TOKEN };
  process.env.NODE_ENV = 'production';
  delete process.env.METRICS_TOKEN;
  t.after(() => {
    if (previous.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.env;
    if (previous.token !== undefined) process.env.METRICS_TOKEN = previous.token;
  });
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const bare = await fetch(`${base}/metrics`);
  assert.equal(bare.status, 401);
  const trick = await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer undefined' } });
  assert.equal(trick.status, 401, 'заголовок «Bearer undefined» не должен открывать метрики');
  const health = await (await fetch(`${base}/healthz`)).json();
  assert.deepEqual(Object.keys(health), ['ok'], 'в production подробности healthz скрыты');
});

test('«вся компания видит, что время занято»: чужой видит занятость, а не название и описание', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  const startAt = new Date(Date.now() + 2 * 86400000).toISOString();
  const endAt = new Date(Date.now() + 2 * 86400000 + 3600000).toISOString();
  const made = await call(base, '/api/v1/calendar-events', {
    cookie: people.bob.cookie, method: 'POST',
    body: { kind: 'meeting', title: 'Секретные переговоры', description: 'Секретное описание', startAt, endAt, visibility: 'workspace' },
  });
  assert.equal(made.status, 201);
  const id = made.payload.event.id;
  const range = `from=${new Date(Date.now() - 86400000).toISOString()}&to=${new Date(Date.now() + 5 * 86400000).toISOString()}`;

  const list = await call(base, `/api/v1/calendar-events?${range}`, { cookie: people.alice.cookie });
  const seen = list.payload.items.find((x) => x.id === id);
  assert.ok(seen, 'занятость видна');
  assert.equal(seen.busyOnly, true);
  assert.notEqual(seen.title, 'Секретные переговоры');
  const card = await call(base, `/api/v1/calendar-events/${id}`, { cookie: people.alice.cookie });
  assert.equal(card.payload.event.description, null);
  assert.notEqual(card.payload.event.title, 'Секретные переговоры');

  // Организатор видит своё целиком.
  const own = await call(base, `/api/v1/calendar-events/${id}`, { cookie: people.bob.cookie });
  assert.equal(own.payload.event.title, 'Секретные переговоры');
  assert.equal(own.payload.event.description, 'Секретное описание');
});

test('личная беседа называется именем собеседника у обоих', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  const created = await call(base, '/api/v1/conversations', {
    cookie: people.alice.cookie, method: 'POST', body: { kind: 'direct', participantIds: [people.bob.id] },
  });
  assert.equal(created.status, 201);
  const titleFor = async (who) => (await call(base, '/api/v1/bootstrap', { cookie: people[who].cookie }))
    .payload.conversations.find((c) => c.id === created.payload.conversation.id)?.title;
  assert.equal(await titleFor('alice'), 'bob');
  assert.equal(await titleFor('bob'), 'alice');
});

test('повторение, которое кончается раньше первой встречи, отклоняется', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  const start = new Date(Date.now() + 5 * 86400000);
  const result = await call(base, '/api/v1/calendar-events', {
    cookie: people.alice.cookie, method: 'POST',
    body: { kind: 'meeting', title: 'Серия', startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600000).toISOString(),
      timezone: 'Europe/Moscow', recurrenceRule: 'FREQ=WEEKLY;UNTIL=20200101T000000Z' },
  });
  assert.equal(result.status, 400);
  assert.equal(result.code, 'INVALID_RECURRENCE');
});

test('API-ключ не управляет безопасностью учётной записи, а при увольнении ключи отзываются', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  const made = await call(base, '/api/v1/api-keys', { cookie: people.alice.cookie, method: 'POST', body: { name: 'ci' } });
  assert.equal(made.status, 201);
  const bearer = { headers: { authorization: `Bearer ${made.payload.key}` } };
  assert.equal((await call(base, '/api/v1/bootstrap', bearer)).status, 200, 'ключ работает для обычных запросов');
  for (const [method, path] of [['POST', '/api/v1/auth/two-factor'], ['GET', '/api/v1/auth/sessions'], ['POST', '/api/v1/api-keys'], ['GET', '/api/v1/vault']]) {
    const denied = await call(base, path, { method, body: method === 'POST' ? { name: 'x' } : undefined, ...bearer });
    assert.equal(denied.status, 403, `${method} ${path} по ключу`);
    assert.equal(denied.code, 'API_KEY_FORBIDDEN');
  }
  const off = await call(base, '/api/v1/people/' + people.alice.id + '/deactivate', { cookie: people.owner.cookie, method: 'POST' });
  assert.equal(off.status, 200, JSON.stringify(off.payload));
  const back = await call(base, '/api/v1/people/' + people.alice.id + '/reactivate', { cookie: people.owner.cookie, method: 'POST' });
  assert.equal(back.status, 200, JSON.stringify(back.payload));
  assert.equal((await call(base, '/api/v1/bootstrap', bearer)).status, 401, 'после возвращения старый ключ не оживает');
});

test('уволенному нельзя поручить задачу и открыть с ним личную переписку; чужой Origin не проходит с cookie', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  assert.equal((await call(base, '/api/v1/people/' + people.bob.id + '/deactivate', { cookie: people.owner.cookie, method: 'POST' })).status, 200);
  const task = await call(base, '/api/v1/tasks', { cookie: people.alice.cookie, method: 'POST', body: { title: 'уволенному', ownerId: people.bob.id } });
  assert.equal(task.status, 409);
  assert.equal(task.code, 'PERSON_DEACTIVATED');
  const dm = await call(base, '/api/v1/conversations', { cookie: people.alice.cookie, method: 'POST', body: { kind: 'direct', participantIds: [people.bob.id] } });
  assert.equal(dm.status, 400);

  const evil = await call(base, '/api/v1/tasks', { cookie: people.alice.cookie, method: 'POST', headers: { origin: 'http://evil.example' }, body: { title: 'csrf' } });
  assert.equal(evil.status, 403);
  assert.equal(evil.code, 'CROSS_ORIGIN');
  const same = await call(base, '/api/v1/tasks', { cookie: people.alice.cookie, method: 'POST', headers: { origin: base }, body: { title: 'свой сайт', ownerId: people.alice.id } });
  assert.notEqual(same.status, 403);
});

test('подразделение и дата выхода: PATCH держит те же границы, что и создание', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  const unit = await call(base, '/api/v1/org/units', { cookie: people.owner.cookie, method: 'POST', body: { name: 'Отдел', kind: 'department' } });
  assert.equal(unit.status, 201);
  const id = unit.payload.unit.id;
  for (const body of [{ name: 'я'.repeat(5000) }, { name: { a: 1 } }, { purpose: 'я'.repeat(900) }, { purpose: { a: 1 } }]) {
    assert.equal((await call(base, `/api/v1/org/units/${id}`, { cookie: people.owner.cookie, method: 'PATCH', body })).status, 400, JSON.stringify(body).slice(0, 40));
  }
  for (const startedOn of ['99999-01-01', '2020-02-31', [1]]) {
    const bad = await call(base, `/api/v1/people/${people.alice.id}`, { cookie: people.alice.cookie, method: 'PATCH', body: { startedOn } });
    assert.equal(bad.status, 400, String(startedOn));
  }
  assert.equal((await call(base, `/api/v1/people/${people.alice.id}`, { cookie: people.alice.cookie, method: 'PATCH', body: { startedOn: '2024-03-01' } })).status, 200);
});

test('повторяющаяся встреча тоже напоминает за 15 минут, отменённое вхождение — нет', { skip }, async (t) => {
  const { app, base, people } = await workspace(t);
  const start = new Date(Date.now() + 10 * 60_000);
  start.setUTCSeconds(0, 0);
  const made = await call(base, '/api/v1/calendar-events', {
    cookie: people.alice.cookie, method: 'POST',
    body: { kind: 'meeting', title: 'Ежедневная планёрка', startAt: start.toISOString(), endAt: new Date(start.getTime() + 1800000).toISOString(),
      timezone: 'UTC', recurrenceRule: 'FREQ=DAILY' },
  });
  assert.equal(made.status, 201);
  await app.reminders.nudge();
  const inbox = await call(base, '/api/v1/notifications?limit=50', { cookie: people.alice.cookie });
  assert.ok(inbox.payload.items.some((n) => n.type === 'calendar.reminder' && n.title === 'Ежедневная планёрка'), 'напоминание о вхождении пришло');
  // Повторный проход не дублирует.
  await app.reminders.nudge();
  const again = await call(base, '/api/v1/notifications?limit=50', { cookie: people.alice.cookie });
  assert.equal(again.payload.items.filter((n) => n.title === 'Ежедневная планёрка').length, 1);
});

test('протокол встречи и поиск не раскрывают «занято»; таймер останавливается вместе с задачей', { skip }, async (t) => {
  const { base, people } = await workspace(t);
  const startAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const endAt = new Date(Date.now() + 3 * 86400000 + 3600000).toISOString();
  const made = await call(base, '/api/v1/calendar-events', { cookie: people.bob.cookie, method: 'POST',
    body: { kind: 'meeting', title: 'Закрытый разговор уникум', startAt, endAt, visibility: 'workspace' } });
  const id = made.payload.event.id;
  assert.equal((await call(base, `/api/v1/calendar-events/${id}/notes`, { cookie: people.bob.cookie, method: 'PUT', body: { title: 'П', notes: 'секрет', decisions: ['д'] } })).status, 200);
  for (const method of ['GET', 'PUT']) {
    const r = await call(base, `/api/v1/calendar-events/${id}/notes`, { cookie: people.alice.cookie, method, body: method === 'PUT' ? { title: 'взлом', notes: 'x', decisions: [] } : undefined });
    assert.equal(r.status, 404, `${method} протокола чужим`);
  }
  const found = await call(base, '/api/v1/search?q=' + encodeURIComponent('уникум'), { cookie: people.alice.cookie });
  assert.equal(found.payload.items.length, 0, 'поиск не выдаёт название занятого события');
  const mine = await call(base, '/api/v1/search?q=' + encodeURIComponent('уникум'), { cookie: people.bob.cookie });
  assert.ok(mine.payload.items.some((x) => x.type === 'event'), 'организатор своё находит');
});

test('экран приглашения: компания, кто зовёт и роль видны по ссылке до ввода пароля', { skip }, async (t) => {
  const { base, people, suffix } = await workspace(t);
  const invited = await call(base, '/api/v1/invitations', { cookie: people.owner.cookie, method: 'POST', body: { email: `peek-${suffix}@t.test`, role: 'member' } });
  const token = new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite');
  const peek = await call(base, `/api/v1/invitations/peek?token=${encodeURIComponent(token)}`);
  assert.equal(peek.status, 200);
  assert.equal(peek.payload.invitation.state, 'pending');
  assert.equal(peek.payload.invitation.role, 'member');
  assert.match(peek.payload.invitation.workspaceName, /Hard/);
  assert.equal((await call(base, '/api/v1/invitations/peek?token=wrong')).status, 404);
  await call(base, '/api/v1/invitations/accept', { method: 'POST', body: { token, displayName: 'Пик', password: 'MemberPassword42' } });
  assert.equal((await call(base, `/api/v1/invitations/peek?token=${encodeURIComponent(token)}`)).payload.invitation.state, 'accepted');
});
