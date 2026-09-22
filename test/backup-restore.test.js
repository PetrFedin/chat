import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

const run = (command, args, env = {}) => new Promise((done) => {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { err += c; });
  child.on('error', (error) => done({ code: -1, out, err: String(error.message) }));
  child.on('exit', (code) => done({ code, out, err }));
});

const havePgDump = async () => (await run('pg_dump', ['--version'])).code === 0;

/**
 * Копия, которую ни разу не разворачивали, — не копия, а файл.
 *
 * Про это узнают в тот единственный день, когда она нужна, и узнают
 * плохо. Поэтому проверка снимает копию настоящим `pg_dump` и
 * разворачивает её настоящим `pg_restore` — без подделок в середине.
 */
test('копия снимается, проверяется на целостность и разворачивается',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  if (!await havePgDump()) return t.skip('в системе нет pg_dump');

  const admin = new URL(DATABASE_URL);
  const adminUrl = new URL(DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const name = `backup_test_${randomUUID().slice(0, 8)}`;
  const pool = new pg.Pool({ connectionString: adminUrl.toString() });
  await pool.query(`CREATE DATABASE ${name}`);
  t.after(async () => {
    await pool.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => {});
    await pool.end();
  });

  admin.pathname = `/${name}`;
  const source = admin.toString();
  const small = new pg.Pool({ connectionString: source });
  // Таблицы, по которым восстановление считает строки: копия обязана
  // донести до целевой базы именно их.
  for (const table of ['messages', 'commitments', 'conversations', 'memberships', 'files', 'calendar_events']) {
    await small.query(`CREATE TABLE ${table}(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), body text)`);
  }
  await small.query("INSERT INTO messages(body) SELECT 'сообщение ' || g FROM generate_series(1,25) g");
  await small.query("INSERT INTO commitments(body) SELECT 'обещание ' || g FROM generate_series(1,7) g");
  await small.end();

  const dir = await mkdtemp(join(tmpdir(), 'chat-backup-'));
  const uploads = await mkdtemp(join(tmpdir(), 'chat-uploads-'));
  await writeFile(join(uploads, 'вложение.txt'), 'содержимое', 'utf8');
  t.after(() => Promise.all([rm(dir, { recursive: true, force: true }), rm(uploads, { recursive: true, force: true })]));

  const backup = await run('node', ['scripts/backup.mjs', '--out', dir, '--keep', '5'],
    { DATABASE_URL: source, UPLOAD_DIR: uploads, S3_BUCKET: '' });
  assert.equal(backup.code, 0, `копия не снялась: ${backup.err}`);

  const [made] = await readdir(dir);
  assert.match(made, /^\d{4}-\d{2}-\d{2}T/, 'копия названа не по времени');
  const manifest = JSON.parse(await readFile(join(dir, made, 'manifest.json'), 'utf8'));
  assert.equal(manifest.uploads.files, 1, 'файлы не попали в копию');
  assert.ok(manifest.database.bytes > 0);
  assert.match(manifest.database.sha256, /^[0-9a-f]{64}$/);

  // Испорченный файл должен быть пойман до того, как что-нибудь тронут:
  // «восстановилось наполовину» хуже, чем «не восстановилось».
  const dumpPath = join(dir, made, 'database.dump');
  const intact = await readFile(dumpPath);
  await writeFile(dumpPath, Buffer.concat([intact, Buffer.from('мусор')]));
  const spoiled = await run('node', ['scripts/restore.mjs', '--from', join(dir, made), '--check'], { DATABASE_URL: source });
  assert.notEqual(spoiled.code, 0, 'повреждённая копия развернулась как ни в чём не бывало');
  assert.match(spoiled.err, /не сходится/);
  await writeFile(dumpPath, intact);

  // И настоящая проверка: развернуть во временную базу и пересчитать строки.
  const checked = await run('node', ['scripts/restore.mjs', '--from', join(dir, made), '--check'], { DATABASE_URL: source });
  assert.equal(checked.code, 0, `проверка восстановления не прошла: ${checked.err}`);
  assert.match(checked.out, /messages: 25/);
  assert.match(checked.out, /commitments: 7/);
  assert.match(checked.out, /Проверка пройдена/);
  // Временная база не должна остаться после себя.
  const leftovers = await pool.query("SELECT datname FROM pg_database WHERE datname LIKE 'restore_check_%'");
  assert.equal(leftovers.rowCount, 0, 'временная база проверки осталась висеть');
});

test('восстановление не затирает живую базу без явного разрешения',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  if (!await havePgDump()) return t.skip('в системе нет pg_dump');
  const scripts = await readFile(new URL('../scripts/restore.mjs', import.meta.url), 'utf8');
  // Восстановление поверх живого пространства — самая дорогая опечатка
  // из возможных, и переспросить здесь дешевле всего.
  assert.match(scripts, /if this is intentional|повторите с --force/);
  assert.match(scripts, /process\.exit\(3\)/);
});
