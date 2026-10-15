const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode, expose: true });

/**
 * Ветки беседы. Права берутся от беседы: видит ветки тот, кто видит беседу; создаёт и переносит сообщения тот, кто может
 * писать в ней; переименовывает и архивирует создатель ветки или тот, кто ведёт беседу. Проверка доступа — на стороне
 * вызывающего (маршрут знает политику беседы), здесь только данные.
 */
export function createTopicRepository(pool) {
  const view = (row) => ({
    id: row.id, conversationId: row.conversation_id, title: row.title, pinned: row.pinned, createdBy: row.created_by,
    createdAt: row.created_at, archivedAt: row.archived_at, messageCount: Number(row.message_count ?? 0), lastMessageAt: row.last_message_at ?? null,
  });

  return {
    async list(session, conversationId, { includeArchived = false } = {}) {
      const { rows } = await pool.query(
        `SELECT t.*, (SELECT count(*) FROM messages m WHERE m.topic_id=t.id AND m.deleted_at IS NULL) message_count,
                (SELECT max(m.created_at) FROM messages m WHERE m.topic_id=t.id) last_message_at
           FROM conversation_topics t WHERE t.workspace_id=$1 AND t.conversation_id=$2 AND ($3 OR t.archived_at IS NULL)
          ORDER BY t.pinned DESC, COALESCE((SELECT max(m.created_at) FROM messages m WHERE m.topic_id=t.id), t.created_at) DESC`,
        [session.workspaceId, conversationId, includeArchived]);
      const { rows: plain } = await pool.query(
        'SELECT count(*)::int n FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND topic_id IS NULL AND thread_root_id IS NULL AND deleted_at IS NULL',
        [session.workspaceId, conversationId]);
      return { items: rows.map(view), generalCount: plain[0].n };
    },

    async create(session, conversationId, title) {
      const clean = String(title ?? '').replace(/[\u0000-\u001f]/g, ' ').trim();
      if (!clean) throw fail('Назовите ветку', 'INVALID_TOPIC');
      if (clean.length > 80) throw fail('Название ветки — не длиннее 80 знаков', 'INVALID_TOPIC');
      const { rows: count } = await pool.query(
        'SELECT count(*)::int n FROM conversation_topics WHERE workspace_id=$1 AND conversation_id=$2 AND archived_at IS NULL', [session.workspaceId, conversationId]);
      if (count[0].n >= 100) throw fail('В беседе уже сто веток: архивируйте ненужные', 'TOO_MANY_TOPICS', 409);
      try {
        const { rows } = await pool.query(
          `INSERT INTO conversation_topics(organization_id,workspace_id,conversation_id,title,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [session.organizationId, session.workspaceId, conversationId, clean, session.userId]);
        return view(rows[0]);
      } catch (error) {
        if (error?.code === '23505') throw fail('Ветка с таким названием уже есть', 'TOPIC_EXISTS', 409);
        throw error;
      }
    },

    async get(session, conversationId, topicId) {
      const { rows } = await pool.query('SELECT * FROM conversation_topics WHERE workspace_id=$1 AND conversation_id=$2 AND id=$3', [session.workspaceId, conversationId, topicId]);
      if (!rows[0]) throw fail('Ветка не найдена', 'TOPIC_NOT_FOUND', 404);
      return rows[0];
    },

    async update(session, conversationId, topicId, { title, pinned, archived }) {
      const topic = await this.get(session, conversationId, topicId);
      const sets = []; const args = [session.workspaceId, topicId];
      if (title !== undefined) {
        const clean = String(title ?? '').replace(/[\u0000-\u001f]/g, ' ').trim();
        if (!clean || clean.length > 80) throw fail('Название ветки — от 1 до 80 знаков', 'INVALID_TOPIC');
        args.push(clean); sets.push(`title=$${args.length}`);
      }
      if (pinned !== undefined) { args.push(Boolean(pinned)); sets.push(`pinned=$${args.length}`); }
      if (archived !== undefined) sets.push(archived ? 'archived_at=now()' : 'archived_at=NULL');
      if (!sets.length) return view(topic);
      try {
        const { rows } = await pool.query(`UPDATE conversation_topics SET ${sets.join(',')} WHERE workspace_id=$1 AND id=$2 RETURNING *`, args);
        return view(rows[0]);
      } catch (error) {
        if (error?.code === '23505') throw fail('Ветка с таким названием уже есть', 'TOPIC_EXISTS', 409);
        throw error;
      }
    },

    /** Сообщения ветки, старые вперёд, страницами «до такого-то времени». */
    async messages(store, session, conversationId, topicId, { limit = 100, before = null } = {}) {
      await this.get(session, conversationId, topicId);
      const size = Math.min(Math.max(Number(limit) || 100, 1), 200);
      const { rows } = await pool.query(
        `SELECT m.id FROM messages m WHERE m.workspace_id=$1 AND m.conversation_id=$2 AND m.topic_id=$3
            AND ($5::timestamptz IS NULL OR m.created_at < $5) ORDER BY m.created_at DESC, m.id DESC LIMIT $4`,
        [session.workspaceId, conversationId, topicId, size, before]);
      const out = [];
      for (const row of rows.reverse()) out.push(await store.getMessage(session, row.id));
      return out.filter(Boolean);
    },

    /** Какая ветка у сообщения; null — общая лента. */
    async assign(session, messageId, conversationId, topicId) {
      if (topicId) {
        const topic = await this.get(session, conversationId, topicId);
        if (topic.archived_at) throw fail('Ветка в архиве: верните её, чтобы писать туда', 'TOPIC_ARCHIVED', 409);
      }
      const { rowCount } = await pool.query(
        'UPDATE messages SET topic_id=$4 WHERE workspace_id=$1 AND conversation_id=$2 AND id=$3 AND thread_root_id IS NULL', [session.workspaceId, conversationId, messageId, topicId ?? null]);
      if (!rowCount) throw fail('Перенести можно сообщение из ленты, не из обсуждения', 'MESSAGE_NOT_MOVABLE', 409);
    },
  };
}
