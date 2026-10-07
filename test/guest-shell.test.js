import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createChatServer } from '../src/server.js';
import { Permission, ROLE_PERMISSIONS, hasPermission } from '../src/rbac.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const VAULT_KEY = process.env.VAULT_KEY;

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const dailyWork = readFileSync(new URL('../public/daily-work.js', import.meta.url), 'utf8');

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
 * Гость — представитель заказчика в чужом рабочем пространстве.
 *
 * Сейф ему предлагали наравне со всеми: личные пароли отправлялись в базу
 * подрядчика, под его ключом шифрования, с раскрытием в его журнале. Это
 * не ограничение доступа, а приглашение сложить своё в чужой сейф.
 */
test('личный сейф — сотрудникам компании, не гостю', () => {
  assert.equal(hasPermission('guest', Permission.VAULT_USE), false);
  for (const role of ['owner', 'admin', 'manager', 'member']) {
    assert.equal(hasPermission(role, Permission.VAULT_USE), true, `${role} остался без сейфа`);
  }
  assert.ok(ROLE_PERMISSIONS.guest.size > 0, 'у гостя должны остаться свои права');
});

test('сейф отказывает гостю на самом маршруте, а не только плиткой',
  { skip: (!DATABASE_URL && 'нет базы') || (!VAULT_KEY && 'нет ключа сейфа') }, async (t) => {
  const app_ = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app_.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app_.close());
  const base = `http://127.0.0.1:${app_.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Гость ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `guest-${suffix}@client.test`, role: 'guest' } });
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const guest = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token, displayName: 'Заказчик', password: 'GuestPassword42' } });

  for (const [method, body] of [['GET', undefined], ['POST', { title: 'Почта', secret: 'S3cret!!' }]]) {
    const answer = await request(base, '/api/v1/vault', { cookie: guest.cookie, method, body });
    // Не 403: отказ с названием права рассказал бы подрядчику, что у
    // компании вообще есть хранилище паролей. Гость видит свою комнату —
    // всё остальное отвечает ему как несуществующий адрес.
    assert.equal(answer.status, 404, `сейф ответил гостю ${answer.status} на ${method}`);
    assert.equal(answer.code, 'NOT_FOUND');
  }
  // Владельцу сейф при этом открыт — иначе проверка доказывала бы поломку.
  assert.equal((await request(base, '/api/v1/vault', { cookie: owner.cookie })).status, 200);

  // Задачи и календарь гость и раньше не мог заводить — здесь это закреплено,
  // потому что интерфейс теперь строится ровно на этих отказах.
  assert.equal((await request(base, '/api/v1/tasks', {
    cookie: guest.cookie, method: 'POST', body: { title: 'проба' } })).status, 404);
  assert.equal((await request(base, '/api/v1/calendar-events', {
    cookie: guest.cookie, method: 'POST',
    body: { title: 'проба', startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3600e3).toISOString() } })).status, 404);
});

/**
 * Оболочка гостя.
 *
 * Гость видел две вкладки, которые не наполнятся ничем и никогда, строку
 * быстрого захвата, роняющую 403 на первой же попытке, и два счётчика
 * задач с вечными нулями.
 */
test('гостю не показывают то, чего сервер ему не даст', () => {
  assert.match(app, /const GUEST_HIDDEN_VIEWS=new Set\(\['tasks','calendar'\]\)/);
  assert.match(app, /const visibleNav=\(\)=>guestShell\(\)\?nav\.filter/);
  assert.match(app, /function navs\(\)\{const html=visibleNav\(\)/,
    'нижнее меню снова строится из полного списка разделов');

  // Адрес — тоже вход: по #/tasks гость попадал на вечно пустой экран.
  assert.match(app, /if\(guestShell\(\)&&\(GUEST_HIDDEN_VIEWS\.has\(v\)\|\|v==='projects'\)\)\{v='today'/);\n  assert.match(app, /if\(parts\[0\]==='projects'&&parts\[1\]\)\{if\(guestShell\(\)\)\{go\('today'/);

  // Строки быстрого захвата на главной больше нет: на телефоне у неё
  // пряталась кнопка, и панель выглядела нерабочей. Создание живёт в
  // «＋» в шапке — он виден всем, включая гостя, и открывает лист, где
  // недоступное гостю просто не показано.
  assert.doesNotMatch(app, /data-quick-form/, 'строка быстрого захвата вернулась на главную');
  assert.match(app, /\$\{can\('vault\.use'\)\?`<button class="module-card pressable" data-action="vault"/);
  assert.match(app, /const agendaSection=\(events,agendaTitle,agendaHint,dayEnd\)=>calendarVisible\(\)/);
  assert.match(app, /const myTasksSection=\(active\)=>tasksVisible\(\)/);
  assert.match(dailyWork, /\$\{taskCountsVisible\(\)\?`/, 'счётчики задач снова показывают гостю нули');
  assert.match(app, /window\.ChatApp=\{[^}]*role:\(\)=>me\(\)\?\.role\?\?null/,
    'daily-work.js спрашивает роль у ChatApp — без неё счётчики вернутся');

  // Строка внимания сжимается до двух карточек, значит и сетка должна.
  const css = readFileSync(new URL('../public/daily-work.css', import.meta.url), 'utf8');
  assert.match(css, /\.dwc-attention-strip\{display:grid;grid-template-columns:repeat\(auto-fit/);
});
