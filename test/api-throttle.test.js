import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiThrottle } from '../src/rate-limit.js';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

/**
 * Ограничение стояло только на входе: подобрать пароль было нельзя, а
 * всё остальное не ограничивалось ничем. Вошедший клиент мог долбить
 * сервер сколько угодно — свой же, попавший в цикл переотправки, кладёт
 * базу не хуже злого умысла.
 */
test('тяжёлые запросы считаются отдельной, более узкой меркой', () => {
  const throttle = createApiThrottle({
    API_RATE_LIMIT_WINDOW_MS: '60000', API_RATE_LIMIT_MAX: '4',
    API_RATE_LIMIT_WRITE_MAX: '2', API_RATE_LIMIT_HEAVY_MAX: '1',
  });

  // Чтение.
  for (let i = 0; i < 4; i += 1) assert.equal(throttle.check('нина', 'GET', '/api/v1/me').allowed, true, `чтение ${i + 1}`);
  assert.equal(throttle.check('нина', 'GET', '/api/v1/me').allowed, false);

  // Запись дороже и считается своим счётчиком — исчерпанное чтение её не трогает.
  assert.equal(throttle.check('нина', 'POST', '/api/v1/tasks').allowed, true);
  assert.equal(throttle.check('нина', 'POST', '/api/v1/tasks').allowed, true);
  assert.equal(throttle.check('нина', 'POST', '/api/v1/tasks').allowed, false);

  // Один поиск стоит как сотня чтений, поэтому у него своя мерка.
  assert.equal(throttle.check('нина', 'GET', '/api/v1/search?q=смета').bucket, 'heavy');
  assert.equal(throttle.check('нина', 'GET', '/api/v1/search?q=смета').allowed, false);
  for (const path of ['/api/v1/digest', '/api/v1/tasks/report']) {
    assert.equal(throttle.check('олег', 'GET', path).bucket, 'heavy', `${path} должен считаться тяжёлым`);
  }

  // Считаем по человеку, а не по адресу: за одним адресом сидит целый
  // офис, и наказывать всех за одного неправильно.
  assert.equal(throttle.check('олег', 'GET', '/api/v1/me').allowed, true);

  // Неопознанный запрос сюда не попадает — им занимается ограничитель входа.
  assert.equal(throttle.check(null, 'GET', '/api/v1/me').allowed, true);
});

test('сервер отвечает 429 с Retry-After и не трогает здоровье',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({
    databaseUrl: DATABASE_URL, startMeetingWorker: false,
    apiThrottle: createApiThrottle({ API_RATE_LIMIT_WINDOW_MS: '60000', API_RATE_LIMIT_MAX: '3', API_RATE_LIMIT_HEAVY_MAX: '1' }),
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const registered = await fetch(`${base}/api/v1/auth/register-company`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ companyName: `Частота ${suffix}`, ownerName: 'Владелец', email: `rl-${suffix}@t.test`, password: 'OwnerPassword42' }),
  });
  const cookie = registered.headers.get('set-cookie').split(';')[0];

  const codes = [];
  for (let i = 0; i < 5; i += 1) codes.push((await fetch(`${base}/api/v1/me`, { headers: { cookie } })).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);

  const limited = await fetch(`${base}/api/v1/me`, { headers: { cookie } });
  assert.equal(limited.headers.get('retry-after'), '60', 'без Retry-After клиент не знает, когда повторить');
  assert.equal((await limited.json()).error.code, 'RATE_LIMITED');

  // Мониторинг не должен получать 429 за то, что опрашивает часто.
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/readyz`)).status, 200);
  // И статика тоже: ограничение касается API, а не страницы.
  assert.equal((await fetch(`${base}/`)).status, 200);

  // Отказ виден в метриках — иначе про упёршегося клиента никто не узнает.
  const metrics = await (await fetch(`${base}/metrics`)).text();
  assert.match(metrics, /chat_rate_limited_total\{bucket="normal"\}/);
});
