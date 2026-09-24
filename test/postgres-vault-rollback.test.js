import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createVaultRepository, readVaultKey } from '../src/vault/vault-repository.js';
import { hashPassword, hashToken } from '../src/security.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const VAULT_KEY = process.env.VAULT_KEY;

/**
 * Пароль в сейфе без записи в журнале — худшее из возможных сочетаний:
 * секрет в базе есть, а следа, кто и когда его туда положил, нет. Ровно
 * за этим в коде стоит откат транзакции — и он не выполнялся ни разу ни в
 * одном тесте, здесь и во всех остальных обёртках `tx`.
 *
 * Отказ подсовывается на уровне драйвера, а не подменой репозитория: так
 * проверяется настоящая транзакция, а не наша выдумка о ней.
 */
test('сорванная запись в журнал не оставляет пароль в сейфе',
  { skip: (!DATABASE_URL && 'нет базы') || (!VAULT_KEY && 'нет ключа сейфа') }, async (t) => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const suffix = randomUUID().slice(0, 8);

  const password = hashPassword('WorkspacePass42');
  const created = await store.createCompany({
    companyName: `Сейф ${suffix}`, ownerName: 'Владелец',
    email: `vault-${suffix}@example.com`, passwordHash: password.hash, passwordSalt: password.salt,
  });
  const tokenHash = hashToken(`vault-${randomUUID()}`);
  await store.createSession({ userId: created.user.id, workspaceId: created.workspace.id, tokenHash,
    expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const owner = await store.getSession(tokenHash);

  // Пул, у которого падает ровно запись в журнал — как если бы отказала
  // сама база на середине транзакции.
  let breakAudit = true;
  const brittle = {
    connect: async () => {
      const client = await pool.connect();
      const query = client.query.bind(client);
      const release = client.release.bind(client);
      // Обёртка обязана передавать все аргументы: пул зовёт client.query с
      // колбэком третьим параметром, и дублёр, который его теряет, вешает
      // весь пул — так я и попался, пока писал этот тест.
      client.query = (...args) => {
        const text = args[0];
        const sql = typeof text === 'string' ? text : text?.text ?? '';
        if (breakAudit && sql.includes('audit_events')) {
          return Promise.reject(Object.assign(new Error('журнал недоступен'), { code: 'TEST_AUDIT_DOWN' }));
        }
        return query(...args);
      };
      // Возвращать в пул нужно нетронутый клиент.
      client.release = (...args) => { client.query = query; client.release = release; return release(...args); };
      return client;
    },
    query: (...args) => pool.query(...args),
  };

  const vault = createVaultRepository(brittle, { key: readVaultKey(process.env) });
  await assert.rejects(() => vault.create(owner, { title: 'Почта бухгалтерии', secret: 'S3cret!!' }),
    (error) => error.code === 'TEST_AUDIT_DOWN');

  const left = Number((await pool.query(
    'SELECT count(*) n FROM vault_entries WHERE workspace_id=$1', [owner.workspaceId])).rows[0].n);
  assert.equal(left, 0, 'пароль остался в сейфе без записи в журнале');

  // А когда журнал на месте, запись проходит целиком: и секрет, и след.
  breakAudit = false;
  const entry = await vault.create(owner, { title: 'Почта бухгалтерии', secret: 'S3cret!!' });
  assert.ok(entry.id);
  assert.equal('secret' in entry, false, 'секрет не должен возвращаться в списке полей');
  const audited = Number((await pool.query(
    `SELECT count(*) n FROM audit_events WHERE workspace_id=$1 AND aggregate_id=$2 AND event_type='vault.created'`,
    [owner.workspaceId, entry.id])).rows[0].n);
  assert.equal(audited, 1, 'запись в сейфе есть, а следа в журнале нет');
});
