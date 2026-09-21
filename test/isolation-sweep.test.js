/**
 * Сплошной перебор чужих идентификаторов по всем маршрутам.
 *
 * Правило, которое здесь проверяется: на идентификатор объекта, к которому у
 * вызывающего нет доступа, сервер обязан ответить 404 — не 403, потому что
 * само существование объекта подтверждать нельзя, — и не отдать ни одного
 * поля этого объекта: ни названия, ни превью, ни имени автора, ни числа
 * участников.
 *
 * Каждый маршрут зовётся трижды:
 *   cross — идентификатор из ДРУГОЙ компании;
 *   priv  — идентификатор объекта СВОЕЙ компании, к которому у этого
 *           человека доступа нет (чужая личная переписка, чужая задача,
 *           чужое личное дело, чужая запись хранилища);
 *   ghost — случайный UUID, которого нет нигде.
 * И от имени обычного сотрудника, и от имени гостя, и — там, где маршрут
 * закрыт правами, — от имени владельца, иначе 403 «нет прав» маскирует
 * ответ на вопрос об изоляции.
 *
 * Таблица ROUTES внизу — единственное место, куда добавляется новый маршрут.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';
import { createAuthThrottle } from '../src/rate-limit.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const skip = !DATABASE_URL && 'нет базы: задайте DATABASE_URL или POSTGRES_TEST_URL';

// Регистрация компании и приём приглашения ходят через ограничитель попыток,
// а тест заводит десяток человек подряд с одного адреса.
const openThrottle = createAuthThrottle({
  AUTH_RATE_LIMIT_MAX_PER_IP: '1000000',
  AUTH_RATE_LIMIT_MAX_PER_IDENTITY: '1000000',
});

async function boot(t) {
  process.env.DATABASE_URL = DATABASE_URL;
  const app = await createChatServer({
    databaseUrl: DATABASE_URL,
    startMeetingWorker: false,
    deliveryWorkerEnabled: false,
    meetingWorkerEnabled: false,
    authThrottle: openThrottle,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  return `http://127.0.0.1:${app.server.address().port}`;
}

async function call(base, path, { cookie, method = 'GET', body, raw, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await response.text();
  return { status: response.status, text };
}

const ok = (label, r) => {
  if (r.status >= 400) throw new Error(`${label} → ${r.status} ${r.text.slice(0, 300)}`);
  return JSON.parse(r.text);
};

/**
 * Одна компания со всем добром внутри. Всё, что она создаёт, носит в названии
 * её суффикс — поэтому «в ответе встретился суффикс чужой компании» и есть
 * точный признак утечки через границу арендаторов.
 *
 * Люди: владелец, сотрудник (за него ходит проверка), «другой» сотрудник
 * (его вещи — то, к чему у сотрудника доступа нет) и гость.
 */
async function company(base, tag) {
  const suffix = `${tag}${Math.random().toString(36).slice(2, 8)}`;
  const s = { suffix, users: {} };

  const owner = ok('register', await call(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: {
      companyName: `Компания ${suffix}`,
      ownerName: `Владелец ${suffix}`,
      email: `owner-${suffix}@iso.test`,
      password: 'OwnerPassword42',
    },
  }));
  const ownerCookie = (await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `owner-${suffix}@iso.test`, password: 'OwnerPassword42' }),
  })).headers.get('set-cookie').split(';')[0];
  s.users.owner = { id: owner.session.userId, cookie: ownerCookie };
  s.workspaceId = owner.session.workspaceId;

  const invite = async (role, name) => {
    const inv = ok('invite', await call(base, '/api/v1/invitations', {
      cookie: s.users.owner.cookie, method: 'POST', body: { email: `${name}-${suffix}@iso.test`, role },
    }));
    const token = new URL(inv.invitation.inviteUrl).searchParams.get('invite');
    const response = await fetch(`${base}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, displayName: `${name} ${suffix}`, password: 'OwnerPassword42' }),
    });
    const payload = await response.json();
    assert.equal(response.status, 201, `приглашение ${role}: ${JSON.stringify(payload)}`);
    return { id: payload.session.userId, cookie: response.headers.get('set-cookie').split(';')[0] };
  };
  s.users.member = await invite('member', 'member');
  s.users.other = await invite('member', 'other');
  s.users.guest = await invite('guest', 'guest');

  const O = s.users.owner.cookie, M = s.users.member.cookie, X = s.users.other.cookie;

  // Беседа каждого рода, в каждой — сотрудник.
  s.conversations = {};
  for (const kind of ['direct', 'group', 'channel', 'team', 'project', 'task',
    'decision', 'approval', 'control', 'incident', 'meeting', 'external']) {
    const body = kind === 'direct'
      ? { kind, participantIds: [s.users.member.id] }
      : { kind, title: `${kind} ${suffix}`, participantIds: [s.users.member.id] };
    const r = await call(base, '/api/v1/conversations', { cookie: O, method: 'POST', body });
    s.conversations[kind] = r.status < 400 ? JSON.parse(r.text).conversation.id : null;
  }
  s.conversationId = s.conversations.group;
  s.messageId = ok('message', await call(base, `/api/v1/conversations/${s.conversationId}/messages`, {
    cookie: O, method: 'POST', body: { kind: 'text', body: `ОБЩЕЕ-${suffix}: сообщение в общей группе` },
  })).message.id;

  // Личная переписка владельца с «другим»: сотрудника и гостя в ней нет.
  s.privateConversationId = ok('private', await call(base, '/api/v1/conversations', {
    cookie: O, method: 'POST', body: { kind: 'direct', participantIds: [s.users.other.id] },
  })).conversation.id;
  s.privateMessageId = ok('private message', await call(base, `/api/v1/conversations/${s.privateConversationId}/messages`, {
    cookie: O, method: 'POST', body: { kind: 'text', body: `СЕКРЕТ-${suffix}: приватная переписка` },
  })).message.id;

  s.taskId = ok('task', await call(base, '/api/v1/tasks', {
    cookie: M, method: 'POST', body: { title: `Задача ${suffix}`, outcome: 'Результат' },
  })).task.id;
  s.otherTaskId = ok('other task', await call(base, '/api/v1/tasks', {
    cookie: X, method: 'POST', body: { title: `ЧУЖАЯ-ЗАДАЧА-${suffix}`, outcome: 'Тайный результат' },
  })).task.id;

  const upload = async (cookie, name) => ok('file', await call(base, '/api/v1/files', {
    cookie, method: 'POST', raw: Buffer.from(`body-${name}`),
    headers: { 'content-type': 'text/plain', 'x-file-name': encodeURIComponent(name) },
  })).file.id;
  s.fileId = await upload(M, `file-${suffix}.txt`);
  s.otherFileId = await upload(X, `ЧУЖОЙ-ФАЙЛ-${suffix}.txt`);

  const startAt = new Date(Date.now() + 3600e3).toISOString();
  const endAt = new Date(Date.now() + 7200e3).toISOString();
  s.calendarEventId = ok('event', await call(base, '/api/v1/calendar-events', {
    cookie: O, method: 'POST',
    body: { title: `Встреча ${suffix}`, startAt, endAt, participantIds: [s.users.member.id] },
  })).event.id;
  s.otherCalendarEventId = ok('other event', await call(base, '/api/v1/calendar-events', {
    cookie: X, method: 'POST',
    body: { title: `ЧУЖАЯ-ВСТРЕЧА-${suffix}`, startAt, endAt, visibility: 'participants' },
  })).event.id;

  s.labelId = ok('label', await call(base, '/api/v1/labels', {
    cookie: O, method: 'POST', body: { kind: 'tag', name: `Метка ${suffix}` },
  })).label.id;
  s.otherLabelId = ok('other label', await call(base, '/api/v1/labels', {
    cookie: X, method: 'POST', body: { kind: 'tag', name: `ЛИЧНАЯ-МЕТКА-${suffix}`, personal: true },
  })).label.id;

  s.personalItemId = ok('personal', await call(base, '/api/v1/personal-items', {
    cookie: M, method: 'POST', body: { kind: 'todo', title: `Личное дело ${suffix}` },
  })).item.id;
  s.otherPersonalItemId = ok('other personal', await call(base, '/api/v1/personal-items', {
    cookie: X, method: 'POST', body: { kind: 'todo', title: `ЧУЖОЕ-ЛИЧНОЕ-${suffix}` },
  })).item.id;

  const remindAt = new Date(Date.now() + 86400e3).toISOString();
  s.reminderId = ok('reminder', await call(base, '/api/v1/reminders', {
    cookie: M, method: 'POST', body: { title: `Напоминание ${suffix}`, remindAt },
  })).reminder.id;
  s.otherReminderId = ok('other reminder', await call(base, '/api/v1/reminders', {
    cookie: X, method: 'POST', body: { title: `ЧУЖОЕ-НАПОМИНАНИЕ-${suffix}`, remindAt },
  })).reminder.id;

  s.vaultId = ok('vault', await call(base, '/api/v1/vault', {
    cookie: M, method: 'POST', body: { title: `Пароль ${suffix}`, secret: `s3cr3t-${suffix}` },
  })).entry.id;
  s.otherVaultId = ok('other vault', await call(base, '/api/v1/vault', {
    cookie: X, method: 'POST', body: { title: `ЧУЖОЙ-ПАРОЛЬ-${suffix}`, secret: `other-s3cr3t-${suffix}` },
  })).entry.id;

  s.gameId = ok('game', await call(base, '/api/v1/games', {
    cookie: O, method: 'POST', body: { conversationId: s.conversationId, kind: 'chess', opponentId: s.users.member.id },
  })).game.id;
  s.otherGameId = ok('other game', await call(base, '/api/v1/games', {
    cookie: O, method: 'POST', body: { conversationId: s.privateConversationId, kind: 'checkers', opponentId: s.users.other.id },
  })).game.id;

  s.orgUnitId = ok('unit', await call(base, '/api/v1/org/units', {
    cookie: O, method: 'POST', body: { kind: 'department', name: `Подразделение ${suffix}` },
  })).unit.id;

  s.pendingInvitation = ok('pending invitation', await call(base, '/api/v1/invitations', {
    cookie: O, method: 'POST', body: { email: `pending-${suffix}@iso.test`, role: 'member' },
  })).invitation;

  s.webhookId = ok('webhook', await call(base, '/api/v1/integrations/webhooks', {
    cookie: O, method: 'POST', body: { label: `Хук ${suffix}`, url: 'https://example.test/hook', topics: ['message.created'] },
  })).endpoint.id;

  s.callId = ok('call', await call(base, `/api/v1/conversations/${s.conversationId}/calls`, {
    cookie: O, method: 'POST', body: { mode: 'audio' },
  })).call.id;
  s.otherCallId = ok('other call', await call(base, `/api/v1/conversations/${s.privateConversationId}/calls`, {
    cookie: O, method: 'POST', body: { mode: 'audio' },
  })).call.id;

  s.highlightId = ok('highlight', await call(base, '/api/v1/highlights', {
    cookie: M, method: 'POST',
    body: { messageId: s.messageId, quote: 'ОБЩЕЕ', startOffset: 0, endOffset: 5, colour: 'yellow' },
  })).highlight.id;
  s.otherHighlightId = ok('other highlight', await call(base, '/api/v1/highlights', {
    cookie: X, method: 'POST',
    body: { messageId: s.privateMessageId, quote: 'СЕКРЕТ', startOffset: 0, endOffset: 6, colour: 'yellow' },
  })).highlight.id;
  s.noteId = ok('note', await call(base, '/api/v1/message-notes', {
    cookie: M, method: 'POST', body: { messageId: s.messageId, body: `Заметка ${suffix}` },
  })).note.id;
  s.otherNoteId = ok('other note', await call(base, '/api/v1/message-notes', {
    cookie: X, method: 'POST', body: { messageId: s.privateMessageId, body: `ЧУЖАЯ-ЗАМЕТКА-${suffix}` },
  })).note.id;
  ok('favour', await call(base, `/api/v1/favourites/message/${s.messageId}`, { cookie: M, method: 'PUT' }));

  s.notificationId = JSON.parse((await call(base, '/api/v1/notifications', { cookie: M })).text).items[0]?.id ?? null;
  s.otherNotificationId = JSON.parse((await call(base, '/api/v1/notifications', { cookie: X })).text).items[0]?.id ?? null;
  return s;
}

/**
 * Маршруты. Каждая строка: [род идентификатора, подпись, построитель].
 * Построитель получает подставляемый идентификатор и возвращает вызов.
 * Новый маршрут — новая строка, больше ничего трогать не нужно.
 */
const ROUTES = (A, B) => [
  // ── беседы ───────────────────────────────────────────────────────────────
  ['conversation', 'PATCH /api/v1/conversations/:id/preferences', (id) => ({ method: 'PATCH', path: `/api/v1/conversations/${id}/preferences`, body: { archived: true } })],
  ['conversation', 'POST /api/v1/conversations/:id/leave', (id) => ({ method: 'POST', path: `/api/v1/conversations/${id}/leave` })],
  ['conversation', 'PATCH /api/v1/conversations/:id', (id) => ({ method: 'PATCH', path: `/api/v1/conversations/${id}`, body: { title: 'перехват' } })],
  ['conversation', 'GET /api/v1/conversations/:id/pins', (id) => ({ path: `/api/v1/conversations/${id}/pins` })],
  ['conversation', 'GET /api/v1/conversations/:id/members', (id) => ({ path: `/api/v1/conversations/${id}/members` })],
  ['conversation', 'POST /api/v1/conversations/:id/members', (id) => ({ method: 'POST', path: `/api/v1/conversations/${id}/members`, body: { userIds: [A.users.member.id] } })],
  ['conversation', 'PATCH /api/v1/conversations/:id/members/:user', (id) => ({ method: 'PATCH', path: `/api/v1/conversations/${id}/members/${B.users.member.id}`, body: { role: 'member' } })],
  ['conversation', 'DELETE /api/v1/conversations/:id/members/:user', (id) => ({ method: 'DELETE', path: `/api/v1/conversations/${id}/members/${B.users.member.id}` })],
  ['conversation', 'GET /api/v1/conversations/:id/messages', (id) => ({ path: `/api/v1/conversations/${id}/messages` })],
  ['conversation', 'POST /api/v1/conversations/:id/messages', (id) => ({ method: 'POST', path: `/api/v1/conversations/${id}/messages`, body: { kind: 'text', body: 'вторжение' } })],
  ['conversation', 'POST /api/v1/conversations/:id/read', (id) => ({ method: 'POST', path: `/api/v1/conversations/${id}/read`, body: {} })],
  ['conversation', 'POST /api/v1/conversations/:id/calls', (id) => ({ method: 'POST', path: `/api/v1/conversations/${id}/calls`, body: { mode: 'audio' } })],
  ['conversation', 'POST /api/v1/conversations/:id/voice', (id) => ({ method: 'POST', path: `/api/v1/conversations/${id}/voice?durationMs=1000`, body: {} })],
  ['conversation', 'GET /api/v1/games?conversationId=', (id) => ({ path: `/api/v1/games?conversationId=${id}` })],
  ['conversation', 'POST /api/v1/games {conversationId}', (id) => ({ method: 'POST', path: '/api/v1/games', body: { conversationId: id, kind: 'chess', opponentId: A.users.other.id } })],

  // ── сообщения ────────────────────────────────────────────────────────────
  ['message', 'POST /api/v1/messages/:id/save', (id) => ({ method: 'POST', path: `/api/v1/messages/${id}/save` })],
  ['message', 'POST /api/v1/messages/:id/pin', (id) => ({ method: 'POST', path: `/api/v1/messages/${id}/pin` })],
  ['message', 'POST /api/v1/messages/:id/forward', (id) => ({ method: 'POST', path: `/api/v1/messages/${id}/forward`, body: { conversationId: A.conversationId } })],
  ['message', 'PATCH /api/v1/messages/:id', (id) => ({ method: 'PATCH', path: `/api/v1/messages/${id}`, body: { body: 'подмена' } })],
  ['message', 'DELETE /api/v1/messages/:id', (id) => ({ method: 'DELETE', path: `/api/v1/messages/${id}` })],
  ['message', 'POST /api/v1/messages/:id/reactions', (id) => ({ method: 'POST', path: `/api/v1/messages/${id}/reactions`, body: { reaction: '👍' } })],
  ['message', 'POST /api/v1/highlights {messageId}', (id) => ({ method: 'POST', path: '/api/v1/highlights', body: { messageId: id, quote: 'зонд', startOffset: 0, endOffset: 4 } })],
  ['message', 'POST /api/v1/message-notes {messageId}', (id) => ({ method: 'POST', path: '/api/v1/message-notes', body: { messageId: id, body: 'зонд' } })],
  ['message', 'PUT /api/v1/favourites/message/:id', (id) => ({ method: 'PUT', path: `/api/v1/favourites/message/${id}` })],
  ['message', 'POST /api/v1/tasks {sourceMessageId}', (id) => ({ method: 'POST', path: '/api/v1/tasks', body: { title: 'зонд', sourceMessageId: id }, allow: [400, 403, 404] })],

  // ── задачи ───────────────────────────────────────────────────────────────
  ['task', 'GET /api/v1/tasks/:id', (id) => ({ path: `/api/v1/tasks/${id}` })],
  ['task', 'POST /api/v1/tasks/:id/transitions', (id) => ({ method: 'POST', path: `/api/v1/tasks/${id}/transitions`, body: { to: 'accepted' } })],
  ['task', 'POST /api/v1/tasks/:id/evidence', (id) => ({ method: 'POST', path: `/api/v1/tasks/${id}/evidence`, body: { type: 'note', value: 'зонд' } })],
  ['task', 'PATCH /api/v1/tasks/:id/assignment', (id) => ({ method: 'PATCH', path: `/api/v1/tasks/${id}/assignment`, body: { ownerId: A.users.member.id } })],
  ['task', 'PATCH /api/v1/tasks/:id/schedule', (id) => ({ method: 'PATCH', path: `/api/v1/tasks/${id}/schedule`, body: { promisedAt: new Date(Date.now() + 36e5).toISOString() } })],
  ['task', 'PUT /api/v1/favourites/task/:id', (id) => ({ method: 'PUT', path: `/api/v1/favourites/task/${id}` })],
  ['task', 'PUT /api/v1/labels/:own/links/task/:id', (id) => ({ method: 'PUT', path: `/api/v1/labels/${A.labelId}/links/task/${id}` })],

  // ── файлы ────────────────────────────────────────────────────────────────
  ['file', 'GET /api/v1/files/:id/content', (id) => ({ path: `/api/v1/files/${id}/content` })],
  ['file', 'GET /api/v1/files/:id/preview', (id) => ({ path: `/api/v1/files/${id}/preview` })],
  ['file', 'POST /api/v1/personal-items/:own/files {fileId}', (id) => ({ method: 'POST', path: `/api/v1/personal-items/${A.personalItemId}/files`, body: { fileId: id } })],
  // Звезда на файле не проверяет доступ, а список избранного печатает имя
  // файла. Правило требует 404.
  ['file', 'PUT /api/v1/favourites/file/:id', (id) => ({ method: 'PUT', path: `/api/v1/favourites/file/${id}` })],

  // ── календарь ────────────────────────────────────────────────────────────
  ['event', 'GET /api/v1/calendar-events/:id', (id) => ({ path: `/api/v1/calendar-events/${id}` })],
  ['event', 'PATCH /api/v1/calendar-events/:id', (id) => ({ method: 'PATCH', path: `/api/v1/calendar-events/${id}`, body: { title: 'перехват' } })],
  ['event', 'DELETE /api/v1/calendar-events/:id', (id) => ({ method: 'DELETE', path: `/api/v1/calendar-events/${id}` })],
  ['event', 'POST /api/v1/calendar-events/:id/respond', (id) => ({ method: 'POST', path: `/api/v1/calendar-events/${id}/respond`, body: { response: 'accepted' } })],
  ['event', 'POST /api/v1/calendar-events/:id/participants', (id) => ({ method: 'POST', path: `/api/v1/calendar-events/${id}/participants`, body: { userIds: [A.users.member.id] } })],
  ['event', 'DELETE /api/v1/calendar-events/:id/participants/:user', (id) => ({ method: 'DELETE', path: `/api/v1/calendar-events/${id}/participants/${B.users.member.id}` })],
  ['event', 'POST /api/v1/calendar-events/:id/files', (id) => ({ method: 'POST', path: `/api/v1/calendar-events/${id}/files`, body: { fileId: A.fileId } })],
  // То же, что и с файлом: звезда на встрече выдаёт её название.
  ['event', 'PUT /api/v1/favourites/event/:id', (id) => ({ method: 'PUT', path: `/api/v1/favourites/event/${id}` })],

  // ── метки ────────────────────────────────────────────────────────────────
  ['label', 'GET /api/v1/labels/:id/targets', (id) => ({ path: `/api/v1/labels/${id}/targets` })],
  ['label', 'PATCH /api/v1/labels/:id', (id) => ({ method: 'PATCH', path: `/api/v1/labels/${id}`, body: { name: 'перехват' } })],
  ['label', 'DELETE /api/v1/labels/:id', (id) => ({ method: 'DELETE', path: `/api/v1/labels/${id}` })],
  ['label', 'PUT /api/v1/labels/:id/links/task/:own', (id) => ({ method: 'PUT', path: `/api/v1/labels/${id}/links/task/${A.taskId}` })],

  // ── личные дела ──────────────────────────────────────────────────────────
  ['personal', 'GET /api/v1/personal-items/:id', (id) => ({ path: `/api/v1/personal-items/${id}` })],
  ['personal', 'PATCH /api/v1/personal-items/:id', (id) => ({ method: 'PATCH', path: `/api/v1/personal-items/${id}`, body: { title: 'перехват' } })],
  ['personal', 'DELETE /api/v1/personal-items/:id', (id) => ({ method: 'DELETE', path: `/api/v1/personal-items/${id}` })],
  ['personal', 'POST /api/v1/personal-items/:id/comments', (id) => ({ method: 'POST', path: `/api/v1/personal-items/${id}/comments`, body: { body: 'зонд' } })],
  ['personal', 'POST /api/v1/personal-items/:id/schedule', (id) => ({ method: 'POST', path: `/api/v1/personal-items/${id}/schedule`, body: { startAt: new Date(Date.now() + 36e5).toISOString(), endAt: new Date(Date.now() + 72e5).toISOString() } })],

  // ── напоминания ──────────────────────────────────────────────────────────
  ['reminder', 'PATCH /api/v1/reminders/:id', (id) => ({ method: 'PATCH', path: `/api/v1/reminders/${id}`, body: { title: 'перехват' } })],
  ['reminder', 'DELETE /api/v1/reminders/:id', (id) => ({ method: 'DELETE', path: `/api/v1/reminders/${id}` })],

  // ── хранилище паролей ────────────────────────────────────────────────────
  ['vault', 'POST /api/v1/vault/:id/secret', (id) => ({ method: 'POST', path: `/api/v1/vault/${id}/secret` })],
  ['vault', 'PATCH /api/v1/vault/:id', (id) => ({ method: 'PATCH', path: `/api/v1/vault/${id}`, body: { title: 'перехват' } })],
  ['vault', 'DELETE /api/v1/vault/:id', (id) => ({ method: 'DELETE', path: `/api/v1/vault/${id}` })],

  // ── игры ─────────────────────────────────────────────────────────────────
  ['game', 'GET /api/v1/games/:id', (id) => ({ path: `/api/v1/games/${id}` })],
  ['game', 'GET /api/v1/games/:id/moves', (id) => ({ path: `/api/v1/games/${id}/moves` })],
  ['game', 'POST /api/v1/games/:id/moves', (id) => ({ method: 'POST', path: `/api/v1/games/${id}/moves`, body: { from: 'e2', to: 'e4' } })],
  ['game', 'POST /api/v1/games/:id/respond', (id) => ({ method: 'POST', path: `/api/v1/games/${id}/respond`, body: { accept: true } })],
  ['game', 'POST /api/v1/games/:id/resign', (id) => ({ method: 'POST', path: `/api/v1/games/${id}/resign` })],

  // ── подразделения ────────────────────────────────────────────────────────
  ['unit', 'PATCH /api/v1/org/units/:id', (id) => ({ method: 'PATCH', path: `/api/v1/org/units/${id}`, body: { name: 'перехват' }, as: 'owner' })],
  ['unit', 'DELETE /api/v1/org/units/:id', (id) => ({ method: 'DELETE', path: `/api/v1/org/units/${id}`, as: 'owner' })],
  ['unit', 'POST /api/v1/org/units/:id/members', (id) => ({ method: 'POST', path: `/api/v1/org/units/${id}/members`, body: { userId: A.users.member.id }, as: 'owner' })],
  ['unit', 'PATCH /api/v1/org/units/:id/members/:user', (id) => ({ method: 'PATCH', path: `/api/v1/org/units/${id}/members/${B.users.member.id}`, body: { role: 'head' }, as: 'owner' })],
  ['unit', 'DELETE /api/v1/org/units/:id/members/:user', (id) => ({ method: 'DELETE', path: `/api/v1/org/units/${id}/members/${B.users.member.id}`, as: 'owner' })],
  ['unit', 'POST /api/v1/org/units {parentId}', (id) => ({ method: 'POST', path: '/api/v1/org/units', body: { name: 'зонд', parentId: id }, as: 'owner' })],

  // ── люди ─────────────────────────────────────────────────────────────────
  ['user', 'GET /api/v1/people/:id', (id) => ({ path: `/api/v1/people/${id}` })],
  ['user', 'PATCH /api/v1/people/:id', (id) => ({ method: 'PATCH', path: `/api/v1/people/${id}`, body: { about: 'перехват' }, as: 'owner' })],
  ['user', 'POST /api/v1/conversations {participantIds}', (id) => ({ method: 'POST', path: '/api/v1/conversations', body: { kind: 'group', title: 'зонд', participantIds: [id] }, allow: [400, 403, 404] })],
  ['user', 'POST /api/v1/tasks {ownerId}', (id) => ({ method: 'POST', path: '/api/v1/tasks', body: { title: 'зонд', ownerId: id }, allow: [400, 403, 404] })],
  ['user', 'POST /api/v1/conversations/:own/members {userIds}', (id) => ({ method: 'POST', path: `/api/v1/conversations/${A.conversationId}/members`, body: { userIds: [id] }, allow: [400, 403, 404] })],
  ['user', 'POST /api/v1/calendar-events/:own/participants', (id) => ({ method: 'POST', path: `/api/v1/calendar-events/${A.calendarEventId}/participants`, body: { userIds: [id] }, allow: [400, 403, 404, 409] })],
  ['user', 'POST /api/v1/games {opponentId}', (id) => ({ method: 'POST', path: '/api/v1/games', body: { conversationId: A.conversationId, kind: 'chess', opponentId: id }, allow: [400, 403, 404, 409] })],

  // ── звонки и разборы встреч ──────────────────────────────────────────────
  ['call', 'GET /api/v1/calls/:id', (id) => ({ path: `/api/v1/calls/${id}` })],
  ['call', 'POST /api/v1/calls/:id/join', (id) => ({ method: 'POST', path: `/api/v1/calls/${id}/join`, body: {} })],
  ['call', 'POST /api/v1/calls/:id/leave', (id) => ({ method: 'POST', path: `/api/v1/calls/${id}/leave`, body: {} })],
  ['call', 'POST /api/v1/calls/:id/media', (id) => ({ method: 'POST', path: `/api/v1/calls/${id}/media`, body: { audio: true } })],
  ['call', 'POST /api/v1/calls/:id/recording-consent', (id) => ({ method: 'POST', path: `/api/v1/calls/${id}/recording-consent`, body: { granted: true } })],
  ['call', 'POST /api/v1/calls/:id/recording/start', (id) => ({ method: 'POST', path: `/api/v1/calls/${id}/recording/start`, body: {}, as: 'owner' })],
  ['call', 'POST /api/v1/calls/:id/end', (id) => ({ method: 'POST', path: `/api/v1/calls/${id}/end`, body: {} })],
  ['call', 'GET /api/v1/calls/:id/meeting', (id) => ({ path: `/api/v1/calls/${id}/meeting` })],
  ['call', 'POST /api/v1/admin/meeting-jobs/:id/retry', (id) => ({ method: 'POST', path: `/api/v1/admin/meeting-jobs/${id}/retry`, body: { reason: 'зонд проверки изоляции' }, as: 'owner' })],
  ['call', 'POST /api/v1/meeting-proposals/:id/accept', (id) => ({ method: 'POST', path: `/api/v1/meeting-proposals/${id}/accept`, body: {} })],
  ['call', 'POST /api/v1/meeting-proposals/:id/reject', (id) => ({ method: 'POST', path: `/api/v1/meeting-proposals/${id}/reject`, body: {} })],

  // ── личные пометки ───────────────────────────────────────────────────────
  ['highlight', 'DELETE /api/v1/highlights/:id', (id) => ({ method: 'DELETE', path: `/api/v1/highlights/${id}` })],
  ['note', 'PATCH /api/v1/message-notes/:id', (id) => ({ method: 'PATCH', path: `/api/v1/message-notes/${id}`, body: { body: 'перехват' } })],
  ['note', 'DELETE /api/v1/message-notes/:id', (id) => ({ method: 'DELETE', path: `/api/v1/message-notes/${id}` })],

  // ── уведомления ──────────────────────────────────────────────────────────
  ['notification', 'POST /api/v1/notifications/:id/read', (id) => ({ method: 'POST', path: `/api/v1/notifications/${id}/read` })],

  // ── исходящие интеграции ─────────────────────────────────────────────────
  ['webhook', 'POST /api/v1/integrations/webhooks/:id/disable', (id) => ({ method: 'POST', path: `/api/v1/integrations/webhooks/${id}/disable`, as: 'owner' })],
  ['webhook', 'POST /api/v1/integrations/webhooks/:id/enable', (id) => ({ method: 'POST', path: `/api/v1/integrations/webhooks/${id}/enable`, as: 'owner' })],
  ['webhook', 'DELETE /api/v1/integrations/webhooks/:id', (id) => ({ method: 'DELETE', path: `/api/v1/integrations/webhooks/${id}`, as: 'owner' })],
];

const GHOST = '00000000-0000-4000-8000-000000000000';

const IDS = (A, B) => ({
  conversation: { cross: B.conversationId, priv: A.privateConversationId },
  message: { cross: B.messageId, priv: A.privateMessageId },
  task: { cross: B.taskId, priv: A.otherTaskId },
  file: { cross: B.fileId, priv: A.otherFileId },
  event: { cross: B.calendarEventId, priv: A.otherCalendarEventId },
  label: { cross: B.labelId, priv: A.otherLabelId },
  personal: { cross: B.personalItemId, priv: A.otherPersonalItemId },
  reminder: { cross: B.reminderId, priv: A.otherReminderId },
  vault: { cross: B.vaultId, priv: A.otherVaultId },
  game: { cross: B.gameId, priv: A.otherGameId },
  unit: { cross: B.orgUnitId, priv: null },
  webhook: { cross: B.webhookId, priv: null },
  call: { cross: B.callId, priv: A.otherCallId },
  highlight: { cross: B.highlightId, priv: A.otherHighlightId },
  note: { cross: B.noteId, priv: A.otherNoteId },
  user: { cross: B.users.member.id, priv: null },
  notification: { cross: B.notificationId, priv: A.otherNotificationId },
});

// Всё, что принадлежит «другому» сотруднику внутри своей компании, носит
// одну из этих пометок в названии.
const PRIVATE_MARKERS = (A) => ['ЧУЖ', `СЕКРЕТ-${A.suffix}`, 'ЛИЧНАЯ-МЕТКА', `other-s3cr3t-${A.suffix}`];

test('чужой идентификатор не открывает ни один маршрут', { skip }, async (t) => {
  const base = await boot(t);
  const A = await company(base, 'a');
  const B = await company(base, 'b');
  const ids = IDS(A, B);
  const priv = PRIVATE_MARKERS(A);
  const failures = [];

  for (const [kind, label, build] of ROUTES(A, B)) {
    for (const variant of ['cross', 'priv', 'ghost']) {
      const id = variant === 'ghost' ? GHOST : ids[kind][variant];
      if (!id) continue;
      const spec = build(id);
      // Владелец компании А — законный участник её «приватных» объектов,
      // поэтому этот вариант имеет смысл только для сотрудника и гостя.
      const actors = spec.as === 'owner'
        ? (variant === 'priv' ? [] : ['owner'])
        : (variant === 'priv' ? ['member', 'guest'] : ['member', 'guest', 'owner']);
      for (const actor of actors) {
        const r = await call(base, spec.path, {
          cookie: A.users[actor].cookie, method: spec.method ?? 'GET', body: spec.body,
        });
        const where = `${label} [${variant}/${actor}] → ${r.status} ${r.text.slice(0, 200)}`;

        // 1. Ни одного поля чужого объекта — ни при 404, ни при 403, ни при 200.
        const leaked = variant === 'cross'
          ? (r.text.includes(B.suffix) ? [B.suffix] : [])
          : variant === 'priv' ? priv.filter((marker) => r.text.includes(marker)) : [];
        if (leaked.length) failures.push(`УТЕЧКА ${JSON.stringify(leaked)}: ${where}`);

        // 2. Отказ, а не работа: чужой идентификатор ничего не делает.
        const allow = spec.allow ?? [404];
        if (!allow.includes(r.status)) failures.push(`ОЖИДАЛОСЬ ${allow.join('/')}: ${where}`);
      }
    }
  }

  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});

/**
 * Звезда на объекте — тоже доступ к объекту: список избранного печатает
 * название. Проверка отдельная, потому что дыра видна не в ответе на запись,
 * а в следующем чтении списка.
 */
test('избранное не печатает название объекта, к которому нет доступа', { skip }, async (t) => {
  const base = await boot(t);
  const A = await company(base, 'f');
  const B = await company(base, 'g');

  for (const actor of ['member', 'guest']) {
    const cookie = A.users[actor].cookie;
    for (const [type, id] of [
      ['file', A.otherFileId], ['event', A.otherCalendarEventId],
      ['message', A.privateMessageId], ['conversation', A.privateConversationId], ['task', A.otherTaskId],
    ]) {
      const r = await call(base, `/api/v1/favourites/${type}/${id}`, { cookie, method: 'PUT' });
      assert.equal(r.status, 404, `${actor} пометил чужой ${type}: ${r.status} ${r.text}`);
    }
    for (const [type, id] of [
      ['file', B.fileId], ['event', B.calendarEventId],
      ['message', B.messageId], ['conversation', B.conversationId], ['task', B.taskId],
    ]) {
      const r = await call(base, `/api/v1/favourites/${type}/${id}`, { cookie, method: 'PUT' });
      assert.equal(r.status, 404, `${actor} пометил объект другой компании (${type}): ${r.status} ${r.text}`);
    }
    const list = await call(base, '/api/v1/favourites', { cookie });
    for (const marker of [...PRIVATE_MARKERS(A), B.suffix]) {
      assert.ok(!list.text.includes(marker),
        `в избранном ${actor} видно «${marker}»: ${list.text.slice(0, 400)}`);
    }
  }
});

/**
 * Поиск, ленты и сводки — те же чужие данные, только без идентификатора в
 * запросе. Сотрудник и гость не должны выуживать чужое строкой поиска.
 */
test('поиск и ленты не достают чужое', { skip }, async (t) => {
  const base = await boot(t);
  const A = await company(base, 'h');
  const B = await company(base, 'i');
  const feeds = [
    '/api/v1/search?q=', '/api/v1/files?q=', '/api/v1/mentions', '/api/v1/attention',
    '/api/v1/contacts', '/api/v1/people', '/api/v1/bootstrap', '/api/v1/saved-messages',
    '/api/v1/calendar-invitations', '/api/v1/labels', '/api/v1/vault', '/api/v1/reminders',
    '/api/v1/personal-items', '/api/v1/meetings', '/api/v1/tasks', '/api/v1/conversations',
    '/api/v1/notifications', '/api/v1/favourites', '/api/v1/highlights', '/api/v1/message-notes',
  ];
  for (const actor of ['member', 'guest']) {
    const cookie = A.users[actor].cookie;
    for (const feed of feeds) {
      const path = feed.endsWith('q=') ? `${feed}${B.suffix}` : feed;
      const r = await call(base, path, { cookie });
      if (r.status >= 400) continue; // маршрут закрыт этой роли — это не утечка
      const body = feed.endsWith('q=') ? r.text.replace(`"query":"${B.suffix}"`, '') : r.text;
      assert.ok(!body.includes(B.suffix), `${actor} видит компанию B в ${path}: ${body.slice(0, 400)}`);
      for (const marker of PRIVATE_MARKERS(A)) {
        assert.ok(!body.includes(marker), `${actor} видит «${marker}» в ${path}: ${body.slice(0, 400)}`);
      }
    }
    // Поиск по характерной строке чужого добра своей же компании.
    for (const query of ['ЧУЖ', `СЕКРЕТ-${A.suffix}`]) {
      const r = await call(base, `/api/v1/search?q=${encodeURIComponent(query)}`, { cookie });
      const items = JSON.parse(r.text).items ?? [];
      assert.deepEqual(items, [], `${actor} нашёл чужое по «${query}»: ${r.text.slice(0, 400)}`);
    }
  }
});

/**
 * Существование объекта — тоже сведение. На идентификатор, которого человек
 * видеть не должен, ответ обязан быть неотличим от ответа на выдуманный UUID.
 */
test('чужой идентификатор отвечает так же, как несуществующий', { skip }, async (t) => {
  const base = await boot(t);
  const A = await company(base, 'j');
  const B = await company(base, 'k');
  const ids = IDS(A, B);
  const mismatches = [];

  for (const [kind, label, build] of ROUTES(A, B)) {
    for (const variant of ['cross', 'priv']) {
      const id = ids[kind][variant];
      if (!id) continue;
      const spec = build(id);
      const actors = spec.as === 'owner'
        ? (variant === 'priv' ? [] : ['owner'])
        : (variant === 'priv' ? ['member', 'guest'] : ['member', 'guest', 'owner']);
      for (const actor of actors) {
        const cookie = A.users[actor].cookie;
        const real = await call(base, spec.path, { cookie, method: spec.method ?? 'GET', body: spec.body });
        const ghostSpec = build(GHOST);
        const ghost = await call(base, ghostSpec.path, { cookie, method: ghostSpec.method ?? 'GET', body: ghostSpec.body });
        if (real.status !== ghost.status) {
          mismatches.push(`${label} [${variant}/${actor}]: чужой → ${real.status} ${JSON.parse(real.text || 'null')?.error?.code ?? ''}, выдуманный → ${ghost.status} ${JSON.parse(ghost.text || 'null')?.error?.code ?? ''}`);
        }
      }
    }
  }

  assert.deepEqual(mismatches, [], `\n${mismatches.join('\n')}\n`);
});
