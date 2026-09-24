import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
process.env.VAULT_KEY ||= randomBytes(32).toString('base64');

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

async function company(t, suffix) {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Журнал ${suffix}`, ownerName: 'Анна', email: `jo-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invite = async (role, mail, displayName) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: mail, role },
    });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const accepted = await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName, password: 'MemberPassword42' },
    });
    const boot = await request(base, '/api/v1/bootstrap', { cookie: accepted.cookie });
    return { cookie: accepted.cookie, id: boot.payload.session.userId };
  };
  return { app, base, owner, invite };
}

/**
 * Кто завёл отдел, кого туда поставил и кто назначил начальника — ровно
 * то, ради чего журнал и держат. Оргструктура менялась бесследно.
 */
test('изменения оргструктуры и появление бесед попадают в журнал',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner, invite } = await company(t, suffix);
  const igor = await invite('member', `ji-${suffix}@t.test`, 'Игорь');

  const unit = (await request(base, '/api/v1/org/units', {
    cookie: owner.cookie, method: 'POST', body: { kind: 'division', name: 'Отдел аналитики', seatLimit: 6 },
  })).payload.unit;
  await request(base, `/api/v1/org/units/${unit.id}/members`, {
    cookie: owner.cookie, method: 'POST', body: { userId: igor.id, role: 'head' },
  });
  await request(base, `/api/v1/org/units/${unit.id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { name: 'Аналитика и отчётность' },
  });
  await request(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST', body: { kind: 'channel', title: 'Аналитика', visibility: 'workspace' },
  });
  await request(base, `/api/v1/org/units/${unit.id}/members/${igor.id}`, { cookie: owner.cookie, method: 'DELETE' });

  const journal = (await request(base, '/api/v1/audit?limit=50', { cookie: owner.cookie })).payload.items;
  const kinds = journal.map((event) => event.eventType);
  for (const expected of ['org.unit.created', 'org.unit.head_appointed', 'org.unit.updated',
    'org.unit.member_removed', 'conversation.created']) {
    assert.ok(kinds.includes(expected), `в журнале нет «${expected}»`);
  }
  // Запись должна говорить, что именно поменяли, а не «что-то поменяли».
  const renamed = journal.find((event) => event.eventType === 'org.unit.updated');
  assert.equal(renamed.payload.changed.name, 'Аналитика и отчётность');
  const appointed = journal.find((event) => event.eventType === 'org.unit.head_appointed');
  assert.equal(appointed.payload.userId, igor.id);
});

/**
 * Сейф заявлен как личное хранилище, а в журнале видно, кто и когда
 * доставал оттуда пароль. Руководителю отдела это знать незачем: его
 * дело — работа отдела, а не чужие замки.
 */
test('записи о сейфе и входах видит владелец и сам человек, но не руководитель',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner, invite } = await company(t, suffix);
  const boss = await invite('manager', `jm-${suffix}@t.test`, 'Игорь');

  const entry = (await request(base, '/api/v1/vault', {
    cookie: owner.cookie, method: 'POST', body: { title: 'Банк-клиент', secret: 'очень-секретно' },
  })).payload.entry;
  await request(base, `/api/v1/vault/${entry.id}/secret`, { cookie: owner.cookie, method: 'POST', body: {} });

  const kindsFor = async (cookie) => (await request(base, '/api/v1/audit?limit=100', { cookie }))
    .payload.items.map((event) => event.eventType);

  const mine = await kindsFor(owner.cookie);
  assert.ok(mine.includes('vault.revealed'), 'владелец не видит собственный журнал сейфа');
  assert.ok(mine.includes('invitation.issued'));

  const theirs = await kindsFor(boss.cookie);
  assert.ok(!theirs.includes('vault.revealed'), 'руководитель видит, кто доставал пароль из чужого сейфа');
  assert.ok(!theirs.some((kind) => kind.startsWith('auth.') && kind !== 'auth.login.succeeded'),
    'руководителю видны чужие события входа');
  // Работа компании ему по-прежнему видна — резать надо личное, а не всё.
  assert.ok(theirs.includes('invitation.issued'), 'руководитель перестал видеть приглашения');

  // Про себя человек видит всё: это его собственные замки. Приглашённый
  // входит по ссылке, поэтому события входа у него ещё не было — делаем
  // настоящий вход.
  const again = await request(base, '/api/v1/auth/login', {
    method: 'POST', body: { email: `jm-${suffix}@t.test`, password: 'MemberPassword42' },
  });
  const own = (await request(base, '/api/v1/audit?limit=100', { cookie: again.cookie }))
    .payload.items.filter((event) => event.eventType === 'auth.login.succeeded');
  assert.equal(own.length, 1, 'человек видит не только свои входы');
});

/**
 * «Два новых», когда в самой беседе видно одно, — это не подсказка, а
 * повод искать несуществующее: второе сообщение лежит в ветке.
 */
test('сводка считает ленту и ветки отдельно',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner, invite } = await company(t, suffix);
  const mate = await invite('member', `jd-${suffix}@t.test`, 'Олег');
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];

  const root = (await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: 'Собираем отчёт' },
  })).payload.message;
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: 'Подробности внутри', threadRootId: root.id },
  });
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: 'И ещё одна мысль', threadRootId: root.id },
  });

  const digest = (await request(base, '/api/v1/digest', { cookie: mate.cookie })).payload;
  const room = digest.busiest.find((item) => item.id === conversation.id);
  assert.ok(room, 'беседа не попала в сводку');
  // Одно в ленте и два в ветке — именно так, как человек увидит, когда откроет.
  assert.equal(room.newMessages, 1);
  assert.equal(room.newInThreads, 2);
});
