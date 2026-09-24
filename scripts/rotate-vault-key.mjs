#!/usr/bin/env node
/**
 * Смена ключа, которым запечатан сейф.
 *
 * Ключом `VAULT_KEY` запечатаны пароли компании и секреты второго
 * множителя. Сменить его было нечем — а ключ, который нельзя сменить,
 * не меняют никогда: он живёт в переменной окружения до первого
 * увольнения человека, который его видел.
 *
 * Порядок такой, и он не требует остановки:
 *
 *   1. Сгенерировать новый ключ:   node scripts/rotate-vault-key.mjs --new-key
 *   2. В окружении: VAULT_KEY=<новый>, VAULT_KEY_PREVIOUS=<прежний>.
 *      Перезапустить. Новое пишется новым ключом, прежнее читается
 *      прежним — сейф работает всё это время.
 *   3. Переписать хранимое:        node scripts/rotate-vault-key.mjs
 *   4. Убрать VAULT_KEY_PREVIOUS. Перезапустить.
 *
 * Шаг 3 идёт частями и может прерваться: номер поколения в строке
 * говорит, что уже переписано, и повторный запуск продолжает с того же
 * места, а не с начала.
 *
 * Проверить, не осталось ли чего на прежнем ключе:
 *   node scripts/rotate-vault-key.mjs --check
 */
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { open, readVaultKeys, seal } from '../src/vault/vault-repository.js';

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const BATCH = 200;

if (has('new-key')) {
  // Ключ печатается один раз и только сюда: в переменную окружения его
  // переносит человек. Записывать его в журнал или в базу нельзя.
  console.log(randomBytes(32).toString('base64'));
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Нужен DATABASE_URL.');
  process.exit(2);
}

const { key, previous } = readVaultKeys();
if (!key) {
  console.error('Нужен VAULT_KEY — 32 байта в base64. Новый можно получить: node scripts/rotate-vault-key.mjs --new-key');
  process.exit(2);
}

/**
 * Отпечаток ключа — им помечаются переписанные строки.
 *
 * Тридцать один бит от хеша: столбец целочисленный, а совпадение двух
 * отпечатков на паре ключей не меняет сохранность — «--check» проверяет
 * не пометки, а то, что строка действительно открывается.
 */
const keyVersion = (value) => createHash('sha256').update(value).digest().readUInt32BE(0) & 0x7fffffff;

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const readers = [key, previous].filter(Boolean);

/**
 * Одна таблица с запечатанным столбцом.
 *
 * Переписываем построчно и в своей транзакции на каждую порцию: одна
 * длинная транзакция на весь сейф держит блокировки ровно столько,
 * сколько идёт переписывание, и мешает работать всем остальным.
 */
async function rotate(table, { id, secret, version, label }) {
  // Поколение считаем от самого ключа, а не «максимум плюс один»:
  // иначе после первого прохода все строки снова оказываются
  // «старыми», и каждый следующий запуск переписывает сейф целиком —
  // а запускают его снова именно потому, что прошлый мог прерваться.
  const target = keyVersion(key);
  let done = 0;
  let failed = 0;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT ${id} id, ${secret} secret FROM ${table} WHERE ${version} <> $1 LIMIT ${BATCH}`,
      [target],
    );
    if (!rows.length) break;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        let plain;
        try { plain = open(readers, row.secret); } catch {
          // Строку, которую не открыть ни одним ключом, не трогаем и не
          // прячем: подменить её нечем, а молча пропустить — значит
          // однажды обнаружить потерю при следующей смене.
          failed += 1;
          await client.query(`UPDATE ${table} SET ${version} = $2 WHERE ${id} = $1`, [row.id, target]);
          console.error(`  не открылась строка ${row.id}`);
          continue;
        }
        await client.query(
          `UPDATE ${table} SET ${secret} = $2, ${version} = $3 WHERE ${id} = $1`,
          [row.id, seal(key, plain), target],
        );
        done += 1;
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally { client.release(); }
    process.stdout.write(`  ${label}: ${done}\r`);
  }
  console.log(`  ${label}: переписано ${done}${failed ? `, не открылось ${failed}` : ''}`);
  return { done, failed };
}

/** Сколько строк ещё открывается только прежним ключом. */
async function check() {
  if (!previous) {
    console.log('VAULT_KEY_PREVIOUS не задан — проверять нечего: всё читается нынешним ключом или не читается вовсе.');
  }
  let stale = 0;
  let broken = 0;
  for (const [table, id, secret] of [['vault_entries', 'id', 'secret'], ['auth_totp', 'user_id', 'secret']]) {
    const { rows } = await pool.query(`SELECT ${id} id, ${secret} secret FROM ${table}`);
    for (const row of rows) {
      try { open([key], row.secret); } catch {
        try { open([previous].filter(Boolean), row.secret); stale += 1; }
        catch { broken += 1; console.error(`  не открывается ни одним ключом: ${table} ${row.id}`); }
      }
    }
  }
  console.log(stale
    ? `На прежнем ключе ещё ${stale}: переписывание не закончено, VAULT_KEY_PREVIOUS убирать рано.`
    : 'Всё запечатано нынешним ключом — VAULT_KEY_PREVIOUS можно убрать.');
  if (broken) {
    console.error(`Строк, которые не открываются вовсе: ${broken}. Это потеря: нужен тот ключ, которым их запечатали.`);
    return 1;
  }
  return stale ? 3 : 0;
}

async function main() {
  if (has('check')) return check();

  if (!previous) {
    console.error('VAULT_KEY_PREVIOUS не задан. Порядок: сначала поставить новый ключ в VAULT_KEY,');
    console.error('прежний — в VAULT_KEY_PREVIOUS, перезапустить, и только потом переписывать.');
    process.exit(2);
  }
  if (key.equals(previous)) {
    console.error('VAULT_KEY и VAULT_KEY_PREVIOUS совпадают — менять нечего.');
    process.exit(2);
  }

  console.log('Переписываю запечатанное нынешним ключом.');
  const vault = await rotate('vault_entries', { id: 'id', secret: 'secret', version: 'key_version', label: 'пароли' });
  const totp = await rotate('auth_totp', { id: 'user_id', secret: 'secret', version: 'key_version', label: 'второй множитель' });

  const failed = vault.failed + totp.failed;
  if (failed) {
    console.error(`Не открылось строк: ${failed}. Они остались как были — нужен ключ, которым их запечатали.`);
    process.exit(1);
  }
  console.log('Готово. Проверьте «--check» и уберите VAULT_KEY_PREVIOUS.');
  return 0;
}

main()
  .then((code) => pool.end().then(() => process.exit(code ?? 0)))
  .catch(async (error) => {
    console.error(`Смена ключа не удалась: ${error.message}`);
    await pool.end().catch(() => {});
    process.exit(1);
  });
