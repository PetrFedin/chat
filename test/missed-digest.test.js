import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
 * «Что я пропустил» за неделю отсутствия.
 *
 * Отвечать на этот вопрос продукт умел единственным способом — листайте
 * всё подряд, — и у кого сорок бесед, тот не листал.
 */
test('сводка отвечает, что произошло без человека',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const day = 86400000;
  const month = new Date(Date.now() - 30 * day).toISOString();

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Сводка ${suffix}`, ownerName: 'Директор', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const join = async (tag, name) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: `${tag}-${suffix}@t.test`, role: 'member' } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const session = await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: name, password: 'OwnerPassword42' } });
    const me = await request(base, '/api/v1/me', { cookie: session.cookie });
    return { cookie: session.cookie, userId: me.payload.userId, email: `${tag}-${suffix}@t.test` };
  };
  const nina = await join('nina', 'Нина');
  const oleg = await join('oleg', 'Олег');

  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];
  const handle = nina.email.split('@')[0];
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: `@${handle} посмотрите смету, пожалуйста`, mentionedUserIds: [nina.userId] } });
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: 'просто сообщение без упоминания' } });

  // Ей предложили обязательство и она ещё не ответила.
  const proposed = (await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST',
    body: { title: 'Свести акты', ownerId: nina.userId, promisedAt: new Date(Date.now() + 3 * day).toISOString() } })).payload.task;
  // А это — срок, прошедший, пока её не было.
  const slipping = (await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST',
    body: { title: 'Сверка', ownerId: nina.userId, promisedAt: new Date(Date.now() - 2 * day).toISOString() } })).payload.task;
  const move = async (cookie, id, to) => {
    const current = (await request(base, `/api/v1/tasks/${id}`, { cookie })).payload.task;
    return request(base, `/api/v1/tasks/${id}/transitions`, {
      cookie, method: 'POST', body: { to, expectedVersion: current.version, reason: 'ход' } });
  };
  await move(nina.cookie, slipping.id, 'accepted');
  await move(nina.cookie, slipping.id, 'in_progress');

  // А это двинулось без неё: она попросила Олега, он взялся и упёрся.
  // Обязательство касается троих, и движение любого из них — новость
  // для остальных.
  const hers = (await request(base, '/api/v1/tasks', {
    cookie: nina.cookie, method: 'POST',
    body: { title: 'Замеры на объекте', ownerId: oleg.userId, promisedAt: new Date(Date.now() + 5 * day).toISOString() } })).payload.task;
  for (const to of ['accepted', 'scheduled', 'blocked']) {
    const step = await move(oleg.cookie, hers.id, to);
    assert.equal(step.status, 200, `переход в ${to} не удался: ${step.code}`);
  }

  const digest = (await request(base, `/api/v1/digest?from=${month}`, { cookie: nina.cookie })).payload;
  assert.equal(digest.empty, false);
  assert.equal(digest.guessedSince, false, 'границу задали явно');

  assert.equal(digest.mentions.length, 1, 'в сводку попало не ровно одно упоминание');
  assert.match(digest.mentions[0].snippet, /посмотрите смету/);
  assert.equal(digest.mentions[0].conversationId, conversation.id);
  assert.ok(digest.mentions[0].messageId, 'без идентификатора сообщения к нему не перейти');

  assert.deepEqual(digest.awaitingYourAnswer.map((x) => x.id), [proposed.id]);
  assert.equal(digest.awaitingYourAnswer[0].requesterName, 'Директор');

  assert.deepEqual(digest.slippedDeadlines.map((x) => x.id), [slipping.id],
    'просроченным считается то, чей срок прошёл внутри отрезка и кто всё ещё открыт');

  // Одна строка на обязательство, а не на каждый переход: задача,
  // прошедшая четыре состояния, — это одна новость.
  assert.equal(digest.movedWithoutYou.length, 1);
  assert.equal(digest.movedWithoutYou[0].to, 'blocked', 'показываем последнее движение, а не первое');
  assert.equal(digest.movedWithoutYou[0].from, 'scheduled');
  assert.equal(digest.movedWithoutYou[0].actorName, 'Олег');
  assert.equal(digest.movedWithoutYou[0].id, hers.id);

  assert.ok(digest.joined.some((p) => p.displayName === 'Директор'));
  assert.ok(digest.joined.some((p) => p.displayName === 'Олег'));
  assert.equal(digest.joined.some((p) => p.userId === nina.userId), false, 'себя в списке новых людей быть не должно');

  // Свои собственные сообщения новостью не являются.
  const mine = (await request(base, `/api/v1/digest?from=${month}`, { cookie: owner.cookie })).payload;
  assert.equal(mine.mentions.length, 0, 'директор сам себя не упоминал');
  assert.equal(mine.busiest.length, 0, 'собственные сообщения не считаются новыми');

  // Пустой отрезок — честно пустая сводка, а не набор пустых разделов.
  const quiet = (await request(base,
    `/api/v1/digest?from=${new Date(Date.now() - 80 * day).toISOString()}&`, { cookie: nina.cookie })).payload;
  assert.ok(quiet.mentions.length >= 1, 'более широкий отрезок не может показать меньше');

  assert.equal((await request(base, '/api/v1/digest?from=позавчера', { cookie: nina.cookie })).status, 400);

  // Гость получает сводку только по тому, что ему видно: ни обязательств
  // компании, ни списка её сотрудников.
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `guest-${suffix}@client.test`, role: 'guest' } });
  const guestToken = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const guest = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token: guestToken, displayName: 'Заказчик', password: 'GuestPassword42' } });
  const guestDigest = (await request(base, `/api/v1/digest?from=${month}`, { cookie: guest.cookie })).payload;
  assert.equal(guestDigest.joined.length, 0, 'гостю показали штат компании');
  assert.equal(guestDigest.slippedDeadlines.length, 0);
  assert.equal(guestDigest.movedWithoutYou.length, 0);
  assert.equal(guestDigest.busiest.length, 0, 'гостю показали чужие беседы');
});

test('сводка доступна из интерфейса', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-action="digest"/);
  assert.match(app, /digest:\(\)=>digestModal\(\)/);
  assert.match(app, /api\(`\/api\/v1\/digest\$\{query\}`\)/);
  // Из упоминания — сразу в то место переписки, а не в её конец.
  assert.match(app, /openChatAtMessage\(conversation,message\)/);
  // Роль в интерфейсе пишется по-русски — словарём, а не руками.
  assert.match(app, /const ROLE_WORD=\{owner:'владелец'/);
  assert.equal(app.includes('esc(p.title||p.role)'), false, 'роль снова печатается английским словом из базы');
});
