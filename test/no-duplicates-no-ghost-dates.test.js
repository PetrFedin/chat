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

async function company(t, suffix) {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const owner = await call(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Двойник ${suffix}`, ownerName: 'Владелец', email: `dup-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invitation = await call(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mate-${suffix}@t.test`, role: 'member' } });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const mate = await call(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Коллега', password: 'MemberPassword42' } });
  const mateId = (await call(base, '/api/v1/bootstrap', { cookie: mate.cookie })).payload.session.userId;
  return { base, owner, mate, mateId, suffix };
}

/**
 * Переписка вдвоём одна на двоих.
 *
 * Это не «комната, которую можно создать», а сам факт того, что эти двое
 * разговаривают. Заводилась же она каждый раз заново: двойной клик по
 * имени в справочнике давал два одинаковых пункта в списке, и половина
 * разговора уезжала в один, половина в другой. Склеить их потом нечем.
 */
test('личная переписка не двоится от двойного нажатия',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const { base, owner, mate, mateId } = await company(t, suffix);

  const open = () => call(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST', body: { kind: 'direct', participantIds: [mateId] } });

  const first = await open();
  assert.equal(first.status, 201);
  const second = await open();
  assert.equal(second.payload.conversation.id, first.payload.conversation.id, 'завелась вторая переписка с тем же человеком');
  assert.equal(second.payload.existed, true);

  // И с другой стороны тоже открывается та же самая.
  const theirs = await call(base, '/api/v1/conversations', {
    cookie: mate.cookie, method: 'POST',
    body: { kind: 'direct', participantIds: [(await call(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.session.userId] } });
  assert.equal(theirs.payload.conversation.id, first.payload.conversation.id);

  const mine = (await call(base, '/api/v1/conversations', { cookie: owner.cookie })).payload.items
    .filter((item) => item.kind === 'direct' && item.title === 'Коллега');
  assert.equal(mine.length, 1, `в списке ${mine.length} одинаковых переписок`);
});

/**
 * Приглашать того, кто уже здесь, незачем.
 *
 * Приглашение создавалось, ссылка уходила, место занималось — а перейти
 * по ней человек не мог: «у этого адреса уже есть учётная запись».
 * Приглашение оставалось в очереди навсегда и держало место, а совет
 * «отзовите лишние» не подсказывал, какие именно.
 */
test('приглашение различает «уже работает» и «уже позвали»',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const { base, owner } = await company(t, suffix);

  const works = await call(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mate-${suffix}@t.test`, role: 'member' } });
  assert.equal(works.code, 'ALREADY_IN_WORKSPACE');
  assert.match(works.payload.error.message, /уже работает/);

  const fresh = `new-${suffix}@granit.test`;
  assert.equal((await call(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: fresh, role: 'member' } })).status, 201);
  const again = await call(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: fresh, role: 'member' } });
  assert.equal(again.code, 'ALREADY_INVITED');
  assert.doesNotMatch(again.payload.error.message, /record|constraint|exists/i,
    `наружу вышло сообщение драйвера: ${again.payload.error.message}`);
});

/**
 * Даты, которых не бывает.
 *
 * `new Date` дописывает несуществующие дни: 31 февраля молча становится
 * 3 марта, и человек получает напоминание не в тот день, звонок не в тот
 * день и срок не тогда, когда назначил. А дата, присланная массивом,
 * проходила все проверки и давала 2000 год — обещание, просроченное с
 * рождения.
 */
test('несуществующая дата отбивается везде, а не досчитывается до следующего месяца',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const { base, owner } = await company(t, suffix);
  const general = (await call(base, '/api/v1/conversations', { cookie: owner.cookie }))
    .payload.items.find((item) => item.slug === 'general');

  const cases = [
    ['напоминание на 31 ноября', '/api/v1/reminders', { title: 'Позвонить', remindAt: '2026-11-31T10:00:00Z' }],
    ['напоминание на 31 февраля', '/api/v1/reminders', { title: 'Позвонить', remindAt: '2026-02-31T10:00:00Z' }],
    ['задача со сроком массивом', '/api/v1/tasks', { title: 'Задача', promisedAt: [1] }],
    ['встреча на 31 февраля', '/api/v1/calendar-events', { title: 'Встреча', startAt: '2026-02-31T10:00:00Z', endAt: '2026-02-31T11:00:00Z' }],
    ['звонок на 31 февраля', '/api/v1/calls/scheduled', { conversationId: general.id, title: 'Созвон', startAt: '2026-02-31T10:00:00Z' }],
    ['срок доступа на 31 февраля', '/api/v1/invitations', { email: `ghost-${suffix}@t.test`, role: 'guest', accessUntil: '2027-02-31T00:00:00Z' }],
  ];
  for (const [what, path, body] of cases) {
    const answer = await call(base, path, { cookie: owner.cookie, method: 'POST', body });
    assert.equal(answer.status >= 400 && answer.status < 500, true, `${what}: прошло со статусом ${answer.status}`);
    assert.match(String(answer.payload?.error?.message ?? ''), /дат/i, `${what}: отказ объясняет не то — ${answer.payload?.error?.message}`);
  }

  // А настоящая дата проходит.
  assert.equal((await call(base, '/api/v1/reminders', {
    cookie: owner.cookie, method: 'POST', body: { title: 'Позвонить', remindAt: '2026-11-30T10:00:00Z' } })).status, 201);
});
