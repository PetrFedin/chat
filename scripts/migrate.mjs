#!/usr/bin/env node
/**
 * Накатчик миграций.
 *
 * До него схема накатывалась руками: список из двадцати пяти команд psql
 * в файле сборки, а в README и .env.example стояли устаревшие диапазоны
 * («001..013», «001–015»). Узнать, что накачено на живой базе, было
 * нельзя ничем, кроме как смотреть таблицы глазами.
 *
 * Здесь три правила.
 *
 * Первое: каждая миграция применяется в своей транзакции вместе с
 * записью о ней. Оборванный посередине запуск не оставляет базу в
 * состоянии «половина применилась, а отметки нет».
 *
 * Второе: у применённой миграции запоминается отпечаток файла. Если файл
 * потом изменили, накатчик отказывается работать и говорит, какой
 * именно: правка уже применённой миграции — это расхождение между
 * средами, которое иначе всплывёт через месяц на чужой машине.
 *
 * Третье: замок на время работы. Два процесса, поднявшиеся
 * одновременно, не накатят одно и то же дважды.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, 'db/migrations');
const LOCK = 8_101_975; // произвольное, но постоянное число для advisory lock

const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export function readMigrations() {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(directory, name), 'utf8');
      return { name, sql, checksum: digest(sql) };
    });
}

export async function migrate({ databaseUrl = process.env.DATABASE_URL, log = console.log } = {}) {
  if (!databaseUrl) throw new Error('DATABASE_URL не задан: накатывать миграции некуда');
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL DEFAULT 0
    )`);

    const known = new Map((await client.query('SELECT name,checksum FROM schema_migrations')).rows
      .map((row) => [row.name, row.checksum]));

    for (const migration of readMigrations()) {
      const seen = known.get(migration.name);
      if (seen) {
        if (seen !== migration.checksum) {
          throw new Error(`Миграция ${migration.name} уже применена, но файл с тех пор изменился. `
            + 'Правка применённой миграции расходится между средами — заведите новую.');
        }
        continue;
      }
      const started = Date.now();
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations(name,checksum,duration_ms) VALUES($1,$2,$3)',
          [migration.name, migration.checksum, Date.now() - started],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Миграция ${migration.name} не применилась: ${error.message}`);
      }
      applied.push(migration.name);
      log(`применена ${migration.name} (${Date.now() - started} мс)`);
    }
    return { applied, total: known.size + applied.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    client.release();
    await pool.end();
  }
}

/** Что накачено на этой базе — чтобы не смотреть таблицы глазами. */
export async function status({ databaseUrl = process.env.DATABASE_URL } = {}) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const { rows } = await pool.query(
      "SELECT name,applied_at FROM schema_migrations ORDER BY name"
    ).catch(() => ({ rows: [] }));
    const known = new Set(rows.map((r) => r.name));
    return readMigrations().map((m) => ({ name: m.name, applied: known.has(m.name) }));
  } finally { await pool.end(); }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const command = process.argv[2] ?? 'up';
  try {
    if (command === 'status') {
      for (const row of await status()) console.log(`${row.applied ? '✓' : '·'} ${row.name}`);
    } else {
      const { applied, total } = await migrate();
      console.log(applied.length ? `накачено новых: ${applied.length}, всего: ${total}` : `всё накачено (${total})`);
    }
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
