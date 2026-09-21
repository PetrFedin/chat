import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createChatServer } from '../src/server.js';
import { Permission, ROLE_PERMISSIONS } from '../src/rbac.js';

/**
 * Матрица «роль × маршрут».
 *
 * Каждая строка таблицы ROUTES — это один маршрут и ожидаемый код ответа для
 * каждой из пяти ролей. Новый маршрут добавляется строкой: `path` и `body`
 * получают мир (см. buildWorld) с уже готовыми объектами — своими и чужими,
 * чтобы «нет прав» (403) отличалось от «не моё» (404), а отказ по правилу
 * предметной области (409) — от обоих.
 *
 * Поле `gap` не проверяется: это запись о том, что роль обещает одно, а
 * сервер делает другое. Оно стоит рядом с фактом намеренно — иначе
 * расхождение исчезает из виду, как только тест позеленел.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const skip = DATABASE_URL ? false : 'DATABASE_URL не задан: матрица проверяется только на PostgreSQL';
const PASS = 'MatrixPassword42';
const ROLES = ['owner', 'admin', 'manager', 'member', 'guest'];
const MISSING = '00000000-0000-4000-8000-000000000000';
const VAULT = process.env.VAULT_KEY ? 200 : 503;
const VAULT_CREATED = process.env.VAULT_KEY ? 201 : 503;

const rnd = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const iso = (ms) => new Date(Date.now() + ms).toISOString();

async function call(base, path, { cookie, method = 'GET', body, raw } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(raw ? raw.headers : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: raw ? raw.body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return {
    status: response.status,
    payload,
    code: payload?.error?.code ?? null,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
  };
}

async function startServer(t) {
  const app = await createChatServer({ startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  return `http://127.0.0.1:${app.server.address().port}`;
}

/** Компания: по человеку на каждую роль плюс «чужой сотрудник». */
async function buildCompany(base) {
  const suffix = rnd();
  const registered = await call(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Матрица ${suffix}`, ownerName: 'Владелец', email: `owner-${suffix}@matrix.test`, password: PASS },
  });
  assert.equal(registered.status, 201, 'компания заводится');
  const ownerId = (await call(base, '/api/v1/me', { cookie: registered.cookie })).payload.userId;

  const join = async (role, displayName) => {
    const invitation = await call(base, '/api/v1/invitations', {
      cookie: registered.cookie,
      method: 'POST',
      body: { email: `${role}-${rnd()}@matrix.test`, role },
    });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const accepted = await call(base, '/api/v1/invitations/accept', { method: 'POST', body: { token, displayName, password: PASS } });
    const me = await call(base, '/api/v1/me', { cookie: accepted.cookie });
    return { cookie: accepted.cookie, userId: me.payload.userId, role };
  };

  return {
    actors: {
      owner: { cookie: registered.cookie, userId: ownerId, role: 'owner' },
      admin: await join('admin', 'Администратор'),
      manager: await join('manager', 'Руководитель'),
      member: await join('member', 'Сотрудник'),
      guest: await join('guest', 'Гость'),
    },
    // Чужой сотрудник — владелец «чужих» объектов. Он ни в одной строке не
    // действует, он только создаёт то, на что смотрят остальные.
    stranger: await join('member', 'Чужой сотрудник'),
  };
}

/**
 * Мир для одной роли: свои объекты и чужие. Каждый разрушающий маршрут
 * получает собственный объект, иначе строка таблицы начинает зависеть от
 * порядка строк выше неё.
 */
async function buildWorld(base, actors, stranger, actor) {
  const as = (who) => (path, options = {}) => call(base, path, { cookie: who.cookie, ...options });
  const O = as(actors.owner);
  const S = as(stranger);
  const A = as(actor);
  const staff = [actors.admin.userId, actors.manager.userId, actors.member.userId, stranger.userId];

  const conversation = async (title, extra = {}) =>
    (await O('/api/v1/conversations', {
      method: 'POST',
      body: { kind: 'group', title, participantIds: [...staff, actors.guest.userId], ...extra },
    })).payload.conversation;

  const room = await conversation(`Комната ${rnd()}`);
  const roomGames = await conversation(`Игровая ${rnd()}`);
  const leaveChannel = (await O('/api/v1/conversations', {
    method: 'POST',
    body: { kind: 'channel', title: `Канал ${rnd()}`, visibility: 'workspace', participantIds: [...staff, actors.guest.userId] },
  })).payload.conversation;
  // Чтобы «уйти из канала» не упиралось в «ты последний владелец комнаты»,
  // у канала есть второй владелец.
  await O(`/api/v1/conversations/${leaveChannel.id}/members/${stranger.userId}`, { method: 'PATCH', body: { role: 'owner' } });

  const post = async (who, text) => (await as(who)(`/api/v1/conversations/${room.id}/messages`, { method: 'POST', body: { kind: 'text', body: text } })).payload?.message ?? null;
  const strangerMessage = await post(stranger, 'чужое сообщение');
  const strangerMessageToDelete = await post(stranger, 'чужое сообщение на удаление');
  const strangerMessageToPin = await post(stranger, 'чужое сообщение на закрепление');
  const ownMessage = await post(actor, 'своё сообщение');

  const task = async (title) => (await S('/api/v1/tasks', { method: 'POST', body: { title } })).payload?.task ?? null;
  const foreignTask = await task(`Чужая задача ${rnd()}`);
  const foreignTaskToCancel = await task(`Чужая задача отмена ${rnd()}`);
  const foreignTaskToSchedule = await task(`Чужая задача срок ${rnd()}`);
  const foreignTaskToReassign = await task(`Чужая задача передача ${rnd()}`);
  const foreignTaskForEvidence = await task(`Чужая задача свидетельство ${rnd()}`);

  // Чужая задача, доведённая чужими руками до приёмки: владелец, заказчик и
  // приёмщик — один и тот же человек.
  const drive = async (id, to, version, reason) =>
    (await S(`/api/v1/tasks/${id}/transitions`, { method: 'POST', body: { to, expectedVersion: version, reason } })).payload?.task;
  let review = await task(`Чужая на приёмке ${rnd()}`);
  review = await drive(review.id, 'accepted', review.version);
  review = await drive(review.id, 'in_progress', review.version);
  review = (await S(`/api/v1/tasks/${review.id}/evidence`, { method: 'POST', body: { type: 'note', value: 'результат готов', expectedVersion: review.version } })).payload.task;
  const foreignTaskInReview = await drive(review.id, 'in_review', review.version);

  const event = async (title) =>
    (await S('/api/v1/calendar-events', {
      method: 'POST',
      body: { title, startAt: iso(864e5), endAt: iso(864e5 + 36e5), visibility: 'workspace' },
    })).payload?.event ?? null;
  const foreignEvent = await event(`Чужая встреча ${rnd()}`);
  const foreignEventToCancel = await event(`Чужая встреча отмена ${rnd()}`);
  const foreignEventGuests = await event(`Чужая встреча участники ${rnd()}`);
  // Роль должна иметь, на что отвечать: приглашение делает организатор.
  await S(`/api/v1/calendar-events/${foreignEvent.id}/participants`, { method: 'POST', body: { userIds: [actor.userId] } });

  const unit = (await O('/api/v1/org/units', { method: 'POST', body: { name: `Отдел ${rnd()}`, kind: 'department' } })).payload.unit;
  const unitToDelete = (await O('/api/v1/org/units', { method: 'POST', body: { name: `Отдел удаляемый ${rnd()}`, kind: 'department' } })).payload.unit;
  await O(`/api/v1/org/units/${unit.id}/members`, { method: 'POST', body: { userId: stranger.userId, role: 'member' } });

  const label = async (name) => (await O('/api/v1/labels', { method: 'POST', body: { name, kind: 'tag' } })).payload.label;
  const sharedLabel = await label(`Метка ${rnd()}`);
  const sharedLabelToRename = await label(`Метка переименование ${rnd()}`);
  const sharedLabelToDelete = await label(`Метка удаление ${rnd()}`);

  const personalItem = (await A('/api/v1/personal-items', { method: 'POST', body: { title: `Личное ${rnd()}` } })).payload?.item ?? null;
  const personalItemToDelete = (await A('/api/v1/personal-items', { method: 'POST', body: { title: `Личное удаление ${rnd()}` } })).payload?.item ?? null;
  const reminder = (await A('/api/v1/reminders', { method: 'POST', body: { title: `Напоминание ${rnd()}`, remindAt: iso(36e5) } })).payload?.reminder ?? null;
  const reminderToDelete = (await A('/api/v1/reminders', { method: 'POST', body: { title: `Напоминание удаление ${rnd()}`, remindAt: iso(36e5) } })).payload?.reminder ?? null;
  const note = (await A('/api/v1/message-notes', { method: 'POST', body: { messageId: strangerMessage.id, body: 'заметка' } })).payload?.note ?? null;
  const highlight = (await A('/api/v1/highlights', { method: 'POST', body: { messageId: strangerMessage.id, quote: 'чужое', startOffset: 0, endOffset: 5 } })).payload?.highlight ?? null;

  const foreignCall = (await S(`/api/v1/conversations/${room.id}/calls`, { method: 'POST', body: { mode: 'audio' } })).payload.call;
  const webhook = (await O('/api/v1/integrations/webhooks', { method: 'POST', body: { label: `Хук ${rnd()}`, url: 'https://example.test/hook', topics: ['task.created'] } })).payload.endpoint;
  const webhookToDelete = (await O('/api/v1/integrations/webhooks', { method: 'POST', body: { label: `Хук удаление ${rnd()}`, url: 'https://example.test/hook2', topics: ['task.created'] } })).payload.endpoint;
  // Игра заводится чужими руками, чтобы роль отвечала на приглашение, а не на своё.
  const foreignGame = (await S('/api/v1/games', { method: 'POST', body: { conversationId: roomGames.id, kind: 'checkers', opponentId: actor.userId } })).payload?.game ?? null;

  const ownFile = (await call(base, '/api/v1/files', {
    cookie: actor.cookie,
    method: 'POST',
    raw: { headers: { 'content-type': 'text/plain', 'x-file-name': 'note.txt' }, body: 'матрица' },
  })).payload?.file ?? null;

  return {
    room, roomGames, leaveChannel, strangerMessage, strangerMessageToDelete, strangerMessageToPin, ownMessage,
    foreignTask, foreignTaskToCancel, foreignTaskToSchedule, foreignTaskToReassign, foreignTaskForEvidence, foreignTaskInReview,
    foreignEvent, foreignEventToCancel, foreignEventGuests, unit, unitToDelete, sharedLabel, sharedLabelToRename, sharedLabelToDelete,
    personalItem, personalItemToDelete, reminder, reminderToDelete, note, highlight, foreignCall, webhook, webhookToDelete,
    foreignGame, ownFile, actor, actors, stranger,
  };
}

const id = (value) => value?.id ?? MISSING;

/**
 * Таблица. `expect` — код для каждой роли; одно число значит «для всех».
 * `gap` — то, что роль обещает и чего сервер не делает; оно только печатается.
 */
const ROUTES = [
  // --- сессия и приглашения -------------------------------------------------
  { route: 'GET /api/v1/me', path: () => '/api/v1/me', expect: 200 },
  { route: 'GET /api/v1/bootstrap', path: () => '/api/v1/bootstrap', expect: 200 },
  {
    route: 'POST /api/v1/invitations', method: 'POST', path: () => '/api/v1/invitations',
    body: () => ({ email: `invited-${rnd()}@matrix.test`, role: 'member' }),
    expect: { owner: 201, admin: 201, manager: 201, member: 403, guest: 403 },
  },
  {
    route: 'POST /api/v1/invitations (role=admin)', method: 'POST', path: () => '/api/v1/invitations',
    body: () => ({ email: `escalated-${rnd()}@matrix.test`, role: 'admin' }),
    expect: { owner: 201, admin: 201, manager: 403, member: 403, guest: 403 },
    note: 'пригласить можно на свою ступень и ниже: руководитель админа не выпишет',
  },
  {
    route: 'POST /api/v1/password-resets', method: 'POST', path: () => '/api/v1/password-resets',
    body: (w) => ({ userId: w.stranger.userId }),
    expect: { owner: 201, admin: 201, manager: 201, member: 403, guest: 403 },
  },

  // --- рабочий день ---------------------------------------------------------
  { route: 'GET /api/v1/attention', path: () => '/api/v1/attention', expect: 200 },
  { route: 'GET /api/v1/notifications', path: () => '/api/v1/notifications', expect: 200 },
  { route: 'POST /api/v1/notifications/read-all', method: 'POST', path: () => '/api/v1/notifications/read-all', body: () => ({}), expect: 200 },
  { route: 'GET /api/v1/search', path: () => '/api/v1/search?q=задача', expect: 200 },
  { route: 'GET /api/v1/files', path: () => '/api/v1/files', expect: 200 },
  { route: 'GET /api/v1/mentions', path: () => '/api/v1/mentions', expect: 200 },

  // --- задачи ---------------------------------------------------------------
  { route: 'GET /api/v1/tasks', path: () => '/api/v1/tasks', expect: 200 },
  {
    route: 'POST /api/v1/tasks', method: 'POST', path: () => '/api/v1/tasks', body: () => ({ title: `Новая задача ${rnd()}` }),
    expect: { owner: 201, admin: 201, manager: 201, member: 201, guest: 403 },
  },
  {
    route: 'GET /api/v1/tasks/{чужая}', path: (w) => `/api/v1/tasks/${id(w.foreignTask)}`,
    expect: { owner: 200, admin: 200, manager: 200, member: 404, guest: 404 },
  },
  {
    route: 'POST /api/v1/tasks/{чужая}/transitions (отменить)', method: 'POST',
    path: (w) => `/api/v1/tasks/${id(w.foreignTaskToCancel)}/transitions`,
    body: (w) => ({ to: 'cancelled', reason: 'работа не нужна', expectedVersion: w.foreignTaskToCancel.version }),
    expect: { owner: 200, admin: 200, manager: 200, member: 404, guest: 404 },
  },
  {
    route: 'POST /api/v1/tasks/{чужая на приёмке}/transitions (принять результат)', method: 'POST',
    path: (w) => `/api/v1/tasks/${id(w.foreignTaskInReview)}/transitions`,
    body: (w) => ({ to: 'accepted_result', expectedVersion: w.foreignTaskInReview.version }),
    expect: { owner: 403, admin: 403, manager: 403, member: 404, guest: 404 },
    gap: 'owner/admin/manager: принять чужой результат не может никто, кроме назначенного приёмщика — задача уволившегося замирает в in_review',
  },
  {
    route: 'POST /api/v1/tasks/{чужая}/evidence', method: 'POST',
    path: (w) => `/api/v1/tasks/${id(w.foreignTaskForEvidence)}/evidence`,
    body: (w) => ({ type: 'note', value: 'наблюдение руководителя', expectedVersion: w.foreignTaskForEvidence.version }),
    expect: { owner: 201, admin: 201, manager: 201, member: 404, guest: 404 },
  },
  {
    route: 'PATCH /api/v1/tasks/{чужая}/assignment', method: 'PATCH',
    path: (w) => `/api/v1/tasks/${id(w.foreignTaskToReassign)}/assignment`,
    body: (w) => ({ ownerId: w.actors.member.userId, reason: 'перераспределение нагрузки', expectedVersion: w.foreignTaskToReassign.version }),
    expect: { owner: 200, admin: 200, manager: 200, member: 404, guest: 404 },
  },
  {
    route: 'PATCH /api/v1/tasks/{чужая}/schedule', method: 'PATCH',
    path: (w) => `/api/v1/tasks/${id(w.foreignTaskToSchedule)}/schedule`,
    body: (w) => ({ promisedAt: iso(3 * 864e5), reason: 'срок сдвигается', expectedVersion: w.foreignTaskToSchedule.version }),
    expect: { owner: 200, admin: 200, manager: 200, member: 404, guest: 404 },
  },

  // --- календарь ------------------------------------------------------------
  { route: 'GET /api/v1/calendar-events', path: () => '/api/v1/calendar-events', expect: 200 },
  {
    route: 'POST /api/v1/calendar-events', method: 'POST', path: () => '/api/v1/calendar-events',
    body: () => ({ title: `Своя встреча ${rnd()}`, startAt: iso(2 * 864e5), endAt: iso(2 * 864e5 + 36e5) }),
    expect: { owner: 201, admin: 201, manager: 201, member: 201, guest: 403 },
  },
  { route: 'GET /api/v1/calendar-invitations', path: () => '/api/v1/calendar-invitations', expect: 200 },
  {
    route: 'GET /api/v1/calendar-events/{чужая}', path: (w) => `/api/v1/calendar-events/${id(w.foreignEvent)}`,
    expect: { owner: 200, admin: 200, manager: 200, member: 200, guest: 404 },
    note: 'встреча с visibility=workspace от гостя скрыта — это и есть удержание гостя',
  },
  {
    route: 'PATCH /api/v1/calendar-events/{чужая}', method: 'PATCH', path: (w) => `/api/v1/calendar-events/${id(w.foreignEvent)}`,
    body: () => ({ title: 'Перенесено' }),
    expect: { owner: 200, admin: 200, manager: 200, member: 403, guest: 404 },
    note: 'право calendar.manage.team исполнено: встречу уволившегося есть кому вести',
  },
  {
    route: 'DELETE /api/v1/calendar-events/{чужая}', method: 'DELETE', path: (w) => `/api/v1/calendar-events/${id(w.foreignEventToCancel)}`,
    expect: { owner: 204, admin: 204, manager: 204, member: 403, guest: 404 },
    note: 'встречу уволившегося отменяет тот, кому доверены встречи команды',
  },
  {
    route: 'POST /api/v1/calendar-events/{чужая}/respond', method: 'POST', path: (w) => `/api/v1/calendar-events/${id(w.foreignEvent)}/respond`,
    body: () => ({ response: 'accepted' }),
    expect: { owner: 200, admin: 200, manager: 200, member: 200, guest: 404 },
    note: 'гостя нельзя пригласить на встречу: приглашение отбирает участников с role<>guest',
  },
  {
    route: 'POST /api/v1/calendar-events/{чужая}/participants', method: 'POST',
    path: (w) => `/api/v1/calendar-events/${id(w.foreignEventGuests)}/participants`,
    body: (w) => ({ userIds: [w.actors.member.userId] }),
    expect: { owner: 201, admin: 201, manager: 201, member: 403, guest: 404 },
    note: 'позвать на чужую встречу может тот, кому доверены встречи команды',
  },
  {
    route: 'POST /api/v1/calendar-events/{чужая}/files', method: 'POST', path: (w) => `/api/v1/calendar-events/${id(w.foreignEvent)}/files`,
    body: (w) => ({ fileId: id(w.ownFile) }),
    expect: { owner: 201, admin: 201, manager: 201, member: 403, guest: 404 },
  },

  // --- присутствие ----------------------------------------------------------
  { route: 'POST /api/v1/presence', method: 'POST', path: () => '/api/v1/presence', body: () => ({ state: 'busy' }), expect: 200 },

  // --- переписка ------------------------------------------------------------
  { route: 'GET /api/v1/conversations', path: () => '/api/v1/conversations', expect: 200 },
  { route: 'GET /api/v1/conversations/archived', path: () => '/api/v1/conversations/archived', expect: 200 },
  { route: 'GET /api/v1/saved-messages', path: () => '/api/v1/saved-messages', expect: 200 },
  {
    route: 'POST /api/v1/conversations (группа)', method: 'POST', path: () => '/api/v1/conversations',
    body: () => ({ kind: 'group', title: `Группа ${rnd()}` }), expect: 201,
  },
  {
    route: 'POST /api/v1/conversations (канал)', method: 'POST', path: () => '/api/v1/conversations',
    body: () => ({ kind: 'channel', title: `Канал ${rnd()}`, visibility: 'workspace' }),
    expect: { owner: 201, admin: 201, manager: 201, member: 403, guest: 403 },
  },
  {
    route: 'PATCH /api/v1/conversations/{id}/preferences', method: 'PATCH', path: (w) => `/api/v1/conversations/${w.room.id}/preferences`,
    body: () => ({ archived: false }), expect: 200,
  },
  {
    route: 'POST /api/v1/conversations/{id}/claim', method: 'POST', path: (w) => `/api/v1/conversations/${w.room.id}/claim`, body: () => ({}),
    expect: { owner: 409, admin: 409, manager: 409, member: 403, guest: 403 },
  },
  {
    route: 'POST /api/v1/conversations/{канал}/leave', method: 'POST', path: (w) => `/api/v1/conversations/${w.leaveChannel.id}/leave`, body: () => ({}),
    expect: { owner: 200, admin: 200, manager: 200, member: 200, guest: 404 },
  },
  {
    route: 'PATCH /api/v1/conversations/{id}', method: 'PATCH', path: (w) => `/api/v1/conversations/${w.room.id}`,
    body: () => ({ title: `Переименовано ${rnd()}` }),
    expect: { owner: 200, admin: 200, manager: 200, member: 403, guest: 403 },
  },
  { route: 'GET /api/v1/conversations/{id}/pins', path: (w) => `/api/v1/conversations/${w.room.id}/pins`, expect: 200 },
  { route: 'GET /api/v1/conversations/{id}/members', path: (w) => `/api/v1/conversations/${w.room.id}/members`, expect: 200 },
  {
    route: 'POST /api/v1/conversations/{id}/members', method: 'POST', path: (w) => `/api/v1/conversations/${w.room.id}/members`,
    body: (w) => ({ userIds: [w.actors.owner.userId], role: 'member' }),
    expect: { owner: 200, admin: 200, manager: 200, member: 403, guest: 403 },
  },
  {
    route: 'PATCH /api/v1/conversations/{id}/members/{u}', method: 'PATCH',
    path: (w) => `/api/v1/conversations/${w.room.id}/members/${w.stranger.userId}`, body: () => ({ role: 'moderator' }),
    expect: { owner: 200, admin: 200, manager: 200, member: 403, guest: 403 },
  },
  {
    route: 'DELETE /api/v1/conversations/{id}/members/{u}', method: 'DELETE',
    path: (w) => `/api/v1/conversations/${w.room.id}/members/${w.stranger.userId}`,
    expect: { owner: 200, admin: 200, manager: 200, member: 403, guest: 403 },
  },
  { route: 'GET /api/v1/conversations/{id}/messages', path: (w) => `/api/v1/conversations/${w.room.id}/messages`, expect: 200 },
  {
    route: 'POST /api/v1/conversations/{id}/messages', method: 'POST', path: (w) => `/api/v1/conversations/${w.room.id}/messages`,
    body: () => ({ kind: 'text', body: 'привет' }), expect: 201,
  },
  { route: 'POST /api/v1/messages/{чужое}/save', method: 'POST', path: (w) => `/api/v1/messages/${id(w.strangerMessage)}/save`, body: () => ({}), expect: 200 },
  {
    route: 'POST /api/v1/messages/{чужое}/pin', method: 'POST', path: (w) => `/api/v1/messages/${id(w.strangerMessageToPin)}/pin`, body: () => ({}),
    expect: { owner: 200, admin: 200, manager: 200, member: 403, guest: 403 },
  },
  {
    route: 'POST /api/v1/messages/{чужое}/forward', method: 'POST', path: (w) => `/api/v1/messages/${id(w.strangerMessage)}/forward`,
    body: (w) => ({ conversationId: w.room.id }), expect: 201,
  },
  {
    route: 'PATCH /api/v1/messages/{чужое}', method: 'PATCH', path: (w) => `/api/v1/messages/${id(w.strangerMessage)}`,
    body: () => ({ body: 'правка чужого' }), expect: 403,
  },
  {
    route: 'DELETE /api/v1/messages/{чужое}', method: 'DELETE', path: (w) => `/api/v1/messages/${id(w.strangerMessageToDelete)}`,
    expect: { owner: 200, admin: 200, manager: 403, member: 403, guest: 403 },
  },
  { route: 'DELETE /api/v1/messages/{своё}', method: 'DELETE', path: (w) => `/api/v1/messages/${id(w.ownMessage)}`, expect: 200 },
  {
    route: 'POST /api/v1/messages/{чужое}/reactions', method: 'POST', path: (w) => `/api/v1/messages/${id(w.strangerMessage)}/reactions`,
    body: () => ({ reaction: '👍' }), expect: 200,
  },
  { route: 'POST /api/v1/conversations/{id}/read', method: 'POST', path: (w) => `/api/v1/conversations/${w.room.id}/read`, body: () => ({}), expect: 204 },

  // --- звонки ---------------------------------------------------------------
  {
    route: 'POST /api/v1/conversations/{id}/calls', method: 'POST', path: (w) => `/api/v1/conversations/${w.room.id}/calls`,
    body: () => ({ mode: 'audio' }), expect: 201,
  },
  { route: 'GET /api/v1/calls/{чужой}', path: (w) => `/api/v1/calls/${id(w.foreignCall)}`, expect: 200 },
  {
    route: 'POST /api/v1/calls/{чужой}/join', method: 'POST', path: (w) => `/api/v1/calls/${id(w.foreignCall)}/join`, body: () => ({}),
    expect: 503, note: 'LiveKit не настроен: провайдер отвечает раньше, чем права',
  },
  { route: 'POST /api/v1/calls/{чужой}/leave', method: 'POST', path: (w) => `/api/v1/calls/${id(w.foreignCall)}/leave`, body: () => ({}), expect: 200 },
  {
    route: 'PATCH /api/v1/calls/{чужой}/media', method: 'PATCH', path: (w) => `/api/v1/calls/${id(w.foreignCall)}/media`,
    body: () => ({ audioEnabled: false }), expect: 200,
  },
  {
    route: 'POST /api/v1/calls/{чужой}/recording-consent', method: 'POST', path: (w) => `/api/v1/calls/${id(w.foreignCall)}/recording-consent`,
    body: () => ({}), expect: 200,
  },
  {
    route: 'POST /api/v1/calls/{чужой}/recording/start', method: 'POST', path: (w) => `/api/v1/calls/${id(w.foreignCall)}/recording/start`, body: () => ({}),
    expect: { owner: 409, admin: 409, manager: 409, member: 403, guest: 403 },
  },
  {
    route: 'POST /api/v1/calls/{чужой}/recording/stop', method: 'POST', path: (w) => `/api/v1/calls/${id(w.foreignCall)}/recording/stop`, body: () => ({}),
    expect: { owner: 409, admin: 409, manager: 409, member: 403, guest: 403 },
  },
  {
    route: 'POST /api/v1/calls/{чужой}/end', method: 'POST', path: (w) => `/api/v1/calls/${id(w.foreignCall)}/end`, body: () => ({}),
    expect: { owner: 200, admin: 200, manager: 200, member: 403, guest: 403 },
  },

  // --- встречи и их разбор --------------------------------------------------
  { route: 'GET /api/v1/meetings', path: () => '/api/v1/meetings', expect: 200 },
  { route: 'GET /api/v1/calls/{чужой}/meeting', path: (w) => `/api/v1/calls/${id(w.foreignCall)}/meeting`, expect: 200 },
  {
    route: 'POST /api/v1/meeting-proposals/{нет}/accept', method: 'POST', path: () => `/api/v1/meeting-proposals/${MISSING}/accept`, body: () => ({}),
    expect: { owner: 404, admin: 404, manager: 404, member: 404, guest: 403 },
  },
  {
    route: 'POST /api/v1/meeting-proposals/{нет}/reject', method: 'POST', path: () => `/api/v1/meeting-proposals/${MISSING}/reject`, body: () => ({}),
    expect: { owner: 404, admin: 404, manager: 404, member: 404, guest: 403 },
  },

  // --- эксплуатация встреч (admin) ------------------------------------------
  { route: 'GET /api/v1/admin/meeting-jobs', path: () => '/api/v1/admin/meeting-jobs', expect: { owner: 200, admin: 200, manager: 403, member: 403, guest: 403 } },
  {
    route: 'POST /api/v1/admin/meeting-jobs/{нет}/retry', method: 'POST', path: () => `/api/v1/admin/meeting-jobs/${MISSING}/retry`,
    body: () => ({ reason: 'повторить' }), expect: { owner: 404, admin: 404, manager: 403, member: 403, guest: 403 },
  },
  {
    route: 'GET /api/v1/admin/meeting-jobs/{нет}/audit', path: () => `/api/v1/admin/meeting-jobs/${MISSING}/audit`,
    expect: { owner: 200, admin: 200, manager: 403, member: 403, guest: 403 },
    gap: 'manager: audit.read у роли есть, но единственный «audit»-маршрут закрыт правом meeting.ops.manage',
  },
  { route: 'GET /api/v1/admin/meeting-prices', path: () => '/api/v1/admin/meeting-prices', expect: { owner: 200, admin: 200, manager: 403, member: 403, guest: 403 } },
  {
    route: 'POST /api/v1/admin/meeting-prices', method: 'POST', path: () => '/api/v1/admin/meeting-prices',
    body: () => ({ effectiveAt: iso(0), currency: 'USD' }),
    expect: { owner: 400, admin: 400, manager: 403, member: 403, guest: 403 },
  },
  { route: 'GET /api/v1/admin/meeting-costs', path: () => '/api/v1/admin/meeting-costs', expect: { owner: 200, admin: 200, manager: 403, member: 403, guest: 403 } },

  // --- интеграции -----------------------------------------------------------
  { route: 'GET /api/v1/integrations/webhooks', path: () => '/api/v1/integrations/webhooks', expect: { owner: 200, admin: 200, manager: 403, member: 403, guest: 403 } },
  {
    route: 'POST /api/v1/integrations/webhooks', method: 'POST', path: () => '/api/v1/integrations/webhooks',
    body: () => ({ label: `Хук ${rnd()}`, url: 'https://example.test/new', topics: ['task.created'] }),
    expect: { owner: 201, admin: 201, manager: 403, member: 403, guest: 403 },
  },
  { route: 'GET /api/v1/integrations/deliveries', path: () => '/api/v1/integrations/deliveries', expect: { owner: 200, admin: 200, manager: 403, member: 403, guest: 403 } },
  {
    route: 'POST /api/v1/integrations/webhooks/{id}/disable', method: 'POST', path: (w) => `/api/v1/integrations/webhooks/${id(w.webhook)}/disable`,
    body: () => ({}), expect: { owner: 200, admin: 200, manager: 403, member: 403, guest: 403 },
  },
  {
    route: 'DELETE /api/v1/integrations/webhooks/{id}', method: 'DELETE', path: (w) => `/api/v1/integrations/webhooks/${id(w.webhookToDelete)}`,
    expect: { owner: 204, admin: 204, manager: 403, member: 403, guest: 403 },
  },

  // --- оргструктура ---------------------------------------------------------
  { route: 'GET /api/v1/org/units', path: () => '/api/v1/org/units', expect: { owner: 200, admin: 200, manager: 200, member: 200, guest: 404 } },
  {
    route: 'POST /api/v1/org/units', method: 'POST', path: () => '/api/v1/org/units', body: () => ({ name: `Новый отдел ${rnd()}` }),
    expect: { owner: 201, admin: 201, manager: 403, member: 403, guest: 404 },
  },
  {
    route: 'PATCH /api/v1/org/units/{id}', method: 'PATCH', path: (w) => `/api/v1/org/units/${id(w.unit)}`, body: () => ({ name: `Отдел ${rnd()}` }),
    expect: { owner: 200, admin: 200, manager: 403, member: 403, guest: 404 },
  },
  {
    route: 'DELETE /api/v1/org/units/{id}', method: 'DELETE', path: (w) => `/api/v1/org/units/${id(w.unitToDelete)}`,
    expect: { owner: 204, admin: 204, manager: 403, member: 403, guest: 404 },
  },
  { route: 'GET /api/v1/org/units/{id}/members', path: (w) => `/api/v1/org/units/${id(w.unit)}/members`, expect: { owner: 200, admin: 200, manager: 200, member: 200, guest: 404 } },
  {
    route: 'POST /api/v1/org/units/{id}/members', method: 'POST', path: (w) => `/api/v1/org/units/${id(w.unit)}/members`,
    body: (w) => ({ userId: w.actors.member.userId, role: 'member' }),
    expect: { owner: 201, admin: 201, manager: 403, member: 403, guest: 404 },
  },
  {
    route: 'PATCH /api/v1/org/units/{id}/members/{u}', method: 'PATCH', path: (w) => `/api/v1/org/units/${id(w.unit)}/members/${w.stranger.userId}`,
    body: () => ({ role: 'admin' }), expect: { owner: 200, admin: 200, manager: 403, member: 403, guest: 404 },
  },
  {
    route: 'DELETE /api/v1/org/units/{id}/members/{u}', method: 'DELETE', path: (w) => `/api/v1/org/units/${id(w.unit)}/members/${w.stranger.userId}`,
    expect: { owner: 204, admin: 204, manager: 403, member: 403, guest: 404 },
  },
  { route: 'GET /api/v1/org/people/{u}/chain', path: (w) => `/api/v1/org/people/${w.stranger.userId}/chain`, expect: { owner: 200, admin: 200, manager: 200, member: 200, guest: 404 } },

  // --- люди -----------------------------------------------------------------
  { route: 'GET /api/v1/contacts', path: () => '/api/v1/contacts', expect: 200 },
  {
    route: 'GET /api/v1/people', path: () => '/api/v1/people', expect: 200,
    gap: 'guest: гость получает весь штатный справочник компании, хотя оргструктура и игры от него закрыты',
  },
  { route: 'GET /api/v1/people/{другой}', path: (w) => `/api/v1/people/${w.stranger.userId}`, expect: 200 },
  {
    route: 'PATCH /api/v1/people/{другой}', method: 'PATCH', path: (w) => `/api/v1/people/${w.stranger.userId}`, body: () => ({ title: 'Ведущий инженер' }),
    expect: { owner: 200, admin: 200, manager: 403, member: 403, guest: 403 },
  },
  { route: 'PATCH /api/v1/people/{себя}', method: 'PATCH', path: (w) => `/api/v1/people/${w.actor.userId}`, body: () => ({ about: 'о себе' }), expect: 200 },
  { route: 'GET /api/v1/people/{другой}/activity', path: (w) => `/api/v1/people/${w.stranger.userId}/activity`, expect: 200 },

  // --- метки ----------------------------------------------------------------
  { route: 'GET /api/v1/labels', path: () => '/api/v1/labels', expect: 200 },
  {
    route: 'POST /api/v1/labels', method: 'POST', path: () => '/api/v1/labels', body: () => ({ name: `Метка ${rnd()}` }), expect: 201,
    gap: 'guest: посторонний заводит общую метку рабочего пространства — её видит весь штат',
  },
  { route: 'GET /api/v1/labels/{id}/targets', path: (w) => `/api/v1/labels/${id(w.sharedLabel)}/targets`, expect: 200 },
  {
    route: 'PUT /api/v1/labels/{id}/links/task/{t}', method: 'PUT',
    path: (w) => `/api/v1/labels/${id(w.sharedLabel)}/links/task/${id(w.foreignTask)}`, body: () => ({}),
    expect: { owner: 200, admin: 200, manager: 200, member: 404, guest: 404 },
  },
  { route: 'GET /api/v1/labelled/task/{t}', path: (w) => `/api/v1/labelled/task/${id(w.foreignTask)}`, expect: 200 },
  {
    route: 'PATCH /api/v1/labels/{чужая общая}', method: 'PATCH', path: (w) => `/api/v1/labels/${id(w.sharedLabelToRename)}`,
    body: () => ({ name: `Переименовано ${rnd()}` }),
    expect: { owner: 200, admin: 200, manager: 200, member: 200, guest: 404 },
    gap: 'member: любой сотрудник переименовывает общую метку, заведённую владельцем — у общей таксономии нет хозяина',
  },
  {
    route: 'DELETE /api/v1/labels/{чужая общая}', method: 'DELETE', path: (w) => `/api/v1/labels/${id(w.sharedLabelToDelete)}`,
    expect: { owner: 204, admin: 204, manager: 204, member: 204, guest: 404 },
    gap: 'member: и удаляет её тоже',
  },

  // --- личное планирование --------------------------------------------------
  { route: 'GET /api/v1/personal-items', path: () => '/api/v1/personal-items', expect: 200 },
  { route: 'POST /api/v1/personal-items', method: 'POST', path: () => '/api/v1/personal-items', body: () => ({ title: `Личное ${rnd()}` }), expect: 201 },
  { route: 'GET /api/v1/personal-items/{своё}', path: (w) => `/api/v1/personal-items/${id(w.personalItem)}`, expect: 200 },
  { route: 'PATCH /api/v1/personal-items/{своё}', method: 'PATCH', path: (w) => `/api/v1/personal-items/${id(w.personalItem)}`, body: () => ({ title: 'Переименовано' }), expect: 200 },
  {
    route: 'POST /api/v1/personal-items/{своё}/comments', method: 'POST', path: (w) => `/api/v1/personal-items/${id(w.personalItem)}/comments`,
    body: () => ({ body: 'комментарий' }), expect: 201,
  },
  {
    route: 'POST /api/v1/personal-items/{своё}/schedule', method: 'POST', path: (w) => `/api/v1/personal-items/${id(w.personalItem)}/schedule`,
    body: () => ({ startAt: iso(864e5), endAt: iso(864e5 + 36e5) }), expect: 200,
  },
  { route: 'DELETE /api/v1/personal-items/{своё}', method: 'DELETE', path: (w) => `/api/v1/personal-items/${id(w.personalItemToDelete)}`, expect: 204 },

  // --- напоминания ----------------------------------------------------------
  { route: 'GET /api/v1/reminders', path: () => '/api/v1/reminders', expect: 200 },
  { route: 'POST /api/v1/reminders', method: 'POST', path: () => '/api/v1/reminders', body: () => ({ title: 'Позвонить', remindAt: iso(36e5) }), expect: 201 },
  { route: 'PATCH /api/v1/reminders/{своё}', method: 'PATCH', path: (w) => `/api/v1/reminders/${id(w.reminder)}`, body: () => ({ title: 'Позвонить позже' }), expect: 200 },
  { route: 'DELETE /api/v1/reminders/{своё}', method: 'DELETE', path: (w) => `/api/v1/reminders/${id(w.reminderToDelete)}`, expect: 204 },

  // --- сейф -----------------------------------------------------------------
  { route: 'GET /api/v1/vault', path: () => '/api/v1/vault', expect: VAULT, note: 'без VAULT_KEY сейф отвечает 503 всем' },
  { route: 'POST /api/v1/vault', method: 'POST', path: () => '/api/v1/vault', body: () => ({ title: 'Пароль', secret: 's3cret' }), expect: VAULT_CREATED },

  // --- личные пометки -------------------------------------------------------
  { route: 'GET /api/v1/favourites', path: () => '/api/v1/favourites', expect: 200 },
  { route: 'PUT /api/v1/favourites/message/{m}', method: 'PUT', path: (w) => `/api/v1/favourites/message/${id(w.strangerMessage)}`, body: () => ({}), expect: 200 },
  { route: 'DELETE /api/v1/favourites/message/{m}', method: 'DELETE', path: (w) => `/api/v1/favourites/message/${id(w.strangerMessage)}`, expect: 200 },
  { route: 'GET /api/v1/highlights', path: () => '/api/v1/highlights', expect: 200 },
  {
    route: 'POST /api/v1/highlights', method: 'POST', path: () => '/api/v1/highlights',
    body: (w) => ({ messageId: id(w.strangerMessage), quote: 'чужое', startOffset: 0, endOffset: 5 }), expect: 201,
  },
  { route: 'DELETE /api/v1/highlights/{своё}', method: 'DELETE', path: (w) => `/api/v1/highlights/${id(w.highlight)}`, expect: 204 },
  { route: 'GET /api/v1/message-notes', path: () => '/api/v1/message-notes', expect: 200 },
  {
    route: 'POST /api/v1/message-notes', method: 'POST', path: () => '/api/v1/message-notes',
    body: (w) => ({ messageId: id(w.strangerMessage), body: 'заметка' }), expect: 201,
  },
  { route: 'PATCH /api/v1/message-notes/{своё}', method: 'PATCH', path: (w) => `/api/v1/message-notes/${id(w.note)}`, body: () => ({ body: 'правка' }), expect: 200 },
  { route: 'DELETE /api/v1/message-notes/{своё}', method: 'DELETE', path: (w) => `/api/v1/message-notes/${id(w.note)}`, expect: 204 },

  // --- игры -----------------------------------------------------------------
  { route: 'GET /api/v1/games', path: () => '/api/v1/games', expect: { owner: 200, admin: 200, manager: 200, member: 200, guest: 404 } },
  {
    route: 'POST /api/v1/games', method: 'POST', path: () => '/api/v1/games',
    body: (w) => ({ conversationId: w.roomGames.id, kind: 'chess', opponentId: w.stranger.userId }),
    expect: { owner: 201, admin: 201, manager: 201, member: 201, guest: 404 },
  },
  { route: 'GET /api/v1/games/{чужая}', path: (w) => `/api/v1/games/${id(w.foreignGame)}`, expect: { owner: 200, admin: 200, manager: 200, member: 200, guest: 404 } },
  {
    route: 'POST /api/v1/games/{чужая}/respond', method: 'POST', path: (w) => `/api/v1/games/${id(w.foreignGame)}/respond`, body: () => ({ accept: true }),
    expect: { owner: 200, admin: 200, manager: 200, member: 200, guest: 404 },
  },
  { route: 'GET /api/v1/games/{чужая}/moves', path: (w) => `/api/v1/games/${id(w.foreignGame)}/moves`, expect: { owner: 200, admin: 200, manager: 200, member: 200, guest: 404 } },
  {
    route: 'POST /api/v1/games/{чужая}/resign', method: 'POST', path: (w) => `/api/v1/games/${id(w.foreignGame)}/resign`, body: () => ({}),
    expect: { owner: 200, admin: 200, manager: 200, member: 200, guest: 404 },
  },

  // --- файлы и push ---------------------------------------------------------
  { route: 'GET /api/v1/files/{своё}/content', path: (w) => `/api/v1/files/${id(w.ownFile)}/content`, expect: 200 },
  { route: 'GET /api/v1/files/{своё}/preview', path: (w) => `/api/v1/files/${id(w.ownFile)}/preview`, expect: 200 },
  {
    route: 'POST /api/v1/push-subscriptions', method: 'POST', path: () => '/api/v1/push-subscriptions',
    body: () => ({ endpoint: `https://push.test/${rnd()}`, keys: { p256dh: 'a'.repeat(22), auth: 'b'.repeat(16) } }), expect: 201,
  },
];

const expectedFor = (row, role) => (typeof row.expect === 'number' ? row.expect : row.expect[role]);

test('матрица «роль × маршрут»', { skip, concurrency: false }, async (t) => {
  const base = await startServer(t);
  const { actors, stranger } = await buildCompany(base);

  for (const role of ROLES) {
    await t.test(`роль ${role}`, async (tt) => {
      const world = await buildWorld(base, actors, stranger, actors[role]);
      for (const row of ROUTES) {
        const expected = expectedFor(row, role);
        await tt.test(`${row.route} → ${expected}`, async () => {
          const response = await call(base, row.path(world), {
            cookie: actors[role].cookie,
            method: row.method ?? 'GET',
            body: row.body ? row.body(world) : undefined,
          });
          assert.equal(
            response.status,
            expected,
            `${row.route} для роли ${role}: ожидали ${expected}, получили ${response.status}${response.code ? ` ${response.code}` : ''}`,
          );
        });
      }
    });
  }
});

/**
 * Право, которое не проверяется нигде, вводит в заблуждение и того, кто его
 * выдаёт, и того, кто его получил. Эти четыре — именно такие: они есть в
 * ROLE_PERMISSIONS, показываются пользователю в /api/v1/me и не встречаются
 * больше нигде в src/.
 *
 * Тест зафиксирован на текущем факте намеренно: как только право начнут
 * проверять, он упадёт и напомнит убрать его отсюда.
 */
// Право, объявленное ролью и не проверяемое нигде, — обещание, которого
// никто не держит. Список тает по мере того, как обещания исполняются:
// calendar.manage.team ушёл отсюда, когда встречу уволившегося стало
// кому вести.
const UNENFORCED = [
  Permission.ORGANIZATION_MANAGE,
  Permission.TASK_MANAGE_TEAM,
  Permission.AUDIT_READ,
];

test('права, которые объявлены, но нигде не проверяются', async () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.js') && entry.name !== 'rbac.js') files.push(full);
    }
  };
  await walk(src);
  const sources = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  const corpus = sources.join('\n');

  for (const permission of UNENFORCED) {
    assert.ok(
      !corpus.includes(permission),
      `${permission} где-то проверяется — обновите список UNENFORCED и ожидания в матрице`,
    );
  }

  // Следствие первое: владелец и администратор различаются ровно одним
  // правом, и это право — необеспеченное. Функционально это одна роль.
  const owner = ROLE_PERMISSIONS.owner;
  const admin = ROLE_PERMISSIONS.admin;
  const difference = [...owner].filter((permission) => !admin.has(permission));
  assert.deepEqual(difference, [Permission.ORGANIZATION_MANAGE]);
  assert.ok(UNENFORCED.includes(difference[0]), 'единственное отличие владельца от администратора ничего не значит');

  // Следствие второе: полномочия руководителя по чужим задачам держатся не на
  // праве task.manage.team, а на списке ролей в src/task/task-authority.js.
  const authority = await readFile(fileURLToPath(new URL('../src/task/task-authority.js', import.meta.url)), 'utf8');
  assert.match(authority, /TEAM_MANAGERS\s*=\s*new Set\(\['owner','admin','manager'\]\)/);
});
