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

/**
 * Настройка обязана что-то менять.
 *
 * Переключатель, который сохраняется, но не влияет на рассылку, хуже
 * его отсутствия: человек считает, что выключил шум, и перестаёт
 * смотреть в приложение.
 */
test('выключенный переключатель действительно останавливает push',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const sent = [];
  const app = await createChatServer({
    databaseUrl: DATABASE_URL, startMeetingWorker: false,
    // Подменяем только отправку: воронка, настройки и выборка адресатов
    // остаются настоящими.
    push: { enabled: true, publicKey: 'test' },
    sendPush: (subscription, payload) => { sent.push({ subscription, payload }); },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Тишина ${suffix}`, ownerName: 'Владелец', email: `np-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `nina-${suffix}@t.test`, role: 'member' } });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const nina = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Нина', password: 'OwnerPassword42' } });
  const ninaId = (await request(base, '/api/v1/me', { cookie: nina.cookie })).payload.userId;

  // Умолчание — всё включено: человек, который ничего не настраивал,
  // должен получать уведомления, а не тишину.
  const defaults = (await request(base, '/api/v1/notification-preferences', { cookie: nina.cookie })).payload.preferences;
  for (const name of ['mentions', 'direct', 'channels', 'tasks', 'calendar', 'meetings']) {
    assert.equal(defaults[name], true, `по умолчанию ${name} должен быть включён`);
  }
  assert.equal(defaults.quietFrom, null);

  const saved = await request(base, '/api/v1/notification-preferences', {
    cookie: nina.cookie, method: 'PUT',
    body: { mentions: true, direct: true, channels: false, tasks: true, calendar: true, meetings: true } });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.preferences.channels, false);

  // Одна граница без второй — не интервал.
  assert.equal((await request(base, '/api/v1/notification-preferences', {
    cookie: nina.cookie, method: 'PUT', body: { quietFrom: 22 } })).code, 'INVALID_QUIET_HOURS');
  assert.equal((await request(base, '/api/v1/notification-preferences', {
    cookie: nina.cookie, method: 'PUT', body: { quietFrom: 25, quietTo: 8 } })).code, 'INVALID_QUIET_HOURS');

  await request(base, '/api/v1/push-subscriptions', {
    cookie: nina.cookie, method: 'POST',
    body: { endpoint: `https://push.test/${suffix}`, keys: { p256dh: 'k'.repeat(87), auth: 'a'.repeat(22) } } });

  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];
  sent.length = 0;
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: 'Обычное сообщение в канале' } });
  assert.equal(sent.length, 0, 'сообщение в канале ушло человеку, который их выключил');

  // А упоминание — проходит: это другой класс события.
  sent.length = 0;
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST',
    body: { body: 'Нина, посмотрите смету', mentionedUserIds: [ninaId] } });
  assert.equal(sent.length, 1, 'упоминание не дошло, хотя переключатель упоминаний включён');
  assert.match(sent[0].payload.title, /упомянул/);

  // Тихие часы: ставим интервал, накрывающий текущий час в поясе
  // человека, и проверяем, что молчит всё, кроме личного обращения.
  const hourNow = new Date().getUTCHours();
  await request(base, '/api/v1/notification-preferences', {
    cookie: nina.cookie, method: 'PUT',
    body: { mentions: true, direct: true, channels: true, tasks: true, calendar: true, meetings: true,
      quietFrom: hourNow, quietTo: (hourNow + 2) % 24, quietAllowMentions: true } });

  sent.length = 0;
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: 'Сообщение в тихий час' } });
  assert.equal(sent.length, 0, 'в тихий час пришло обычное сообщение');

  sent.length = 0;
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST',
    body: { body: 'Нина, срочно', mentionedUserIds: [ninaId] } });
  assert.equal(sent.length, 1, 'из тишины обязан быть выход: личное обращение проходит');

  // А если выход закрыть — тишина полная.
  await request(base, '/api/v1/notification-preferences', {
    cookie: nina.cookie, method: 'PUT',
    body: { mentions: true, direct: true, channels: true, tasks: true, calendar: true, meetings: true,
      quietFrom: hourNow, quietTo: (hourNow + 2) % 24, quietAllowMentions: false } });
  sent.length = 0;
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST',
    body: { body: 'Нина, ещё раз', mentionedUserIds: [ninaId] } });
  assert.equal(sent.length, 0, 'закрытый выход из тишины всё равно пропустил уведомление');

  // Сняли тихие часы — всё снова приходит.
  await request(base, '/api/v1/notification-preferences', {
    cookie: nina.cookie, method: 'PUT',
    body: { mentions: true, direct: true, channels: true, tasks: true, calendar: true, meetings: true,
      quietFrom: null, quietTo: null } });
  sent.length = 0;
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: 'Рабочее время' } });
  assert.equal(sent.length, 1, 'после снятия тихих часов уведомления должны вернуться');
});

test('настройки уведомлений есть в интерфейсе', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /id="notify-form"/);
  assert.match(app, /api\('\/api\/v1\/notification-preferences'\)/);
  assert.match(app, /method:'PUT'/);
  assert.match(app, /const NOTIFY_SWITCHES=\[/);
  // Обещать в интерфейсе то, чего нет в настройке, нельзя.
  assert.doesNotMatch(app, /по выходным push не приходит/);
});
