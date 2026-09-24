import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

async function company(base, suffix) {
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Приём ${suffix}`, ownerName: 'Директор', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invite = async (tag, name, role = 'member') => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: `${tag}-${suffix}@t.test`, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const session = await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: name, password: 'OwnerPassword42' } });
    const me = await request(base, '/api/v1/me', { cookie: session.cookie });
    return { cookie: session.cookie, userId: me.payload.userId };
  };
  return { owner, invite };
}

/**
 * Каталог каналов.
 *
 * Уйти из канала было можно, вернуться — нет: маршрута не существовало.
 * Человек оставался «здесь по видимости», без строки участника, и
 * единственным выходом было попросить кого-нибудь добавить его обратно.
 */
test('каталог каналов и вход обратно',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const { owner, invite } = await company(base, suffix);
  const worker = await invite('nina', 'Нина');

  const open = (await request(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST',
    body: { kind: 'channel', title: 'Стройка СГ-114', purpose: 'Ход работ и акты', visibility: 'workspace' } })).payload.conversation;
  const secret = (await request(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST',
    body: { kind: 'channel', title: 'Дирекция', purpose: 'Только для руководства', visibility: 'private' } })).payload.conversation;

  const catalogue = (await request(base, '/api/v1/conversations/catalogue', { cookie: worker.cookie })).payload.items;
  const found = catalogue.find((c) => c.id === open.id);
  assert.ok(found, 'открытого канала нет в каталоге');
  assert.equal(found.purpose, 'Ход работ и акты', 'каталог без описания — тот же список названий');
  assert.equal(found.member, true, 'в открытые каналы сотрудник попадает сразу');
  assert.ok(found.memberCount >= 2);
  // Приватного канала для непосвящённого не существует: ни строкой, ни
  // намёком. Само его название — тоже сведения.
  assert.equal(catalogue.some((c) => c.id === secret.id), false, 'приватный канал попал в каталог');

  // Ушёл — и вернулся сам.
  assert.equal((await request(base, `/api/v1/conversations/${open.id}/leave`, {
    cookie: worker.cookie, method: 'POST' })).status, 200);
  const afterLeave = (await request(base, '/api/v1/conversations/catalogue', { cookie: worker.cookie }))
    .payload.items.find((c) => c.id === open.id);
  assert.equal(afterLeave.member, false);

  assert.equal((await request(base, `/api/v1/conversations/${open.id}/join`, {
    cookie: worker.cookie, method: 'POST' })).status, 200);
  const afterJoin = (await request(base, '/api/v1/conversations/catalogue', { cookie: worker.cookie }))
    .payload.items.find((c) => c.id === open.id);
  assert.equal(afterJoin.member, true, 'вернуться в канал не удалось');
  // Дважды войти — не ошибка и не второй участник.
  assert.equal((await request(base, `/api/v1/conversations/${open.id}/join`, {
    cookie: worker.cookie, method: 'POST' })).status, 200);
  assert.equal((await request(base, '/api/v1/conversations/catalogue', { cookie: worker.cookie }))
    .payload.items.find((c) => c.id === open.id).memberCount, afterJoin.memberCount);

  // В приватный канал не войти, и отказ не выдаёт его существования.
  assert.equal((await request(base, `/api/v1/conversations/${secret.id}/join`, {
    cookie: worker.cookie, method: 'POST' })).status, 404);

  // Поиск ищет и по описанию, а не только по названию.
  const byPurpose = (await request(base, '/api/v1/conversations/catalogue?q=акты', { cookie: worker.cookie })).payload.items;
  assert.equal(byPurpose.some((c) => c.id === open.id), true);
  assert.equal((await request(base, '/api/v1/conversations/catalogue?q=такогонет', { cookie: worker.cookie })).payload.items.length, 0);

  // Гость каталога компании не видит вовсе.
  const guest = await (async () => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: `guest-${suffix}@client.test`, role: 'guest' } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    return request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: 'Заказчик', password: 'GuestPassword42' } });
  })();
  assert.deepEqual((await request(base, '/api/v1/conversations/catalogue', { cookie: guest.cookie })).payload.items, []);
  assert.equal((await request(base, `/api/v1/conversations/${open.id}/join`, {
    cookie: guest.cookie, method: 'POST' })).status, 403);
});

/**
 * Первые шаги.
 *
 * Шаги выводятся из настоящего состояния, а не отмечаются нажатием:
 * мастер настройки, где галочки ставит сам пользователь, врёт с первого
 * экрана — человек «прошёл онбординг», не сделав ничего.
 */
test('первые шаги отмечаются делом, а не нажатием',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const { owner, invite } = await company(base, suffix);
  const channel = (await request(base, '/api/v1/conversations', {
    cookie: owner.cookie, method: 'POST',
    body: { kind: 'channel', title: 'Стройка', purpose: 'Объект', visibility: 'workspace' } })).payload.conversation;
  const newcomer = await invite('petr', 'Пётр');

  const at = async (cookie) => (await request(base, '/api/v1/onboarding', { cookie })).payload.onboarding;
  const step = (state, id) => state.steps.find((s) => s.id === id);

  let state = await at(newcomer.cookie);
  assert.ok(state, 'новому человеку не показали первые шаги');
  assert.equal(state.left, 4);
  // Членство в открытых каналах выдаётся само — значит, отмечать шаг по
  // нему нельзя: он был бы закрыт ещё до первого экрана.
  assert.equal(step(state, 'channels').done, false, 'шаг отмечен до того, как человек что-либо сделал');
  assert.equal(step(state, 'profile').done, false);

  // Должность — и шаг закрывается сам.
  assert.equal((await request(base, `/api/v1/people/${newcomer.userId}`, {
    cookie: newcomer.cookie, method: 'PATCH', body: { title: 'Сметчик' } })).status, 200);
  state = await at(newcomer.cookie);
  assert.equal(step(state, 'profile').done, true, 'заполненная должность не закрыла шаг');

  // Открыл канал — закрылся второй.
  await request(base, `/api/v1/conversations/${channel.id}/read`, { cookie: newcomer.cookie, method: 'POST', body: {} });
  state = await at(newcomer.cookie);
  assert.equal(step(state, 'channels').done, true);

  // Написал — закрылся третий.
  await request(base, `/api/v1/conversations/${channel.id}/messages`, {
    cookie: newcomer.cookie, method: 'POST', body: { body: 'Всем привет, я Пётр' } });
  state = await at(newcomer.cookie);
  assert.equal(step(state, 'hello').done, true);

  // Последний шаг закрывается первым обязательством — и вместе с ним
  // исчезает вся карточка: доделывать нечего.
  await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST', body: { title: 'Свести смету', ownerId: newcomer.userId } });
  assert.equal(await at(newcomer.cookie), null, 'подсказка осталась, когда все шаги сделаны');

  // Тот, кто закрыл подсказку, больше её не видит.
  const other = await invite('olga', 'Ольга');
  assert.ok(await at(other.cookie));
  assert.deepEqual((await request(base, '/api/v1/onboarding/dismiss', { cookie: other.cookie, method: 'POST' })).payload,
    { dismissed: true });
  assert.equal(await at(other.cookie), null);

  // Гостю про устройство чужой компании рассказывать нечего.
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `guest-${suffix}@client.test`, role: 'guest' } });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const guest = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Заказчик', password: 'GuestPassword42' } });
  assert.equal(await at(guest.cookie), null);
});

test('каталог и первые шаги есть в интерфейсе', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(html, /data-action="catalogue"/, 'из боковой панели каталог не открыть');
  assert.match(app, /catalogue:\(\)=>catalogueModal\(\)/);
  assert.match(app, /data-catalogue-join/);
  assert.match(app, /onboardingSection\(\)/);
  assert.match(app, /loadOnboarding\(\)/);
  assert.match(app, /api\('\/api\/v1\/onboarding\/dismiss',\{method:'POST'\}\)/);

  // Сетка строки рассчитана на «значок, текст, действие»; строка без
  // значка выталкивала кнопку за край экрана.
  assert.match(css, /\.row\.flow\{display:flex/);
  assert.match(app, /class="row flow"/);
});
