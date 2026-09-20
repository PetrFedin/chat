import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readMigrations, migrate, status } from '../scripts/migrate.mjs';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

test('every migration is readable and has a checksum', () => {
  const list = readMigrations();
  assert.ok(list.length >= 25, `миграций найдено ${list.length}`);
  // Имена задают порядок: он должен быть однозначным.
  const numbers = list.map((m) => m.name.slice(0, 3));
  assert.deepEqual(numbers, [...numbers].sort(), 'миграции не выстраиваются по имени');
  assert.equal(new Set(numbers).size, numbers.length, 'два файла с одним номером');
  for (const m of list) assert.match(m.checksum, /^[0-9a-f]{16}$/);
});

// Инструкции разошлись с реальностью однажды («001..013» против 25) —
// пусть больше не расходятся: README не называет диапазон, он называет
// команду.
test('the instructions point at the runner, not at a range that rots', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(readme, /npm run migrate/);
  assert.doesNotMatch(readme, /миграции `001`[–-]`0\d\d`/, 'README снова называет диапазон миграций');
  assert.doesNotMatch(env, /001\.\.0\d\d/, '.env.example снова называет диапазон миграций');
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /npm run migrate/, 'сборка накатывает схему не накатчиком');
  assert.doesNotMatch(ci, /db\/migrations\/0\d\d_/, 'в сборке снова перечислены миграции поимённо');
});

test('the runner applies, is idempotent and refuses a changed migration',
  { skip: !DATABASE_URL && 'нет базы' }, async () => {
  const { Pool } = await import('pg');
  const admin = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const name = `chat_mig_${Math.random().toString(36).slice(2, 8)}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = DATABASE_URL.replace(/\/[^/]*$/, `/${name}`);
  try {
    const first = await migrate({ databaseUrl: url, log: () => {} });
    assert.ok(first.applied.length >= 25, 'миграции не применились');

    const again = await migrate({ databaseUrl: url, log: () => {} });
    assert.deepEqual(again.applied, [], 'повторный запуск накатил что-то ещё раз');

    const state = await status({ databaseUrl: url });
    assert.ok(state.every((row) => row.applied), 'состояние показывает ненакаченные миграции');

    // Правка уже применённой миграции расходится между средами.
    const pool = new Pool({ connectionString: url, max: 1 });
    await pool.query("UPDATE schema_migrations SET checksum='0000000000000000' WHERE name=(SELECT min(name) FROM schema_migrations)");
    await pool.end();
    await assert.rejects(() => migrate({ databaseUrl: url, log: () => {} }),
      (error) => /файл с тех пор изменился/.test(error.message));
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  }
});
