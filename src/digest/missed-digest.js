import { isGuest } from '../persistence/visibility.js';
import { ACTIVE_TASK_STATUSES } from '../task/task-authority.js';

/**
 * «Что я пропустил».
 *
 * Вопрос, который человек задаёт в понедельник после недели отсутствия,
 * и на который рабочее пространство отвечало единственным способом:
 * листайте всё подряд. У кого сорок бесед, тот не листает — он просто
 * не возвращается к пропущенному, и оно пропадает совсем.
 *
 * Сводка намеренно короткая и отвечает только на «что касается меня»:
 * упоминания, обещания, сроки, прошедшие без меня встречи и беседы, где
 * новее всего. Полный пересказ всего, что произошло в компании, — это
 * та же лента, только в другом порядке.
 */

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 90;

const number = (value) => Number(value ?? 0);

export function createMissedDigest(pool) {
  if (!pool) return null;
  const active = [...ACTIVE_TASK_STATUSES];

  /**
   * С какого момента считать.
   *
   * По умолчанию — когда человек в прошлый раз здесь был: это и есть
   * «пока меня не было». Берём предыдущий сеанс, а не текущий, иначе
   * граница всегда оказывается «только что» и сводка пуста. Если
   * прошлого сеанса не осталось (их подчищает сборщик), отступаем на
   * неделю — лучше показать лишнее, чем ничего.
   */
  async function since(session, from) {
    if (from) {
      const at = new Date(from);
      if (Number.isNaN(at.getTime())) {
        throw Object.assign(new Error('Invalid date'), { code: 'INVALID_DATE', statusCode: 400, expose: true });
      }
      const earliest = Date.now() - MAX_WINDOW_DAYS * 86400000;
      // Слишком давняя граница превращает сводку в ту же ленту.
      return { from: new Date(Math.max(at.getTime(), earliest)).toISOString(), guessed: false };
    }
    const { rows } = await pool.query(
      `SELECT max(last_seen_at) at FROM user_sessions
        WHERE workspace_id=$1 AND user_id=$2 AND id <> $3::uuid AND revoked_at IS NULL`,
      [session.workspaceId, session.userId, session.sessionId ?? null],
    );
    const previous = rows[0]?.at ? new Date(rows[0].at) : null;
    const fallback = new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86400000);
    const earliest = new Date(Date.now() - MAX_WINDOW_DAYS * 86400000);
    if (!previous || previous < earliest) return { from: fallback.toISOString(), guessed: true };
    return { from: previous.toISOString(), guessed: true };
  }

  return {
    async build(session, { from = null } = {}) {
      if (isGuest(session)) {
        // Гостю сводка тоже нужна, но только по тому, что ему видно:
        // упоминания и его беседы. Обязательств и встреч компании у него
        // нет, и пустые разделы ему показывать незачем.
        return guestDigest(session, await since(session, from));
      }
      const window = await since(session, from);
      const params = [session.workspaceId, session.userId, window.from];
      // Два раздела спрашивают не про отрезок, а про «прямо сейчас»:
      // что ждёт вашего ответа. Границу периода им передавать нечем, а
      // лишний параметр запрос не выполнит — его не из чего вывести.
      const now = [session.workspaceId, session.userId];

      const [mentions, awaiting, slipped, moved, meetings, invitations, joined, rooms] = await Promise.all([
        // Упоминания — то, на что человека звали лично.
        pool.query(
          `SELECT m.id, m.conversation_id "conversationId", m.body, m.created_at "createdAt",
                  m.author_id "authorId", COALESCE(ap.display_name, au.email) "authorName",
                  c.title "conversationTitle", c.kind
             FROM message_mentions mm
             JOIN messages m ON m.workspace_id=mm.workspace_id AND m.id=mm.message_id
             JOIN conversations c ON c.workspace_id=m.workspace_id AND c.id=m.conversation_id
             JOIN users au ON au.id=m.author_id
             LEFT JOIN workspace_profiles ap ON ap.workspace_id=m.workspace_id AND ap.user_id=m.author_id
            WHERE mm.workspace_id=$1 AND mm.mentioned_user_id=$2
              AND m.created_at > $3 AND m.deleted_at IS NULL
            ORDER BY m.created_at DESC LIMIT 20`, params),

        // Дела, где ход за вами.
        //
        // Раздел показывал только предложенные обязательства — то есть
        // один случай из трёх. Работа, сданная вам на приёмку, и
        // принятый результат, который некому закрыть, ждут ответа не
        // меньше: пока вы не ответите, не движется никто. Понедельничная
        // сводка о них молчала, и человек с чужой работой на руках читал
        // «всё разобрано».
        pool.query(
          `SELECT c.id, c.title, c.status, c.promised_at "promisedAt", c.created_at "createdAt",
                  COALESCE(rp.display_name, ru.email) "requesterName",
                  COALESCE(op.display_name, ou.email) "ownerName"
             FROM commitments c
             JOIN users ru ON ru.id=c.requester_id
             JOIN users ou ON ou.id=c.owner_id
             LEFT JOIN workspace_profiles rp ON rp.workspace_id=c.workspace_id AND rp.user_id=c.requester_id
             LEFT JOIN workspace_profiles op ON op.workspace_id=c.workspace_id AND op.user_id=c.owner_id
            WHERE c.workspace_id=$1 AND (
                    (c.status='proposed' AND c.owner_id=$2)
                 OR (c.status='in_review' AND c.acceptor_id=$2)
                 OR (c.status='accepted_result' AND (c.requester_id=$2 OR c.acceptor_id=$2)))
            ORDER BY c.created_at DESC LIMIT 20`, now),

        // Сроки, прошедшие, пока вас не было: срок наступил внутри
        // отрезка, а обязательство всё ещё открыто.
        pool.query(
          `SELECT c.id, c.title, c.promised_at "promisedAt", c.status,
                  c.owner_id "ownerId", COALESCE(op.display_name, ou.email) "ownerName"
             FROM commitments c
             JOIN users ou ON ou.id=c.owner_id
             LEFT JOIN workspace_profiles op ON op.workspace_id=c.workspace_id AND op.user_id=c.owner_id
            WHERE c.workspace_id=$1 AND (c.owner_id=$2 OR c.requester_id=$2 OR c.acceptor_id=$2)
              AND c.status = ANY($4) AND c.promised_at > $3 AND c.promised_at < now()
            ORDER BY c.promised_at LIMIT 20`, [...params, active]),

        // Что сдвинулось в ваших обязательствах без вас: переходы,
        // сделанные кем-то другим.
        pool.query(
          // По строке на обязательство, а не на переход: задача, прошедшая
          // за неделю четыре состояния, — это одна новость, а не четыре.
          // Показываем последнее движение и откуда она в него пришла.
          `SELECT DISTINCT ON (a.aggregate_id)
                  a.aggregate_id id, c.title, a.event_type "eventType",
                  a.payload->>'to' "to", a.payload->>'from' "from",
                  a.payload->>'promisedAt' "promisedAt", a.payload->>'previousPromisedAt' "previousPromisedAt",
                  a.payload->>'reason' "reason",
                  a.created_at "at", COALESCE(ap.display_name, au.email) "actorName"
             FROM audit_events a
             JOIN commitments c ON c.workspace_id=a.workspace_id AND c.id=a.aggregate_id
             JOIN users au ON au.id=a.actor_id
             LEFT JOIN workspace_profiles ap ON ap.workspace_id=a.workspace_id AND ap.user_id=a.actor_id
            WHERE a.workspace_id=$1 AND a.aggregate_type='commitment'
              -- Читались только переходы по состояниям. Передача задачи
              -- другому человеку и перенос срока — тоже движение, и
              -- именно они происходят без ведома того, кого касаются:
              -- новый владелец узнавал о своём обязательстве, только
              -- открыв список задач, а уехавший срок не показывался
              -- вовсе. Оба события в журнале лежали с первого дня.
              AND a.event_type IN ('commitment.transitioned','commitment.reassigned','commitment.rescheduled')
              AND a.created_at > $3
              AND a.actor_id <> $2
              AND (c.owner_id=$2 OR c.requester_id=$2 OR c.acceptor_id=$2)
            ORDER BY a.aggregate_id, a.created_at DESC LIMIT 20`, params),

        // Встречи, прошедшие без вас. «Без вас» буквально: вы значились
        // участником и не ответили «приду».
        pool.query(
          `SELECT e.id, e.title, e.start_at "startAt",
                  COALESCE(op.display_name, ou.email) "organiserName", p.response_status "response"
             FROM calendar_event_participants p
             JOIN calendar_events e ON e.workspace_id=p.workspace_id AND e.id=p.calendar_event_id
             JOIN users ou ON ou.id=e.owner_id
             LEFT JOIN workspace_profiles op ON op.workspace_id=e.workspace_id AND op.user_id=e.owner_id
            WHERE p.workspace_id=$1 AND p.user_id=$2
              AND e.start_at > $3 AND e.start_at < now()
            ORDER BY e.start_at DESC LIMIT 20`, params),

        // Приглашения, которые ещё ждут ответа, — даже если встреча
        // назначена на будущее: это то, что от вас нужно прямо сейчас.
        pool.query(
          `SELECT e.id, e.title, e.start_at "startAt",
                  COALESCE(op.display_name, ou.email) "organiserName"
             FROM calendar_event_participants p
             JOIN calendar_events e ON e.workspace_id=p.workspace_id AND e.id=p.calendar_event_id
             JOIN users ou ON ou.id=e.owner_id
             LEFT JOIN workspace_profiles op ON op.workspace_id=e.workspace_id AND op.user_id=e.owner_id
            WHERE p.workspace_id=$1 AND p.user_id=$2 AND p.response_status='invited'
              AND e.start_at >= now()
            ORDER BY e.start_at LIMIT 20`, now),

        // Кто появился в компании: по возвращении полезнее всего знать,
        // с кем теперь здороваться.
        pool.query(
          `SELECT m.user_id "userId", COALESCE(wp.display_name, u.email) "displayName",
                  wp.title, m.role, m.created_at "joinedAt"
             FROM memberships m
             JOIN users u ON u.id=m.user_id
             LEFT JOIN workspace_profiles wp ON wp.workspace_id=m.workspace_id AND wp.user_id=m.user_id
            WHERE m.workspace_id=$1 AND m.created_at > $3 AND m.user_id <> $2
              AND m.role <> 'guest' AND u.disabled_at IS NULL
            ORDER BY m.created_at DESC LIMIT 10`, params),

        // Беседы, где больше всего нового. Не пересказ — только куда
        // стоит заглянуть и насколько там накопилось.
        pool.query(
          `SELECT c.id, c.kind, c.title,
                  -- В ленте и в ветках считаем отдельно: «два новых»,
                  -- когда в самой беседе видно одно, — это не подсказка,
                  -- а повод искать несуществующее.
                  count(m.id) FILTER (WHERE m.thread_root_id IS NULL)::int "newMessages",
                  count(m.id) FILTER (WHERE m.thread_root_id IS NOT NULL)::int "newInThreads",
                  max(m.created_at) "lastAt"
             FROM conversation_members cm
             JOIN conversations c ON c.workspace_id=cm.workspace_id AND c.id=cm.conversation_id
             JOIN messages m ON m.workspace_id=c.workspace_id AND m.conversation_id=c.id
            WHERE cm.workspace_id=$1 AND cm.user_id=$2 AND cm.archived_at IS NULL
              AND c.archived_at IS NULL AND m.deleted_at IS NULL
              AND m.author_id <> $2
              AND m.created_at > GREATEST($3::timestamptz, COALESCE(cm.last_read_at, $3::timestamptz))
            GROUP BY c.id, c.kind, c.title
            ORDER BY count(m.id) DESC LIMIT 10`, params),
      ]);

      const digest = {
        since: window.from,
        guessedSince: window.guessed,
        mentions: mentions.rows.map((row) => ({
          messageId: row.id,
          conversationId: row.conversationId,
          conversationTitle: row.conversationTitle,
          kind: row.kind,
          authorId: row.authorId,
          authorName: row.authorName,
          // Достаточно, чтобы вспомнить, о чём речь, и решить, идти ли.
          snippet: String(row.body ?? '').slice(0, 200),
          createdAt: row.createdAt,
        })),
        awaitingYourAnswer: awaiting.rows,
        slippedDeadlines: slipped.rows,
        movedWithoutYou: moved.rows,
        meetingsHeld: meetings.rows.map((row) => ({ ...row, attended: row.response === 'accepted' })),
        invitations: invitations.rows,
        joined: joined.rows,
        busiest: rooms.rows.map((row) => ({ ...row, newMessages: number(row.newMessages), newInThreads: number(row.newInThreads) })),
      };
      digest.empty = !Object.entries(digest)
        .filter(([key]) => Array.isArray(digest[key]))
        .some(([, value]) => value.length);
      return digest;
    },
  };

  /** У гостя нет ни обязательств, ни встреч компании — только беседы. */
  async function guestDigest(session, window) {
    const params = [session.workspaceId, session.userId, window.from];
    const [mentions, rooms] = await Promise.all([
      pool.query(
        `SELECT m.id, m.conversation_id "conversationId", m.body, m.created_at "createdAt",
                m.author_id "authorId", COALESCE(ap.display_name, au.email) "authorName",
                c.title "conversationTitle", c.kind
           FROM message_mentions mm
           JOIN messages m ON m.workspace_id=mm.workspace_id AND m.id=mm.message_id
           JOIN conversations c ON c.workspace_id=m.workspace_id AND c.id=m.conversation_id
           JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$2
           JOIN users au ON au.id=m.author_id
           LEFT JOIN workspace_profiles ap ON ap.workspace_id=m.workspace_id AND ap.user_id=m.author_id
          WHERE mm.workspace_id=$1 AND mm.mentioned_user_id=$2
            AND m.created_at > $3 AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC LIMIT 20`, params),
      pool.query(
        `SELECT c.id, c.kind, c.title,
                count(m.id) FILTER (WHERE m.thread_root_id IS NULL)::int "newMessages",
                count(m.id) FILTER (WHERE m.thread_root_id IS NOT NULL)::int "newInThreads",
                max(m.created_at) "lastAt"
           FROM conversation_members cm
           JOIN conversations c ON c.workspace_id=cm.workspace_id AND c.id=cm.conversation_id
           JOIN messages m ON m.workspace_id=c.workspace_id AND m.conversation_id=c.id
          WHERE cm.workspace_id=$1 AND cm.user_id=$2 AND cm.archived_at IS NULL
            AND c.archived_at IS NULL AND m.deleted_at IS NULL AND m.author_id <> $2
            AND m.created_at > GREATEST($3::timestamptz, COALESCE(cm.last_read_at, $3::timestamptz))
          GROUP BY c.id, c.kind, c.title
          ORDER BY count(m.id) DESC LIMIT 10`, params),
    ]);
    const digest = {
      since: window.from,
      guessedSince: window.guessed,
      mentions: mentions.rows.map((row) => ({
        messageId: row.id,
        conversationId: row.conversationId,
        conversationTitle: row.conversationTitle,
        kind: row.kind,
        authorId: row.authorId,
        authorName: row.authorName,
        snippet: String(row.body ?? '').slice(0, 200),
        createdAt: row.createdAt,
      })),
      awaitingYourAnswer: [],
      slippedDeadlines: [],
      movedWithoutYou: [],
      meetingsHeld: [],
      invitations: [],
      joined: [],
      busiest: rooms.rows.map((row) => ({ ...row, newMessages: number(row.newMessages), newInThreads: number(row.newInThreads) })),
    };
    digest.empty = !digest.mentions.length && !digest.busiest.length;
    return digest;
  }
}
