import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

/**
 * Личное хранилище паролей.
 *
 * Секрет никогда не покидает этот файл в открытом виде: сюда приходит
 * строка, отсюда уходит шифртекст, и обратно — только по отдельному
 * запросу, который пишется в аудит. Список паролей секретов не содержит,
 * поэтому обычный экран хранилища ничего не раскрывает даже случайно.
 *
 * Ключ берётся из окружения (VAULT_KEY, 32 байта в base64). Нет ключа —
 * хранилище не работает и честно об этом сообщает; молча складывать
 * пароли открытым текстом хуже, чем не иметь такой возможности вовсе.
 */

const fail = (message, code, statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

const ALGORITHM = 'aes-256-gcm';
const NONCE = 12;
const TAG = 16;
const MAX_SECRET = 4000;

export function readVaultKey(env = process.env) {
  const raw = env.VAULT_KEY;
  if (!raw) return null;
  let key;
  try { key = Buffer.from(raw, 'base64'); } catch { return null; }
  // 32 байта — длина ключа AES-256. Короче нельзя, длиннее — не ключ.
  return key.length === 32 ? key : null;
}

export function seal(key, plaintext) {
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]);
}

export function open(key, sealed) {
  const buffer = Buffer.from(sealed);
  if (buffer.length <= NONCE + TAG) throw fail('Stored secret is damaged', 'VAULT_ENTRY_DAMAGED', 500);
  const decipher = createDecipheriv(ALGORITHM, key, buffer.subarray(0, NONCE));
  decipher.setAuthTag(buffer.subarray(NONCE, NONCE + TAG));
  return Buffer.concat([decipher.update(buffer.subarray(NONCE + TAG)), decipher.final()]).toString('utf8');
}

const COLUMNS = `id,title,login,url,note,created_at "createdAt",updated_at "updatedAt",last_viewed_at "lastViewedAt"`;

const readTitle = (value) => {
  const title = String(value ?? '').trim();
  if (!title || title.length > 200) throw fail('A vault entry needs a title of up to 200 characters', 'INVALID_VAULT_TITLE', 400);
  return title;
};

const readSecret = (value) => {
  const secret = String(value ?? '');
  if (!secret) throw fail('A vault entry needs a secret', 'INVALID_VAULT_SECRET', 400);
  if (secret.length > MAX_SECRET) throw fail(`A secret is at most ${MAX_SECRET} characters`, 'INVALID_VAULT_SECRET', 400);
  return secret;
};

const trimmed = (value, limit) =>
  value == null || value === '' ? null : String(value).slice(0, limit);

export function createVaultRepository(pool, { key = readVaultKey() } = {}) {
  const unavailable = (message, code) => () => { throw fail(message, code, 503); };
  if (!pool) {
    const stop = unavailable('The vault needs the PostgreSQL store', 'VAULT_UNAVAILABLE');
    return { enabled: false, reason: 'no-database', list: stop, create: stop, update: stop, remove: stop, reveal: stop };
  }
  if (!key) {
    const stop = unavailable('The vault is not configured: set VAULT_KEY to 32 random bytes in base64', 'VAULT_KEY_MISSING');
    return { enabled: false, reason: 'no-key', list: stop, create: stop, update: stop, remove: stop, reveal: stop };
  }

  /** Раскрытие пароля — событие. В корпоративном продукте оно оставляет след. */
  const audit = async (client, session, entryId, eventType, payload = {}) => {
    await client.query(
      `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
       VALUES($1,$2,'vault_entry',$3,$4,$5,$6)`,
      [session.organizationId, session.workspaceId, entryId, eventType, session.userId, payload],
    );
  };

  return {
    enabled: true,

    /** Список без секретов: экран хранилища сам по себе ничего не раскрывает. */
    async list(session) {
      const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM vault_entries WHERE workspace_id=$1 AND owner_id=$2 ORDER BY title`,
        [session.workspaceId, session.userId],
      );
      return rows;
    },

    async create(session, body = {}) {
      const title = readTitle(body.title);
      const secret = readSecret(body.secret);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO vault_entries(organization_id,workspace_id,owner_id,title,login,url,note,secret)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${COLUMNS}`,
          [session.organizationId, session.workspaceId, session.userId, title,
           trimmed(body.login, 200), trimmed(body.url, 500), trimmed(body.note, 2000), seal(key, secret)],
        );
        await audit(client, session, rows[0].id, 'vault.created', { title });
        await client.query('COMMIT');
        return rows[0];
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async update(session, id, patch = {}) {
      const sets = [];
      const params = [session.workspaceId, session.userId, id];
      const push = (column, value) => { params.push(value); sets.push(`${column}=$${params.length}`); };
      if (patch.title !== undefined) push('title', readTitle(patch.title));
      if (patch.login !== undefined) push('login', trimmed(patch.login, 200));
      if (patch.url !== undefined) push('url', trimmed(patch.url, 500));
      if (patch.note !== undefined) push('note', trimmed(patch.note, 2000));
      if (patch.secret !== undefined) push('secret', seal(key, readSecret(patch.secret)));
      if (!sets.length) throw fail('Nothing to change', 'EMPTY_VAULT_PATCH', 400);
      sets.push('updated_at=now()');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `UPDATE vault_entries SET ${sets.join(',')} WHERE workspace_id=$1 AND owner_id=$2 AND id=$3 RETURNING ${COLUMNS}`,
          params,
        );
        if (!rows[0]) throw fail('Vault entry not found', 'VAULT_ENTRY_NOT_FOUND', 404);
        await audit(client, session, id, 'vault.updated', { secretChanged: patch.secret !== undefined });
        await client.query('COMMIT');
        return rows[0];
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async remove(session, id) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'DELETE FROM vault_entries WHERE workspace_id=$1 AND owner_id=$2 AND id=$3 RETURNING title',
          [session.workspaceId, session.userId, id],
        );
        if (!rows[0]) throw fail('Vault entry not found', 'VAULT_ENTRY_NOT_FOUND', 404);
        await audit(client, session, id, 'vault.deleted', { title: rows[0].title });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    /** Отдельный запрос, отдельная запись в аудите. */
    async reveal(session, id) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT id,title,login,secret FROM vault_entries WHERE workspace_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE',
          [session.workspaceId, session.userId, id],
        );
        if (!rows[0]) throw fail('Vault entry not found', 'VAULT_ENTRY_NOT_FOUND', 404);
        const secret = open(key, rows[0].secret);
        await client.query('UPDATE vault_entries SET last_viewed_at=now() WHERE id=$1', [id]);
        await audit(client, session, id, 'vault.revealed', { title: rows[0].title });
        await client.query('COMMIT');
        return { id: rows[0].id, title: rows[0].title, login: rows[0].login, secret };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/** Ключ для развёртывания: печатается один раз и кладётся в окружение. */
export const suggestKey = () => randomBytes(32).toString('base64');
export const newRequestId = () => randomUUID();
