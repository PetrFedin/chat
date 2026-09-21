import pg from 'pg';
import { PostgresStore } from '/Users/petr/Documents/claude/chat/src/persistence/store.js';
import { createVaultRepository, readVaultKey } from '/Users/petr/Documents/claude/chat/src/vault/vault-repository.js';
import { hashPassword, hashToken } from '/Users/petr/Documents/claude/chat/src/security.js';
import { randomUUID } from 'node:crypto';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const store = new PostgresStore(pool);
const s = randomUUID().slice(0, 8);
const p = hashPassword('WorkspacePass42');
const created = await store.createCompany({ companyName: 'V ' + s, ownerName: 'O', email: `v-${s}@e.com`, passwordHash: p.hash, passwordSalt: p.salt });
const th = hashToken('v-' + randomUUID());
await store.createSession({ userId: created.user.id, workspaceId: created.workspace.id, tokenHash: th, expiresAt: new Date(Date.now() + 864e5).toISOString() });
const owner = await store.getSession(th);
console.log('фикстура готова');
let breakAudit = true;
const brittle = {
  connect: async () => {
    const client = await pool.connect();
    const q = client.query.bind(client);
    client.query = (text, params) => {
      const sql = typeof text === 'string' ? text : text?.text ?? '';
      if (breakAudit && sql.includes('audit_events')) return Promise.reject(Object.assign(new Error('журнал недоступен'), { code: 'TEST_AUDIT_DOWN' }));
      return q(text, params);
    };
    return client;
  },
  query: (...a) => pool.query(...a),
};
const vault = createVaultRepository(brittle, { key: readVaultKey(process.env) });
try { await vault.create(owner, { title: 'T', secret: 'S3cret!!' }); console.log('создано — плохо'); }
catch (e) { console.log('отказ:', e.code); }
console.log('считаем записи…');
const n = (await pool.query('SELECT count(*) n FROM vault_entries WHERE workspace_id=$1', [owner.workspaceId])).rows[0].n;
console.log('записей в сейфе:', n);
breakAudit = false;
const entry = await vault.create(owner, { title: 'T2', secret: 'S3cret!!' });
console.log('вторая запись:', entry.id);
await pool.end();
