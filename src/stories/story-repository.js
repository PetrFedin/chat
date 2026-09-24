import { AVATAR_TYPES } from '../media/avatar.js';

/**
 * Сторис: как выглядит работа сегодня.
 *
 * Привезли, залили, смонтировали — показать это было негде:
 * фотография уходила в беседу и через день тонула под перепиской.
 * Сторис живут сутки и заменяют десяток «смотрите, как получилось» в
 * общем канале, а снятое остаётся в личном архиве автора.
 *
 * Гости их не видят и не публикуют: гость — чужой сотрудник в одной
 * комнате, а сторис показывают всей компании.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const forbidden = () => Object.assign(
  new Error('Сторис — для сотрудников компании'),
  { code: 'STORIES_FORBIDDEN', statusCode: 403, expose: true },
);

const notFound = () => Object.assign(new Error('Сторис не найдена'), { code: 'STORY_NOT_FOUND', statusCode: 404 });

export function createStories(pool, store) {
  if (!pool) return null;

  const view = (row) => ({
    id: row.id,
    authorId: row.authorId,
    authorName: row.authorName,
    caption: row.caption,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    url: `/api/v1/files/${row.fileId}/content`,
    seen: row.seen ?? false,
    views: row.views ?? 0,
  });

  return {
    /**
     * Опубликовать снимок.
     *
     * Снимок приходит ссылкой на уже загруженный файл — тем же путём,
     * что и любое вложение, с теми же проверками типа и размера.
     */
    async publish(session, { fileId, caption = null, hours = 24 }) {
      if (session.role === 'guest') throw forbidden();
      const file = await store.getFile?.(session, fileId);
      if (!file) throw Object.assign(new Error('Файл не найден'), { code: 'FILE_NOT_FOUND', statusCode: 404, expose: true });
      if (!AVATAR_TYPES.has(String(file.mimeType ?? '').toLowerCase())) {
        throw Object.assign(new Error('В сторис идёт фотография: jpeg, png, webp, gif или avif'),
          { code: 'INVALID_STORY_TYPE', statusCode: 400, expose: true });
      }
      const live = Math.min(Math.max(Number(hours) || 24, 1), 72);
      const { rows } = await pool.query(
        `INSERT INTO stories(organization_id,workspace_id,author_id,file_id,caption,expires_at)
         VALUES($1,$2,$3,$4,$5,now() + ($6 || ' hours')::interval)
         RETURNING id, author_id "authorId", file_id "fileId", caption, created_at "createdAt", expires_at "expiresAt"`,
        [session.organizationId, session.workspaceId, session.userId, fileId,
          caption ? String(caption).slice(0, 300) : null, String(live)],
      );
      return view({ ...rows[0], authorName: session.displayName, views: 0, seen: true });
    },

    /**
     * Что сейчас идёт — по всей компании, свежее сверху.
     *
     * Свои показываем тоже: автор должен видеть, что он опубликовал и
     * сколько человек это посмотрело.
     */
    async live(session) {
      if (session.role === 'guest') return [];
      const { rows } = await pool.query(
        `SELECT s.id, s.author_id "authorId", s.file_id "fileId", s.caption,
                s.created_at "createdAt", s.expires_at "expiresAt",
                COALESCE(p.display_name, u.email) "authorName",
                -- Своя сторис всегда просмотрена: автор её не «смотрит»,
                -- поэтому строки в просмотрах у него нет и рамка «новое»
                -- горела на собственной записи до самого конца её жизни.
                (s.author_id=$2 OR EXISTS(SELECT 1 FROM story_views v WHERE v.story_id=s.id AND v.user_id=$2)) seen,
                (SELECT count(*)::int FROM story_views v WHERE v.story_id=s.id) views
           FROM stories s
           JOIN users u ON u.id=s.author_id
           LEFT JOIN workspace_profiles p ON p.workspace_id=s.workspace_id AND p.user_id=s.author_id
          WHERE s.workspace_id=$1 AND s.deleted_at IS NULL AND s.expires_at > now()
          ORDER BY s.created_at DESC LIMIT 100`,
        [session.workspaceId, session.userId],
      );
      return rows.map(view);
    },

    /**
     * Свой архив: всё снятое, включая погасшее.
     *
     * Ради него сторис и держат в компании — «когда мы это заливали»
     * через полгода отвечается снимком, а не памятью.
     */
    async archive(session, { limit = 60 } = {}) {
      if (session.role === 'guest') return [];
      const { rows } = await pool.query(
        `SELECT s.id, s.author_id "authorId", s.file_id "fileId", s.caption,
                s.created_at "createdAt", s.expires_at "expiresAt",
                COALESCE(p.display_name, u.email) "authorName",
                true seen,
                (SELECT count(*)::int FROM story_views v WHERE v.story_id=s.id) views
           FROM stories s
           JOIN users u ON u.id=s.author_id
           LEFT JOIN workspace_profiles p ON p.workspace_id=s.workspace_id AND p.user_id=s.author_id
          WHERE s.workspace_id=$1 AND s.author_id=$2 AND s.deleted_at IS NULL
          ORDER BY s.created_at DESC LIMIT $3`,
        [session.workspaceId, session.userId, Math.min(Number(limit) || 60, 200)],
      );
      return rows.map((row) => ({ ...view(row), live: new Date(row.expiresAt) > new Date() }));
    },

    /** Отметка о просмотре: автору видно, кто посмотрел. */
    async seen(session, storyId) {
      if (session.role === 'guest') throw forbidden();
      const { rowCount } = await pool.query(
        `INSERT INTO story_views(workspace_id,story_id,user_id)
         SELECT $1,$2,$3 FROM stories s
          WHERE s.id=$2 AND s.workspace_id=$1 AND s.deleted_at IS NULL
         ON CONFLICT DO NOTHING`,
        [session.workspaceId, storyId, session.userId],
      );
      return { seen: true, first: rowCount > 0 };
    },

    /** Кто посмотрел — только автору. */
    async viewers(session, storyId) {
      const { rows } = await pool.query(
        `SELECT v.user_id "userId", COALESCE(p.display_name, u.email) "displayName", v.seen_at "seenAt"
           FROM story_views v
           JOIN stories s ON s.id=v.story_id
           JOIN users u ON u.id=v.user_id
           LEFT JOIN workspace_profiles p ON p.workspace_id=v.workspace_id AND p.user_id=v.user_id
          WHERE v.story_id=$1 AND s.workspace_id=$2 AND s.author_id=$3
          ORDER BY v.seen_at DESC`,
        [storyId, session.workspaceId, session.userId],
      );
      return rows;
    },

    /** Убрать свою — до срока. */
    async remove(session, storyId) {
      const { rows } = await pool.query(
        `UPDATE stories SET deleted_at=now()
          WHERE id=$1 AND workspace_id=$2 AND author_id=$3 AND deleted_at IS NULL
          RETURNING id`,
        [storyId, session.workspaceId, session.userId],
      );
      if (!rows[0]) throw notFound();
      return { removed: true };
    },
  };
}

export const STORY_DEFAULT_MS = DAY_MS;
