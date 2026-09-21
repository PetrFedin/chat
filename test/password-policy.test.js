import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, validatePassword, hashPassword, verifyPassword } from '../src/security.js';
import { createChatServer } from '../src/server.js';

/**
 * Единственные три `throw` в модуле безопасности — и ни один тест никогда
 * не подавал им плохой ввод. Если правило сломается, сервис начнёт молча
 * принимать пароль «1», и узнают об этом не раньше того, кто этим
 * воспользуется; чинить постфактум поздно — пароли уже у людей.
 */
test('слабый пароль не принимается', () => {
  const weak = ['', '1', 'короткий', 'ПарольБезЦифр', '1234567890123', 'abcdefghijkl'];
  for (const password of weak) {
    assert.throws(() => validatePassword(password), (error) => error.code === 'WEAK_PASSWORD',
      `пароль «${password}» приняли`);
  }
  assert.throws(() => validatePassword(null), (error) => error.code === 'WEAK_PASSWORD');
  assert.throws(() => validatePassword(12345678901234), (error) => error.code === 'WEAK_PASSWORD');

  // Достаточный — двенадцать символов, буквы и цифра, в любом алфавите.
  assert.equal(validatePassword('Пароль12345678'), 'Пароль12345678');
  assert.equal(validatePassword('Password1234'), 'Password1234');
});

test('почта разбирается строго', () => {
  const bad = ['', ' ', 'не почта', 'a@b', 'a@b.', '@example.com', 'a b@example.com', 'a@ example.com'];
  for (const email of bad) {
    assert.throws(() => normalizeEmail(email), (error) => error.code === 'INVALID_EMAIL', `адрес «${email}» приняли`);
  }
  assert.equal(normalizeEmail('  Пётр@Example.COM  '), 'пётр@example.com');
});

test('пароль хранится солёным и проверяется по времени', () => {
  const first = hashPassword('Password1234');
  const second = hashPassword('Password1234');
  assert.notEqual(first.hash, second.hash, 'одинаковые пароли дают одинаковый хеш — соли нет');
  assert.ok(verifyPassword('Password1234', first.salt, first.hash));
  assert.equal(verifyPassword('Password1235', first.salt, first.hash), false);
  assert.equal(verifyPassword('Password1234', second.salt, first.hash), false, 'чужая соль подошла');
});

// И то же правило на входе в продукт: регистрация компании и приём
// приглашения не должны пропускать слабый пароль.
const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

test('регистрация не заводит компанию на слабом пароле',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const send = (body) => fetch(`${base}/api/v1/auth/register-company`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  const weak = await send({ companyName: `Слабый ${suffix}`, ownerName: 'Владелец', email: `weak-${suffix}@t.test`, password: '1' });
  assert.equal(weak.status, 400);
  assert.equal((await weak.json()).error.code, 'WEAK_PASSWORD');

  const badEmail = await send({ companyName: `Почта ${suffix}`, ownerName: 'Владелец', email: 'не почта', password: 'Password1234' });
  assert.equal((await badEmail.json()).error.code, 'INVALID_EMAIL');

  const good = await send({ companyName: `Хороший ${suffix}`, ownerName: 'Владелец', email: `ok-${suffix}@t.test`, password: 'Password1234' });
  assert.equal(good.status, 201);
});
