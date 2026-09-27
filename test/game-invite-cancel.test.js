import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

/**
 * Раньше у пославшего приглашение не было способа его отменить: единственный
 * доступный на игре глагол, resign(), требовал уже начатой партии. Теперь
 * resign() на неотвеченном приглашении завершает его без победителя — это
 * отзыв, а не поражение того, кто ещё не сел за доску.
 */
test('отмена неотвеченного игрового приглашения не засчитывает поражение — это не сданная партия',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = randomUUID().slice(0, 8);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST', body: { companyName: `Games ${suffix}`, ownerName: 'Владелец', email: `games-owner-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invited = await request(base, '/api/v1/invitations', { cookie: owner.cookie, method: 'POST', body: { email: `games-member-${suffix}@t.test`, role: 'member' } });
  const memberToken = new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite');
  const member = await request(base, '/api/v1/invitations/accept', { method: 'POST', body: { token: memberToken, displayName: 'Соперник', password: 'MemberPassword42' } });

  const boot = await request(base, '/api/v1/bootstrap', { cookie: owner.cookie });
  const general = boot.payload.conversations.find((c) => c.slug === 'general');
  const memberBoot = await request(base, '/api/v1/bootstrap', { cookie: member.cookie });
  const opponentId = memberBoot.payload.session.userId;

  const created = await request(base, '/api/v1/games', { cookie: owner.cookie, method: 'POST', body: { conversationId: general.id, kind: 'chess', opponentId } });
  assert.equal(created.status, 201);
  const gameId = created.payload.game.id;
  assert.equal(created.payload.game.status, 'invited');

  // Соперник — не тот, кто звал, — отменить приглашение не может.
  const opponentAttempt = await request(base, `/api/v1/games/${gameId}/resign`, { cookie: member.cookie, method: 'POST' });
  assert.equal(opponentAttempt.status, 403);
  assert.equal(opponentAttempt.code, 'NOT_CHALLENGER');

  const cancelled = await request(base, `/api/v1/games/${gameId}/resign`, { cookie: owner.cookie, method: 'POST' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.payload.game.status, 'finished');
  assert.equal(cancelled.payload.game.result, 'invite_cancelled');
  assert.equal(cancelled.payload.game.winnerId, null, 'отмена приглашения не должна назначать победителя — партия не начиналась');

  // Уже завершённую (отменённую) игру нельзя отменить или сдать повторно.
  const again = await request(base, `/api/v1/games/${gameId}/resign`, { cookie: owner.cookie, method: 'POST' });
  assert.equal(again.status, 409);
  assert.equal(again.code, 'WRONG_STATUS');
});

test('сдача уже принятой партии по-прежнему засчитывает победу сопернику (не регрессия)',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = randomUUID().slice(0, 8);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST', body: { companyName: `Games2 ${suffix}`, ownerName: 'Владелец', email: `games2-owner-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invited = await request(base, '/api/v1/invitations', { cookie: owner.cookie, method: 'POST', body: { email: `games2-member-${suffix}@t.test`, role: 'member' } });
  const memberToken = new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite');
  const member = await request(base, '/api/v1/invitations/accept', { method: 'POST', body: { token: memberToken, displayName: 'Соперник', password: 'MemberPassword42' } });
  const boot = await request(base, '/api/v1/bootstrap', { cookie: owner.cookie });
  const general = boot.payload.conversations.find((c) => c.slug === 'general');
  const memberBoot = await request(base, '/api/v1/bootstrap', { cookie: member.cookie });
  const opponentId = memberBoot.payload.session.userId;

  const created = await request(base, '/api/v1/games', { cookie: owner.cookie, method: 'POST', body: { conversationId: general.id, kind: 'chess', opponentId } });
  const gameId = created.payload.game.id;
  const accepted = await request(base, `/api/v1/games/${gameId}/respond`, { cookie: member.cookie, method: 'POST', body: { accept: true } });
  assert.equal(accepted.payload.game.status, 'active');

  const resigned = await request(base, `/api/v1/games/${gameId}/resign`, { cookie: owner.cookie, method: 'POST' });
  assert.equal(resigned.payload.game.result, 'resigned');
  assert.equal(resigned.payload.game.winnerId, opponentId, 'в настоящей партии сдавшийся проигрывает, а соперник выигрывает');
});
