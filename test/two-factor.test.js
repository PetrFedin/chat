import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createChatServer } from '../src/server.js';
import { base32Encode, codeAt, newSecret, verifyCode } from '../src/security/totp.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
// Секрет второго множителя запечатан тем же ключом, что и сейф паролей:
// без ключа он не включается вовсе, и проверять тогда нечего.
process.env.VAULT_KEY ||= randomBytes(32).toString('base64');

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

const now = () => Math.floor(Date.now() / 1000 / 30);

/**
 * Свою реализацию TOTP проверяем чужими числами.
 *
 * Контрольные векторы RFC 6238: секрет «12345678901234567890» и четыре
 * момента времени. Если наша арифметика разъедется со стандартом, коды
 * из любого настоящего аутентификатора перестанут подходить — и узнаем
 * мы это от человека, который не может войти.
 */
test('коды сходятся с контрольными векторами RFC 6238', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(codeAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(codeAt(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(codeAt(secret, Math.floor(1234567890 / 30)), '005924');
  assert.equal(codeAt(secret, Math.floor(2000000000 / 30)), '279037');
});

/** Допуск в одно окно — и ни одним больше. */
test('код принимается в соседнем окне и не принимается в далёком', () => {
  const secret = newSecret();
  const at = Date.now();
  const window = Math.floor(at / 1000 / 30);
  assert.equal(verifyCode(secret, codeAt(secret, window), { now: at }), true);
  assert.equal(verifyCode(secret, codeAt(secret, window - 1), { now: at }), true);
  assert.equal(verifyCode(secret, codeAt(secret, window + 1), { now: at }), true);
  assert.equal(verifyCode(secret, codeAt(secret, window + 3), { now: at }), false);
  assert.equal(verifyCode(secret, '', { now: at }), false);
  assert.equal(verifyCode(secret, '12345', { now: at }), false);
});

/**
 * Пароль был единственным, что отделяло чужого человека от переписки
 * компании, сейфа с паролями и журнала действий.
 */
test('второй множитель закрывает вход и открывается кодом',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const email = `tf-${suffix}@t.test`;
  const password = 'OwnerPassword42';

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST', body: { companyName: `Вход ${suffix}`, ownerName: 'Владелец', email, password },
  });
  assert.equal(owner.status, 201);

  const before = await request(base, '/api/v1/auth/two-factor', { cookie: owner.cookie });
  assert.equal(before.payload.enabled, false);

  const started = await request(base, '/api/v1/auth/two-factor', { cookie: owner.cookie, method: 'POST' });
  assert.equal(started.status, 201);
  const secret = started.payload.secret;
  assert.match(started.payload.otpauth, /^otpauth:\/\/totp\//);

  // Пока код не подтверждён, вход не меняется: иначе человек с криво
  // настроенным приложением запирает себя снаружи своей же компании.
  const midway = await request(base, '/api/v1/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(midway.status, 200, 'неподтверждённая настройка не должна закрывать вход');

  const wrong = await request(base, '/api/v1/auth/two-factor/confirm', {
    cookie: owner.cookie, method: 'POST', body: { code: '000000' },
  });
  assert.equal(wrong.code, 'TWO_FACTOR_BAD_CODE');

  const confirmed = await request(base, '/api/v1/auth/two-factor/confirm', {
    cookie: owner.cookie, method: 'POST', body: { code: codeAt(secret, now()) },
  });
  assert.equal(confirmed.status, 201);
  assert.equal(confirmed.payload.recoveryCodes.length, 10);
  const recovery = confirmed.payload.recoveryCodes;

  const bare = await request(base, '/api/v1/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(bare.status, 401);
  // Отдельный код, а не «неверный пароль»: человек должен понимать, что
  // пароль принят и нужен код.
  assert.equal(bare.code, 'TWO_FACTOR_REQUIRED');

  const badCode = await request(base, '/api/v1/auth/login', { method: 'POST', body: { email, password, code: '000000' } });
  assert.equal(badCode.code, 'TWO_FACTOR_BAD_CODE');

  const code = codeAt(secret, now());
  const good = await request(base, '/api/v1/auth/login', { method: 'POST', body: { email, password, code } });
  assert.equal(good.status, 200);

  // Тот же код второй раз не проходит: подсмотренный через плечо код не
  // должен работать все тридцать секунд.
  const replay = await request(base, '/api/v1/auth/login', { method: 'POST', body: { email, password, code } });
  assert.equal(replay.code, 'TWO_FACTOR_BAD_CODE');
  assert.equal(replay.status, 401);

  // Телефон потерян — вход по запасному коду, и он одноразовый.
  const rescued = await request(base, '/api/v1/auth/login', { method: 'POST', body: { email, password, code: recovery[0] } });
  assert.equal(rescued.status, 200);
  const reused = await request(base, '/api/v1/auth/login', { method: 'POST', body: { email, password, code: recovery[0] } });
  assert.equal(reused.status, 401);

  const state = await request(base, '/api/v1/auth/two-factor', { cookie: good.cookie });
  assert.equal(state.payload.enabled, true);
  assert.equal(state.payload.recoveryCodesLeft, 9);

  // Снять защиту одним запросом из чужой вкладки нельзя.
  const naked = await request(base, '/api/v1/auth/two-factor', { cookie: good.cookie, method: 'DELETE', body: {} });
  assert.equal(naked.status, 403);
  assert.equal(naked.code, 'WRONG_PASSWORD');

  const off = await request(base, '/api/v1/auth/two-factor', {
    cookie: good.cookie, method: 'DELETE', body: { password },
  });
  assert.equal(off.status, 200);
  const plain = await request(base, '/api/v1/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(plain.status, 200);
});
