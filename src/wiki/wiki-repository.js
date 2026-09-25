import { cleanText } from '../http/helpers.js';

/**
 * Вики: дерево совместных страниц компании.
 *
 * В отличие от базы знаний (knowledge-repository.js), где пишет
 * куратор, а читает компания, здесь читают и пишут одни и те же люди —
 * любой сотрудник. Правка не стирает прежний текст: снимок «как было
 * до этой правки» уходит в `wiki_page_versions`, а `version` на самой
 * странице — то же optimistic concurrency, что у задач: сохранение
 * поверх чужой правки, которую вы не видели, отклоняется честным 409,
 * а не тихой перезаписью.
 *
 * Только PostgreSQL, как и остальные недавние модули (база знаний,
 * сейф паролей, Telegram-мост): состояние, которому нельзя разойтись
 * между процессами памяти, не эмулируется — оно либо есть в базе, либо
 * модуль честно отвечает 503.
 */

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode, expose: true });

const readTitle = (value) => cleanText(value, 200, 'Заголовок');
const readContent = (value) => {
  const content = String(value ?? '');
  if (content.length > 100000) throw fail('Текст страницы длиннее 100000 символов', 'INVALID_TEXT', 400);
  return content;
};

const COLUMNS = `id,parent_id "parentId",title,content,version,created_by "createdBy",updated_by "updatedBy",
  created_at "createdAt",updated_at "updatedAt",archived_at "archivedAt"`;
const SUMMARY_COLUMNS = `id,parent_id "parentId",title,version,created_by "createdBy",updated_by "updatedBy",
  created_at "createdAt",updated_at "updatedAt"`;

const view = (row) => ({
  id: row.id, parentId: row.parentId ?? null, title: row.title, content: row.content, version: row.version,
  createdBy: row.createdBy, updatedBy: row.updatedBy, createdAt: row.createdAt, updatedAt: row.updatedAt,
  archivedAt: row.archivedAt ?? null,
});
const summaryView = (row) => ({
  id: row.id, parentId: row.parentId ?? null, title: row.title, version: row.version,
  createdBy: row.createdBy, updatedBy: row.updatedBy, createdAt: row.createdAt, updatedAt: row.updatedAt,
});

export function createWikiRepository(pool) {
  if (!pool) {
    const stop = () => { throw fail('Вики работает только с базой данных PostgreSQL', 'WIKI_UNAVAILABLE', 503); };
    return { enabled: false, list: stop, get: stop, create: stop, update: stop, archive: stop, history: stop, search: stop };
  }

  return {
    enabled: true,

    /** Дети заданной страницы, а без parentId — страницы верхнего уровня. */
    async list(session, { parentId = null } = {}) {
      const { rows } = await pool.query(
        `SELECT ${SUMMARY_COLUMNS} FROM wiki_pages
          WHERE workspace_id=$1 AND archived_at IS NULL AND parent_id IS NOT DISTINCT FROM $2
          ORDER BY title`,
        [session.workspaceId, parentId],
      );
      return rows.map(summaryView);
    },

    async get(session, id) {
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM wiki_pages WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, id]);
      if (!rows[0]) throw fail('Страница не найдена', 'WIKI_PAGE_NOT_FOUND', 404);
      const page = view(rows[0]);
      const { rows: children } = await pool.query(
        `SELECT ${SUMMARY_COLUMNS} FROM wiki_pages WHERE workspace_id=$1 AND parent_id=$2 AND archived_at IS NULL ORDER BY title`,
        [session.workspaceId, id],
      );
      return { ...page, children: children.map(summaryView) };
    },

    async create(session, { title, parentId = null, content = '' } = {}) {
      const cleanTitle = readTitle(title);
      const cleanContent = readContent(content);
      if (parentId) {
        const { rows } = await pool.query('SELECT 1 FROM wiki_pages WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL', [session.workspaceId, parentId]);
        if (!rows[0]) throw fail('Родительская страница не найдена', 'WIKI_PARENT_NOT_FOUND', 404);
      }
      const { rows } = await pool.query(
        `INSERT INTO wiki_pages(organization_id,workspace_id,parent_id,title,content,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING ${COLUMNS}`,
        [session.organizationId, session.workspaceId, parentId, cleanTitle, cleanContent, session.userId],
      );
      return view(rows[0]);
    },

    /**
     * `expectedVersion` обязателен: без него UPDATE отвечал бы всегда,
     * даже если страницу правил кто-то ещё, пока эта форма была открыта.
     * Прежний текст уходит в `wiki_page_versions` в той же транзакции,
     * что и сама правка, — история не может разойтись с фактом правки.
     */
    async update(session, id, { title, content, expectedVersion } = {}) {
      if (expectedVersion === undefined || expectedVersion === null) throw fail('Не указана версия страницы, которую вы редактировали', 'EXPECTED_VERSION_REQUIRED', 400);
      if (title === undefined && content === undefined) throw fail('Нечего менять', 'EMPTY_WIKI_PATCH', 400);
      const nextTitle = title !== undefined ? readTitle(title) : undefined;
      const nextContent = content !== undefined ? readContent(content) : undefined;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: priorRows } = await client.query(
          'SELECT title,content,version FROM wiki_pages WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
          [session.workspaceId, id],
        );
        const prior = priorRows[0];
        if (!prior) throw fail('Страница не найдена', 'WIKI_PAGE_NOT_FOUND', 404);
        if (prior.version !== Number(expectedVersion)) throw fail('Страницу успели изменить, пока вы её редактировали. Обновите её и повторите правку.', 'STALE_VERSION', 409);
        await client.query(
          `INSERT INTO wiki_page_versions(organization_id,workspace_id,page_id,version,title,content,edited_by)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [session.organizationId, session.workspaceId, id, prior.version, prior.title, prior.content, session.userId],
        );
        const { rows } = await client.query(
          `UPDATE wiki_pages SET title=COALESCE($3,title),content=COALESCE($4,content),version=version+1,updated_by=$5,updated_at=now()
             WHERE workspace_id=$1 AND id=$2 RETURNING ${COLUMNS}`,
          [session.workspaceId, id, nextTitle ?? null, nextContent ?? null, session.userId],
        );
        await client.query('COMMIT');
        return view(rows[0]);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async archive(session, id) {
      const { rows } = await pool.query(
        'UPDATE wiki_pages SET archived_at=now() WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING id',
        [session.workspaceId, id],
      );
      if (!rows[0]) throw fail('Страница не найдена', 'WIKI_PAGE_NOT_FOUND', 404);
    },

    async history(session, id) {
      const { rows: exists } = await pool.query('SELECT 1 FROM wiki_pages WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id]);
      if (!exists[0]) throw fail('Страница не найдена', 'WIKI_PAGE_NOT_FOUND', 404);
      const { rows } = await pool.query(
        `SELECT id,version,title,content,edited_by "editedBy",replaced_at "replacedAt"
           FROM wiki_page_versions WHERE workspace_id=$1 AND page_id=$2 ORDER BY replaced_at DESC`,
        [session.workspaceId, id],
      );
      return rows;
    },

    async search(session, { query, limit = 30 } = {}) {
      const q = String(query ?? '').trim();
      if (!q) return [];
      const max = Math.min(Math.max(Number(limit) || 30, 1), 100);
      const { rows } = await pool.query(
        `SELECT ${SUMMARY_COLUMNS}, ts_headline('russian',content,plainto_tsquery('russian',$3),'MaxFragments=1,MaxWords=20') snippet
           FROM wiki_pages
          WHERE workspace_id=$1 AND archived_at IS NULL
            AND (to_tsvector('russian',coalesce(title,'')||' '||coalesce(content,''))@@plainto_tsquery('russian',$3) OR title ILIKE '%'||$3||'%')
          ORDER BY ts_rank_cd(to_tsvector('russian',coalesce(title,'')||' '||coalesce(content,'')),plainto_tsquery('russian',$3)) DESC
          LIMIT $2`,
        [session.workspaceId, max, q],
      );
      return rows.map((row) => ({ ...summaryView(row), snippet: row.snippet }));
    },
  };
}
