import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createLabelRepository } from '../src/labels/label-repository.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

async function sessionFor(store, userId, workspaceId, role = 'owner') {
  const tokenHash = hashToken(`cursor-${randomUUID()}`);
  await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  return store.getSession(tokenHash);
}

async function company(pool) {
  const store = new PostgresStore(pool);
  const suffix = randomUUID().slice(0, 8);
  const password = hashPassword('WorkspacePass42');
  const created = await store.createCompany({
    companyName: `Курсор ${suffix}`, ownerName: 'Владелец',
    email: `cursor-${suffix}@t.test`, passwordHash: password.hash, passwordSalt: password.salt,
  });
  const owner = await sessionFor(store, created.user.id, created.workspace.id);
  const tokenHash = hashToken(`cursor-invite-${randomUUID()}`);
  await store.createInvitation(owner, {
    email: `colleague-${suffix}@t.test`, role: 'member', tokenHash,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const accepted = await store.acceptInvitation({
    tokenHash, displayName: 'Коллега', passwordHash: password.hash, passwordSalt: password.salt,
  });
  const colleague = await sessionFor(store, accepted.user.id, owner.workspaceId);
  return { store, owner, colleague };
}

/**
 * Отметка «прочитано до сообщения» не должна съедать то, что пришло позже.
 *
 * Человек открыл беседу, прочёл до середины и ушёл на встречу. Клиент
 * честно сообщил, до какого сообщения дочитано, — а сервер записывал
 * границей чтения `now()`. Всё, что накопилось после названного
 * сообщения, молча становилось прочитанным: счётчик обнулялся, беседа
 * уходила вниз списка, и тридцать сообщений никто больше не открывал.
 */
test('прочитано до середины — остальное остаётся непрочитанным',
  { skip: !databaseUrl && 'нет базы' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const { store, owner, colleague } = await company(pool);
  const general = (await store.listConversations(owner)).find((c) => c.slug === 'general');

  const say = (body) => store.createMessage(colleague, general.id, {
    kind: 'text', body, replyToId: null, threadRootId: null, metadata: {}, clientRequestId: null, mentionedUserIds: [],
  });
  const first = await say('первое');
  await say('второе');
  const third = await say('третье');
  await say('четвёртое');
  await say('пятое');

  const before = (await store.listConversations(owner)).find((c) => c.id === general.id);
  assert.equal(before.unreadCount, 5, 'пять чужих сообщений должны быть непрочитанными');

  await store.markRead(owner, general.id, third.id);
  const after = (await store.listConversations(owner)).find((c) => c.id === general.id);
  assert.equal(after.unreadCount, 2, 'отметка до третьего сообщения съела четвёртое и пятое');

  // А отметка до первого возвращает непрочитанными четыре: граница ходит
  // и назад — этим же способом человек помечает беседу непрочитанной.
  await store.markRead(owner, general.id, first.id);
  const back = (await store.listConversations(owner)).find((c) => c.id === general.id);
  assert.equal(back.unreadCount, 4);

  // Без названного сообщения отметка по-прежнему значит «всё прочитано».
  await store.markRead(owner, general.id);
  const all = (await store.listConversations(owner)).find((c) => c.id === general.id);
  assert.equal(all.unreadCount, 0);
});

/**
 * Метка не вешается на то, чего нет.
 *
 * Проверку проходили сообщение, файл, задача и беседа, а встреча, человек
 * и запись личного плана — нет: метку принимал любой опознаватель, в том
 * числе выдуманный. В списке метки такая связь показывалась строкой с
 * пустым названием, и снять её было неоткуда — объекта, с которого
 * снимают метку, не существует.
 */
test('метка не ложится на выдуманный объект',
  { skip: !databaseUrl && 'нет базы' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const { store, owner } = await company(pool);
  const labels = createLabelRepository(pool, store);
  const label = await labels.createLabel(owner, { kind: 'tag', name: `Метка ${randomUUID().slice(0, 6)}` });
  const ghost = randomUUID();

  for (const targetType of ['event', 'person', 'note', 'task', 'conversation', 'message', 'file']) {
    await assert.rejects(
      () => labels.apply(owner, label.id, targetType, ghost),
      (error) => error.code === 'TARGET_NOT_FOUND',
      `${targetType}: метка легла на несуществующий объект`,
    );
  }

  const targets = await labels.targetsOf(owner, label.id);
  assert.equal(targets.length, 0, 'в списке метки остались связи с пустыми названиями');
});
