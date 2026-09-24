import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

async function request(base, path, { cookie, method = 'GET', body, key } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, replay: response.headers.get('idempotent-replay'), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

// Сервер умел отличать повтор от нового действия с самого начала, а клиент
// ключа не посылал: оборванная сеть превращала одно нажатие в две задачи.
test('повтор с тем же ключом не создаёт вторую задачу',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Повтор ${suffix}`, ownerName: 'Владелец', email: `own-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const key = `key-${suffix}`;
  const body = { title: `Задача ${suffix}`, outcome: 'Готово' };

  const first = await request(base, '/api/v1/tasks', { cookie: owner.cookie, method: 'POST', body, key });
  assert.equal(first.status, 201);
  const again = await request(base, '/api/v1/tasks', { cookie: owner.cookie, method: 'POST', body, key });
  assert.equal(again.status, 201);
  assert.equal(again.replay, 'true', 'второй раз сервер возвращает первый ответ');
  assert.equal(again.payload.task.id, first.payload.task.id);

  const tasks = (await request(base, '/api/v1/tasks', { cookie: owner.cookie })).payload.items
    .filter((task) => task.title === body.title);
  assert.equal(tasks.length, 1, 'в списке ровно одна задача');

  // Тот же ключ на другое действие — отказ, а не тихая подмена ответа.
  const different = await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST', body: { title: 'Совсем другое' }, key });
  assert.equal(different.status, 409);

  // И клиент этот ключ действительно посылает.
  const client = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(client, /'Idempotency-Key'\]=/);
  assert.match(client, /WRITE_METHODS/);
});
