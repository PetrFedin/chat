import { pageSize } from '../http/helpers.js';
/**
 * Личные пометки: избранное, выделения маркером и заметки на сообщения.
 *
 * Всё здесь принадлежит одному человеку и никому больше не видно, поэтому
 * каждый запрос ограничен user_id, а не только workspace_id. Проверка
 * доступа к самому объекту остаётся за тем, кто его отдаёт: пометка
 * бесполезна без объекта, а объект отдаётся по своим правилам.
 */

import { openConversationSql, conversationTitleSql } from '../persistence/visibility.js';

const fail = (message, code, statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

/**
 * Пометка ставится на чужую вещь, и право её поставить — это право её
 * видеть. Раньше здесь стоял комментарий «проверяет тот, кто отдаёт
 * беседы»: он был неверен, не проверял никто. Любой сотрудник и даже
 * гость мог повесить заметку на сообщение из чужой личной переписки и
 * прочитать его начало в собственном списке заметок — сервер сам
 * подставлял туда первые сто сорок знаков чужого текста.
 *
 * Условие ниже — то же самое, по которому отдаются беседы: своя комната
 * по членству либо открытый канал для сотрудника, но не для гостя.
 */
const seesConversation = (session, alias = 'c') =>
  `(${openConversationSql(session, alias)} OR EXISTS(
      SELECT 1 FROM conversation_members cm
       WHERE cm.workspace_id=${alias}.workspace_id AND cm.conversation_id=${alias}.id AND cm.user_id=$2))`;

const TARGETS = new Set(['conversation', 'message', 'task', 'event', 'file']);
const COLOURS = new Set(['yellow', 'green', 'pink', 'blue']);
const NOTE_KINDS = new Set(['important', 'remember', 'question', 'note']);

export function createMarkRepository(pool) {
  if (!pool) {
    const stop = () => { throw fail('Marks need the PostgreSQL store', 'MARKS_UNAVAILABLE', 503); };
    return {
      enabled: false,
      favourites: stop, favour: stop, unfavour: stop,
      highlights: stop, highlight: stop, unhighlight: stop,
      notes: stop, note: stop, editNote: stop, removeNote: stop,
    };
  }

  /** Видит ли человек эту беседу — и, значит, вправе ли помечать её содержимое. */
  const mayTouchConversation = async (session, conversationId) => {
    if (!conversationId) throw fail('A mark needs the conversation it belongs to', 'MARK_TARGET_REQUIRED', 400);
    const { rowCount } = await pool.query(
      `SELECT 1 FROM conversations c
        WHERE c.workspace_id=$1 AND c.id=$3 AND c.archived_at IS NULL AND ${seesConversation(session)}`,
      [session.workspaceId, session.userId, conversationId],
    );
    if (!rowCount) throw fail('Not found', 'NOT_FOUND', 404);
  };

  /** То же для сообщения: оно должно лежать в видимой беседе. */
  const mayTouchMessage = async (session, messageId, conversationId) => {
    const { rows } = await pool.query(
      `SELECT m.conversation_id "conversationId" FROM messages m
         JOIN conversations c ON c.workspace_id=m.workspace_id AND c.id=m.conversation_id
        WHERE m.workspace_id=$1 AND m.id=$3 AND ${seesConversation(session)}`,
      [session.workspaceId, session.userId, messageId],
    );
    if (!rows[0]) throw fail('Not found', 'NOT_FOUND', 404);
    // Беседу в запросе не принимаем на веру: пометка ляжет туда, где
    // сообщение лежит на самом деле.
    if (conversationId && conversationId !== rows[0].conversationId) {
      throw fail('That message is not in that conversation', 'MESSAGE_NOT_IN_CONVERSATION', 409);
    }
    return rows[0].conversationId;
  };

  /** Встреча: своя, общая для сотрудников, своя по приглашению или по комнате. */
  const mayTouchEvent = async (session, eventId) => {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM calendar_events e WHERE e.workspace_id=$1 AND e.id=$3 AND (
         e.owner_id=$2
         OR (e.visibility='workspace' AND $4<>'guest')
         OR EXISTS(SELECT 1 FROM calendar_event_participants p
                    WHERE p.workspace_id=e.workspace_id AND p.calendar_event_id=e.id AND p.user_id=$2)
         OR EXISTS(SELECT 1 FROM conversation_members cm
                    WHERE cm.workspace_id=e.workspace_id AND cm.conversation_id=e.conversation_id AND cm.user_id=$2))`,
      [session.workspaceId, session.userId, eventId, session.role],
    );
    if (!rowCount) throw fail('Not found', 'NOT_FOUND', 404);
  };

  /** Файл: свой либо опубликованный в беседе, которую человек видит. */
  const mayTouchFile = async (session, fileId) => {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM files f WHERE f.workspace_id=$1 AND f.id=$3 AND f.deleted_at IS NULL AND (
         f.uploaded_by=$2
         OR EXISTS(SELECT 1 FROM file_links fl
                     JOIN messages m ON m.workspace_id=fl.workspace_id AND fl.entity_type='message' AND fl.entity_id=m.id
                     JOIN conversations c ON c.workspace_id=m.workspace_id AND c.id=m.conversation_id
                    WHERE fl.workspace_id=f.workspace_id AND fl.file_id=f.id
                      AND m.deleted_at IS NULL AND c.archived_at IS NULL AND ${seesConversation(session)}))`,
      [session.workspaceId, session.userId, fileId],
    );
    if (!rowCount) throw fail('Not found', 'NOT_FOUND', 404);
  };

  return {
    enabled: true,

    /**
     * Избранное одним списком с названиями: экран «Избранное» должен
     * показывать, что именно отмечено, а не перечень идентификаторов.
     */
    async favourites(session, { type = null, limit = 200 } = {}) {
      if (type && !TARGETS.has(type)) throw fail('Unknown favourite type', 'INVALID_FAVOURITE_TYPE', 400);
      const { rows } = await pool.query(
        `SELECT f.target_type "targetType", f.target_id "targetId", f.created_at "createdAt",
                CASE f.target_type
                  WHEN 'conversation' THEN (SELECT c.title FROM conversations c WHERE c.workspace_id=f.workspace_id AND c.id=f.target_id)
                  -- Удалённое сообщение и в избранном удалённое: тело
                  -- затёрто в ленте, а здесь оставалось процитированным —
                  -- человек отозвал ошибочную фразу, а у коллеги она
                  -- по-прежнему на виду и ведёт в никуда.
                  WHEN 'message' THEN (SELECT CASE WHEN m.deleted_at IS NULL THEN left(m.body,140) ELSE 'Сообщение удалено' END
                                         FROM messages m WHERE m.workspace_id=f.workspace_id AND m.id=f.target_id)
                  WHEN 'task' THEN (SELECT t.title FROM commitments t WHERE t.workspace_id=f.workspace_id AND t.id=f.target_id)
                  WHEN 'event' THEN (SELECT e.title FROM calendar_events e WHERE e.workspace_id=f.workspace_id AND e.id=f.target_id)
                  WHEN 'file' THEN (SELECT x.name FROM files x WHERE x.workspace_id=f.workspace_id AND x.id=f.target_id)
                END title,
                CASE f.target_type
                  WHEN 'message' THEN (SELECT m.conversation_id FROM messages m WHERE m.workspace_id=f.workspace_id AND m.id=f.target_id)
                  WHEN 'conversation' THEN f.target_id
                END "conversationId"
           FROM favourites f
          WHERE f.workspace_id=$1 AND f.user_id=$2 AND ($3::text IS NULL OR f.target_type=$3)
            AND (f.target_type NOT IN ('event') OR EXISTS(
                  SELECT 1 FROM calendar_events e WHERE e.workspace_id=f.workspace_id AND e.id=f.target_id AND (
                    e.owner_id=$2 OR (e.visibility='workspace' AND $5<>'guest')
                    OR EXISTS(SELECT 1 FROM calendar_event_participants p WHERE p.workspace_id=e.workspace_id AND p.calendar_event_id=e.id AND p.user_id=$2)
                    OR EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.workspace_id=e.workspace_id AND cm.conversation_id=e.conversation_id AND cm.user_id=$2))))
            AND (f.target_type NOT IN ('file') OR EXISTS(
                  SELECT 1 FROM files x WHERE x.workspace_id=f.workspace_id AND x.id=f.target_id AND x.deleted_at IS NULL AND (
                    x.uploaded_by=$2
                    OR EXISTS(SELECT 1 FROM file_links fl
                                JOIN messages m ON m.workspace_id=fl.workspace_id AND fl.entity_type='message' AND fl.entity_id=m.id
                                JOIN conversations c ON c.workspace_id=m.workspace_id AND c.id=m.conversation_id
                               WHERE fl.workspace_id=x.workspace_id AND fl.file_id=x.id AND m.deleted_at IS NULL AND c.archived_at IS NULL AND ${seesConversation(session)}))))
            AND (f.target_type NOT IN ('message','conversation') OR EXISTS(
                  SELECT 1 FROM conversations c
                   WHERE c.workspace_id=f.workspace_id
                     AND c.id = CASE f.target_type
                           WHEN 'conversation' THEN f.target_id
                           ELSE (SELECT m.conversation_id FROM messages m WHERE m.workspace_id=f.workspace_id AND m.id=f.target_id) END
                     AND ${seesConversation(session)}))
          ORDER BY f.created_at DESC LIMIT $4`,
        [session.workspaceId, session.userId, type, pageSize(limit, 200, 500), session.role],
      );
      return rows;
    },

    async favour(session, targetType, targetId) {
      if (!TARGETS.has(targetType)) throw fail('Unknown favourite type', 'INVALID_FAVOURITE_TYPE', 400);
      // Звезда на чужом — тоже доступ к чужому: список избранного
      // показывает название беседы и начало сообщения.
      if (targetType === 'message') await mayTouchMessage(session, targetId, null);
      if (targetType === 'conversation') await mayTouchConversation(session, targetId);
      if (targetType === 'event') await mayTouchEvent(session, targetId);
      if (targetType === 'file') await mayTouchFile(session, targetId);
      if (targetType === 'task') {
        const { rowCount } = await pool.query(
          `SELECT 1 FROM commitments t WHERE t.workspace_id=$1 AND t.id=$2
             AND (t.owner_id=$3 OR t.requester_id=$3 OR t.acceptor_id=$3
                  OR EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=t.workspace_id AND m.user_id=$3 AND m.role IN('owner','admin','manager')))`,
          [session.workspaceId, targetId, session.userId],
        );
        if (!rowCount) throw fail('Not found', 'NOT_FOUND', 404);
      }
      await pool.query(
        `INSERT INTO favourites(organization_id,workspace_id,user_id,target_type,target_id)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [session.organizationId, session.workspaceId, session.userId, targetType, targetId],
      );
      return { favourite: true, targetType, targetId };
    },

    async unfavour(session, targetType, targetId) {
      await pool.query(
        'DELETE FROM favourites WHERE workspace_id=$1 AND user_id=$2 AND target_type=$3 AND target_id=$4',
        [session.workspaceId, session.userId, targetType, targetId],
      );
      return { favourite: false, targetType, targetId };
    },

    /** Выделения: либо все свои, либо только в одной беседе. */
    async highlights(session, { conversationId = null, messageId = null, limit = 300 } = {}) {
      const { rows } = await pool.query(
        `SELECT h.id,h.conversation_id "conversationId",h.message_id "messageId",h.quote,
                h.start_offset "startOffset",h.end_offset "endOffset",h.colour,h.created_at "createdAt",
                ${conversationTitleSql('h.conversation_id','h.workspace_id','$2')} "conversationTitle"
           FROM message_highlights h
          WHERE h.workspace_id=$1 AND h.user_id=$2
            AND ($3::uuid IS NULL OR h.conversation_id=$3)
            AND ($4::uuid IS NULL OR h.message_id=$4)
            AND EXISTS(SELECT 1 FROM conversations c WHERE c.workspace_id=h.workspace_id AND c.id=h.conversation_id AND ${seesConversation(session)})
          ORDER BY h.created_at DESC LIMIT $5`,
        [session.workspaceId, session.userId, conversationId, messageId, pageSize(limit, 300, 500)],
      );
      return rows;
    },

    async highlight(session, body = {}) {
      const quote = String(body.quote ?? '');
      const start = Number(body.startOffset);
      const end = Number(body.endOffset);
      if (!quote.trim()) throw fail('A highlight needs the text it covers', 'INVALID_HIGHLIGHT', 400);
      if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start || start < 0) {
        throw fail('A highlight needs a valid range', 'INVALID_HIGHLIGHT_RANGE', 400);
      }
      const colour = body.colour ?? 'yellow';
      if (!COLOURS.has(colour)) throw fail('Unknown highlight colour', 'INVALID_HIGHLIGHT_COLOUR', 400);
      const conversationId = await mayTouchMessage(session, body.messageId, body.conversationId);

      // Смещения сверяются с самим сообщением, а не только с длиной цитаты.
      //
      // Раньше проверка принимала обе единицы измерения сразу — и кодовые
      // точки, и единицы UTF-16, — так что одно и то же выделение эмодзи
      // было законно и как 7..8, и как 7..9, а рисовалось по одной из них.
      // Смещения 999998..999999 сохранялись без возражений и подсвечивали
      // пустоту. Теперь единица одна — единицы UTF-16, как их считает
      // браузер, — и кусок текста обязан совпасть с цитатой.
      const { rows: source } = await pool.query(
        'SELECT body FROM messages WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL',
        [session.workspaceId, body.messageId],
      );
      const text = source[0]?.body ?? '';
      if (end > text.length || text.slice(start, end) !== quote) {
        throw fail('The highlighted range does not match its text', 'HIGHLIGHT_RANGE_MISMATCH', 400);
      }

      // Сообщение должно существовать и быть в беседе, которую человек
      // действительно видит: проверяет тот, кто отдаёт беседы.
      const { rows } = await pool.query(
        `INSERT INTO message_highlights(organization_id,workspace_id,user_id,conversation_id,message_id,quote,start_offset,end_offset,colour)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id,conversation_id "conversationId",message_id "messageId",quote,
                   start_offset "startOffset",end_offset "endOffset",colour,created_at "createdAt"`,
        [session.organizationId, session.workspaceId, session.userId, conversationId, body.messageId,
         quote.slice(0, 2000), start, end, colour],
      );
      return rows[0];
    },

    async unhighlight(session, id) {
      const { rowCount } = await pool.query(
        'DELETE FROM message_highlights WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
        [session.workspaceId, session.userId, id],
      );
      if (!rowCount) throw fail('Highlight not found', 'HIGHLIGHT_NOT_FOUND', 404);
    },

    async notes(session, { conversationId = null, messageId = null, limit = 300 } = {}) {
      const { rows } = await pool.query(
        `SELECT n.id,n.conversation_id "conversationId",n.message_id "messageId",n.kind,n.body,
                n.created_at "createdAt",n.updated_at "updatedAt",
                ${conversationTitleSql('n.conversation_id','n.workspace_id','$2')} "conversationTitle",
                -- То же и у заметки: своя заметка остаётся, а цитата из
                -- удалённого сообщения — нет.
                (SELECT CASE WHEN m.deleted_at IS NULL THEN left(m.body,140) ELSE 'Сообщение удалено' END
                   FROM messages m WHERE m.workspace_id=n.workspace_id AND m.id=n.message_id) "messagePreview"
           FROM message_notes n
          WHERE n.workspace_id=$1 AND n.user_id=$2
            AND ($3::uuid IS NULL OR n.conversation_id=$3)
            AND ($4::uuid IS NULL OR n.message_id=$4)
            AND EXISTS(SELECT 1 FROM conversations c WHERE c.workspace_id=n.workspace_id AND c.id=n.conversation_id AND ${seesConversation(session)})
          ORDER BY n.created_at DESC LIMIT $5`,
        [session.workspaceId, session.userId, conversationId, messageId, pageSize(limit, 300, 500)],
      );
      return rows;
    },

    async note(session, body = {}) {
      const text = String(body.body ?? '').trim();
      if (!text) throw fail('A note needs text', 'INVALID_NOTE', 400);
      // Раньше длинная заметка молча обрезалась до двух тысяч знаков под
      // ответом «сохранено»: человек терял написанное и узнавал об этом,
      // только вернувшись к ней. Остальные текстовые поля в продукте
      // отказывают — эта тоже.
      if (text.length > 2000) throw fail('A note is at most 2000 characters', 'INVALID_NOTE', 400);
      const kind = body.kind ?? 'note';
      if (!NOTE_KINDS.has(kind)) throw fail('Unknown note kind', 'INVALID_NOTE_KIND', 400);
      const conversationId = await mayTouchMessage(session, body.messageId, body.conversationId);
      const { rows } = await pool.query(
        `INSERT INTO message_notes(organization_id,workspace_id,user_id,conversation_id,message_id,kind,body)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         RETURNING id,conversation_id "conversationId",message_id "messageId",kind,body,created_at "createdAt",updated_at "updatedAt"`,
        [session.organizationId, session.workspaceId, session.userId, conversationId, body.messageId, kind, text],
      );
      return rows[0];
    },

    async editNote(session, id, patch = {}) {
      const sets = [];
      const params = [session.workspaceId, session.userId, id];
      if (patch.body !== undefined) {
        const text = String(patch.body ?? '').trim();
        if (!text) throw fail('A note needs text', 'INVALID_NOTE', 400);
        if (text.length > 2000) throw fail('A note is at most 2000 characters', 'INVALID_NOTE', 400);
        params.push(text); sets.push(`body=$${params.length}`);
      }
      if (patch.kind !== undefined) {
        if (!NOTE_KINDS.has(patch.kind)) throw fail('Unknown note kind', 'INVALID_NOTE_KIND', 400);
        params.push(patch.kind); sets.push(`kind=$${params.length}`);
      }
      if (!sets.length) throw fail('Nothing to change', 'EMPTY_NOTE_PATCH', 400);
      sets.push('updated_at=now()');
      const { rows } = await pool.query(
        `UPDATE message_notes SET ${sets.join(',')} WHERE workspace_id=$1 AND user_id=$2 AND id=$3
         RETURNING id,conversation_id "conversationId",message_id "messageId",kind,body,created_at "createdAt",updated_at "updatedAt"`,
        params,
      );
      if (!rows[0]) throw fail('Note not found', 'NOTE_NOT_FOUND', 404);
      return rows[0];
    },

    async removeNote(session, id) {
      const { rowCount } = await pool.query(
        'DELETE FROM message_notes WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
        [session.workspaceId, session.userId, id],
      );
      if (!rowCount) throw fail('Note not found', 'NOTE_NOT_FOUND', 404);
    },
  };
}
