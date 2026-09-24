import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
 * Принятое решение оставалось внутри карточки своей встречи: чтобы
 * вспомнить, что решили по объекту, надо было помнить, на какой именно
 * встрече это было. Через полгода этого не помнит никто.
 */
test('решения собираются сквозным списком и ищутся по слову',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const pool = app.store.pool;

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Решения ${suffix}`, ownerName: 'Анна', email: `dc-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const boot = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload;
  const me = boot.session.userId;
  const conversation = boot.conversations[0];

  // Встреча с разбором: звонок, прогон и три предложения. Кладём прямо
  // в базу — проверяем сборку решений, а не путь, которым они туда
  // попали.
  const { rows: [call] } = await pool.query(
    `INSERT INTO call_sessions(organization_id,workspace_id,conversation_id,created_by,title,mode,state,started_at,provider,provider_room_name)
     VALUES($1,$2,$3,$4,'Разбор по СГ-114','video','ended',now(),'livekit',$5) RETURNING id`,
    [boot.session.organizationId, boot.session.workspaceId, conversation.id, me, `room-${suffix}`]);
  await pool.query(
    `INSERT INTO call_participants(organization_id,workspace_id,call_id,user_id,joined_at,connection_state)
     VALUES($1,$2,$3,$4,now(),'disconnected')`,
    [boot.session.organizationId, boot.session.workspaceId, call.id, me]);
  const { rows: [recording] } = await pool.query(
    `INSERT INTO call_recordings(organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,started_by,started_at)
     VALUES($1,$2,$3,'livekit',$4,$5,'ready',$6,now()) RETURNING id`,
    [boot.session.organizationId, boot.session.workspaceId, call.id, `rec-${suffix}`, `key-${suffix}`, me]);
  const { rows: [run] } = await pool.query(
    `INSERT INTO meeting_intelligence_runs(organization_id,workspace_id,call_id,recording_id,status)
     VALUES($1,$2,$3,$4,'review_ready') RETURNING id`,
    [boot.session.organizationId, boot.session.workspaceId, call.id, recording.id]);

  // В таблице стоит проверка «принято — есть кто и когда принял,
  // отклонено — есть кто и когда отклонил»: заполняем ту пару, что
  // соответствует состоянию.
  const put = (type, title, status) => pool.query(
    `INSERT INTO meeting_proposals(organization_id,workspace_id,run_id,proposal_type,title,body,status,
                                   accepted_by,accepted_at,rejected_by,rejected_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [boot.session.organizationId, boot.session.workspaceId, run.id, type, title, 'подробности', status,
      status === 'accepted' ? me : null, status === 'accepted' ? new Date() : null,
      status === 'rejected' ? me : null, status === 'rejected' ? new Date() : null]);
  await put('decision', 'Берём подрядчика Б по СГ-114', 'accepted');
  await put('decision', 'Переносим заливку на май', 'proposed');
  await put('decision', 'Меняем поставщика щебня', 'rejected');
  await put('action', 'Оформить договор', 'accepted');

  const all = (await request(base, '/api/v1/meetings/decisions', { cookie: owner.cookie })).payload.items;
  // Только принятые и только решения: предложенное — ещё не решение, а
  // отклонённое им не стало; действие — это задача, а не решение.
  assert.equal(all.length, 1);
  assert.equal(all[0].title, 'Берём подрядчика Б по СГ-114');
  assert.equal(all[0].acceptedByName, 'Анна');
  assert.equal(all[0].callTitle, 'Разбор по СГ-114');
  assert.equal(all[0].conversationId, conversation.id);

  const found = (await request(base, '/api/v1/meetings/decisions?q=подрядчика', { cookie: owner.cookie })).payload.items;
  assert.equal(found.length, 1);
  const missed = (await request(base, '/api/v1/meetings/decisions?q=бетон', { cookie: owner.cookie })).payload.items;
  assert.equal(missed.length, 0);

  // Чужая встреча — чужие решения: список отдаёт только те, где человек
  // был участником.
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `dm-${suffix}@t.test`, role: 'member' },
  });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const member = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Олег', password: 'MemberPassword42' },
  });
  const theirs = (await request(base, '/api/v1/meetings/decisions', { cookie: member.cookie })).payload.items;
  assert.equal(theirs.length, 0, 'решения с чужой встречи попали в список');
});

/**
 * Статусы были видны только значком у имени — то есть тогда, когда на
 * имя смотрят. Писать и назначать задачи продолжали так, будто человек
 * за столом.
 */
test('оболочка предупреждает о том, что человека нет, до действия, а не после', async () => {
  const app = await readFile(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
  // Предупреждение стоит над полем ввода в беседе...
  assert.match(app, /composer-wrap">\$\{awayNotice\(c\)\}/);
  // ...и под выбором ответственного в задаче.
  assert.match(app, /data-owner-away/);
  assert.match(app, /watchOwnerAvailability\(\$\('#task-form'\)\)/);

  const css = await readFile(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');
  assert.match(css, /\.away-notice\{/);
});

/**
 * Разбор с расшифровкой есть только у записанного звонка. Совещание в
 * кабинете, планёрка на объекте, разговор с заказчиком по телефону
 * проходили мимо: таблица под протоколы лежала в схеме с самого начала
 * и не читалась ни одной строкой кода.
 */
test('протокол встречи пишется, правится на месте и отдаёт решения в общий список',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Протокол ${suffix}`, ownerName: 'Анна', email: `mn-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const event = (await request(base, '/api/v1/calendar-events', {
    cookie: owner.cookie, method: 'POST',
    body: { kind: 'meeting', title: 'Планёрка на объекте',
      startAt: new Date(Date.now() - 3600000).toISOString(), endAt: new Date().toISOString() },
  })).payload.event;

  assert.equal((await request(base, `/api/v1/calendar-events/${event.id}/notes`, { cookie: owner.cookie })).payload.notes, null);

  const saved = await request(base, `/api/v1/calendar-events/${event.id}/notes`, {
    cookie: owner.cookie, method: 'PUT',
    body: {
      notes: 'Обсудили сроки',
      // Пустая строка между решениями — это опечатка, а не решение.
      decisions: [`Берём подрядчика Б ${suffix}`, '   ', 'Заливку переносим на май'],
      actionItems: ['Заказать пересчёт сметы'],
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.notes.decisions.length, 2);
  assert.equal(saved.payload.notes.createdByName, 'Анна');

  // Один протокол на встречу: два параллельных «что решили» — это тот
  // же спор, только теперь письменный.
  const again = await request(base, `/api/v1/calendar-events/${event.id}/notes`, {
    cookie: owner.cookie, method: 'PUT',
    body: { decisions: [`Берём подрядчика Б ${suffix}`], actionItems: ['Заказать пересчёт сметы'] },
  });
  assert.equal(again.payload.notes.id, saved.payload.notes.id);
  assert.equal(again.payload.notes.decisions.length, 1);

  // Человеку всё равно, записывали встречу или нет: он ищет «что решили».
  const decisions = (await request(base, `/api/v1/meetings/decisions?q=${encodeURIComponent(suffix)}`, { cookie: owner.cookie })).payload.items;
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].title, `Берём подрядчика Б ${suffix}`);
  assert.equal(decisions[0].callTitle, 'Планёрка на объекте');

  // Пункт превращается в обязательство — иначе это благое намерение.
  const committed = await request(base, `/api/v1/calendar-events/${event.id}/notes/commit`, {
    cookie: owner.cookie, method: 'POST', body: { index: 0 },
  });
  assert.equal(committed.status, 201);
  assert.equal(committed.payload.task.title, 'Заказать пересчёт сметы');
  assert.match(committed.payload.task.outcome, /Планёрка на объекте/);

  const missing = await request(base, `/api/v1/calendar-events/${event.id}/notes/commit`, {
    cookie: owner.cookie, method: 'POST', body: { index: 9 },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.code, 'ACTION_ITEM_NOT_FOUND');

  // Протокол наследует видимость встречи: чужой человек её не видит, и
  // протокола тоже.
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mo-${suffix}@t.test`, role: 'member' },
  });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const outsider = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Олег', password: 'MemberPassword42' },
  });
  const peeking = await request(base, `/api/v1/calendar-events/${event.id}/notes`, { cookie: outsider.cookie });
  assert.equal(peeking.status, 404);
});
