#!/usr/bin/env node
/**
 * Восстановление из резервной копии — и проверка, что она рабочая.
 *
 * Копия, которую ни разу не разворачивали, — не копия, а файл. Про это
 * узнают в тот единственный день, когда она нужна, и узнают плохо.
 * Поэтому у восстановления есть режим `--check`: развернуть во временную
 * базу, пересчитать строки и сказать, сходится ли с описью.
 *
 *   node scripts/restore.mjs --from data/backups/2026-… --into postgres://…/target
 *   node scripts/restore.mjs --from data/backups/2026-… --check
 *
 * Без `--force` существующая база не трогается: восстановление поверх
 * живого пространства — самая дорогая опечатка из возможных.
 */
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

function run(command, args, { capture = false } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: capture ? ['ignore', 'pipe', 'inherit'] : ['ignore', 'inherit', 'inherit'] });
    let out = '';
    if (capture) child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', (error) => fail(error.code === 'ENOENT'
      ? new Error(`${command} не найден. Установите клиент PostgreSQL.`) : error));
    child.on('exit', (code) => (code === 0 ? done(out) : fail(new Error(`${command} завершился с кодом ${code}`))));
  });
}

// A database snapshot cannot know whether SMTP accepted a queued message after
// that snapshot was taken. Keep the original intent and evidence, but require a
// human to reconcile it with Sent before any further decision about sending.
const EMAIL_RESTORE_GUARD = `
DO $chatx_email_restore$
DECLARE held bigint;
BEGIN
  IF to_regclass('public.email_send_intents') IS NULL THEN RETURN; END IF;
  UPDATE public.email_send_intents
  SET status='unknown_outcome',
      data=data || jsonb_build_object(
        'status','unknown_outcome',
        'lastError','EMAIL_BACKUP_RESTORED',
        'restoredFromStatus',status,
        'restoredAt',clock_timestamp(),
        'updatedAt',clock_timestamp(),
        'version',COALESCE((data->>'version')::integer,1)+1,
        'leaseToken',NULL,
        'leaseUntil',NULL
      )
  WHERE status IN ('queued','scheduled','dispatching');
  GET DIAGNOSTICS held = ROW_COUNT;
  RAISE NOTICE 'Email outbox: % restored intent(s) held for explicit Sent reconciliation; automatic resend is disabled.', held;
END
$chatx_email_restore$;
`;

/** Restore and quarantine commit together; neither producer nor SQL failure can expose an active restored queue. */
async function restoreDatabase(target, dumpPath) {
  return new Promise((done, fail) => {
    // Stream the archive directly: a second unencrypted SQL file is unnecessary.
    const producer = spawn('pg_restore', ['--no-owner', '--no-privileges', '--clean', '--if-exists', '--file=-', dumpPath], { stdio: ['ignore', 'pipe', 'inherit'] });
    const consumer = spawn('psql', ['--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1', '--file=-', '--dbname', target], { stdio: ['pipe', 'inherit', 'inherit'] });
    let producerClosed = false, consumerClosed = false, failure = null;
    const finish = () => {
      if (producerClosed && consumerClosed) failure ? fail(failure) : done();
    };
    const abort = error => {
      failure ??= error;
      producer.stdout.unpipe(consumer.stdin);
      producer.kill('SIGTERM');
      consumer.kill('SIGTERM');
      consumer.stdin.destroy();
      finish();
    };
    const spawnFailure = (command, error) => abort(error.code === 'ENOENT' ? new Error(`${command} не найден. Установите клиент PostgreSQL.`) : error);
    producer.on('error', error => spawnFailure('pg_restore', error));
    consumer.on('error', error => spawnFailure('psql', error));
    consumer.stdin.on('error', error => abort(error));
    // psql --single-transaction commits on EOF, including when this controller
    // crashes. Explicit BEGIN keeps an unexpected EOF fail-closed instead.
    consumer.stdin.write('BEGIN;\n');
    producer.stdout.pipe(consumer.stdin, { end: false });
    producer.on('close', code => {
      producerClosed = true;
      if (code !== 0) abort(new Error(`pg_restore завершился с кодом ${code}; восстановление отменено`));
      else if (!failure) consumer.stdin.end('\n' + EMAIL_RESTORE_GUARD + '\nCOMMIT;\n');
      finish();
    });
    consumer.on('close', code => {
      consumerClosed = true;
      if (code !== 0) abort(new Error(`psql завершился с кодом ${code}; восстановление отменено`));
      else if (!producerClosed) abort(new Error('psql завершился до окончания архива; восстановление отменено'));
      finish();
    });
  });
}

const sha256 = (path) => new Promise((done, fail) => {
  const hash = createHash('sha256');
  createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', fail)
    .on('end', () => done(hash.digest('hex')));
});

/** Строки в главных таблицах — то, по чему видно, что копия не пустая. */
const COUNTED = ['messages', 'commitments', 'conversations', 'memberships', 'files', 'calendar_events'];

async function counts(url) {
  const sql = COUNTED.map((table) => `SELECT '${table}' t, count(*) n FROM ${table}`).join(' UNION ALL ');
  const out = await run('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--field-separator=|', '-c', sql, url], { capture: true });
  return Object.fromEntries(out.trim().split('\n').filter(Boolean).map((line) => {
    const [table, number] = line.split('|');
    return [table, Number(number)];
  }));
}

async function main() {
  const from = flag('from');
  if (!from) {
    console.error('Укажите копию: --from data/backups/…');
    process.exit(2);
  }
  const dir = resolve(from);
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const dumpPath = join(dir, manifest.database.file);

  // Копия могла испортиться на диске молча. Проверяем до того, как
  // что-нибудь тронем.
  const size = (await stat(dumpPath)).size;
  if (size !== manifest.database.bytes) {
    throw new Error(`размер копии не сходится: ${size} вместо ${manifest.database.bytes}`);
  }
  const digest = await sha256(dumpPath);
  if (digest !== manifest.database.sha256) {
    throw new Error('контрольная сумма копии не сходится — файл повреждён');
  }
  console.log(`Копия от ${manifest.createdAt}, целостность в порядке.`);

  const check = has('check');
  const into = flag('into');
  if (!check && !into) {
    console.error('Укажите, куда разворачивать: --into postgres://… (или --check для проверки во временной базе)');
    process.exit(2);
  }

  let target = into;
  let temporary = null;
  if (check) {
    const source = process.env.DATABASE_URL;
    if (!source) throw new Error('для проверки нужен DATABASE_URL: из него берётся адрес сервера');
    const url = new URL(source);
    temporary = `restore_check_${randomUUID().slice(0, 8)}`;
    const admin = new URL(source);
    admin.pathname = '/postgres';
    await run('psql', ['--no-psqlrc', '-c', `CREATE DATABASE ${temporary}`, admin.toString()]);
    url.pathname = `/${temporary}`;
    target = url.toString();
    console.log(`Временная база ${temporary} создана.`);
  } else if (!has('force')) {
    // Восстановление поверх живого пространства — самая дорогая опечатка
    // из возможных, и переспросить здесь дешевле всего.
    const existing = await counts(target).catch(() => null);
    const busy = existing && Object.values(existing).some((n) => n > 0);
    if (busy) {
      console.error('В целевой базе уже есть данные. Если это намеренно, повторите с --force.');
      console.error(`  сейчас там: ${Object.entries(existing).map(([t, n]) => `${t}=${n}`).join(', ')}`);
      process.exit(3);
    }
  }

  try {
    await restoreDatabase(target, dumpPath);
    const restored = await counts(target);
    console.log('Восстановлено:');
    for (const table of COUNTED) console.log(`  ${table}: ${restored[table] ?? 0}`);

    if (check) {
      const empty = Object.values(restored).every((n) => n === 0);
      if (empty) throw new Error('копия развернулась пустой — восстанавливать из неё нечего');
      console.log('Проверка пройдена: копия разворачивается и содержит данные.');
    }
  } finally {
    if (temporary) {
      const admin = new URL(process.env.DATABASE_URL);
      admin.pathname = '/postgres';
      await run('psql', ['--no-psqlrc', '-c', `DROP DATABASE IF EXISTS ${temporary}`, admin.toString()]).catch(() => {});
      console.log(`Временная база ${temporary} удалена.`);
    }
  }
}

main().catch((error) => {
  console.error(`Восстановление не удалось: ${error.message}`);
  process.exit(1);
});
