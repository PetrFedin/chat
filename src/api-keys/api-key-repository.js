import { randomBytes, createHash } from 'node:crypto';

/**
 * Персональные API-ключи для стороннего доступа к REST API.
 *
 * Ключ действует за того, кто его выпустил: `resolve()` возвращает
 * ровно ту же форму сессии, что и cookie-логин, — тот же rbac.js
 * дальше решает, что можно, а что нет. Разница только в одном флаге:
 * `readOnly` запрещает всё, что не GET, ещё на входе — до того, как
 * запрос доходит до конкретного маршрута.
 *
 * Только PostgreSQL, как и остальные недавние интеграции (Telegram,
 * .ics-подписка, база знаний): ключ — это состояние, которое должно
 * пережить перезапуск процесса, а не то, что стоит подделывать в
 * памяти ради теста.
 */

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode, expose: true });

const PREFIX = 'cxk_';

const hashKey = (raw) => createHash('sha256').update(String(raw ?? ''), 'utf8').digest('hex');

function newKey() {
  const secret = randomBytes(24).toString('base64url');
  const raw = `${PREFIX}${secret}`;
  return { raw, prefix: raw.slice(0, 12) };
}

export function createApiKeyRepository(pool) {
  if (!pool) {
    const stop = () => { throw fail('API-ключи работают только с базой данных PostgreSQL', 'API_KEYS_UNAVAILABLE', 503); };
    return { enabled: false, list: stop, create: stop, revoke: stop, resolve: async () => null };
  }

  /** След в журнале: ключ даёт доступ к данным, и кто его выдал — не тайна. Сбой журнала ключу не мешает. */
  const audit = (session, id, eventType, payload) => pool.query(
    `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
     VALUES($1,$2,'api_key',$3,$4,$5,$6)`,
    [session.organizationId, session.workspaceId, id, eventType, session.userId, payload],
  ).catch(() => {});

  return {
    enabled: true,

    async list(session) {
      const { rows } = await pool.query(
        `SELECT id,name,key_prefix "keyPrefix",read_only "readOnly",created_at "createdAt",last_used_at "lastUsedAt",revoked_at "revokedAt"
           FROM api_keys WHERE workspace_id=$1 AND user_id=$2 ORDER BY created_at DESC`,
        [session.workspaceId, session.userId],
      );
      return rows;
    },

    /** Секрет возвращается один раз, в момент создания, и больше нигде и никогда. */
    async create(session, { name, readOnly = false } = {}) {
      const trimmed = String(name ?? '').trim();
      if (!trimmed) throw fail('Название ключа обязательно', 'API_KEY_NAME_REQUIRED');
      const { raw, prefix } = newKey();
      const { rows } = await pool.query(
        `INSERT INTO api_keys(organization_id,workspace_id,user_id,name,key_hash,key_prefix,read_only,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$3)
         RETURNING id,name,key_prefix "keyPrefix",read_only "readOnly",created_at "createdAt"`,
        [session.organizationId, session.workspaceId, session.userId, trimmed.slice(0, 100), hashKey(raw), prefix, Boolean(readOnly)],
      );
      await audit(session, rows[0].id, 'api_key.created', { name: rows[0].name, readOnly: rows[0].readOnly });
      return { ...rows[0], key: raw };
    },

    async revoke(session, id) {
      const { rows } = await pool.query(
        'UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND revoked_at IS NULL RETURNING name',
        [id, session.workspaceId, session.userId],
      );
      if (!rows[0]) throw fail('Ключ не найден', 'NOT_FOUND', 404);
      await audit(session, id, 'api_key.revoked', { name: rows[0].name });
    },

    /**
     * Опознание по заголовку `Authorization: Bearer <ключ>`.
     *
     * Форма ответа совпадает с `store.getSession`: остальному серверу
     * незачем знать, пришёл запрос по cookie или по ключу.
     */
    async resolve(rawKey) {
      if (!rawKey || !rawKey.startsWith(PREFIX)) return null;
      const { rows } = await pool.query(
        `SELECT k.id key_id,k.read_only,k.user_id,k.workspace_id,w.organization_id,m.role,u.email,
                p.display_name,w.name workspace_name,o.name organization_name,p.title,p.department,p.locale,p.timezone
           FROM api_keys k
           JOIN users u ON u.id=k.user_id
           JOIN memberships m ON m.workspace_id=k.workspace_id AND m.user_id=k.user_id
           JOIN workspaces w ON w.id=k.workspace_id
           JOIN organizations o ON o.id=w.organization_id
           LEFT JOIN workspace_profiles p ON p.workspace_id=k.workspace_id AND p.user_id=k.user_id
          WHERE k.key_hash=$1 AND k.revoked_at IS NULL AND u.disabled_at IS NULL
            AND (m.access_until IS NULL OR m.access_until>now())`,
        [hashKey(rawKey)],
      );
      const r = rows[0];
      if (!r) return null;
      pool.query('UPDATE api_keys SET last_used_at=now() WHERE id=$1', [r.key_id]).catch(() => {});
      return {
        apiKeyId: r.key_id,
        readOnly: r.read_only,
        userId: r.user_id,
        workspaceId: r.workspace_id,
        organizationId: r.organization_id,
        role: r.role,
        email: r.email,
        displayName: r.display_name || r.email,
        workspaceName: r.workspace_name,
        organizationName: r.organization_name,
        profile: { displayName: r.display_name, email: r.email, title: r.title, department: r.department, locale: r.locale, timezone: r.timezone },
      };
    },
  };
}
