import { randomBytes } from 'node:crypto';
import { buildIcsFeed } from './ics-feed.js';

/**
 * Личная .ics-подписка на календарь ChatX.
 *
 * Видимость события здесь — то же правило, что и в самом экране
 * календаря (см. calendar-repository.js expandSeries): свои события,
 * события с visibility='workspace' для всех, кроме гостя, и
 * visibility='participants' — только приглашённым. Подписка не должна
 * стать способом обойти видимость, которую человек и так не видит в
 * приложении.
 *
 * Только PostgreSQL: подписка — не то, что стоит подделывать в памяти.
 */

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode, expose: true });

// Полгода назад и два года вперёд: подписка описывает недавнее прошлое
// и обозримое будущее, а не превращается в неограниченно растущий файл,
// который календарное приложение перечитывает по расписанию.
const WINDOW_PAST_MS = 182 * 86400000;
const WINDOW_FUTURE_MS = 2 * 365 * 86400000;

export function createIcsFeedRepository(pool) {
  if (!pool) {
    const stop = () => { throw fail('Подписка на календарь работает только с базой данных PostgreSQL', 'ICS_FEED_UNAVAILABLE', 503); };
    return { enabled: false, getOrCreateToken: stop, regenerate: stop, renderFeed: stop };
  }

  const newToken = () => randomBytes(24).toString('hex');

  return {
    enabled: true,

    async getOrCreateToken(session) {
      if (session.role === 'guest') throw fail('Подписка на календарь недоступна', 'NOT_FOUND', 404);
      const { rows } = await pool.query('SELECT token FROM calendar_feed_tokens WHERE workspace_id=$1 AND user_id=$2', [session.workspaceId, session.userId]);
      if (rows[0]) return rows[0].token;
      const token = newToken();
      await pool.query(
        `INSERT INTO calendar_feed_tokens(workspace_id,user_id,token) VALUES($1,$2,$3)
         ON CONFLICT (workspace_id,user_id) DO NOTHING`,
        [session.workspaceId, session.userId, token],
      );
      const { rows: after } = await pool.query('SELECT token FROM calendar_feed_tokens WHERE workspace_id=$1 AND user_id=$2', [session.workspaceId, session.userId]);
      return after[0].token;
    },

    async regenerate(session) {
      if (session.role === 'guest') throw fail('Подписка на календарь недоступна', 'NOT_FOUND', 404);
      const token = newToken();
      await pool.query(
        `INSERT INTO calendar_feed_tokens(workspace_id,user_id,token) VALUES($1,$2,$3)
         ON CONFLICT (workspace_id,user_id) DO UPDATE SET token=$3,created_at=now()`,
        [session.workspaceId, session.userId, token],
      );
      return token;
    },

    /** Старая ссылка перестаёт открывать календарь, не трогая новую. */
    async revoke(session) {
      await pool.query('DELETE FROM calendar_feed_tokens WHERE workspace_id=$1 AND user_id=$2', [session.workspaceId, session.userId]);
    },

    async renderFeed(token) {
      const { rows: holders } = await pool.query(
        `SELECT t.workspace_id "workspaceId",t.user_id "userId",m.role,p.display_name "displayName"
           FROM calendar_feed_tokens t
           JOIN memberships m ON m.workspace_id=t.workspace_id AND m.user_id=t.user_id
           LEFT JOIN workspace_profiles p ON p.workspace_id=t.workspace_id AND p.user_id=t.user_id
          WHERE t.token=$1`,
        [token],
      );
      const holder = holders[0];
      if (!holder) throw fail('Ссылка на календарь недействительна', 'ICS_FEED_NOT_FOUND', 404);

      const since = new Date(Date.now() - WINDOW_PAST_MS).toISOString();
      const until = new Date(Date.now() + WINDOW_FUTURE_MS).toISOString();
      const { rows } = await pool.query(
        `SELECT e.id,e.title,e.description,e.start_at "startAt",e.end_at "endAt",e.all_day "allDay",
                e.recurrence_rule "recurrenceRule",e.created_at "createdAt",e.updated_at "updatedAt",
                COALESCE((SELECT jsonb_agg(jsonb_build_object('at',x.occurrence_at,'cancelled',x.cancelled,'startAt',x.start_at,'endAt',x.end_at,'title',x.title))
                   FROM calendar_event_exceptions x WHERE x.workspace_id=e.workspace_id AND x.calendar_event_id=e.id),'[]') exceptions
           FROM calendar_events e
           LEFT JOIN calendar_event_participants pa ON pa.workspace_id=e.workspace_id AND pa.calendar_event_id=e.id AND pa.user_id=$3
          WHERE e.workspace_id=$1
            AND (e.recurrence_rule IS NOT NULL OR (e.start_at>=$4 AND e.start_at<=$5))
            AND (e.owner_id=$3
                 OR (e.visibility='workspace' AND $2<>'guest')
                 OR (e.visibility='participants' AND (pa.user_id IS NOT NULL
                     OR EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.workspace_id=e.workspace_id AND cm.conversation_id=e.conversation_id AND cm.user_id=$3))))
          ORDER BY e.start_at`,
        [holder.workspaceId, holder.role, holder.userId, since, until],
      );
      return buildIcsFeed(rows, { calendarName: `ChatX — ${holder.displayName ?? 'календарь'}` });
    },
  };
}
