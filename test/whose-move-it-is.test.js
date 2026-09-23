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
 * За кем ход.
 *
 * Экран «Сегодня» считал непрочитанное, упоминания и сроки — то есть всё,
 * что человек должен прочесть, и ничего из того, что он должен решить.
 * Работа, сданную на проверку, не показывал ни один список: исполнитель
 * ждал, а принимающему она была видна одной строчкой в колокольчике,
 * уходившей вниз за полдня. Пока ход не сделан, не движется никто.
 */
test('работа, сданная на проверку, ждёт названного человека и никого больше',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = randomUUID().slice(0, 8);

  const owner = await call(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Ход ${suffix}`, ownerName: 'Принимающая', email: `move-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invitation = await call(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `doer-${suffix}@t.test`, role: 'member' },
  });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const doer = await call(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Исполнитель', password: 'MemberPassword42' },
  });
  const doerId = (await call(base, '/api/v1/bootstrap', { cookie: doer.cookie })).payload.session.userId;

  const decisions = async (cookie) => (await call(base, '/api/v1/attention', { cookie })).payload.attention;
  const waiting = async (cookie) => (await call(base, '/api/v1/tasks?status=mine&counts=1', { cookie })).payload;

  const created = await call(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST', body: { title: 'Свести смету', ownerId: doerId },
  });
  const task = created.payload.task;

  // Предложенное обязательство ждёт того, кому его предложили.
  assert.equal((await decisions(doer.cookie)).tasksToAnswer, 1);
  assert.equal((await decisions(owner.cookie)).tasksToAnswer, 0);

  const move = async (cookie, to) => {
    const current = (await call(base, `/api/v1/tasks/${task.id}`, { cookie })).payload.task;
    return call(base, `/api/v1/tasks/${task.id}/transitions`, {
      cookie, method: 'POST', body: { to, expectedVersion: current.version },
    });
  };
  assert.equal((await move(doer.cookie, 'accepted')).status, 200);
  assert.equal((await move(doer.cookie, 'in_progress')).status, 200);
  const version = (await call(base, `/api/v1/tasks/${task.id}`, { cookie: doer.cookie })).payload.task.version;
  assert.equal((await call(base, `/api/v1/tasks/${task.id}/evidence`, {
    cookie: doer.cookie, method: 'POST', body: { type: 'url', value: 'https://example.test/smeta.xlsx', expectedVersion: version },
  })).status, 201);
  assert.equal((await move(doer.cookie, 'in_review')).status, 200);

  // Ход перешёл: сдавший больше ничего не ждёт, ждёт принимающая.
  const afterHandover = await decisions(owner.cookie);
  assert.equal(afterHandover.tasksToReview, 1, 'сданная работа не значится ни в одном списке дел');
  assert.equal(afterHandover.awaitingMyDecision, 1);
  assert.equal((await decisions(doer.cookie)).awaitingMyDecision, 0, 'у сдавшего работу ход уже не его');

  const list = await waiting(owner.cookie);
  assert.equal(list.counts.mine, 1);
  assert.deepEqual(list.items.map((item) => [item.title, item.status]), [['Свести смету', 'in_review']]);
  assert.equal((await waiting(doer.cookie)).items.length, 0);

  // Принятый результат всё ещё ждёт решения — его надо закрыть.
  assert.equal((await move(owner.cookie, 'accepted_result')).status, 200);
  const toClose = await decisions(owner.cookie);
  assert.equal(toClose.tasksToReview, 0);
  assert.equal(toClose.tasksToClose, 1, 'принятый результат повис между состояниями и ни в чьём списке не числится');

  // И только закрытие убирает задачу со всех столов.
  assert.equal((await move(owner.cookie, 'closed')).status, 200);
  assert.equal((await decisions(owner.cookie)).awaitingMyDecision, 0);
  assert.equal((await waiting(owner.cookie)).counts.mine, 0);
});
