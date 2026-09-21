import { randomUUID } from 'node:crypto';

const ANSWERS = new Set(['accepted', 'tentative', 'declined']);
import { Permission, hasPermission } from '../rbac.js';

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

const participantView = (row) => ({
  userId: row.user_id,
  displayName: row.display_name ?? null,
  title: row.title ?? null,
  response: row.response_status,
  optional: row.optional,
  note: row.note ?? null,
  respondedAt: row.responded_at ?? null,
  invitedBy: row.invited_by ?? null,
});

/**
 * Events people are actually invited to.
 *
 * The participant table has existed since migration 003 and never had a
 * writer, so an event had an owner and nothing else. Without participation
 * there is no such thing as "awaiting your answer", which is the one calendar
 * signal a working day is organised around.
 */
export function createCalendarRepository(pool, store = null) {
  if (!pool) return null;

  const tx = async (run) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };

  /**
   * Встречу ведёт организатор. Но организатор увольняется, уходит в
   * отпуск, теряет доступ — а встреча остаётся в календаре у всех.
   * Поэтому её ведёт ещё и тот, кому компания доверила чужое расписание:
   * право calendar.manage.team было объявлено ролью и не проверялось
   * нигде, из-за чего такую встречу нельзя было тронуть вообще никому.
   */
  const assertMayRun = (session, event, what) => {
    if (event.owner_id === session.userId) return;
    if (hasPermission(session.role, Permission.CALENDAR_MANAGE_TEAM)) return;
    throw fail(what, 'CALENDAR_NOT_ORGANISER', 403);
  };

  const loadEvent = async (client, session, id) => {
    const { rows } = await client.query(
      `SELECT * FROM calendar_events e WHERE e.workspace_id=$1 AND e.id=$2 AND ${VISIBLE_EVENT} FOR UPDATE`,
      visibilityArgs(session, id),
    );
    if (!rows[0]) throw fail('Event not found', 'CALENDAR_EVENT_NOT_FOUND', 404);
    return rows[0];
  };

  /**
   * Кто видит встречу: организатор, весь штат для общей, приглашённый,
   * участник связанной комнаты — и тот, кому доверены чужие встречи.
   * Правило одно на чтение и на правку: когда оно было записано дважды,
   * они разошлись, и руководитель получал 404 на собственную правку.
   */
  const VISIBLE_EVENT = `(
         e.owner_id=$3
         OR (e.visibility='workspace' AND $4<>'guest')
         OR EXISTS(SELECT 1 FROM calendar_event_participants p WHERE p.workspace_id=e.workspace_id AND p.calendar_event_id=e.id AND p.user_id=$3)
         OR EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.workspace_id=e.workspace_id AND cm.conversation_id=e.conversation_id AND cm.user_id=$3)
         OR $5)`;
  const visibilityArgs = (session, id) => [session.workspaceId, id, session.userId, session.role,
    hasPermission(session.role, Permission.CALENDAR_MANAGE_TEAM)];

  const maySee = async (session, id) => {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM calendar_events e WHERE e.workspace_id=$1 AND e.id=$2 AND ${VISIBLE_EVENT}`,
      visibilityArgs(session, id),
    );
    return rowCount > 0;
  };

  const notify = async (client, session, { recipients, type, title, body, eventId }) => {
    const targets = [...new Set(recipients)].filter((id) => id && id !== session.userId);
    if (!targets.length) return;
    for (const recipient of targets) {
      await client.query(
        `INSERT INTO notifications(organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (workspace_id,dedupe_key) DO NOTHING`,
        [session.organizationId, session.workspaceId, recipient, randomUUID(), `${type}:${eventId}:${recipient}:${Date.now()}`, type, title, body],
      );
    }
  };

  const repository = {
    /** One event with everything a person needs before deciding to attend. */
    async getEvent(session, id) {
      if (!(await maySee(session, id))) throw fail('Event not found', 'CALENDAR_EVENT_NOT_FOUND', 404);
      const [event, participants, files] = await Promise.all([
        pool.query(
          `SELECT e.id,e.kind,e.title,e.description,e.owner_id "ownerId",e.start_at "startAt",e.end_at "endAt",
                  e.timezone,e.all_day "allDay",e.visibility,e.commitment_id "commitmentId",e.conversation_id "conversationId",
                  e.version,e.created_at "createdAt",e.updated_at "updatedAt",
                  p.display_name "ownerName", c.title "conversationTitle", cm.title "commitmentTitle"
           FROM calendar_events e
           LEFT JOIN workspace_profiles p ON p.workspace_id=e.workspace_id AND p.user_id=e.owner_id
           LEFT JOIN conversations c ON c.workspace_id=e.workspace_id AND c.id=e.conversation_id
           LEFT JOIN commitments cm ON cm.workspace_id=e.workspace_id AND cm.id=e.commitment_id
           WHERE e.workspace_id=$1 AND e.id=$2`,
          [session.workspaceId, id],
        ),
        pool.query(
          `SELECT pa.*, pr.display_name, pr.title FROM calendar_event_participants pa
           LEFT JOIN workspace_profiles pr ON pr.workspace_id=pa.workspace_id AND pr.user_id=pa.user_id
           WHERE pa.workspace_id=$1 AND pa.calendar_event_id=$2
           ORDER BY pa.optional, pr.display_name`,
          [session.workspaceId, id],
        ),
        pool.query(
          `SELECT f.id,f.name,f.mime_type "mimeType",f.size_bytes "sizeBytes",ef.created_at "attachedAt"
           FROM calendar_event_files ef JOIN files f ON f.workspace_id=ef.workspace_id AND f.id=ef.file_id
           WHERE ef.workspace_id=$1 AND ef.calendar_event_id=$2 ORDER BY ef.created_at`,
          [session.workspaceId, id],
        ),
      ]);
      const mine = participants.rows.find((p) => p.user_id === session.userId);
      return {
        ...event.rows[0],
        participants: participants.rows.map(participantView),
        files: files.rows,
        myResponse: mine?.response_status ?? null,
        // Карточка обещала кнопки только организатору, хотя вести чужие
        // встречи разрешено и по праву calendar.manage.team — иначе встречу
        // уволившегося снова оказывалось некому перенести.
        canEdit: event.rows[0].ownerId === session.userId
          || hasPermission(session.role, Permission.CALENDAR_MANAGE_TEAM),
        needsMyAnswer: mine?.response_status === 'invited',
      };
    },

    /**
     * A range read that also says, per event, whether this viewer still owes
     * an answer — which is what the month and week grids mark.
     */
    async listRange(session, { from = null, to = null } = {}) {
      const { rows } = await pool.query(
        `SELECT e.id,e.kind,e.title,e.owner_id "ownerId",e.start_at "startAt",e.end_at "endAt",e.all_day "allDay",
                e.visibility,e.commitment_id "commitmentId",e.conversation_id "conversationId",
                pa.response_status "myResponse",
                (SELECT count(*)::int FROM calendar_event_participants x WHERE x.workspace_id=e.workspace_id AND x.calendar_event_id=e.id) "participantCount",
                (SELECT count(*)::int FROM calendar_event_files ef WHERE ef.workspace_id=e.workspace_id AND ef.calendar_event_id=e.id) "fileCount"
         FROM calendar_events e
         LEFT JOIN calendar_event_participants pa ON pa.workspace_id=e.workspace_id AND pa.calendar_event_id=e.id AND pa.user_id=$4
         WHERE e.workspace_id=$1
           AND ($2::timestamptz IS NULL OR e.start_at >= $2)
           AND ($3::timestamptz IS NULL OR e.start_at <= $3)
           AND (e.owner_id=$4
                OR (e.visibility='workspace' AND $5<>'guest')
                OR (e.visibility='participants' AND (pa.user_id IS NOT NULL
                    OR EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.workspace_id=e.workspace_id AND cm.conversation_id=e.conversation_id AND cm.user_id=$4))))
         ORDER BY e.start_at, e.id`,
        [session.workspaceId, from, to, session.userId, session.role],
      );
      return rows.map((row) => ({ ...row, needsMyAnswer: row.myResponse === 'invited' }));
    },

    /** Everything still awaiting this person's answer, for the attention strip. */
    async pendingInvitations(session) {
      const { rows } = await pool.query(
        `SELECT e.id,e.title,e.start_at "startAt",e.kind, pr.display_name "organiser"
         FROM calendar_event_participants pa
         JOIN calendar_events e ON e.workspace_id=pa.workspace_id AND e.id=pa.calendar_event_id
         LEFT JOIN workspace_profiles pr ON pr.workspace_id=e.workspace_id AND pr.user_id=e.owner_id
         WHERE pa.workspace_id=$1 AND pa.user_id=$2 AND pa.response_status='invited' AND e.start_at > now() - interval '1 day'
         ORDER BY e.start_at LIMIT 20`,
        [session.workspaceId, session.userId],
      );
      return rows;
    },

    async invite(session, eventId, userIds, { optional = false } = {}) {
      return tx(async (client) => {
        const event = await loadEvent(client, session, eventId);
        assertMayRun(session, event, 'Приглашать может организатор или тот, кто ведёт чужие встречи');
        const ids = [...new Set(userIds)].filter(Boolean);
        if (!ids.length) throw fail('Nobody to invite', 'NO_PARTICIPANTS');
        const { rows: staff } = await client.query(
          "SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=ANY($2::uuid[]) AND role<>'guest'",
          [session.workspaceId, ids],
        );
        const allowed = staff.map((r) => r.user_id);
        if (!allowed.length) throw fail('Those people are not workspace staff', 'NOT_WORKSPACE_STAFF', 409);
        for (const userId of allowed) {
          // Re-inviting somebody must not erase the answer they already gave.
          await client.query(
            `INSERT INTO calendar_event_participants(organization_id,workspace_id,calendar_event_id,user_id,optional,invited_by)
             VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (workspace_id,calendar_event_id,user_id) DO NOTHING`,
            [session.organizationId, session.workspaceId, eventId, userId, optional, session.userId],
          );
        }
        await notify(client, session, {
          recipients: allowed, type: 'calendar.invited', eventId,
          title: event.title, body: 'Приглашение на встречу — требуется ответ',
        });
        return { invited: allowed.length };
      });
    },

    async respond(session, eventId, response, note = null) {
      if (!ANSWERS.has(response)) throw fail('Answer must be accepted, tentative or declined', 'INVALID_RESPONSE');
      return tx(async (client) => {
        const event = await loadEvent(client, session, eventId);
        const { rows } = await client.query(
          `UPDATE calendar_event_participants SET response_status=$3, responded_at=now(), note=$4
           WHERE workspace_id=$1 AND calendar_event_id=$2 AND user_id=$5 RETURNING *`,
          [session.workspaceId, eventId, response, note, session.userId],
        );
        if (!rows[0]) throw fail('You are not invited to this event', 'NOT_INVITED', 404);
        await notify(client, session, {
          recipients: [event.owner_id], type: 'calendar.responded', eventId,
          title: event.title, body: `Ответ на приглашение: ${response === 'accepted' ? 'принято' : response === 'declined' ? 'отклонено' : 'под вопросом'}`,
        });
        return participantView(rows[0]);
      });
    },

    async removeParticipant(session, eventId, userId) {
      return tx(async (client) => {
        const event = await loadEvent(client, session, eventId);
        assertMayRun(session, event, 'Менять состав может организатор или тот, кто ведёт чужие встречи');
        const { rowCount } = await client.query(
          'DELETE FROM calendar_event_participants WHERE workspace_id=$1 AND calendar_event_id=$2 AND user_id=$3',
          [session.workspaceId, eventId, userId],
        );
        if (!rowCount) throw fail('That person is not invited', 'NOT_INVITED', 404);
        return { removed: true };
      });
    },

    async updateEvent(session, eventId, patch) {
      return tx(async (client) => {
        const event = await loadEvent(client, session, eventId);
        assertMayRun(session, event, 'Править встречу может организатор или тот, кто ведёт чужие встречи');
        const columns = { title: 'title', description: 'description', startAt: 'start_at', endAt: 'end_at', visibility: 'visibility', kind: 'kind', allDay: 'all_day' };
        const fields = Object.keys(columns).filter((f) => patch[f] !== undefined);
        if (!fields.length) throw fail('Nothing to update', 'EMPTY_PATCH');
        const start = patch.startAt ?? event.start_at;
        const end = patch.endAt === undefined ? event.end_at : patch.endAt;
        if (end && new Date(end) <= new Date(start)) throw fail('The event must end after it starts', 'INVALID_CALENDAR_RANGE');

        const setters = fields.map((f, i) => `${columns[f]}=$${i + 3}`).join(',');
        const { rows } = await client.query(
          `UPDATE calendar_events SET ${setters}, version=version+1, updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *`,
          [session.workspaceId, eventId, ...fields.map((f) => patch[f])],
        );
        const timeChanged = fields.includes('startAt') || fields.includes('endAt');
        if (timeChanged) {
          // A moved meeting invalidates the answers people already gave.
          const { rows: attendees } = await client.query(
            "UPDATE calendar_event_participants SET response_status='invited', responded_at=NULL WHERE workspace_id=$1 AND calendar_event_id=$2 AND response_status<>'invited' RETURNING user_id",
            [session.workspaceId, eventId],
          );
          await notify(client, session, {
            recipients: attendees.map((a) => a.user_id), type: 'calendar.updated', eventId,
            title: rows[0].title, body: 'Время встречи изменилось — подтвердите участие заново',
          });
        }
        return rows[0].id;
      }).then((id) => repository.getEvent(session, id));
    },

    async cancelEvent(session, eventId) {
      return tx(async (client) => {
        const event = await loadEvent(client, session, eventId);
        assertMayRun(session, event, 'Отменить встречу может организатор или тот, кто ведёт чужие встречи');
        const { rows: attendees } = await client.query('SELECT user_id FROM calendar_event_participants WHERE workspace_id=$1 AND calendar_event_id=$2', [session.workspaceId, eventId]);
        await notify(client, session, {
          recipients: attendees.map((a) => a.user_id), type: 'calendar.cancelled', eventId,
          title: event.title, body: 'Встреча отменена',
        });
        await client.query('DELETE FROM calendar_events WHERE workspace_id=$1 AND id=$2', [session.workspaceId, eventId]);
        return { cancelled: true };
      });
    },

    async attachFile(session, eventId, fileId) {
      return tx(async (client) => {
        const event = await loadEvent(client, session, eventId);
        assertMayRun(session, event, 'Приложить материалы может организатор или тот, кто ведёт чужие встречи');
        if (store && !(await store.getFile(session, fileId))) throw fail('File not found', 'FILE_NOT_FOUND', 404);
        await client.query(
          `INSERT INTO calendar_event_files(organization_id,workspace_id,calendar_event_id,file_id,added_by)
           VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [session.organizationId, session.workspaceId, eventId, fileId, session.userId],
        );
        return { attached: true };
      });
    },
  };

  return repository;
}
