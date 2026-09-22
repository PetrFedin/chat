/**
 * Протокол встречи, у которой не было записи.
 *
 * Разбор с расшифровкой есть только у записанного звонка. Совещание в
 * кабинете, планёрка на объекте, разговор с заказчиком по телефону —
 * всё это проходит мимо: договорились и разошлись, а через месяц
 * выясняется, что каждый помнит своё.
 *
 * Таблица под это лежала в схеме с самого начала и не читалась ни
 * одной строкой кода — оставалась единственной такой во всей базе.
 *
 * Решения отсюда попадают в общий список решений компании: человеку
 * всё равно, записывали встречу или нет, он ищет «что мы решили».
 */

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode, expose: true });

/** Список строк: пустые и лишние пробелы не хранятся. */
const lines = (value, limit = 50) => (Array.isArray(value) ? value : [])
  .map((item) => String(item ?? '').replace(/\s+/g, ' ').trim())
  .filter(Boolean)
  .slice(0, limit)
  .map((item) => item.slice(0, 500));

const view = (row) => ({
  id: row.id,
  calendarEventId: row.calendarEventId,
  callId: row.callId,
  title: row.title,
  notes: row.notes,
  decisions: row.decisions ?? [],
  actionItems: row.actionItems ?? [],
  visibility: row.visibility,
  createdBy: row.createdBy,
  createdByName: row.createdByName ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const COLUMNS = `n.id, n.calendar_event_id "calendarEventId", n.call_id "callId", n.title, n.notes,
  n.decisions, n.action_items "actionItems", n.visibility, n.created_by "createdBy",
  COALESCE(p.display_name, u.email) "createdByName", n.created_at "createdAt", n.updated_at "updatedAt"`;

export function createMeetingNotes(pool, { calendar = null, store = null } = {}) {
  if (!pool) return null;

  /**
   * Видно ли человеку это событие.
   *
   * Протокол наследует видимость встречи, а не заводит свою: иначе
   * появляется второй ответ на вопрос «кому это видно», и однажды они
   * разойдутся.
   */
  const eventOrFail = async (session, eventId) => {
    const event = await calendar?.getEvent(session, eventId);
    if (!event) throw fail('Встреча не найдена', 'EVENT_NOT_FOUND', 404);
    return event;
  };

  return {
    /** Протокол встречи, если он есть. */
    async get(session, eventId) {
      await eventOrFail(session, eventId);
      const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM meeting_notes n
           LEFT JOIN users u ON u.id = n.created_by
           LEFT JOIN workspace_profiles p ON p.workspace_id = n.workspace_id AND p.user_id = n.created_by
          WHERE n.workspace_id = $1 AND n.calendar_event_id = $2
          ORDER BY n.created_at LIMIT 1`,
        [session.workspaceId, eventId],
      );
      return rows[0] ? view(rows[0]) : null;
    },

    /**
     * Записать или поправить протокол.
     *
     * Один протокол на встречу: два параллельных «что решили» — это тот
     * же спор, только теперь письменный.
     */
    async save(session, eventId, { notes = null, decisions = [], actionItems = [], title = null } = {}) {
      const event = await eventOrFail(session, eventId);
      const heading = String(title ?? event.title ?? 'Встреча').replace(/\s+/g, ' ').trim().slice(0, 240);
      if (!heading) throw fail('У протокола должно быть название', 'INVALID_TITLE');
      const body = notes === null || notes === undefined ? null : String(notes).slice(0, 20000);
      const { rows } = await pool.query(
        `INSERT INTO meeting_notes(organization_id, workspace_id, calendar_event_id, created_by,
                                   title, notes, decisions, action_items, visibility)
         VALUES($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'participants')
         ON CONFLICT (workspace_id, calendar_event_id) WHERE calendar_event_id IS NOT NULL
         DO UPDATE SET title = EXCLUDED.title, notes = EXCLUDED.notes,
                       decisions = EXCLUDED.decisions, action_items = EXCLUDED.action_items,
                       updated_at = now()
         RETURNING id`,
        [session.organizationId, session.workspaceId, eventId, session.userId, heading, body,
          JSON.stringify(lines(decisions)), JSON.stringify(lines(actionItems))],
      );
      await pool.query(
        `INSERT INTO audit_events(organization_id, workspace_id, aggregate_type, aggregate_id, event_type, actor_id, payload)
         VALUES($1, $2, 'calendar_event', $3, 'meeting.notes.saved', $4, $5)`,
        [session.organizationId, session.workspaceId, eventId, session.userId,
          { noteId: rows[0].id, decisions: lines(decisions).length, actionItems: lines(actionItems).length }],
      );
      return this.get(session, eventId);
    },

    /**
     * Пункт из протокола — в обязательство.
     *
     * «Договорились, что Олег закажет пересчёт» само по себе не
     * происходит: пока у пункта нет владельца и срока, это не
     * договорённость, а благое намерение.
     */
    async commit(session, eventId, { index, ownerId, promisedAt = null }) {
      const note = await this.get(session, eventId);
      if (!note) throw fail('Протокола нет', 'NOTES_NOT_FOUND', 404);
      const title = note.actionItems[Number(index)];
      if (!title) throw fail('В протоколе нет такого пункта', 'ACTION_ITEM_NOT_FOUND', 404);
      if (!store?.createTask) throw fail('Задачи доступны в режиме с базой данных', 'TASKS_UNAVAILABLE', 503);
      const task = await store.createTask(session, {
        title,
        ownerId: ownerId ?? session.userId,
        acceptorId: session.userId,
        promisedAt: promisedAt ?? null,
        outcome: `Из протокола встречи «${note.title}»`,
      });
      return { task };
    },
  };
}
