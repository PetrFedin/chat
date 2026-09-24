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
    body: { companyName: `Закрытые ${suffix}`, ownerName: 'Владелец', email: `cu-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invite = async (role, mail, displayName) => {
    const invitation = await request(base, '/api/v1/invitations', { cookie: owner.cookie, method: 'POST', body: { email: mail, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const accepted = await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName, password: 'MemberPassword42' },
    });
    const boot = await request(base, '/api/v1/bootstrap', { cookie: accepted.cookie });
    return { cookie: accepted.cookie, id: boot.payload.session.userId };
  };
  return { base, owner, invite };
}

/**
 * Закрытое подразделение.
 *
 * Юридический отдел, служба безопасности, группа под сделку — там сам
 * список участников и есть тайна. Схема же была целиком открытой:
 * любой сотрудник видел все отделы, их состав и руководителей.
 *
 * Уговор такой: имя, замок и число людей видно всем — за места платит
 * компания, и прятать сам факт существования нельзя. Состав, назначение
 * и руководитель — только тем, кто внутри.
 */
test('закрытое подразделение: снаружи видно имя и счёт, внутренности — нет',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner, invite } = await company(t, suffix);
  const lawyer = await invite('manager', `cl-${suffix}@t.test`, 'Ирина Юрист');
  const outsider = await invite('member', `co-${suffix}@t.test`, 'Олег Посторонний');

  // Юрист заводит свой отдел закрытым и становится его руководителем.
  const created = await request(base, '/api/v1/org/units', {
    cookie: lawyer.cookie, method: 'POST',
    body: { kind: 'division', name: 'Юридический отдел', purpose: 'Сделка с подрядчиком', visibility: 'closed' },
  });
  assert.equal(created.status, 201, `отдел не создался: ${created.code}`);
  const unit = created.payload.unit;
  assert.equal(unit.closed, true);
  assert.equal(unit.headUserId, lawyer.id, 'заводящий закрытый отдел не стал его руководителем');

  await request(base, `/api/v1/org/units/${unit.id}/members`, {
    cookie: lawyer.cookie, method: 'POST', body: { userId: outsider.id, role: 'member' },
  });
  await request(base, `/api/v1/org/units/${unit.id}/members/${outsider.id}`, { cookie: lawyer.cookie, method: 'DELETE' });

  // Владелец видит, что отдел есть и сколько в нём людей — но не более.
  const chart = (await request(base, '/api/v1/org/units', { cookie: owner.cookie })).payload.items;
  const seen = chart.find((item) => item.id === unit.id);
  assert.ok(seen, 'закрытый отдел пропал из схемы: владелец не увидит занятых мест');
  assert.equal(seen.closed, true);
  assert.equal(seen.inside, false);
  assert.equal(seen.seats.used, 1, 'число людей должно быть видно — за места платит компания');
  assert.equal(seen.headUserId, null, 'руководитель закрытого отдела виден снаружи');
  assert.equal(seen.purpose, null, 'назначение закрытого отдела видно снаружи');

  // Состав — только изнутри.
  const outside = await request(base, `/api/v1/org/units/${unit.id}/members`, { cookie: owner.cookie });
  assert.equal(outside.status, 404, 'владелец получил состав закрытого отдела');
  const inside = await request(base, `/api/v1/org/units/${unit.id}/members`, { cookie: lawyer.cookie });
  assert.equal(inside.status, 200);
  assert.deepEqual(inside.payload.items.map((x) => x.userId), [lawyer.id]);

  // И по одному человеку состав тоже не собрать: карточка не выдаёт
  // закрытые подразделения того, на кого смотрят.
  const card = await request(base, `/api/v1/org/people/${lawyer.id}/chain`, { cookie: owner.cookie });
  assert.equal(card.payload.units.length, 0, 'карточка человека выдала его закрытый отдел');
  const own = await request(base, `/api/v1/org/people/${lawyer.id}/chain`, { cookie: lawyer.cookie });
  assert.equal(own.payload.units.length, 1, 'человек не видит собственный закрытый отдел');
});

/**
 * Права на всё пространство не должны быть отмычкой: если владелец
 * вправе вписать в закрытый отдел кого угодно — в том числе себя, — то
 * закрытости не существует.
 */
test('состав закрытого подразделения меняют только изнутри',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner, invite } = await company(t, suffix);
  const lawyer = await invite('manager', `sl-${suffix}@t.test`, 'Ирина Юрист');
  const helper = await invite('member', `sh-${suffix}@t.test`, 'Павел Помощник');
  const ownerId = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.session.userId;

  const unit = (await request(base, '/api/v1/org/units', {
    cookie: lawyer.cookie, method: 'POST', body: { kind: 'division', name: 'Служба безопасности', visibility: 'closed' },
  })).payload.unit;

  // Владелец не может вписать туда ни себя, ни кого-то ещё.
  const selfAdd = await request(base, `/api/v1/org/units/${unit.id}/members`, {
    cookie: owner.cookie, method: 'POST', body: { userId: ownerId, role: 'member' },
  });
  assert.equal(selfAdd.status, 403, 'владелец вписал себя в закрытый отдел');
  const otherAdd = await request(base, `/api/v1/org/units/${unit.id}/members`, {
    cookie: owner.cookie, method: 'POST', body: { userId: helper.id, role: 'member' },
  });
  assert.equal(otherAdd.status, 403);

  // А руководитель отдела — может.
  const byHead = await request(base, `/api/v1/org/units/${unit.id}/members`, {
    cookie: lawyer.cookie, method: 'POST', body: { userId: helper.id, role: 'member' },
  });
  assert.equal(byHead.status, 201);

  // Открытое подразделение прежних правил не теряет: им управляет тот,
  // у кого права на оргструктуру.
  const open = (await request(base, '/api/v1/org/units', {
    cookie: owner.cookie, method: 'POST', body: { kind: 'division', name: 'Снабжение' },
  })).payload.unit;
  assert.equal(open.closed, false);
  const openAdd = await request(base, `/api/v1/org/units/${open.id}/members`, {
    cookie: owner.cookie, method: 'POST', body: { userId: helper.id, role: 'member' },
  });
  assert.equal(openAdd.status, 201, 'владелец перестал управлять открытым подразделением');
});

/**
 * Дальше по схеме: закрытость не должна ломать остальное. Владелец
 * по-прежнему отвечает за штат — переименовать и распустить отдел он
 * вправе, и след об этом остаётся в журнале.
 */
test('закрытый отдел остаётся частью компании: его можно переименовать и распустить',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner, invite } = await company(t, suffix);
  const lawyer = await invite('manager', `dl-${suffix}@t.test`, 'Ирина Юрист');

  const unit = (await request(base, '/api/v1/org/units', {
    cookie: lawyer.cookie, method: 'POST', body: { kind: 'division', name: 'Комиссия', visibility: 'closed' },
  })).payload.unit;

  const renamed = await request(base, `/api/v1/org/units/${unit.id}`, {
    cookie: owner.cookie, method: 'PATCH', body: { name: 'Рабочая комиссия' },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.payload.unit.name, 'Рабочая комиссия');
  // Переименование не открывает внутренностей.
  assert.equal(renamed.payload.unit.headUserId, null);

  const removed = await request(base, `/api/v1/org/units/${unit.id}`, { cookie: owner.cookie, method: 'DELETE' });
  assert.equal(removed.status, 204);
  const chart = (await request(base, '/api/v1/org/units', { cookie: owner.cookie })).payload.items;
  assert.equal(chart.some((item) => item.id === unit.id), false);
});

/**
 * Список приглашений не должен обходить закрытость.
 *
 * Приглашение помнит подразделение, а список ожидающих видит всякий,
 * кто вправе звать. Если бы он называл закрытый отдел, состав такого
 * отдела собирался бы по приглашениям — по одному человеку за раз.
 */
test('в списке ожидающих закрытый отдел не называется тому, кто в нём не состоит',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const { base, owner, invite } = await company(t, suffix);
  const lawyer = await invite('manager', `il-${suffix}@t.test`, 'Ирина Юрист');

  const unit = (await request(base, '/api/v1/org/units', {
    cookie: lawyer.cookie, method: 'POST', body: { kind: 'division', name: 'Юридический отдел', visibility: 'closed' },
  })).payload.unit;

  const sent = await request(base, '/api/v1/invitations', {
    cookie: lawyer.cookie, method: 'POST',
    body: { email: `tajna-${suffix}@granit.test`, role: 'member', unitId: unit.id },
  });
  assert.equal(sent.status, 201);

  const find = (items) => items.find((i) => i.email === `tajna-${suffix}@granit.test`);

  const inside = find((await request(base, '/api/v1/invitations', { cookie: lawyer.cookie })).payload.items);
  assert.equal(inside.unitName, 'Юридический отдел');
  assert.equal(inside.unitId, unit.id);

  const outside = find((await request(base, '/api/v1/invitations', { cookie: owner.cookie })).payload.items);
  assert.ok(outside, 'приглашение вовсе пропало из списка — владелец не увидит занятых мест');
  assert.equal(outside.unitName, null, 'название закрытого отдела видно снаружи');
  assert.equal(outside.unitId, null, 'опознаватель закрытого отдела видно снаружи');
  // Но что отдел закрытый — сказать можно: это объясняет, почему пусто.
  assert.equal(outside.unitClosed, true);
});
