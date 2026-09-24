import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/persistence/store.js';
import { hashPassword, hashToken } from '../src/security.js';

const password = hashPassword('WorkspacePass42');

async function sessionFor(store, userId, workspaceId, label) {
  const tokenHash = hashToken(`session-${label}-${Math.random()}`);
  await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  return store.getSession(tokenHash);
}

async function invite(store, owner, email, displayName) {
  const tokenHash = hashToken(`invite-${email}-${Math.random()}`);
  await store.createInvitation(owner, { email, role: 'member', tokenHash, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const accepted = await store.acceptInvitation({ tokenHash, displayName, passwordHash: password.hash, passwordSalt: password.salt });
  return accepted.user.id;
}

const setup = async () => {
  const store = new MemoryStore();
  const created = await store.createCompany({
    companyName: 'Northstar', ownerName: 'Алексей Воронцов', email: 'alexey@northstar.test',
    passwordHash: password.hash, passwordSalt: password.salt,
  });
  const session = await sessionFor(store, created.user.id, created.workspace.id, 'owner');

  const people = {
    anna: await invite(store, session, 'anna@northstar.test', 'Анна'),
    annabelle: await invite(store, session, 'annabelle@northstar.test', 'Аннабель Крылова'),
    annaBelova: await invite(store, session, 'a.belova@northstar.test', 'Анна Белова'),
  };

  const conversation = await store.createConversation(session, { kind: 'channel', title: 'Общий', visibility: 'workspace' });
  return { store, session, people, conversationId: conversation.id };
};

const mentionsOf = async (store, session, conversationId, body) => {
  const message = await store.createMessage(session, conversationId, { kind: 'text', body });
  return new Set(message.mentionedUserIds ?? []);
};

// «@anna» used to fire on «@annabelle» because the match was a plain
// substring, so a name that merely starts another name pulled in the wrong
// colleague.
test('a mention matches a whole handle, not a prefix of a longer one', async () => {
  const { store, session, people, conversationId } = await setup();

  const shortHandle = await mentionsOf(store, session, conversationId, 'Привет @anna, посмотри задачу');
  assert.ok(shortHandle.has(people.anna), '«@anna» не дошло до Анны');
  assert.ok(!shortHandle.has(people.annabelle), '«@anna» задело Аннабель');

  const longHandle = await mentionsOf(store, session, conversationId, 'Привет @annabelle');
  assert.ok(longHandle.has(people.annabelle));
  assert.ok(!longHandle.has(people.anna), '«@annabelle» задело Анну');
});

// An email address in the body is not a mention: its local part is preceded by
// the address owner's name, not by a word boundary.
test('an email address in the body does not mention anyone', async () => {
  const { store, session, people, conversationId } = await setup();
  const mentions = await mentionsOf(store, session, conversationId, 'Пишите на support@anna.example');
  assert.ok(!mentions.has(people.anna), 'адрес почты создал упоминание');
});

// «@Анна Белова» ends a word after «Анна», so the shorter handle also matched
// there and named a different colleague.
test('the longest handle wins at a given position', async () => {
  const { store, session, people, conversationId } = await setup();
  const mentions = await mentionsOf(store, session, conversationId, 'Спасибо, @анна белова');
  assert.ok(mentions.has(people.annaBelova), '«@анна белова» не дошло');
  assert.ok(!mentions.has(people.anna), 'короткий хэндл перехватил длинный');
});

// An edit used to leave the original mention set untouched: a name added by an
// edit never reached that person, and a removed name kept its unread mention.
test('editing a message recomputes who it mentions', async () => {
  const { store, session, people, conversationId } = await setup();
  const message = await store.createMessage(session, conversationId, { kind: 'text', body: 'Черновик @anna' });
  assert.deepEqual(message.mentionedUserIds, [people.anna]);

  const edited = await store.editMessage(session, message.id, 'Черновик @annabelle');
  assert.deepEqual(edited.mentionedUserIds, [people.annabelle], 'правка не пересчитала упоминания');

  const reread = await store.getMessage(session, message.id);
  assert.deepEqual(reread.mentionedUserIds, [people.annabelle], 'сохранённое сообщение осталось со старым набором');
});
