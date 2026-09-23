import { Permission, hasPermission } from '../rbac.js';

const KINDS = new Set(['priority', 'tag', 'folder', 'status']);
const TARGETS = new Set(['message', 'file', 'task', 'event', 'conversation', 'person', 'note']);
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

const labelView = (row) => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  colour: row.colour,
  position: row.position,
  parentId: row.parent_id ?? null,
  ownerId: row.owner_id ?? null,
  personal: Boolean(row.owner_id),
  description: row.description ?? null,
  usage: row.usage === undefined ? undefined : Number(row.usage),
});

/**
 * One mechanism behind importance, tags and folders.
 *
 * They differ in presentation and in whether more than one may apply at a
 * time, not in substance. Keeping them apart would mean three filters, three
 * search paths and three places to fix the same bug.
 */
export function createLabelRepository(pool, store = null) {
  if (!pool) return null;

  const tx = async (run) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };

  /**
   * A label is usable if it is shared or belongs to this person. Anything
   * else must behave as if it does not exist, so a personal folder name is
   * not discoverable by probing ids.
   */
  // A guest reaches only labels of their own; everyone on the staff also sees
  // the shared vocabulary. Kept in one place so the list and the apply agree.
  const ownScope = (session) => (session.role === 'guest' ? 'owner_id=$3' : '(owner_id IS NULL OR owner_id=$3)');

  /**
   * Кто вправе менять метку.
   *
   * Личную — только её владелец. Общий словарь компании — тот, кто им
   * распоряжается: раньше переименовать и удалить общую метку мог любой
   * сотрудник, и вчерашняя «Важно» назавтра оказывалась «Не важно» у
   * всех сразу, без следа о том, кто это сделал.
   */
  const assertMayChange = (session, row) => {
    if (row.owner_id) {
      if (row.owner_id !== session.userId) throw fail('Label not found', 'LABEL_NOT_FOUND', 404);
      return;
    }
    if (!hasPermission(session.role, Permission.CHANNEL_MANAGE)) {
      throw fail('Общий словарь компании ведут те, кто распоряжается каналами', 'LABEL_SHARED_FORBIDDEN', 403);
    }
  };

  const loadLabel = async (client, session, id) => {
    const { rows } = await client.query(
      `SELECT * FROM labels WHERE workspace_id=$1 AND id=$2 AND ${ownScope(session)} FOR UPDATE`,
      [session.workspaceId, id, session.userId],
    );
    if (!rows[0]) throw fail('Label not found', 'LABEL_NOT_FOUND', 404);
    return rows[0];
  };

  /** The object must be one this person can already reach; a label never widens access. */
  const assertTargetVisible = async (session, targetType, targetId) => {
    if (!store) return;
    if (targetType === 'message') {
      const conversationId = await store.messageConversation?.(session, targetId);
      if (!conversationId || !(await store.canAccessConversation(session, conversationId))) throw fail('Target not found', 'TARGET_NOT_FOUND', 404);
      return;
    }
    if (targetType === 'conversation') {
      if (!(await store.canAccessConversation(session, targetId))) throw fail('Target not found', 'TARGET_NOT_FOUND', 404);
      return;
    }
    if (targetType === 'task') {
      if (!(await store.getTask(session, targetId))) throw fail('Target not found', 'TARGET_NOT_FOUND', 404);
      return;
    }
    if (targetType === 'file') {
      if (!(await store.getFile(session, targetId))) throw fail('Target not found', 'TARGET_NOT_FOUND', 404);
      return;
    }
    // Встреча, человек и заметка проверок не проходили вовсе: метку брала
    // любая строчка, в том числе выдуманный опознаватель. Список метки потом
    // показывал такую связь с пустым названием — и убрать её было неоткуда,
    // потому что объекта, с которого снимают метку, не существует.
    if (targetType === 'event') {
      const { rowCount } = await pool.query(
        `SELECT 1 FROM calendar_events e WHERE e.workspace_id=$1 AND e.id=$2 AND (
           e.owner_id=$3
           OR (e.visibility='workspace' AND $4<>'guest')
           OR EXISTS(SELECT 1 FROM calendar_event_participants p WHERE p.workspace_id=e.workspace_id AND p.calendar_event_id=e.id AND p.user_id=$3)
           OR EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.workspace_id=e.workspace_id AND cm.conversation_id=e.conversation_id AND cm.user_id=$3))`,
        [session.workspaceId, targetId, session.userId, session.role],
      );
      if (!rowCount) throw fail('Target not found', 'TARGET_NOT_FOUND', 404);
      return;
    }
    if (targetType === 'person') {
      const { rowCount } = await pool.query(
        `SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2
           AND (access_until IS NULL OR access_until>now())`,
        [session.workspaceId, targetId],
      );
      if (!rowCount) throw fail('Target not found', 'TARGET_NOT_FOUND', 404);
      return;
    }
    if (targetType === 'note') {
      // `note` — это запись личного плана. Она вещь личная: чужую нельзя ни
      // разметить, ни нащупать перебором опознавателей.
      const { rowCount } = await pool.query(
        'SELECT 1 FROM personal_items WHERE workspace_id=$1 AND id=$2 AND owner_id=$3',
        [session.workspaceId, targetId, session.userId],
      );
      if (!rowCount) throw fail('Target not found', 'TARGET_NOT_FOUND', 404);
    }
  };

  const repository = {
    async listLabels(session, { kind = null } = {}) {
      const { rows } = await pool.query(
        `SELECT l.*, (SELECT count(*) FROM label_links k WHERE k.workspace_id=l.workspace_id AND k.label_id=l.id) usage
         FROM labels l
         WHERE l.workspace_id=$1 AND ${session.role === 'guest' ? 'l.owner_id=$2' : '(l.owner_id IS NULL OR l.owner_id=$2)'} AND ($3::text IS NULL OR l.kind=$3)
         ORDER BY l.kind, l.position, lower(l.name)`,
        [session.workspaceId, session.userId, kind],
      );
      return rows.map(labelView);
    },

    async createLabel(session, { kind = 'tag', name, colour = 'neutral', parentId = null, personal = false, description = null, position = 0 }) {
      if (!KINDS.has(kind)) throw fail('Unknown label kind', 'INVALID_LABEL_KIND');
      if (!String(name ?? '').trim()) throw fail('A label needs a name', 'INVALID_LABEL_NAME');
      // Only folders nest. A nested importance or tag has no meaning and would
      // make the filter ambiguous.
      if (parentId && kind !== 'folder') throw fail('Only folders can be nested', 'LABEL_NESTING_NOT_ALLOWED', 409);
      // Гость — сотрудник другой компании, пришедший по одному делу.
      // Личные метки у него свои, общий словарь компании — не его.
      if (!personal && session.role === 'guest') {
        throw fail('Внешний участник заводит только личные метки', 'GUEST_LABEL_SHARED', 403);
      }
      const { rows } = await pool.query(
        `INSERT INTO labels(organization_id,workspace_id,kind,name,colour,parent_id,owner_id,description,position,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [session.organizationId, session.workspaceId, kind, String(name).trim(), colour, parentId,
          personal ? session.userId : null, description, position, session.userId],
      );
      return labelView({ ...rows[0], usage: 0 });
    },

    async updateLabel(session, id, patch) {
      return tx(async (client) => {
        assertMayChange(session, await loadLabel(client, session, id));
        const columns = { name: 'name', colour: 'colour', description: 'description', position: 'position' };
        const fields = Object.keys(columns).filter((f) => patch[f] !== undefined);
        if (!fields.length) throw fail('Nothing to update', 'EMPTY_PATCH');
        if (patch.name !== undefined && !String(patch.name).trim()) throw fail('A label needs a name', 'INVALID_LABEL_NAME');
        const setters = fields.map((f, i) => `${columns[f]}=$${i + 3}`).join(',');
        const { rows } = await client.query(
          `UPDATE labels SET ${setters}, updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *`,
          [session.workspaceId, id, ...fields.map((f) => (f === 'name' ? String(patch.name).trim() : patch[f]))],
        );
        return labelView(rows[0]);
      });
    },

    async deleteLabel(session, id) {
      return tx(async (client) => {
        assertMayChange(session, await loadLabel(client, session, id));
        // Links go with it: a label nobody can see must not keep marking things.
        await client.query('DELETE FROM labels WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id]);
        return { deleted: true };
      });
    },

    async apply(session, labelId, targetType, targetId) {
      if (!TARGETS.has(targetType)) throw fail('Unknown target type', 'INVALID_TARGET_TYPE');
      return tx(async (client) => {
        // The label is checked before the target on purpose: somebody who does
        // not hold the label learns nothing about what the target is.
        const label = await loadLabel(client, session, labelId);
        await assertTargetVisible(session, targetType, targetId);
        if (label.kind === 'priority') {
          // Importance is exclusive: applying one replaces whichever was on
          // the object, so a thing is never both important and secondary.
          await client.query(
            `DELETE FROM label_links k USING labels l
             WHERE k.workspace_id=$1 AND k.target_type=$2 AND k.target_id=$3
               AND l.workspace_id=k.workspace_id AND l.id=k.label_id AND l.kind='priority'
               AND ${session.role === 'guest' ? 'l.owner_id=$4' : '(l.owner_id IS NULL OR l.owner_id=$4)'}`,
            [session.workspaceId, targetType, targetId, session.userId],
          );
        }
        await client.query(
          `INSERT INTO label_links(organization_id,workspace_id,label_id,target_type,target_id,applied_by)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [session.organizationId, session.workspaceId, labelId, targetType, targetId, session.userId],
        );
        return { applied: true, labelId, targetType, targetId, exclusive: label.kind === 'priority' };
      });
    },

    async remove(session, labelId, targetType, targetId) {
      return tx(async (client) => {
        await loadLabel(client, session, labelId);
        const { rowCount } = await client.query(
          'DELETE FROM label_links WHERE workspace_id=$1 AND label_id=$2 AND target_type=$3 AND target_id=$4',
          [session.workspaceId, labelId, targetType, targetId],
        );
        if (!rowCount) throw fail('That label is not on this object', 'LABEL_NOT_APPLIED', 404);
        return { removed: true };
      });
    },

    /** What is on one object — the chips a card shows. */
    async labelsOf(session, targetType, targetId) {
      const { rows } = await pool.query(
        `SELECT l.*, k.applied_by "appliedBy", k.created_at "appliedAt"
         FROM label_links k JOIN labels l ON l.workspace_id=k.workspace_id AND l.id=k.label_id
         WHERE k.workspace_id=$1 AND k.target_type=$2 AND k.target_id=$3
           AND ${session.role === 'guest' ? 'l.owner_id=$4' : '(l.owner_id IS NULL OR l.owner_id=$4)'}
         ORDER BY CASE l.kind WHEN 'priority' THEN 0 WHEN 'status' THEN 1 WHEN 'folder' THEN 2 ELSE 3 END, l.position, lower(l.name)`,
        [session.workspaceId, targetType, targetId, session.userId],
      );
      return rows.map((row) => ({ ...labelView(row), appliedBy: row.appliedBy, appliedAt: row.appliedAt }));
    },

    /**
     * Everything carrying a label. Access is re-checked per row rather than
     * trusted from the link table, so a label can never surface an object the
     * viewer lost access to.
     */
    async targetsOf(session, labelId, { limit = 50 } = {}) {
      const label = await pool.query(
        'SELECT 1 FROM labels WHERE workspace_id=$1 AND id=$2 AND (owner_id IS NULL OR owner_id=$3)',
        [session.workspaceId, labelId, session.userId],
      );
      if (!label.rowCount) throw fail('Label not found', 'LABEL_NOT_FOUND', 404);
      const { rows } = await pool.query(
        `SELECT k.target_type "targetType", k.target_id "targetId", k.created_at "appliedAt",
                CASE k.target_type
                  WHEN 'task' THEN (SELECT title FROM commitments c WHERE c.workspace_id=k.workspace_id AND c.id=k.target_id)
                  WHEN 'event' THEN (SELECT title FROM calendar_events e WHERE e.workspace_id=k.workspace_id AND e.id=k.target_id)
                  WHEN 'conversation' THEN (SELECT title FROM conversations c WHERE c.workspace_id=k.workspace_id AND c.id=k.target_id)
                  WHEN 'file' THEN (SELECT name FROM files f WHERE f.workspace_id=k.workspace_id AND f.id=k.target_id)
                  WHEN 'message' THEN (SELECT left(body, 80) FROM messages m WHERE m.workspace_id=k.workspace_id AND m.id=k.target_id)
                END title
         FROM label_links k WHERE k.workspace_id=$1 AND k.label_id=$2
         ORDER BY k.created_at DESC LIMIT $3`,
        [session.workspaceId, labelId, Math.min(Number(limit) || 50, 200)],
      );
      const visible = [];
      for (const row of rows) {
        try {
          await assertTargetVisible(session, row.targetType, row.targetId);
          visible.push(row);
        } catch { /* the viewer lost access to it; it simply is not listed */ }
      }
      return visible;
    },
  };

  return repository;
}
