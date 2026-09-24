import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'idempotency-key': crypto.randomUUID(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

/**
 * «Созвонимся в четверг в десять» жило словами в переписке и там же
 * терялось: назначить разговор было нельзя, хотя столбец под время
 * лежал в схеме с самого начала и не читался ни одной строкой кода.
 */
test('звонок назначается с темой, временем, участниками и документами',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Звонки ${suffix}`, ownerName: 'Владелец', email: `sc-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];

  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `sm-${suffix}@t.test`, role: 'member' },
  });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const member = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Олег', password: 'MemberPassword42' },
  });
  const memberId = (await request(base, '/api/v1/bootstrap', { cookie: member.cookie })).payload.session.userId;
  await request(base, `/api/v1/conversations/${conversation.id}/members`, {
    cookie: owner.cookie, method: 'POST', body: { userId: memberId },
  });

  const uploaded = await fetch(`${base}/api/v1/files`, {
    method: 'POST',
    headers: { cookie: owner.cookie, 'content-type': 'text/plain', 'x-file-name': encodeURIComponent('повестка.txt') },
    body: Buffer.from('о чём говорим', 'utf8'),
  });
  const file = (await uploaded.json()).file;

  const startAt = new Date(Date.now() + 86400000).toISOString();
  const made = await request(base, '/api/v1/calls/scheduled', {
    cookie: owner.cookie, method: 'POST',
    body: { conversationId: conversation.id, title: 'Смета по СГ-114', mode: 'audio', startAt, minutes: 45,
      agenda: 'Разобрать расхождения', fileIds: [file.id] },
  });
  assert.equal(made.status, 201);
  assert.equal(made.payload.call.state, 'scheduled');
  assert.equal(made.payload.attached, 1);
  // Звонок и встреча — одно событие, а не два похожих: иначе у
  // разговора не будет ни напоминания, ни места в сетке дня.
  assert.ok(made.payload.call.calendarEventId);

  const mine = await request(base, '/api/v1/calls/scheduled', { cookie: owner.cookie });
  assert.equal(mine.status, 200);
  const entry = mine.payload.items.find((x) => x.id === made.payload.call.id);
  assert.ok(entry, 'назначенного звонка нет в списке');
  assert.equal(entry.title, 'Смета по СГ-114');
  assert.equal(entry.mode, 'audio');
  assert.equal(entry.description, 'Разобрать расхождения');
  assert.equal(entry.participants.length, 2);
  assert.equal(entry.files.length, 1);
  assert.equal(entry.files[0].name, 'повестка.txt');

  // Назначенный звонок — приглашение, и приглашённый его видит.
  const theirs = await request(base, '/api/v1/calls/scheduled', { cookie: member.cookie });
  assert.ok(theirs.payload.items.some((x) => x.id === made.payload.call.id));

  // Отменять чужие договорённости продукт помогать не должен.
  const strangerCancels = await request(base, `/api/v1/calls/${made.payload.call.id}/cancel`, {
    cookie: member.cookie, method: 'POST', body: {},
  });
  assert.equal(strangerCancels.status, 403);
  assert.equal(strangerCancels.code, 'CALL_CANCEL_FORBIDDEN');

  const cancelled = await request(base, `/api/v1/calls/${made.payload.call.id}/cancel`, {
    cookie: owner.cookie, method: 'POST', body: {},
  });
  assert.equal(cancelled.status, 200);
  const after = await request(base, '/api/v1/calls/scheduled', { cookie: owner.cookie });
  assert.ok(!after.payload.items.some((x) => x.id === made.payload.call.id), 'отменённый звонок остался в списке');
});

/** Время, которое не разбирается, не должно доезжать до базы. */
test('негодное время и чужие участники отклоняются',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Время ${suffix}`, ownerName: 'Владелец', email: `st-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];

  const broken = await request(base, '/api/v1/calls/scheduled', {
    cookie: owner.cookie, method: 'POST',
    body: { conversationId: conversation.id, title: 'Когда-нибудь', startAt: 'в четверг' },
  });
  assert.equal(broken.code, 'INVALID_DATE');

  const stranger = await request(base, '/api/v1/calls/scheduled', {
    cookie: owner.cookie, method: 'POST',
    body: { conversationId: conversation.id, title: 'Чужие', startAt: new Date(Date.now() + 3600000).toISOString(),
      participantIds: ['00000000-0000-0000-0000-000000000001'] },
  });
  assert.equal(stranger.code, 'INVALID_CALL_PARTICIPANTS');
});
