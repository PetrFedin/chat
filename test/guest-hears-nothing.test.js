import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
process.env.VAULT_KEY ||= randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

async function call(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'idempotency-key': randomUUID(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

/**
 * Круг получателей считается по каждому из них, а не по пишущему.
 *
 * Правило «кому эта беседа открыта» вшивало в запрос роль одного
 * человека — того, от чьего имени идёт запрос. Там, где собирают круг
 * получателей, смотрящих столько же, сколько строк: сотрудник писал в
 * канал «для всей компании», правило считалось по нему, и в круг
 * попадали все, включая подрядчиков.
 *
 * Гость получал во «Входящие» текст внутреннего сообщения целиком —
 * беседы этой у него в списке нет, по ссылке она не открывается, а
 * счётчик упоминаний показывал единицу при нуле бесед. Тем же путём его
 * записывали в участники звонка, который он не мог открыть.
 */
test('подрядчик не слышит канала, в который его не звали',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = randomUUID().slice(0, 8);

  const owner = await call(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Слух ${suffix}`, ownerName: 'Владелец', email: `hear-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const join = async (role, mail, displayName) => {
    const invitation = await call(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: mail, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const accepted = await call(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName, password: 'MemberPassword42' } });
    const boot = await call(base, '/api/v1/bootstrap', { cookie: accepted.cookie });
    return { cookie: accepted.cookie, id: boot.payload.session.userId };
  };
  const colleague = await join('member', `hc-${suffix}@t.test`, 'Коллега');
  const guest = await join('guest', `hg-${suffix}@t.test`, 'Подрядчик');

  const general = (await call(base, '/api/v1/conversations', { cookie: owner.cookie }))
    .payload.items.find((item) => item.slug === 'general');
  assert.equal(general.visibility, 'workspace', 'проверка теряет смысл, если канал не общий');
  // Гостю этого канала не видно — с этого всё и начинается.
  assert.equal((await call(base, '/api/v1/conversations', { cookie: guest.cookie }))
    .payload.items.some((item) => item.id === general.id), false);

  // Сотрудник пишет внутрь и называет гостя по имени: упоминание —
  // самый прямой путь дотянуться до человека.
  const secret = `Ведомость за сентябрь ${suffix}`;
  assert.equal((await call(base, `/api/v1/conversations/${general.id}/messages`, {
    cookie: colleague.cookie, method: 'POST',
    body: { kind: 'text', body: secret, mentionedUserIds: [guest.id] },
  })).status, 201);

  const inbox = await call(base, '/api/v1/notifications?status=unread', { cookie: guest.cookie });
  assert.equal(inbox.payload.items.length, 0,
    `подрядчику пришло извещение из чужого канала: ${JSON.stringify(inbox.payload.items)}`);
  const seen = JSON.stringify(inbox.payload.items);
  assert.doesNotMatch(seen, new RegExp(suffix), 'текст внутреннего сообщения вышел наружу');

  const attention = (await call(base, '/api/v1/attention', { cookie: guest.cookie })).payload.attention;
  assert.equal(attention.mentions, 0, 'счётчик упоминаний не сходится с экраном: бесед ноль');
  assert.equal(attention.unreadMessages, 0);

  // Звонок в тот же канал зовёт сотрудников и только их.
  const started = await call(base, `/api/v1/conversations/${general.id}/calls`, {
    cookie: owner.cookie, method: 'POST', body: { mode: 'audio' } });
  assert.equal(started.status, 201);
  assert.equal(started.payload.call.participants.some((p) => p.userId === guest.id), false,
    'подрядчика записали в звонок, который он не откроет');
  assert.equal(started.payload.call.participants.some((p) => p.userId === colleague.id), true,
    'сотрудника, наоборот, забыли позвать');

  // А в свою комнату гостя зовут — и там он слышит всё, как все.
  const room = await call(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST',
    body: { kind: 'group', title: `Работа с подрядчиком ${suffix}`, participantIds: [guest.id] } });
  assert.equal(room.status, 201);
  assert.equal((await call(base, `/api/v1/conversations/${room.payload.conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { kind: 'text', body: 'Смотрите смету', mentionedUserIds: [guest.id] },
  })).status, 201);
  const theirs = await call(base, '/api/v1/notifications?status=unread', { cookie: guest.cookie });
  assert.equal(theirs.payload.items.length, 1, 'в своей комнате подрядчик перестал слышать');
});
