/**
 * Who a workspace-wide conversation is actually wide to.
 *
 * `visibility: 'workspace'` is a convenience for staff — a channel nobody has
 * to be invited to. A guest is an outside participant: a client, a contractor,
 * an auditor. Treating them as "part of the workspace" hands them the general
 * channel, the announcements and every other open room, which is how a payroll
 * reminder ends up in front of a customer.
 *
 * A guest therefore reaches a conversation only through an explicit membership
 * row. The clause below is inlined into SQL, and it is safe to inline: it
 * returns one of two fixed strings, chosen by a role that came from the
 * database, never from a request body.
 */
export const GUEST_ROLE = 'guest';

export const isGuest = (session) => session?.role === GUEST_ROLE;

export const openConversationSql = (session, alias = 'c') =>
  (isGuest(session) ? 'false' : `${alias}.visibility IN('workspace','organization')`);

/**
 * Запрос списка бесед — один на всё приложение.
 *
 * Их было два: один в базовом хранилище, другой в надстройке рабочего дня,
 * слово в слово плюс счётчик упоминаний. Копии успели разойтись: в одной
 * непрочитанные считались, в другой возвращался ноль, и какой экран что
 * покажет, зависело от того, какой запрос его обслуживает.
 *
 * `withMentions` добавляет счётчик упоминаний — единственное, чем эти два
 * места когда-либо отличались.
 */
export const conversationListSql = (session, { withMentions = false } = {}) => `
  SELECT c.id,c.kind,
    -- Личная переписка называлась «Диалог» — все сразу, и в списке их было
    -- не различить. Беседа один на один зовётся именем собеседника.
    COALESCE(c.title,CASE WHEN c.kind='direct' THEN (
      SELECT COALESCE(p2.display_name,p2.email)
        FROM conversation_members cm2
        LEFT JOIN workspace_profiles p2 ON p2.workspace_id=cm2.workspace_id AND p2.user_id=cm2.user_id
       WHERE cm2.workspace_id=c.workspace_id AND cm2.conversation_id=c.id AND cm2.user_id<>$2
       LIMIT 1) END) "title",
    c.slug,c.purpose,c.visibility,c.announcement_only "announcementOnly",c.created_at "createdAt",
    cm.archived_at "archivedAt",cm.muted_until "mutedUntil",cm.role "memberRole",
    (SELECT jsonb_build_object('id',m.id,'body',m.body,'kind',m.kind,'authorId',m.author_id,'createdAt',m.created_at)
      FROM messages m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.id AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC,m.id DESC LIMIT 1) "lastMessage",
    COALESCE((SELECT count(*) FROM messages um
      WHERE um.workspace_id=c.workspace_id AND um.conversation_id=c.id AND um.deleted_at IS NULL AND um.author_id<>$2
        AND um.created_at>COALESCE(cm.last_read_at,cm.joined_at,'epoch'::timestamptz)),0)::int "unreadCount"${withMentions ? `,
    COALESCE((SELECT count(*) FROM message_mentions mm JOIN messages xm ON xm.workspace_id=mm.workspace_id AND xm.id=mm.message_id
      WHERE mm.workspace_id=c.workspace_id AND mm.mentioned_user_id=$2 AND xm.conversation_id=c.id AND xm.deleted_at IS NULL
        AND xm.created_at>COALESCE(cm.last_read_at,cm.joined_at,'epoch'::timestamptz)),0)::int "mentionCount"` : ''}
  FROM conversations c
  LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$2
  WHERE c.workspace_id=$1 AND c.archived_at IS NULL AND(${openConversationSql(session, 'c')} OR cm.user_id IS NOT NULL)
    AND(($3::boolean AND cm.archived_at IS NOT NULL) OR (NOT $3::boolean AND cm.archived_at IS NULL))
  ORDER BY COALESCE((SELECT max(created_at) FROM messages m2 WHERE m2.workspace_id=c.workspace_id AND m2.conversation_id=c.id),c.created_at) DESC`;
