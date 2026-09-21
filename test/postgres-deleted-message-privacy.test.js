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

// «Удалить у всех» гасило сообщение в чате, но его полный текст оставался
// в центре уведомлений — навсегда и у всех, кому оно пришло.
test('удалённое сообщение не читается в уведомлениях',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const SECRET = `Тайная смета ${suffix}`;

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Удаление ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mate-${suffix}@t.test`, role: 'member' } });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const mate = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Коллега', password: 'OwnerPassword42' } });

  // Уведомление о простом сообщении приходит в личной беседе — её и заводим.
  const mateId = (await request(base, '/api/v1/people', { cookie: owner.cookie }))
    .payload.items.find((p) => p.email === `mate-${suffix}@t.test`).userId;
  const conversation = (await request(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST', body: { kind: 'direct', participantIds: [mateId] } })).payload.conversation;
  const sent = await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: SECRET } });

  const before = await request(base, '/api/v1/notifications?limit=100', { cookie: mate.cookie });
  assert.ok(JSON.stringify(before.payload.items).includes(SECRET), 'до удаления текст в уведомлении есть — иначе тест ничего не проверяет');

  await request(base, `/api/v1/messages/${sent.payload.message.id}`, { cookie: owner.cookie, method: 'DELETE' });

  const after = await request(base, '/api/v1/notifications?limit=100', { cookie: mate.cookie });
  assert.ok(!JSON.stringify(after.payload.items).includes(SECRET), 'после удаления текста нет нигде в уведомлениях');
  const notice = after.payload.items.find((item) => item.messageId === sent.payload.message.id);
  if (notice) assert.equal(notice.body, 'Сообщение удалено', 'на месте текста — честная пометка');

  // И в самой переписке тела тоже нет.
  const messages = await request(base, `/api/v1/conversations/${conversation.id}/messages`, { cookie: mate.cookie });
  assert.ok(!JSON.stringify(messages.payload.items).includes(SECRET));
});
