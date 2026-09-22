import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { open, seal } from '../src/vault/vault-repository.js';

const run = promisify(execFile);
const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

/**
 * Ключ, которым запечатан сейф, был вечным: сменить его было нечем.
 *
 * Проверяем настоящий скрипт на настоящей базе, а не его пересказ:
 * смена ключа, которая «работает», но теряет пароли, — это потеря, о
 * которой узнают в тот единственный день, когда пароль понадобился.
 *
 * Своя временная база: скрипт переписывает всё хранимое целиком, и
 * запускать его на общей базе значит запечатать чужую работу чужим
 * ключом.
 */
test('смена ключа переписывает сейф и второй множитель, ничего не теряя',
  { skip: !DATABASE_URL && 'нет базы', timeout: 120000 }, async (t) => {
  const admin = new pg.Pool({ connectionString: new URL('/postgres', DATABASE_URL).toString(), max: 1 });
  const name = `rotate_test_${randomUUID().slice(0, 8)}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(DATABASE_URL);
  url.pathname = `/${name}`;
  const target = url.toString();
  // Порядок важен: сначала отпускаем соединения, потом удаляем базу.
  // Иначе «DROP ... WITH (FORCE)» обрывает живой пул, и проверка падает
  // на уборке, хотя проверяемое отработало.
  let pool = null;
  t.after(async () => {
    await pool?.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    await admin.end();
  });

  await run(process.execPath, ['scripts/migrate.mjs'], { env: { ...process.env, DATABASE_URL: target } });

  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  pool = new pg.Pool({ connectionString: target, max: 2 });
  // Удаление базы в конце обрывает соединения, и без этого слушателя
  // запоздавший обрыв всплывает необработанным исключением уже после
  // того, как проверяемое отработало.
  pool.on('error', () => {});

  // Кладём запечатанное прежним ключом прямо в базу: проверяем
  // переписывание, а не путь, которым оно туда попало.
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  const userId = randomUUID();
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [organizationId, 'Гранит']);
  await pool.query('INSERT INTO workspaces(id,organization_id,name) VALUES($1,$2,$3)', [workspaceId, organizationId, 'Стройка']);
  await pool.query('INSERT INTO users(id,email) VALUES($1,$2)', [userId, 'owner@t.test']);
  await pool.query("INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES($1,$2,$3,'owner')",
    [organizationId, workspaceId, userId]);

  const secrets = ['пароль от банк-клиента', 'ключ от шлагбаума 4417'];
  const ids = [];
  for (const secret of secrets) {
    const id = randomUUID();
    ids.push(id);
    await pool.query(
      `INSERT INTO vault_entries(id,organization_id,workspace_id,owner_id,title,secret)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [id, organizationId, workspaceId, userId, 'Счёт', seal(oldKey, secret)],
    );
  }
  const totpSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  await pool.query('INSERT INTO auth_totp(user_id,secret,confirmed_at) VALUES($1,$2,now())',
    [userId, seal(oldKey, totpSecret)]);

  const rotate = (env, args = []) => run(process.execPath, ['scripts/rotate-vault-key.mjs', ...args], {
    env: { ...process.env, DATABASE_URL: target, ...env },
  });

  // Без прежнего ключа переписывать нечем — и об этом надо сказать, а
  // не молча ничего не сделать.
  await assert.rejects(rotate({ VAULT_KEY: newKey.toString('base64'), VAULT_KEY_PREVIOUS: '' }),
    (error) => error.code === 2 && /VAULT_KEY_PREVIOUS/.test(error.stderr));

  // Тем же ключом в оба поля — тоже отказ: это опечатка, а не смена.
  await assert.rejects(rotate({ VAULT_KEY: oldKey.toString('base64'), VAULT_KEY_PREVIOUS: oldKey.toString('base64') }),
    (error) => error.code === 2 && /совпадают/.test(error.stderr));

  const before = await rotate({ VAULT_KEY: newKey.toString('base64'), VAULT_KEY_PREVIOUS: oldKey.toString('base64') }, ['--check'])
    .catch((error) => error);
  assert.match(String(before.stdout ?? ''), /переписывание не закончено/);

  const done = await rotate({ VAULT_KEY: newKey.toString('base64'), VAULT_KEY_PREVIOUS: oldKey.toString('base64') });
  assert.match(done.stdout, /пароли: переписано 2/);
  assert.match(done.stdout, /второй множитель: переписано 1/);

  // Главное: содержимое то же самое, и открывается новым ключом.
  for (const [index, id] of ids.entries()) {
    const { rows } = await pool.query('SELECT secret, key_version FROM vault_entries WHERE id=$1', [id]);
    assert.equal(open([newKey], rows[0].secret), secrets[index]);
    // Поколение — отпечаток ключа, а не счётчик: по нему видно, чем
    // строка запечатана, и повторный запуск её не трогает.
    assert.notEqual(rows[0].key_version, 1);
    // И прежним ключом уже не открывается — иначе смены не было.
    assert.throws(() => open([oldKey], rows[0].secret));
  }
  const { rows: totp } = await pool.query('SELECT secret FROM auth_totp WHERE user_id=$1', [userId]);
  assert.equal(open([newKey], totp[0].secret), totpSecret);

  const after = await rotate({ VAULT_KEY: newKey.toString('base64'), VAULT_KEY_PREVIOUS: oldKey.toString('base64') }, ['--check']);
  assert.match(after.stdout, /можно убрать/);

  // Повторный запуск не должен ничего портить: переписывание идёт
  // частями и может быть прервано, значит его будут запускать снова.
  const again = await rotate({ VAULT_KEY: newKey.toString('base64'), VAULT_KEY_PREVIOUS: oldKey.toString('base64') });
  assert.match(again.stdout, /пароли: переписано 0/);
  const { rows: still } = await pool.query('SELECT secret FROM vault_entries WHERE id=$1', [ids[0]]);
  assert.equal(open([newKey], still[0].secret), secrets[0]);
});

/**
 * Пока идёт переписывание, часть строк запечатана прежним ключом.
 *
 * Без второго ключа на чтение смена означает остановку сейфа — и её
 * просто не делают.
 */
test('во время смены читается и прежним ключом, и новым', () => {
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const sealedOld = seal(oldKey, 'старое');
  const sealedNew = seal(newKey, 'новое');

  assert.equal(open([newKey, oldKey], sealedOld), 'старое');
  assert.equal(open([newKey, oldKey], sealedNew), 'новое');
  // Чужой ключ не открывает — и говорит об этом отдельным кодом, а не
  // «повреждено»: различать потерю ключа и порчу данных важно.
  assert.throws(() => open([randomBytes(32)], sealedNew), (error) => error.code === 'VAULT_KEY_MISMATCH');
});
