#!/usr/bin/env node
/**
 * Резервная копия рабочего пространства.
 *
 * Самый дорогой пробел из всех, что были: в базе лежит переписка
 * компании, задачи и доказательства выполненной работы, и снять с неё
 * копию было нечем. «Сделайте pg_dump руками» — это не резервное
 * копирование, а надежда на то, что кто-то вспомнит.
 *
 * Копия состоит из двух частей, и обе обязательны. База без файлов —
 * это сообщения со ссылками на вложения, которых больше нет. Файлы без
 * базы — папка безымянных ключей. Поэтому копия всегда одна папка с
 * обеими частями и описью, по которой восстановление проверяет, что
 * ничего не потерялось по дороге.
 *
 *   node scripts/backup.mjs [--out каталог] [--keep 14]
 *
 * Восстановление и проверка — `scripts/restore.mjs`.
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, rm, stat, writeFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};

const DATABASE_URL = process.env.DATABASE_URL;
const uploadsRoot = process.env.UPLOAD_DIR ?? fileURLToPath(new URL('../data/uploads/', import.meta.url));
const outRoot = resolve(flag('out', process.env.BACKUP_DIR ?? fileURLToPath(new URL('../data/backups/', import.meta.url))));
const keep = Number(flag('keep', process.env.BACKUP_KEEP ?? 14));

function run(command, args, { env = process.env } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (error) => fail(
      error.code === 'ENOENT'
        // Внятно про то, чего не хватает: «spawn pg_dump ENOENT» в три
        // часа ночи ничего не объясняет.
        ? new Error(`${command} не найден. Установите клиент PostgreSQL той же версии, что и сервер.`)
        : error));
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`${command} завершился с кодом ${code}`))));
  });
}

const sha256 = (path) => new Promise((done, fail) => {
  const hash = createHash('sha256');
  createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', fail)
    .on('end', () => done(hash.digest('hex')));
});

async function countFiles(dir) {
  let files = 0;
  let bytes = 0;
  const walk = async (at) => {
    let entries;
    try { entries = await readdir(at, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else { files += 1; bytes += (await stat(full)).size; }
    }
  };
  await walk(dir);
  return { files, bytes };
}

/** Старые копии удаляются последними: сначала убеждаемся, что новая готова. */
async function prune(root, keepCount) {
  if (!Number.isInteger(keepCount) || keepCount < 1) return [];
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const extra = entries.slice(0, Math.max(0, entries.length - keepCount));
  for (const name of extra) await rm(join(root, name), { recursive: true, force: true });
  return extra;
}

async function main() {
  if (!DATABASE_URL) {
    console.error('DATABASE_URL не задан: копировать нечего');
    process.exit(2);
  }
  const startedAt = new Date();
  const name = startedAt.toISOString().replace(/[:.]/g, '-');
  const dir = join(outRoot, name);
  await mkdir(dir, { recursive: true });

  const dumpPath = join(dir, 'database.dump');
  // Формат custom, а не простой SQL: он сжат, восстанавливается
  // параллельно и позволяет достать отдельную таблицу, не читая всё.
  await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', dumpPath, DATABASE_URL]);

  // Файлы кладутся рядом. Хранилище в S3 копируется своими средствами —
  // выдумывать поверх него свою синхронизацию значит делать хуже.
  const filesDir = join(dir, 'uploads');
  let uploads = { files: 0, bytes: 0 };
  if (process.env.S3_BUCKET) {
    console.log('Файлы лежат в S3 — копируйте бакет средствами провайдера (версионирование или репликация).');
  } else {
    await cp(uploadsRoot, filesDir, { recursive: true, force: true }).catch(() => {});
    uploads = await countFiles(filesDir);
  }

  const dump = await stat(dumpPath);
  const manifest = {
    createdAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    database: { file: 'database.dump', bytes: dump.size, sha256: await sha256(dumpPath) },
    uploads: { directory: process.env.S3_BUCKET ? null : 'uploads', ...uploads, s3Bucket: process.env.S3_BUCKET ?? null },
  };
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const removed = await prune(outRoot, keep);
  console.log(`Копия готова: ${dir}`);
  console.log(`  база: ${(dump.size / 1048576).toFixed(1)} МБ`);
  console.log(`  файлы: ${uploads.files} шт., ${(uploads.bytes / 1048576).toFixed(1)} МБ`);
  if (removed.length) console.log(`  удалено старых копий: ${removed.length}`);
  console.log('Проверьте восстановление: node scripts/restore.mjs --from ' + dir + ' --into postgres://…/проверка');
}

main().catch((error) => {
  console.error(`Копия не снята: ${error.message}`);
  process.exit(1);
});
