import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';
import { codeAt, matchCode } from '../src/security/totp.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
process.env.VAULT_KEY ||= randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

async function call(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'idempotency-key': randomUUID(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

/**
 * Начатая настройка не снимает уже включённую защиту.
 *
 * «Начать настройку» перезаписывало секрет и обнуляло подтверждение, а
 * включённым второй множитель считается именно по подтверждению. Один
 * запрос — и защита снята: пароля он не спрашивал, следа в журнале не
 * оставлял, а на экране незавершённая настройка была неотличима от
 * «выключено». Человек, передумавший на полпути, оставался без второго
 * множителя и об этом не знал.
 */
test('начатая заново настройка не выключает второй множитель',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = randomUUID().slice(0, 8);
  const email = `tf-${suffix}@t.test`;

  const owner = await call(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Множитель ${suffix}`, ownerName: 'Хозяин', email, password: 'OwnerPassword42' },
  });
  const started = await call(base, '/api/v1/auth/two-factor', { cookie: owner.cookie, method: 'POST', body: {} });
  assert.equal(started.status, 201);
  const secret = started.payload.secret;
  assert.equal((await call(base, '/api/v1/auth/two-factor/confirm', {
    cookie: owner.cookie, method: 'POST',
    body: { code: codeAt(secret, Math.floor(Date.now() / 1000 / 30)) },
  })).status, 201);

  const on = await call(base, '/api/v1/auth/two-factor', { cookie: owner.cookie });
  assert.equal(on.payload.enabled, true);

  // Вот она: «начать настройку» без пароля, из уже имеющегося сеанса.
  const again = await call(base, '/api/v1/auth/two-factor', { cookie: owner.cookie, method: 'POST', body: {} });
  assert.equal(again.status, 201);
  const after = await call(base, '/api/v1/auth/two-factor', { cookie: owner.cookie });
  assert.equal(after.payload.enabled, true, 'начатая настройка сняла защиту');
  // И экран теперь отличает начатую настройку от выключенной.
  assert.equal(after.payload.startedAt, true);

  // Вход по-прежнему требует код, и код от СТАРОГО секрета: новый ещё
  // не подтверждён.
  const bare = await call(base, '/api/v1/auth/login', { method: 'POST', body: { email, password: 'OwnerPassword42' } });
  assert.equal(bare.code, 'TWO_FACTOR_REQUIRED');
  const byOld = await call(base, '/api/v1/auth/login', {
    method: 'POST',
    body: { email, password: 'OwnerPassword42', code: codeAt(secret, Math.floor(Date.now() / 1000 / 30)) },
  });
  assert.equal(byOld.status, 200, 'старый код перестал работать до подтверждения нового');
});

/**
 * Код предъявляется один раз.
 *
 * Запоминалось окно, в котором проверяли, а не то, которому код подошёл.
 * Код принимается с допуском в шаг в обе стороны, поэтому код из окна N
 * запоминался как N — и через тридцать секунд, уже в окне N+1, проходил
 * снова. Подсмотренный через плечо код жил минуту вместо «до первого
 * входа».
 */
test('код из приложения нельзя предъявить дважды', () => {
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const now = Date.now();
  const window = Math.floor(now / 1000 / 30);
  const code = codeAt(secret, window);

  // Код подошёл окну N — и это возвращается, а не «текущее окно».
  assert.equal(matchCode(secret, code, { now }), window);
  // Тот же код, предъявленный в следующем окне, всё равно опознаётся как
  // код окна N: значит, сверка «N не больше запомненного» его отсечёт.
  assert.equal(matchCode(secret, code, { now: now + 30000 }), window);
  // А через два окна он не подходит вовсе.
  assert.equal(matchCode(secret, code, { now: now + 90000 }), null);
});
