/**
 * Настройки уведомлений.
 *
 * Уведомления были устроены по принципу «всё или ничего»: ни тихих
 * часов, ни выбора, о чём присылать. В пространстве с сорока каналами
 * это первая причина выключить их совсем — и вместе с рекламой чужого
 * канала человек перестаёт получать упоминания и просроченные сроки, то
 * есть ровно то, ради чего уведомления и нужны.
 *
 * Переключателей намеренно мало, и они по смыслу, а не по типам
 * событий: человек думает «меня позвали» и «сроки», а не
 * «message.mentioned» и «task.rescheduled».
 */

/** Какой переключатель отвечает за какой тип события. */
const SWITCH_OF = new Map(Object.entries({
  'message.mentioned': 'mentions',
  'message.created': 'channels',
  'message.direct': 'direct',
  'task.assigned': 'tasks',
  'task.updated': 'tasks',
  'task.rescheduled': 'tasks',
  'review.requested': 'tasks',
  'calendar.invited': 'calendar',
  'calendar.updated': 'calendar',
  'calendar.cancelled': 'calendar',
  'calendar.responded': 'calendar',
  'calendar.reminder': 'calendar',
  'meeting.review_ready': 'meetings',
  'call.incoming': 'direct',
  'game.move': 'channels',
}));

export const SWITCHES = ['mentions', 'direct', 'channels', 'tasks', 'calendar', 'meetings'];

const DEFAULTS = Object.freeze({
  mentions: true, direct: true, channels: true, tasks: true, calendar: true, meetings: true,
  quietFrom: null, quietTo: null, quietAllowMentions: true,
  // Письмо — единственное, что выключено по умолчанию: см. save().
  dailyDigest: false, digestHour: 8,
});

/**
 * Идёт ли сейчас тихий час по местному времени человека.
 *
 * Интервал может переходить через полночь — «с 22 до 8» встречается
 * чаще, чем «с 9 до 18», и считать его как `from <= h < to` нельзя:
 * получится пустой промежуток.
 */
export function inQuietHours({ quietFrom, quietTo, timezone }, at = new Date()) {
  if (quietFrom === null || quietFrom === undefined || quietTo === null || quietTo === undefined) return false;
  if (quietFrom === quietTo) return false;
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone || 'UTC', hour: '2-digit', hour12: false }).format(at)) % 24;
  } catch {
    // Пояс из профиля может оказаться мусором; тишина по ошибочному
    // поясу хуже, чем её отсутствие — человек просто не узнает о срочном.
    return false;
  }
  return quietFrom < quietTo ? hour >= quietFrom && hour < quietTo : hour >= quietFrom || hour < quietTo;
}

/** Пропускать ли этому человеку уведомление такого типа прямо сейчас. */
export function allows(preference, type, at = new Date()) {
  const settings = { ...DEFAULTS, ...(preference ?? {}) };
  const name = SWITCH_OF.get(type);
  // Неизвестный тип — пропускаем. Забытый в таблице переключатель не
  // должен молча глушить целый класс уведомлений.
  if (name && settings[name] === false) return false;
  if (!inQuietHours(settings, at)) return true;
  // Из тишины есть один выход, и он обязан быть: человека позвали лично.
  return name === 'mentions' && settings.quietAllowMentions !== false;
}

const view = (row, timezone) => ({
  mentions: row.mentions, direct: row.direct, channels: row.channels,
  tasks: row.tasks, calendar: row.calendar, meetings: row.meetings,
  quietFrom: row.quiet_from, quietTo: row.quiet_to,
  quietAllowMentions: row.quiet_allow_mentions,
  dailyDigest: row.daily_digest ?? false,
  digestHour: row.digest_hour ?? 8,
  timezone,
});

export function createNotificationPreferences(pool) {
  if (!pool) return null;

  return {
    async get(session) {
      const { rows } = await pool.query(
        `SELECT p.*, COALESCE(wp.timezone,'UTC') timezone
           FROM memberships m
           LEFT JOIN notification_preferences p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id
           LEFT JOIN workspace_profiles wp ON wp.workspace_id=m.workspace_id AND wp.user_id=m.user_id
          WHERE m.workspace_id=$1 AND m.user_id=$2`,
        [session.workspaceId, session.userId]);
      const row = rows[0];
      if (!row) return { ...DEFAULTS, timezone: 'UTC' };
      // Строки может не быть — человек ничего не настраивал, и это
      // нормальное состояние, а не отсутствие данных.
      if (row.mentions === null) return { ...DEFAULTS, timezone: row.timezone };
      return view(row, row.timezone);
    },

    async save(session, patch) {
      const digestHour = (value) => {
        if (value === null || value === undefined || value === '') return 8;
        const number = Number(value);
        if (!Number.isInteger(number) || number < 0 || number > 23) {
          throw Object.assign(new Error('Час — целое от 0 до 23'), { code: 'INVALID_DIGEST_HOUR', statusCode: 400, expose: true });
        }
        return number;
      };
      const hour = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        if (!Number.isInteger(number) || number < 0 || number > 23) {
          throw Object.assign(new Error('Час — целое от 0 до 23'), { code: 'INVALID_QUIET_HOURS', statusCode: 400, expose: true });
        }
        return number;
      };
      const from = hour(patch.quietFrom);
      const to = hour(patch.quietTo);
      if ((from === null) !== (to === null)) {
        throw Object.assign(new Error('Тихие часы задаются обеими границами'), { code: 'INVALID_QUIET_HOURS', statusCode: 400, expose: true });
      }
      const flag = (name) => (patch[name] === undefined ? true : Boolean(patch[name]));
      const { rows } = await pool.query(
        `INSERT INTO notification_preferences(organization_id,workspace_id,user_id,mentions,direct,channels,tasks,calendar,meetings,quiet_from,quiet_to,quiet_allow_mentions,daily_digest,digest_hour,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
         ON CONFLICT (workspace_id,user_id) DO UPDATE SET
           daily_digest=EXCLUDED.daily_digest,digest_hour=EXCLUDED.digest_hour,
           mentions=EXCLUDED.mentions,direct=EXCLUDED.direct,channels=EXCLUDED.channels,
           tasks=EXCLUDED.tasks,calendar=EXCLUDED.calendar,meetings=EXCLUDED.meetings,
           quiet_from=EXCLUDED.quiet_from,quiet_to=EXCLUDED.quiet_to,
           quiet_allow_mentions=EXCLUDED.quiet_allow_mentions,updated_at=now()
         RETURNING *`,
        [session.organizationId, session.workspaceId, session.userId,
          flag('mentions'), flag('direct'), flag('channels'), flag('tasks'), flag('calendar'), flag('meetings'),
          from, to, patch.quietAllowMentions === undefined ? true : Boolean(patch.quietAllowMentions),
          // Письмо по умолчанию выключено: пространство, которое само
          // начинает писать письма, — это то, от чего ставят фильтр в
          // почте, и вместе с ним в папку уходят приглашения и сброс
          // пароля.
          Boolean(patch.dailyDigest), digestHour(patch.digestHour)]);
      return view(rows[0], session.profile?.timezone || 'UTC');
    },

    /**
     * Кому из этих людей уведомление такого типа сейчас уместно.
     *
     * Единственное место, где настройки применяются: весь push проходит
     * через одну воронку, и фильтровать в каждом вызывающем — значит
     * однажды забыть.
     */
    async recipients(workspaceId, userIds, type, at = new Date()) {
      if (!userIds.length) return [];
      const { rows } = await pool.query(
        `SELECT m.user_id, p.mentions, p.direct, p.channels, p.tasks, p.calendar, p.meetings,
                p.quiet_from, p.quiet_to, p.quiet_allow_mentions, COALESCE(wp.timezone,'UTC') timezone
           FROM memberships m
           LEFT JOIN notification_preferences p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id
           LEFT JOIN workspace_profiles wp ON wp.workspace_id=m.workspace_id AND wp.user_id=m.user_id
          WHERE m.workspace_id=$1 AND m.user_id = ANY($2::uuid[])`,
        [workspaceId, userIds]);
      const settings = new Map(rows.map((row) => [row.user_id, {
        mentions: row.mentions ?? true, direct: row.direct ?? true, channels: row.channels ?? true,
        tasks: row.tasks ?? true, calendar: row.calendar ?? true, meetings: row.meetings ?? true,
        quietFrom: row.quiet_from, quietTo: row.quiet_to,
        quietAllowMentions: row.quiet_allow_mentions ?? true, timezone: row.timezone,
      }]));
      // Человек без строки членства в ответе — не наш; человек без
      // настроек получает всё.
      return userIds.filter((id) => (settings.has(id) ? allows(settings.get(id), type, at) : false));
    },
  };
}

export { DEFAULTS, SWITCH_OF };
