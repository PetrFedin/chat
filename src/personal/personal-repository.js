import { randomUUID } from 'node:crypto';

const KINDS = new Set(['todo', 'note', 'screenshot', 'link']);
const STATUSES = new Set(['open', 'done', 'dropped']);
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

const itemView = (row) => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body ?? null,
  status: row.status,
  dueAt: row.due_at ?? null,
  plannedStart: row.planned_start ?? null,
  plannedEnd: row.planned_end ?? null,
  calendarEventId: row.calendar_event_id ?? null,
  position: row.position,
  completedAt: row.completed_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  commentCount: row.comment_count === undefined ? undefined : Number(row.comment_count),
  fileCount: row.file_count === undefined ? undefined : Number(row.file_count),
});

/**
 * Personal work: the list nobody promised to anybody.
 *
 * A commitment has an accountable owner who accepted it, a designated
 * acceptor and an evidence gate before review. That is the right shape for
 * work between people and the wrong shape for "read this", "buy a cable" or a
 * screenshot kept to look at later. Forcing those through the commitment
 * lifecycle would either break its invariants or bury a two-second thought
 * under a five-step workflow, so personal items are their own thing.
 *
 * Importance, tags and folders are not re-implemented here: they come from
 * the label mechanism, applied to target type 'note'.
 */
export function createPersonalRepository(pool, store = null, labels = null) {
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

  /** A personal item is personal: nobody else reaches it, not even by id. */
  const loadOwn = async (client, session, id) => {
    const { rows } = await client.query(
      'SELECT * FROM personal_items WHERE workspace_id=$1 AND id=$2 AND owner_id=$3 FOR UPDATE',
      [session.workspaceId, id, session.userId],
    );
    if (!rows[0]) throw fail('Запись не найдена', 'PERSONAL_ITEM_NOT_FOUND', 404);
    return rows[0];
  };

  const withLabels = async (session, rows) => {
    if (!labels || !rows.length) return rows.map((r) => ({ ...itemView(r), labels: [] }));
    return Promise.all(rows.map(async (row) => ({ ...itemView(row), labels: await labels.labelsOf(session, 'note', row.id) })));
  };

  const repository = {
    async list(session, { status = 'open', kind = null, due = null, limit = 100 } = {}) {
      if (status && status !== 'all' && !STATUSES.has(status)) throw fail('Состояние бывает open, done или dropped', 'INVALID_STATUS');
      const { rows } = await pool.query(
        `SELECT p.*,
                (SELECT count(*) FROM personal_item_comments c WHERE c.workspace_id=p.workspace_id AND c.item_id=p.id) comment_count,
                (SELECT count(*) FROM personal_item_files f WHERE f.workspace_id=p.workspace_id AND f.item_id=p.id) file_count
         FROM personal_items p
         WHERE p.workspace_id=$1 AND p.owner_id=$2
           AND ($3::text IS NULL OR p.status=$3)
           AND ($4::text IS NULL OR p.kind=$4)
           AND ($5::timestamptz IS NULL OR (p.due_at IS NOT NULL AND p.due_at <= $5))
         ORDER BY p.status, p.position, p.due_at NULLS LAST, p.created_at DESC
         LIMIT $6`,
        [session.workspaceId, session.userId, status === 'all' ? null : status, kind, due, Math.min(Number(limit) || 100, 300)],
      );
      return withLabels(session, rows);
    },

    async get(session, id) {
      const [item, comments, files] = await Promise.all([
        pool.query('SELECT * FROM personal_items WHERE workspace_id=$1 AND id=$2 AND owner_id=$3', [session.workspaceId, id, session.userId]),
        pool.query(
          `SELECT c.id,c.body,c.created_at "createdAt",pr.display_name "authorName"
           FROM personal_item_comments c
           LEFT JOIN workspace_profiles pr ON pr.workspace_id=c.workspace_id AND pr.user_id=c.author_id
           WHERE c.workspace_id=$1 AND c.item_id=$2 ORDER BY c.created_at`,
          [session.workspaceId, id],
        ),
        pool.query(
          `SELECT f.id,f.name,f.mime_type "mimeType",f.size_bytes "sizeBytes"
           FROM personal_item_files pf JOIN files f ON f.workspace_id=pf.workspace_id AND f.id=pf.file_id
           WHERE pf.workspace_id=$1 AND pf.item_id=$2 ORDER BY pf.created_at`,
          [session.workspaceId, id],
        ),
      ]);
      if (!item.rows[0]) throw fail('Запись не найдена', 'PERSONAL_ITEM_NOT_FOUND', 404);
      const [view] = await withLabels(session, item.rows);
      return { ...view, comments: comments.rows, files: files.rows };
    },

    async create(session, { kind = 'todo', title, body = null, dueAt = null, plannedStart = null, plannedEnd = null, position = 0 }) {
      if (!KINDS.has(kind)) throw fail('Вид записи бывает todo, note, screenshot или link', 'INVALID_ITEM_KIND');
      if (!String(title ?? '').trim()) throw fail('У записи должно быть название', 'INVALID_ITEM_TITLE');
      if (plannedEnd && !plannedStart) throw fail('У окна времени должно быть начало', 'INVALID_TIME_RANGE');
      if (plannedEnd && new Date(plannedEnd) <= new Date(plannedStart)) throw fail('Окно времени должно кончаться позже, чем начинается', 'INVALID_TIME_RANGE');
      const { rows } = await pool.query(
        `INSERT INTO personal_items(id,organization_id,workspace_id,owner_id,kind,title,body,due_at,planned_start,planned_end,position)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [randomUUID(), session.organizationId, session.workspaceId, session.userId, kind, String(title).trim(), body, dueAt, plannedStart, plannedEnd, position],
      );
      const [view] = await withLabels(session, rows);
      return view;
    },

    async update(session, id, patch) {
      return tx(async (client) => {
        const item = await loadOwn(client, session, id);
        const columns = { title: 'title', body: 'body', kind: 'kind', dueAt: 'due_at', plannedStart: 'planned_start', plannedEnd: 'planned_end', position: 'position' };
        const fields = Object.keys(columns).filter((f) => patch[f] !== undefined);
        const changingStatus = patch.status !== undefined && patch.status !== item.status;
        if (!fields.length && !changingStatus) throw fail('Нечего менять', 'EMPTY_PATCH');
        if (patch.kind !== undefined && !KINDS.has(patch.kind)) throw fail('Вид записи бывает todo, note, screenshot или link', 'INVALID_ITEM_KIND');
        if (patch.title !== undefined && !String(patch.title).trim()) throw fail('У записи должно быть название', 'INVALID_ITEM_TITLE');

        const start = patch.plannedStart === undefined ? item.planned_start : patch.plannedStart;
        const end = patch.plannedEnd === undefined ? item.planned_end : patch.plannedEnd;
        if (end && !start) throw fail('У окна времени должно быть начало', 'INVALID_TIME_RANGE');
        if (end && new Date(end) <= new Date(start)) throw fail('Окно времени должно кончаться позже, чем начинается', 'INVALID_TIME_RANGE');

        if (fields.length) {
          const setters = fields.map((f, i) => `${columns[f]}=$${i + 3}`).join(',');
          await client.query(
            `UPDATE personal_items SET ${setters}, updated_at=now() WHERE workspace_id=$1 AND id=$2`,
            [session.workspaceId, id, ...fields.map((f) => (f === 'title' ? String(patch.title).trim() : patch[f]))],
          );
        }
        if (changingStatus) {
          if (!STATUSES.has(patch.status)) throw fail('Состояние бывает open, done или dropped', 'INVALID_STATUS');
          // completed_at and status move together; the schema refuses any
          // other combination, so "done" always says when.
          await client.query(
            `UPDATE personal_items SET status=$3, completed_at=CASE WHEN $3='done' THEN now() ELSE NULL END, updated_at=now()
             WHERE workspace_id=$1 AND id=$2`,
            [session.workspaceId, id, patch.status],
          );
        }
        const { rows } = await client.query('SELECT * FROM personal_items WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id]);
        const [view] = await withLabels(session, rows);
        return view;
      });
    },

    async remove(session, id) {
      const { rowCount } = await pool.query(
        'DELETE FROM personal_items WHERE workspace_id=$1 AND id=$2 AND owner_id=$3',
        [session.workspaceId, id, session.userId],
      );
      if (!rowCount) throw fail('Запись не найдена', 'PERSONAL_ITEM_NOT_FOUND', 404);
      return { deleted: true };
    },

    async comment(session, id, body) {
      return tx(async (client) => {
        await loadOwn(client, session, id);
        if (!String(body ?? '').trim()) throw fail('Пустой комментарий не сохранить', 'INVALID_COMMENT');
        const { rows } = await client.query(
          `INSERT INTO personal_item_comments(organization_id,workspace_id,item_id,author_id,body)
           VALUES($1,$2,$3,$4,$5) RETURNING id,body,created_at "createdAt"`,
          [session.organizationId, session.workspaceId, id, session.userId, String(body).trim()],
        );
        return rows[0];
      });
    },

    async attachFile(session, id, fileId) {
      return tx(async (client) => {
        await loadOwn(client, session, id);
        if (store && !(await store.getFile(session, fileId))) throw fail('Файл не найден', 'FILE_NOT_FOUND', 404);
        await client.query(
          `INSERT INTO personal_item_files(organization_id,workspace_id,item_id,file_id)
           VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [session.organizationId, session.workspaceId, id, fileId],
        );
        return { attached: true };
      });
    },

    /**
     * Put the item in the calendar as a focus block. The link is one-way on
     * purpose: deleting the block frees the time without deleting the plan.
     */
    async schedule(session, id, { startAt, endAt }) {
      if (!store) throw fail('Планирование в календаре доступно в режиме с базой данных', 'SCHEDULING_UNAVAILABLE', 503);
      const item = await this.get(session, id);
      if (!startAt || !endAt) throw fail('У блока в календаре должны быть начало и конец', 'INVALID_TIME_RANGE');
      if (new Date(endAt) <= new Date(startAt)) throw fail('Блок должен кончаться позже, чем начинается', 'INVALID_TIME_RANGE');
      const event = await store.createCalendarEvent(session, {
        kind: 'focus', title: item.title, description: item.body ?? null,
        startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(),
        timezone: 'UTC', allDay: false, visibility: 'participants', commitmentId: null, conversationId: null,
      });
      await pool.query(
        'UPDATE personal_items SET calendar_event_id=$3, planned_start=$4, planned_end=$5, updated_at=now() WHERE workspace_id=$1 AND id=$2',
        [session.workspaceId, id, event.id, new Date(startAt).toISOString(), new Date(endAt).toISOString()],
      );
      return this.get(session, id);
    },
  };

  return repository;
}
