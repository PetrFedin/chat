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
 * Ветки были наполовину: столбец писался, но не читался ни разу.
 *
 * Ответ в ветке падал в общий поток вперемешку с остальным, и разбор
 * одного вопроса растворялся в переписке дня — то есть ровно то, от
 * чего ветку и заводят.
 */
async function withServer(t) {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Ветки ${suffix}`, ownerName: 'Владелец', email: `th-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];
  const say = (body, extra = {}) => request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body, ...extra },
  });
  return { base, cookie: owner.cookie, conversation, say };
}

test('ответы в ветке не засоряют ленту и читаются отдельно',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const { base, cookie, conversation, say } = await withServer(t);

  const root = (await say('Что делаем со сметой по СГ-114?')).payload.message;
  await say('Это про другое');
  const first = (await say('Пересчитал: расхождение в бетоне', { threadRootId: root.id })).payload.message;
  await say('Согласен, правим', { threadRootId: root.id });

  const flow = (await request(base, `/api/v1/conversations/${conversation.id}/messages`, { cookie })).payload.items;
  const bodies = flow.map((m) => m.body);
  assert.ok(bodies.includes('Что делаем со сметой по СГ-114?'));
  assert.ok(bodies.includes('Это про другое'));
  // Главное: ответы остались в ветке, а не в общей ленте.
  assert.ok(!bodies.includes('Пересчитал: расхождение в бетоне'), 'ответ из ветки попал в ленту');
  assert.ok(!bodies.includes('Согласен, правим'), 'ответ из ветки попал в ленту');

  // Корень несёт счётчик — по нему видно, что разговор идёт.
  const inFlow = flow.find((m) => m.id === root.id);
  assert.equal(inFlow.replyCount, 2);
  assert.ok(inFlow.lastReplyAt);

  const thread = (await request(base, `/api/v1/conversations/${conversation.id}/messages?thread=${root.id}`, { cookie })).payload.items;
  assert.deepEqual(thread.map((m) => m.body), [
    'Что делаем со сметой по СГ-114?',
    'Пересчитал: расхождение в бетоне',
    'Согласен, правим',
  ]);
  assert.equal(thread[1].threadRootId, root.id);

  // Ветка ветки — не разговор, а лабиринт.
  const nested = await say('А внутри ответа?', { threadRootId: first.id });
  assert.equal(nested.status, 409);
  assert.equal(nested.code, 'NESTED_THREAD');

  // Удалённый ответ из счётчика уходит: счётчик обещает разговор, а не
  // историю удалений.
  await request(base, `/api/v1/messages/${first.id}`, { cookie, method: 'DELETE' });
  const after = (await request(base, `/api/v1/conversations/${conversation.id}/messages`, { cookie }))
    .payload.items.find((m) => m.id === root.id);
  assert.equal(after.replyCount, 1);
});

test('веткой нельзя открыть чужое или несуществующее сообщение',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const { base, cookie, conversation } = await withServer(t);

  const missing = await request(base,
    `/api/v1/conversations/${conversation.id}/messages?thread=00000000-0000-0000-0000-000000000001`, { cookie });
  assert.equal(missing.status, 404);
  assert.equal(missing.code, 'MESSAGE_NOT_FOUND');

  const malformed = await request(base, `/api/v1/conversations/${conversation.id}/messages?thread=нет`, { cookie });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.code, 'INVALID_MESSAGE_ID');
});
