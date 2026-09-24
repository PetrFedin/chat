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
    body: { companyName: `Звонки ${suffix}`, ownerName: 'Звонящая', email: `ring-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invitation = await call(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mate-${suffix}@t.test`, role: 'member' } });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const mate = await call(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Коллега', password: 'MemberPassword42' } });
  const mateId = (await call(base, '/api/v1/bootstrap', { cookie: mate.cookie })).payload.session.userId;
  const general = (await call(base, '/api/v1/conversations', { cookie: owner.cookie }))
    .payload.items.find((item) => item.slug === 'general');
  return { app, base, owner, mate, mateId, general };
}

/**
 * Отказ от звонка и звонок, которого никто не взял.
 *
 * Отклонить входящий было нечем: кнопка «Не сейчас» убирала плашку у
 * того, кто отказался, и звонящий продолжал смотреть на гудки. Обычный
 * выход не годился — после него человек неотличим от того, у кого
 * оборвалась связь.
 *
 * А извещение о звонке уходило только в браузерный push, которого может
 * не быть: отошёл от стола — и не узнал ни что тебе звонили, ни что
 * звонок не состоялся. Понятия «пропущенный» в продукте не было вовсе.
 */
test('отказ от звонка доходит до звонящего, а неотвеченный звонок становится пропущенным',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const { base, owner, mate, mateId, general } = await company(t, suffix);

  const started = await call(base, `/api/v1/conversations/${general.id}/calls`, {
    cookie: owner.cookie, method: 'POST',
    body: { mode: 'audio', title: 'Обсудить смету', participantIds: [mateId] } });
  assert.equal(started.status, 201);
  const ringing = started.payload.call;

  // Тому, кому звонят, звонок виден и тогда, когда он не у экрана.
  const heard = (await call(base, '/api/v1/notifications?status=unread', { cookie: mate.cookie }))
    .payload.items.find((n) => n.type === 'call.started');
  assert.ok(heard, 'звонок нигде не отмечен: кто отошёл от стола, о нём не узнает');
  assert.match(heard.title, /звонит/);

  // Отказ — это ответ, и он отличается от оборвавшейся связи.
  const declined = await call(base, `/api/v1/calls/${ringing.id}/decline`, {
    cookie: mate.cookie, method: 'POST', body: {} });
  assert.equal(declined.status, 200);
  const them = declined.payload.call.participants.find((p) => p.userId === mateId);
  assert.equal(them.connectionState, 'declined');
  // Звонить больше некому — звонок закрыт, а не звонит вечно.
  assert.equal(declined.payload.call.state, 'missed');

  const told = (await call(base, '/api/v1/notifications?status=unread', { cookie: owner.cookie }))
    .payload.items.find((n) => n.type === 'call.declined');
  assert.ok(told, 'звонящей не сказали об отказе — она смотрит на гудки');
  assert.match(told.title, /не может говорить/);
});

/**
 * Обход времени закрывает звонки, до которых никто не дошёл.
 *
 * У состояния «звонит» не было срока: звонок оставался звонящим
 * навсегда — завершить его мог только тот, кто звонил.
 */
test('звонок, который не взяли, закрывается сам и остаётся пропущенным',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = randomUUID().slice(0, 8);
  const { app, base, owner, mate, mateId, general } = await company(t, suffix);

  const started = await call(base, `/api/v1/conversations/${general.id}/calls`, {
    cookie: owner.cookie, method: 'POST',
    body: { mode: 'video', title: 'Срочно про сваи', participantIds: [mateId] } });
  const ringing = started.payload.call;
  assert.equal(ringing.state, 'ringing');

  // Обход зовётся напрямую с нулевым сроком: ждать пять минут в тесте
  // незачем, а проверяем мы именно то, что он делает.
  const missed = await app.calls.sweepUnanswered({ after: '0 seconds' });
  const row = missed.find((item) => item.id === ringing.id);
  assert.ok(row, 'обход не заметил звонок, который никто не взял');
  assert.deepEqual([...row.missed], [mateId]);

  const after = await call(base, `/api/v1/calls/${ringing.id}`, { cookie: owner.cookie });
  assert.equal(after.payload.call.state, 'missed');
  // Время окончания не ставится: звонок не начинался, и таблица этого
  // не допускает — когда звонили, помнит время создания.
  assert.equal(after.payload.call.endedAt, null);
});
