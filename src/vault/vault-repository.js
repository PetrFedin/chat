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

// `expose:true` всегда: без него ответ 5xx показывает человеку
// generic "Internal server error" вместо читаемого сообщения.
const fail = (message, code, statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode, expose: true });

const ALGORITHM = 'aes-256-gcm';
const NONCE = 12;
const TAG = 16;
const MAX_SECRET = 4000;

const readKey = (raw) => {
  if (!raw) return null;
  let key;
  try { key = Buffer.from(raw, 'base64'); } catch { return null; }
  // 32 байта — длина ключа AES-256. Короче нельзя, длиннее — не ключ.
  return key.length === 32 ? key : null;
};

export function readVaultKey(env = process.env) {
  return readKey(env.VAULT_KEY);
}

/**
 * Ключи для чтения: нынешний и прежний.
 *
 * Смена ключа не бывает мгновенной: пока переписываются строки, часть
 * их запечатана старым ключом, а часть новым. Без второго ключа на
 * чтение такая смена означает остановку сейфа — и её просто не делают,
 * а ключ, который нельзя сменить, живёт вечно.
 *
 * Запечатываем всегда нынешним; прежний только открывает.
 */
export function readVaultKeys(env = process.env) {
  return { key: readKey(env.VAULT_KEY), previous: readKey(env.VAULT_KEY_PREVIOUS) };
}

export function seal(key, plaintext) {
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]);
}

/**
 * Открывает запечатанное.
 *
 * Принимает и один ключ, и список: во время смены ключа часть строк
 * запечатана прежним, и перебрать два ключа дешевле, чем остановить
 * сейф на время переписывания.
 */
export function open(key, sealed) {
  const keys = (Array.isArray(key) ? key : [key]).filter(Boolean);
  if (!keys.length) throw fail('Сохранённый секрет повреждён', 'VAULT_ENTRY_DAMAGED', 500);
  const buffer = Buffer.from(sealed);
  if (buffer.length <= NONCE + TAG) throw fail('Сохранённый секрет повреждён', 'VAULT_ENTRY_DAMAGED', 500);
  let last = null;
  for (const candidate of keys) {
    try {
      const decipher = createDecipheriv(ALGORITHM, candidate, buffer.subarray(0, NONCE));
      decipher.setAuthTag(buffer.subarray(NONCE, NONCE + TAG));
      return Buffer.concat([decipher.update(buffer.subarray(NONCE + TAG)), decipher.final()]).toString('utf8');
    } catch (error) { last = error; }
  }
  // Ни один ключ не подошёл — это либо порча, либо потерянный ключ.
  // Различить снаружи нельзя, и обещать, что это просто «повреждено»,
  // было бы неправдой.
  throw Object.assign(fail('Сохранённый секрет не открывается настроенным ключом', 'VAULT_KEY_MISMATCH', 500), { cause: last });
}

const COLUMNS = `id,title,login,url,note,created_at "createdAt",updated_at "updatedAt",last_viewed_at "lastViewedAt"`;

const readTitle = (value) => {
  const title = String(value ?? '').trim();
  if (!title || title.length > 200) throw fail('Записи сейфа нужно название до 200 символов', 'INVALID_VAULT_TITLE', 400);
  return title;
};

const readSecret = (value) => {
  const secret = String(value ?? '');
  if (!secret) throw fail('Записи сейфа нужен секрет', 'INVALID_VAULT_SECRET', 400);
  if (secret.length > MAX_SECRET) throw fail(`Секрет не длиннее ${MAX_SECRET} символов`, 'INVALID_VAULT_SECRET', 400);
  return secret;
};

const trimmed = (value, limit) =>
  value == null || value === '' ? null : String(value).slice(0, limit);

export function createVaultRepository(pool, { key = readVaultKey(), previous = readVaultKeys().previous } = {}) {
  // Запечатываем нынешним, открываем любым из двух: см. readVaultKeys.
  const readers = [key, previous].filter(Boolean);
  const unavailable = (message, code) => () => { throw fail(message, code, 503); };
  if (!pool) {
    const stop = unavailable('Сейфу нужно хранилище PostgreSQL', 'VAULT_UNAVAILABLE');
    return { enabled: false, reason: 'no-database', list: stop, create: stop, update: stop, remove: stop, reveal: stop };
  }
  if (!key) {
    const stop = unavailable('Сейф не настроен: задайте VAULT_KEY — 32 случайных байта в base64', 'VAULT_KEY_MISSING');
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
      if (!sets.length) throw fail('Нечего менять', 'EMPTY_VAULT_PATCH', 400);
      sets.push('updated_at=now()');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `UPDATE vault_entries SET ${sets.join(',')} WHERE workspace_id=$1 AND owner_id=$2 AND id=$3 RETURNING ${COLUMNS}`,
          params,
        );
        if (!rows[0]) throw fail('Запись сейфа не найдена', 'VAULT_ENTRY_NOT_FOUND', 404);
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
        if (!rows[0]) throw fail('Запись сейфа не найдена', 'VAULT_ENTRY_NOT_FOUND', 404);
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
        if (!rows[0]) throw fail('Запись сейфа не найдена', 'VAULT_ENTRY_NOT_FOUND', 404);
        const secret = open(readers, rows[0].secret);
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
