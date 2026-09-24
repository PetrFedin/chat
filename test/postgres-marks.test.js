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

async function fixture(t) {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 8);
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Пометки ${suffix}`, ownerName: 'Владелец', email: `mark-${suffix}@granit.test`, password: 'OwnerPassword42' },
  });
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `mate-${suffix}@granit.test`, role: 'member' },
  });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const mate = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Сотрудник', password: 'OwnerPassword42' },
  });
  const boot = await request(base, '/api/v1/bootstrap', { cookie: mate.cookie });
  const room = await request(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST',
    body: { kind: 'group', title: 'Изыскания', participantIds: [boot.payload.session.userId] },
  });
  const conversationId = room.payload.conversation.id;
  const message = await request(base, `/api/v1/conversations/${conversationId}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: 'Смета вырастет на 12% из-за свай' },
  });
  return { base, owner, mate, conversationId, messageId: message.payload.message.id };
}

test('favourites cover a conversation, a message and a task', { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const { base, owner, conversationId, messageId } = await fixture(t);
  const task = await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST', body: { title: 'Пересчитать смету', ownerId: null },
  });

  const bad = await request(base, `/api/v1/favourites/unicorn/${messageId}`, { cookie: owner.cookie, method: 'PUT' });
  assert.equal(bad.code, 'INVALID_FAVOURITE_TYPE');

  for (const [type, id] of [['conversation', conversationId], ['message', messageId], ['task', task.payload.task.id]]) {
    const added = await request(base, `/api/v1/favourites/${type}/${id}`, { cookie: owner.cookie, method: 'PUT' });
    assert.equal(added.status, 200);
  }
  // Повторное добавление — не ошибка: звезда либо горит, либо нет.
  const again = await request(base, `/api/v1/favourites/message/${messageId}`, { cookie: owner.cookie, method: 'PUT' });
  assert.equal(again.status, 200);

  const listed = await request(base, '/api/v1/favourites', { cookie: owner.cookie });
  assert.equal(listed.payload.items.length, 3);
  const titles = Object.fromEntries(listed.payload.items.map((i) => [i.targetType, i.title]));
  assert.equal(titles.conversation, 'Изыскания');
  assert.equal(titles.task, 'Пересчитать смету');
  assert.match(titles.message, /Смета вырастет/);

  const onlyTasks = await request(base, '/api/v1/favourites?type=task', { cookie: owner.cookie });
  assert.equal(onlyTasks.payload.items.length, 1);

  const removed = await request(base, `/api/v1/favourites/message/${messageId}`, { cookie: owner.cookie, method: 'DELETE' });
  assert.equal(removed.payload.favourite, false);
  const after = await request(base, '/api/v1/favourites', { cookie: owner.cookie });
  assert.equal(after.payload.items.length, 2);
});

test('a highlight keeps its text, and a broken range is refused', { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const { base, owner, mate, conversationId, messageId } = await fixture(t);

  const backwards = await request(base, '/api/v1/highlights', {
    cookie: owner.cookie, method: 'POST',
    body: { conversationId, messageId, quote: 'смета', startOffset: 10, endOffset: 4 },
  });
  assert.equal(backwards.code, 'INVALID_HIGHLIGHT_RANGE');

  const mismatched = await request(base, '/api/v1/highlights', {
    cookie: owner.cookie, method: 'POST',
    body: { conversationId, messageId, quote: 'вырастет', startOffset: 0, endOffset: 3 },
  });
  assert.equal(mismatched.code, 'HIGHLIGHT_RANGE_MISMATCH');

  const wrongColour = await request(base, '/api/v1/highlights', {
    cookie: owner.cookie, method: 'POST',
    body: { conversationId, messageId, quote: 'вырастет', startOffset: 6, endOffset: 14, colour: 'чёрный' },
  });
  assert.equal(wrongColour.code, 'INVALID_HIGHLIGHT_COLOUR');

  const created = await request(base, '/api/v1/highlights', {
    cookie: owner.cookie, method: 'POST',
    body: { conversationId, messageId, quote: 'вырастет', startOffset: 6, endOffset: 14, colour: 'green' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.highlight.quote, 'вырастет');

  const mine = await request(base, `/api/v1/highlights?conversationId=${conversationId}`, { cookie: owner.cookie });
  assert.equal(mine.payload.items.length, 1);
  assert.equal(mine.payload.items[0].conversationTitle, 'Изыскания');

  // Выделение видит только тот, кто его сделал.
  const theirs = await request(base, '/api/v1/highlights', { cookie: mate.cookie });
  assert.deepEqual(theirs.payload.items, []);
  const theirDelete = await request(base, `/api/v1/highlights/${created.payload.highlight.id}`, {
    cookie: mate.cookie, method: 'DELETE',
  });
  assert.equal(theirDelete.code, 'HIGHLIGHT_NOT_FOUND');

  const removed = await request(base, `/api/v1/highlights/${created.payload.highlight.id}`, {
    cookie: owner.cookie, method: 'DELETE',
  });
  assert.equal(removed.status, 204);
});

test('a note hangs on a message and stays private', { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const { base, owner, mate, conversationId, messageId } = await fixture(t);

  const empty = await request(base, '/api/v1/message-notes', {
    cookie: owner.cookie, method: 'POST', body: { conversationId, messageId, body: '   ' },
  });
  assert.equal(empty.code, 'INVALID_NOTE');

  const created = await request(base, '/api/v1/message-notes', {
    cookie: owner.cookie, method: 'POST',
    body: { conversationId, messageId, kind: 'important', body: 'Спросить у Нины про сваи' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.note.kind, 'important');

  const listed = await request(base, '/api/v1/message-notes', { cookie: owner.cookie });
  assert.equal(listed.payload.items.length, 1);
  assert.match(listed.payload.items[0].messagePreview, /Смета вырастет/);
  assert.equal(listed.payload.items[0].conversationTitle, 'Изыскания');

  const edited = await request(base, `/api/v1/message-notes/${created.payload.note.id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { body: 'Спросить у Нины про сваи и сроки', kind: 'question' },
  });
  assert.equal(edited.payload.note.kind, 'question');
  assert.match(edited.payload.note.body, /и сроки/);

  const theirs = await request(base, '/api/v1/message-notes', { cookie: mate.cookie });
  assert.deepEqual(theirs.payload.items, [], 'чужая заметка видна');
  const theirEdit = await request(base, `/api/v1/message-notes/${created.payload.note.id}`, {
    cookie: mate.cookie, method: 'PATCH', body: { body: 'чужое' },
  });
  assert.equal(theirEdit.code, 'NOTE_NOT_FOUND');

  const removed = await request(base, `/api/v1/message-notes/${created.payload.note.id}`, {
    cookie: owner.cookie, method: 'DELETE',
  });
  assert.equal(removed.status, 204);
});

// Пометка ставится на чужую вещь, и право её поставить — это право её
// видеть. Раньше проверки не было ни одной: любой сотрудник и даже гость
// вешал заметку на сообщение из чужой личной переписки и читал его
// начало в собственном списке — сервер сам подставлял туда сто сорок
// знаков чужого текста.
test('a mark cannot reach a message the person may not see', { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const { base, owner, mate, conversationId, messageId } = await fixture(t);
  const suffix = Math.random().toString(36).slice(2, 7);
  const join = async (who, role) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: `${who}-${suffix}@t.test`, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    return request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: who, password: 'OwnerPassword42' } });
  };
  const outsider = await join('outsider', 'member');
  const guest = await join('client', 'guest');

  // Личная переписка, куда эти двое не входят.
  const bootMate = await request(base, '/api/v1/bootstrap', { cookie: mate.cookie });
  const direct = await request(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST',
    body: { kind: 'direct', title: 'Личное', participantIds: [bootMate.payload.session.userId] },
  });
  const secret = await request(base, `/api/v1/conversations/${direct.payload.conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: 'ЗАРПЛАТА обсуждается только здесь' },
  });

  for (const who of [outsider, guest]) {
    const note = await request(base, '/api/v1/message-notes', {
      cookie: who.cookie, method: 'POST',
      body: { messageId: secret.payload.message.id, conversationId: direct.payload.conversation.id, body: '.' } });
    assert.equal(note.code, 'NOT_FOUND', 'заметку повесили на чужое сообщение');

    const star = await request(base, `/api/v1/favourites/message/${secret.payload.message.id}`, {
      cookie: who.cookie, method: 'PUT' });
    assert.equal(star.code, 'NOT_FOUND', 'чужое сообщение попало в избранное');

    const highlight = await request(base, '/api/v1/highlights', {
      cookie: who.cookie, method: 'POST',
      body: { messageId: secret.payload.message.id, conversationId: direct.payload.conversation.id,
        quote: 'ЗАРПЛАТА', startOffset: 0, endOffset: 8 } });
    assert.equal(highlight.code, 'NOT_FOUND', 'чужое сообщение выделили маркером');

    const lists = JSON.stringify([
      (await request(base, '/api/v1/message-notes', { cookie: who.cookie })).payload,
      (await request(base, '/api/v1/favourites', { cookie: who.cookie })).payload,
      (await request(base, '/api/v1/highlights', { cookie: who.cookie })).payload,
    ]);
    assert.ok(!lists.includes('ЗАРПЛАТА'), 'текст чужого сообщения виден в списках пометок');
  }

  // Беседа в запросе не принимается на веру.
  const wrongRoom = await request(base, '/api/v1/message-notes', {
    cookie: owner.cookie, method: 'POST',
    body: { messageId, conversationId: direct.payload.conversation.id, body: 'не туда' } });
  assert.equal(wrongRoom.code, 'MESSAGE_NOT_IN_CONVERSATION');

  // Свой доступ не пострадал.
  const mine = await request(base, '/api/v1/message-notes', {
    cookie: owner.cookie, method: 'POST', body: { messageId, conversationId, body: 'своя заметка' } });
  assert.equal(mine.status, 201);
});
