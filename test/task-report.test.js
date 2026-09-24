import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createChatServer } from '../src/server.js';
import { reportRange } from '../src/task/task-report.js';

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

test('отрезок отчёта: умолчание, порядок границ, мусор', () => {
  const week = reportRange({ from: '2026-09-01', to: '2026-09-08' });
  assert.equal(week.from, new Date('2026-09-01').toISOString());
  const byDefault = reportRange({});
  const days = (Date.parse(byDefault.to) - Date.parse(byDefault.from)) / 86400000;
  assert.ok(Math.abs(days - 30) < 0.01, `по умолчанию ожидались тридцать дней, вышло ${days}`);
  assert.throws(() => reportRange({ from: '2026-09-08', to: '2026-09-01' }), (e) => e.code === 'INVALID_RANGE');
  assert.throws(() => reportRange({ from: 'позавчера' }), (e) => e.code === 'INVALID_DATE');
});

/**
 * Главная цифра продукта.
 *
 * Весь смысл задач-как-обязательств в том, держит ли человек слово. До
 * сих пор продукт не мог ответить: в строке есть обещанный срок и
 * текущее состояние, а момента закрытия не было вовсе.
 */
test('отчёт считает обещания, сроки и просрочку',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const day = 86400000;

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Отчёт ${suffix}`, ownerName: 'Директор', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const join = async (tag, name) => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: `${tag}-${suffix}@t.test`, role: 'member' } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const session = await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: name, password: 'OwnerPassword42' } });
    const me = await request(base, '/api/v1/me', { cookie: session.cookie });
    return { cookie: session.cookie, userId: me.payload.userId };
  };
  const nina = await join('nina', 'Нина');
  const oleg = await join('oleg', 'Олег');

  const make = async (ownerId, title, dueIn) => (await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST',
    body: { title, ownerId, promisedAt: new Date(Date.now() + dueIn).toISOString() } })).payload.task;
  const move = async (cookie, id, to, extra = {}) => {
    const current = (await request(base, `/api/v1/tasks/${id}`, { cookie })).payload.task;
    return request(base, `/api/v1/tasks/${id}/transitions`, {
      cookie, method: 'POST', body: { to, expectedVersion: current.version, reason: 'ход', ...extra } });
  };
  const closeIt = async (holder, id) => {
    const version = (await request(base, `/api/v1/tasks/${id}`, { cookie: holder.cookie })).payload.task.version;
    await request(base, `/api/v1/tasks/${id}/evidence`, {
      cookie: holder.cookie, method: 'POST', body: { type: 'note', value: 'сделано', expectedVersion: version } });
    for (const to of ['in_review']) assert.equal((await move(holder.cookie, id, to)).status, 200, `не удался переход в ${to}`);
    for (const to of ['accepted_result', 'closed']) assert.equal((await move(owner.cookie, id, to)).status, 200, `не удался переход в ${to}`);
  };

  // Нина: одно закрыто с опозданием на двое суток, одно просрочено и в
  // работе, одно ждёт её ответа.
  const late = await make(nina.userId, 'Свести акты', -2 * day);
  await move(nina.cookie, late.id, 'accepted');
  await move(nina.cookie, late.id, 'in_progress');
  await closeIt(nina, late.id);

  const running = await make(nina.userId, 'Сверка', -5 * day);
  await move(nina.cookie, running.id, 'accepted');
  await move(nina.cookie, running.id, 'in_progress');
  await make(nina.userId, 'Отчёт по расходам', 3 * day);

  // Олег: одно закрыто в срок.
  const onTime = await make(oleg.userId, 'Смета', 5 * day);
  await move(oleg.cookie, onTime.id, 'accepted');
  await move(oleg.cookie, onTime.id, 'in_progress');
  await closeIt(oleg, onTime.id);

  const report = (await request(base, '/api/v1/tasks/report', { cookie: owner.cookie })).payload;
  assert.equal(report.scope, 'team');
  assert.equal(report.totals.created, 4);
  assert.equal(report.totals.closed, 2);
  assert.equal(report.totals.promised, 2, 'оба закрытых обязательства имели срок');
  assert.equal(report.totals.onTime, 1, 'ровно одно закрыто до обещанного срока');
  assert.equal(report.totals.keptPromises, 50);
  assert.equal(report.totals.open, 2);
  assert.equal(report.totals.overdue, 1, 'просрочено то, что в работе и с прошедшим сроком');
  assert.equal(report.totals.awaitingAnswer, 1, 'одному человеку предложили и он ещё не ответил');
  assert.ok(report.totals.oldestOverdueSec >= 4 * 86400, 'возраст самой старой просрочки посчитан неверно');

  const byName = Object.fromEntries(report.people.map((p) => [p.displayName, p]));
  assert.equal(byName['Нина'].closed, 1);
  assert.equal(byName['Нина'].keptPromises, 0, 'Нина закрыла своё единственное обещание с опозданием');
  assert.ok(byName['Нина'].avgLateHours >= 47 && byName['Нина'].avgLateHours <= 49,
    `опоздание должно быть около двух суток, посчитано ${byName['Нина'].avgLateHours}`);
  assert.equal(byName['Олег'].keptPromises, 100);
  assert.equal(byName['Олег'].avgLateHours, 0, 'у того, кто не опаздывал, среднего опоздания нет');
  // Гостей в отчёте о людях компании быть не должно, и их там нет —
  // но и тех, кто в компании есть, пропускать нельзя.
  assert.equal(report.people.length, 3, 'в отчёте должны быть все трое, включая того, у кого нет задач');
  assert.equal(byName['Директор'].open, 0);

  // Кто кого просит: все четыре обязательства выдал директор.
  assert.equal(report.pairs.reduce((sum, pair) => sum + pair.count, 0), 4);

  // Сотрудник без права вести чужие задачи видит только себя — даже если
  // попросит отчёт по всей компании.
  const hers = (await request(base, '/api/v1/tasks/report?scope=team', { cookie: nina.cookie })).payload;
  assert.equal(hers.scope, 'mine', 'сотруднику отдали отчёт по всей компании');
  assert.deepEqual(hers.people.map((p) => p.displayName), ['Нина']);
  assert.equal(hers.totals.created, 3, 'в её отчёте только её обязательства');

  // Отрезок времени работает: до всех этих событий ничего не было.
  const before = (await request(base,
    `/api/v1/tasks/report?from=${new Date(Date.now() - 400 * day).toISOString()}&to=${new Date(Date.now() - 300 * day).toISOString()}`,
    { cookie: owner.cookie })).payload;
  assert.equal(before.totals.created, 0);
  assert.equal(before.totals.closed, 0);
  assert.equal(before.totals.keptPromises, null, 'без обещаний доля не ноль процентов, а ничего');
  // Открытое считается на сейчас, а не на конец отрезка: вопрос «сколько
  // висит» не про прошлое.
  assert.equal(before.totals.open, 2);

  assert.equal((await request(base, '/api/v1/tasks/report?from=завтра', { cookie: owner.cookie })).status, 400);

  // Гость не носит обязательств и отчёта о них не получает.
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `guest-${suffix}@client.test`, role: 'guest' } });
  const guestToken = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const guest = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token: guestToken, displayName: 'Заказчик', password: 'GuestPassword42' } });
  assert.equal((await request(base, '/api/v1/tasks/report', { cookie: guest.cookie })).status, 403);
});

test('отчёт есть в интерфейсе, а не только в API', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-action="report"/, 'плитка отчёта пропала из «Ещё»');
  assert.match(app, /report:\(\)=>reportModal\(\)/);
  assert.match(app, /api\(`\/api\/v1\/tasks\/report\?\$\{query\}`\)/);
  // Ноль процентов и «никто не обещал срок» — разные вещи, и интерфейс
  // обязан их различать.
  assert.match(app, /t\.keptPromises===null/);
  // Гостю отчёта не показывают — у него не бывает обязательств.
  assert.match(app, /\$\{tasksVisible\(\)\?`<button class="module-card pressable" data-action="report"/);
});
