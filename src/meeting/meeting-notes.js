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
  .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item) : ''))
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
  // Номера пунктов, по которым задача уже заведена: экран отмечает их
  // как поручённые и не предлагает завести вторую.
  committed: Object.keys(row.committed ?? {}).map(Number).sort((a, b) => a - b),
});

const COLUMNS = `n.id, n.calendar_event_id "calendarEventId", n.call_id "callId", n.title, n.notes,
  n.decisions, n.action_items "actionItems", n.visibility, n.created_by "createdBy",
  COALESCE(p.display_name, u.email) "createdByName", n.created_at "createdAt", n.updated_at "updatedAt",
  n.committed`;

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
    // Чужому человеку, которому встреча видна только как «Занято», протокола не существует.
    if (!event || event.busyOnly) throw fail('Встреча не найдена', 'EVENT_NOT_FOUND', 404);
    return event;
  };

  /**
   * Протокол принадлежит встрече, а не серии.
   *
   * Записали, что решили в понедельник, а в среду записали среду — и
   * понедельник исчезал без предупреждения вместе с решениями. Вхождение
   * адресуется моментом, на который приходится по правилу: тем же
   * признаком, которым уже адресуются перенос и отмена одной встречи.
   * У одиночной встречи момента нет.
   */
  const splitId = (eventId) => {
    const [seriesId, occurrenceAt = null] = String(eventId).split('@');
    if (!occurrenceAt) return { seriesId, occurrenceAt: null };
    const at = new Date(decodeURIComponent(occurrenceAt));
    if (Number.isNaN(at.getTime())) throw fail('Непонятно, о какой встрече серии речь', 'INVALID_OCCURRENCE', 400);
    return { seriesId, occurrenceAt: at.toISOString() };
  };

  return {
    /** Протокол встречи, если он есть. */
    async get(session, eventId) {
      const { seriesId, occurrenceAt } = splitId(eventId);
      await eventOrFail(session, seriesId);
      const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM meeting_notes n
           LEFT JOIN users u ON u.id = n.created_by
           LEFT JOIN workspace_profiles p ON p.workspace_id = n.workspace_id AND p.user_id = n.created_by
          WHERE n.workspace_id = $1 AND n.calendar_event_id = $2
            AND n.occurrence_at IS NOT DISTINCT FROM $3::timestamptz
          ORDER BY n.created_at LIMIT 1`,
        [session.workspaceId, seriesId, occurrenceAt],
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
      const { seriesId, occurrenceAt } = splitId(eventId);
      const event = await eventOrFail(session, seriesId);
      const heading = String(title ?? event.title ?? 'Встреча').replace(/\s+/g, ' ').trim().slice(0, 240);
      if (!heading) throw fail('У протокола должно быть название', 'INVALID_TITLE');
      const body = notes === null || notes === undefined ? null : String(notes).slice(0, 20000);
      const decisionLines = lines(decisions);
      const actionLines = lines(actionItems);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO meeting_notes(organization_id, workspace_id, calendar_event_id, occurrence_at, created_by,
                                     title, notes, decisions, action_items, visibility)
           VALUES($1, $2, $3, $9::timestamptz, $4, $5, $6, $7::jsonb, $8::jsonb, 'participants')
           ON CONFLICT (workspace_id, calendar_event_id, COALESCE(occurrence_at, '-infinity'::timestamptz))
             WHERE calendar_event_id IS NOT NULL
           DO UPDATE SET title = EXCLUDED.title, notes = EXCLUDED.notes,
                         decisions = EXCLUDED.decisions, action_items = EXCLUDED.action_items,
                         updated_at = now()
           RETURNING id`,
          [session.organizationId, session.workspaceId, seriesId, session.userId, heading, body,
            JSON.stringify(decisionLines), JSON.stringify(actionLines), occurrenceAt],
        );
        const noteId = rows[0].id;

        // Manual decisions acquire individual stable IDs. Exact unchanged lines
        // retain their IDs even if reordered. A removed/edited line is retracted;
        // a newly worded decision becomes a new canonical decision instead of
        // silently changing history under an old identifier.
        const existing = (await client.query(
          `SELECT id,title,source_position "sourcePosition"
             FROM decisions
            WHERE workspace_id=$1 AND source_kind='meeting_note' AND source_id=$2 AND status='active'
            ORDER BY source_position,id
            FOR UPDATE`,
          [session.workspaceId,noteId],
        )).rows;
        const used = new Set();

        for (let position = 0; position < decisionLines.length; position += 1) {
          const text = decisionLines[position];
          const same = existing.find((row) => !used.has(row.id) && row.title === text);
          if (same) {
            used.add(same.id);
            await client.query(
              `UPDATE decisions
                  SET source_position=$3,source_title=$4,calendar_event_id=$5,updated_at=now()
                WHERE workspace_id=$1 AND id=$2`,
              [session.workspaceId,same.id,position,heading,seriesId],
            );
            continue;
          }
          await client.query(
            `INSERT INTO decisions(
                organization_id,workspace_id,source_kind,source_id,source_position,title,source_title,
                accepted_by,accepted_at,calendar_event_id,status)
             VALUES($1,$2,'meeting_note',$3,$4,$5,$6,$7,now(),$8,'active')`,
            [session.organizationId,session.workspaceId,noteId,position,text,heading,session.userId,seriesId],
          );
        }

        const removed = existing.filter((row) => !used.has(row.id)).map((row) => row.id);
        if (removed.length) {
          await client.query(
            `UPDATE decisions
                SET status='retracted',retracted_by=$3,retracted_at=now(),updated_at=now()
              WHERE workspace_id=$1 AND id=ANY($2::uuid[])`,
            [session.workspaceId,removed,session.userId],
          );
        }

        await client.query(
          `INSERT INTO audit_events(organization_id, workspace_id, aggregate_type, aggregate_id, event_type, actor_id, payload)
           VALUES($1, $2, 'calendar_event', $3, 'meeting.notes.saved', $4, $5)`,
          [session.organizationId, session.workspaceId, seriesId, session.userId,
            { noteId, decisions: decisionLines.length, actionItems: actionLines.length }],
        );
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
      } finally {
        client.release();
      }
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
      const position = Number(index);
      const title = note.actionItems[position];
      if (!title) throw fail('В протоколе нет такого пункта', 'ACTION_ITEM_NOT_FOUND', 404);
      if (!store?.createTask) throw fail('Задачи доступны в режиме с базой данных', 'TASKS_UNAVAILABLE', 503);

      // Пункт, уже ставший задачей, второй раз задачей не становится:
      // возвращаем ту же. Иначе двое, открывшие протокол после
      // совещания, заводят два одинаковых обязательства — и оба живые.
      const { seriesId, occurrenceAt } = splitId(eventId);
      const { rows: existing } = await pool.query(
        `SELECT committed->>$3 id FROM meeting_notes
          WHERE workspace_id=$1 AND calendar_event_id=$2 AND occurrence_at IS NOT DISTINCT FROM $4::timestamptz`,
        [session.workspaceId, seriesId, String(position), occurrenceAt],
      );
      const known = existing[0]?.id;
      if (known) {
        const already = await store.getTask?.(session, known);
        if (already) return { task: already, alreadyCommitted: true };
      }

      const task = await store.createTask(session, {
        title,
        ownerId: ownerId ?? session.userId,
        acceptorId: session.userId,
        promisedAt: promisedAt ?? null,
        outcome: `Из протокола встречи «${note.title}»`,
      });
      await pool.query(
        `UPDATE meeting_notes SET committed=committed||jsonb_build_object($3::text,$4::text)
          WHERE workspace_id=$1 AND calendar_event_id=$2 AND occurrence_at IS NOT DISTINCT FROM $5::timestamptz`,
        [session.workspaceId, seriesId, String(position), task.id, occurrenceAt],
      );
      return { task };
    },
  };
}
