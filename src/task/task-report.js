import { isGuest } from '../persistence/visibility.js';
import { ACTIVE_TASK_STATUSES, managesTeamTasks } from './task-authority.js';

/**
 * Отчётность по обязательствам и людям.
 *
 * Продукт стоит на мысли, что задача — это обещание одного человека
 * другому, и при этом не мог ответить ни на один вопрос, который из
 * этой мысли следует: держим ли мы слово, на ком сейчас больше, чем он
 * потянет, что застряло и у кого, кто чаще всего просит и кого.
 *
 * Считаем намеренно скучно. Ни «продуктивности», ни баллов, ни рейтинга
 * сотрудников: такие числа в рабочем пространстве начинают жить своей
 * жизнью и меняют поведение людей раньше, чем что-нибудь объясняют.
 * Здесь только то, что человек и так знает про себя, — собранное в одном
 * месте и посчитанное одинаково для всех.
 */

const DEFAULT_WINDOW_DAYS = 30;

/** Отрезок отчёта. По умолчанию — последние тридцать дней. */
export function reportRange({ from = null, to = null } = {}) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - DEFAULT_WINDOW_DAYS * 86400000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw Object.assign(new Error('Invalid report range'), { code: 'INVALID_DATE', statusCode: 400, expose: true });
  }
  if (start > end) {
    throw Object.assign(new Error('Report range starts after it ends'), { code: 'INVALID_RANGE', statusCode: 400, expose: true });
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

const number = (value) => Number(value ?? 0);

/** Доля в процентах, когда знаменатель есть; иначе null, а не ноль. */
const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

export function createTaskReport(pool) {
  if (!pool) return null;
  const active = [...ACTIVE_TASK_STATUSES];

  return {
    /**
     * Отчёт по компании или по одному человеку.
     *
     * Кто ведёт чужие задачи — видит всех; остальные видят себя. Это то
     * же правило, по которому работает список задач, и другого здесь
     * быть не может: отчёт не должен показывать больше, чем экран.
     */
    async build(session, { from = null, to = null, scope = 'team' } = {}) {
      if (isGuest(session)) {
        throw Object.assign(new Error('Guests have no commitments'), { code: 'FORBIDDEN', statusCode: 403 });
      }
      const range = reportRange({ from, to });
      const wholeTeam = managesTeamTasks(session) && scope !== 'mine';
      // Список параметров у каждого запроса свой, ровно по тому, что он
      // спрашивает. Общий список на все четыре не годится: параметр, не
      // упомянутый в запросе, не из чего вывести по типу, и база
      // отказывается выполнять запрос целиком.
      const full = [session.workspaceId, range.from, range.to, active, session.userId, wholeTeam];
      const dated = [session.workspaceId, range.from, range.to, session.userId, wholeTeam];
      const plain = [session.workspaceId, session.userId, wholeTeam];
      // Ограничение по человеку снимается признаком, а не отсутствием
      // условия: так оно одинаково во всех запросах, а не в трёх из
      // четырёх, и его нельзя забыть в новом.
      const onlyMine = (userAt, teamAt, alias = 'c') =>
        ` AND ($${teamAt} OR ${alias}.owner_id=$${userAt} OR ${alias}.requester_id=$${userAt} OR ${alias}.acceptor_id=$${userAt})`;
      const mine = onlyMine(5, 6);

      const [totals, people, stuck, pairs] = await Promise.all([
        pool.query(
          `SELECT
             count(*) FILTER (WHERE c.created_at BETWEEN $2 AND $3)::int created,
             count(*) FILTER (WHERE c.closed_at BETWEEN $2 AND $3 AND c.status IN('closed','accepted_result'))::int closed,
             count(*) FILTER (WHERE c.closed_at BETWEEN $2 AND $3 AND c.status IN('cancelled','rejected'))::int dropped,
             -- «В срок» считается только среди тех, кому срок обещали.
             count(*) FILTER (WHERE c.closed_at BETWEEN $2 AND $3 AND c.status IN('closed','accepted_result')
                              AND c.promised_at IS NOT NULL)::int promised,
             count(*) FILTER (WHERE c.closed_at BETWEEN $2 AND $3 AND c.status IN('closed','accepted_result')
                              AND c.promised_at IS NOT NULL AND c.closed_at <= c.promised_at)::int on_time,
             count(*) FILTER (WHERE c.status = ANY($4))::int open,
             count(*) FILTER (WHERE c.status = ANY($4) AND c.promised_at < now())::int overdue,
             count(*) FILTER (WHERE c.status = ANY($4) AND c.promised_at IS NULL)::int undated,
             count(*) FILTER (WHERE c.status='proposed')::int awaiting_answer,
             EXTRACT(EPOCH FROM (now() - min(c.promised_at) FILTER (WHERE c.status = ANY($4) AND c.promised_at < now())))::int oldest_overdue_sec
           FROM commitments c WHERE c.workspace_id=$1${mine}`, full),

        pool.query(
          `SELECT p.user_id "userId",
                  COALESCE(wp.display_name, u.email) "displayName",
                  p.role,
                  count(c.id) FILTER (WHERE c.status = ANY($4))::int open,
                  count(c.id) FILTER (WHERE c.status = ANY($4) AND c.promised_at < now())::int overdue,
                  count(c.id) FILTER (WHERE c.status = ANY($4) AND c.promised_at BETWEEN now() AND now() + interval '24 hours')::int "dueSoon",
                  count(c.id) FILTER (WHERE c.status='proposed')::int "awaitingAnswer",
                  count(c.id) FILTER (WHERE c.closed_at BETWEEN $2 AND $3 AND c.status IN('closed','accepted_result'))::int closed,
                  count(c.id) FILTER (WHERE c.closed_at BETWEEN $2 AND $3 AND c.status IN('closed','accepted_result')
                                      AND c.promised_at IS NOT NULL)::int promised,
                  count(c.id) FILTER (WHERE c.closed_at BETWEEN $2 AND $3 AND c.status IN('closed','accepted_result')
                                      AND c.promised_at IS NOT NULL AND c.closed_at <= c.promised_at)::int "onTime",
                  -- Насколько опаздывают, когда опаздывают: одно
                  -- просроченное на день и одно на квартал — разные
                  -- разговоры, а в доле они неразличимы.
                  COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (c.closed_at - c.promised_at)) / 3600)
                    FILTER (WHERE c.closed_at BETWEEN $2 AND $3 AND c.status IN('closed','accepted_result')
                            AND c.promised_at IS NOT NULL AND c.closed_at > c.promised_at)), 0)::int "avgLateHours"
             FROM memberships p
             JOIN users u ON u.id = p.user_id
             LEFT JOIN workspace_profiles wp ON wp.workspace_id = p.workspace_id AND wp.user_id = p.user_id
             LEFT JOIN commitments c ON c.workspace_id = p.workspace_id AND c.owner_id = p.user_id${mine}
            WHERE p.workspace_id=$1 AND p.role <> 'guest' AND u.disabled_at IS NULL
              AND ($6 OR p.user_id=$5)
            GROUP BY p.user_id, wp.display_name, u.email, p.role
            ORDER BY overdue DESC, open DESC, "displayName"`, full),

        // Застрявшее: не просрочено, но и не двигается. Просрочку видно
        // и так, а вот обязательство, которое третью неделю «заблокировано»,
        // не видно нигде — и именно оно чаще всего оказывается забытым.
        pool.query(
          `SELECT c.id, c.title, c.status, c.owner_id "ownerId",
                  COALESCE(wp.display_name, u.email) "ownerName",
                  c.promised_at "promisedAt", c.updated_at "updatedAt",
                  EXTRACT(EPOCH FROM (now() - c.updated_at))::int "stillSec"
             FROM commitments c
             JOIN users u ON u.id = c.owner_id
             LEFT JOIN workspace_profiles wp ON wp.workspace_id = c.workspace_id AND wp.user_id = c.owner_id
            WHERE c.workspace_id=$1${onlyMine(2, 3)}
              AND c.status IN ('blocked','deferred','clarify','proposed')
              AND c.updated_at < now() - interval '7 days'
            ORDER BY c.updated_at LIMIT 20`, plain),

        // Кто кого просит. Не для рейтинга, а для ответа на вопрос
        // «почему на этом человеке столько» — обычно потому, что просят
        // его одного.
        pool.query(
          `SELECT c.requester_id "requesterId", c.owner_id "ownerId",
                  COALESCE(rp.display_name, ru.email) "requesterName",
                  COALESCE(op.display_name, ou.email) "ownerName",
                  count(*)::int n
             FROM commitments c
             JOIN users ru ON ru.id = c.requester_id
             JOIN users ou ON ou.id = c.owner_id
             LEFT JOIN workspace_profiles rp ON rp.workspace_id=c.workspace_id AND rp.user_id=c.requester_id
             LEFT JOIN workspace_profiles op ON op.workspace_id=c.workspace_id AND op.user_id=c.owner_id
            WHERE c.workspace_id=$1${onlyMine(4, 5)}
              AND c.created_at BETWEEN $2 AND $3
              AND c.requester_id <> c.owner_id
            GROUP BY c.requester_id, c.owner_id, rp.display_name, ru.email, op.display_name, ou.email
            ORDER BY n DESC LIMIT 10`, dated),
      ]);

      const t = totals.rows[0] ?? {};
      return {
        range,
        scope: wholeTeam ? 'team' : 'mine',
        totals: {
          created: number(t.created),
          closed: number(t.closed),
          dropped: number(t.dropped),
          open: number(t.open),
          overdue: number(t.overdue),
          undated: number(t.undated),
          awaitingAnswer: number(t.awaiting_answer),
          // Ровно та цифра, ради которой всё остальное: из закрытых с
          // обещанным сроком — сколько закрыли до него. null, когда
          // сроков никто не обещал: ноль процентов здесь означал бы
          // «все опоздали», а это неправда.
          keptPromises: share(number(t.on_time), number(t.promised)),
          promised: number(t.promised),
          onTime: number(t.on_time),
          oldestOverdueSec: number(t.oldest_overdue_sec),
        },
        people: people.rows.map((row) => ({
          userId: row.userId,
          displayName: row.displayName,
          role: row.role,
          open: number(row.open),
          overdue: number(row.overdue),
          dueSoon: number(row.dueSoon),
          awaitingAnswer: number(row.awaitingAnswer),
          closed: number(row.closed),
          onTime: number(row.onTime),
          keptPromises: share(number(row.onTime), number(row.promised)),
          avgLateHours: number(row.avgLateHours),
        })),
        stuck: stuck.rows.map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          ownerId: row.ownerId,
          ownerName: row.ownerName,
          promisedAt: row.promisedAt,
          stillDays: Math.floor(number(row.stillSec) / 86400),
        })),
        pairs: pairs.rows.map((row) => ({
          requesterId: row.requesterId,
          requesterName: row.requesterName,
          ownerId: row.ownerId,
          ownerName: row.ownerName,
          count: number(row.n),
        })),
      };
    },
  };
}
