import { randomUUID } from 'node:crypto';

import { parseRecurrence, formatRecurrence, expandOccurrences, describeRecurrence } from './recurrence.js';
import { holidaysBetween, upcomingBirthdays } from './holidays.js';

const ANSWERS = new Set(['accepted', 'tentative', 'declined']);
import { Permission, hasPermission } from '../rbac.js';
import { assertTaskScheduleAuthority } from '../task/task-authority.js';

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode, expose: true });

/** Правило из базы может быть старым или испорченным — карточка не должна из-за этого падать. */
/** Правило, которое кончается раньше начала, создавало встречу, исчезающую из календаря без следа. */
const checkedRule = (value, startAt) => {
  const rule = parseRecurrence(value);
  if (rule?.until && startAt && rule.until.getTime() < new Date(startAt).getTime()) {
    throw Object.assign(new Error('Повторение заканчивается раньше первой встречи'), { code: 'INVALID_RECURRENCE', statusCode: 400, expose: true });
  }
  return formatRecurrence(rule);
};
const safeRule = (value) => { try { return parseRecurrence(value); } catch { return null; } };

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
   * Concrete-event collision guard.
   *
   * Calendar owns time, therefore it must reject an accidental double-booking
   * before a task block or meeting becomes canonical. Recurring-series
   * collision expansion is intentionally a later slice; this query only claims
   * coverage for concrete rows and says so in the returned metadata.
   */
  const findConcreteConflicts = async (client, session, { startAt, endAt, excludeEventId = null, userId = session.userId } = {}) => {
    if (!startAt || !endAt) return [];
    const { rows } = await client.query(
      `SELECT DISTINCT e.id,e.kind,e.title,e.start_at "startAt",e.end_at "endAt"
         FROM calendar_events e
        WHERE e.workspace_id=$1
          AND e.end_at IS NOT NULL
          AND e.recurrence_rule IS NULL
          AND ($5::uuid IS NULL OR e.id<>$5::uuid)
          AND e.start_at < $3
          AND e.end_at > $2
          AND (
            e.owner_id=$4 OR EXISTS(
              SELECT 1 FROM calendar_event_participants p
               WHERE p.workspace_id=e.workspace_id
                 AND p.calendar_event_id=e.id
                 AND p.user_id=$4
                 AND p.response_status<>'declined'
            )
          )
        ORDER BY e.start_at,e.id
        LIMIT 8`,
      [session.workspaceId, startAt, endAt, userId, excludeEventId],
    );
    return rows;
  };

  const findRecurringConflicts = async (client,session,{startAt,endAt,excludeEventId=null,userId=session.userId}={}) => {
    if(!startAt||!endAt)return[];
    const fromMs=Date.parse(startAt),toMs=Date.parse(endAt);
    const {rows}=await client.query(
      `SELECT e.id,e.kind,e.title,e.start_at "startAt",e.end_at "endAt",e.timezone,e.recurrence_rule "recurrenceRule",
              COALESCE((SELECT jsonb_agg(jsonb_build_object('at',x.occurrence_at,'cancelled',x.cancelled,'startAt',x.start_at,'endAt',x.end_at,'title',x.title))
                FROM calendar_event_exceptions x
               WHERE x.workspace_id=e.workspace_id AND x.calendar_event_id=e.id),'[]') "exceptions"
         FROM calendar_events e
        WHERE e.workspace_id=$1
          AND e.recurrence_rule IS NOT NULL
          AND ($2::uuid IS NULL OR e.id<>$2::uuid)
          AND e.start_at < $4
          AND (
            e.owner_id=$3 OR EXISTS(
              SELECT 1 FROM calendar_event_participants p
               WHERE p.workspace_id=e.workspace_id
                 AND p.calendar_event_id=e.id
                 AND p.user_id=$3
                 AND p.response_status<>'declined'
            )
          )`,
      [session.workspaceId,excludeEventId,userId,endAt],
    );
    const out=[];
    for(const row of rows){
      let rule;
      try{rule=parseRecurrence(row.recurrenceRule)}catch{continue}
      const duration=Math.max(0,Date.parse(row.endAt)-Date.parse(row.startAt));
      const changes=new Map((row.exceptions??[]).map(x=>[new Date(x.at).getTime(),x]));
      const occurrences=expandOccurrences({
        startAt:row.startAt,durationMs:duration,rule,timeZone:row.timezone||'UTC',
        from:new Date(fromMs-duration).toISOString(),to:endAt,limit:500,
      });
      for(const at of occurrences){
        const change=changes.get(at.getTime());
        if(change?.cancelled)continue;
        const occStart=change?.startAt?Date.parse(change.startAt):at.getTime();
        const occEnd=change?.endAt?Date.parse(change.endAt):occStart+duration;
        if(occStart<toMs&&occEnd>fromMs){
          out.push({id:row.id,kind:row.kind,title:change?.title??row.title,startAt:new Date(occStart).toISOString(),endAt:new Date(occEnd).toISOString(),seriesId:row.id,occurrenceAt:at.toISOString()});
          if(out.length>=8)return out;
        }
      }
    }
    return out;
  };

  const findScheduleConflicts = async (client,session,input={}) => {
    const [concrete,recurring]=await Promise.all([
      findConcreteConflicts(client,session,input),
      findRecurringConflicts(client,session,input),
    ]);
    return [...concrete,...recurring].sort((a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt)).slice(0,8);
  };

  const assertNoScheduleConflict = async (client, session, input) => {
    if (input.allowConflict) return [];
    const conflicts = await findScheduleConflicts(client, session, input);
    if (!conflicts.length) return conflicts;
    const names = conflicts.slice(0, 3).map((event) => event.title).join(', ');
    throw fail(`Время пересекается с календарём: ${names}. Подтвердите сохранение поверх конфликта.`, 'CALENDAR_CONFLICT', 409);
  };

  const buildTaskBlockRescheduleProposal = async (client,session,eventId,deadline) => {
    const dueMs=Date.parse(deadline??'');
    if(!Number.isFinite(dueMs)) throw fail('Нужен корректный срок задачи','INVALID_DATE',400);
    const event=await loadEvent(client,session,eventId);
    assertMayRun(session,event,'Перепланировать блок может его владелец или тот, кто ведёт чужие встречи');
    if(event.kind!=='task_block'||!event.commitment_id) throw fail('Это не блок работы по задаче','TASK_BLOCK_REQUIRED',409);
    if(!event.end_at) throw fail('У блока работы нет времени окончания','CALENDAR_END_REQUIRED',400);
    const startMs=Date.parse(event.start_at),endMs=Date.parse(event.end_at),durationMs=endMs-startMs;
    if(!(durationMs>0)) throw fail('Некорректная длительность блока','INVALID_CALENDAR_RANGE',400);
    if(endMs<=dueMs) throw fail('Блок уже заканчивается до обещанного срока','NO_SCHEDULE_IMPACT',409);

    const windowStart=new Date(dueMs-14*24*3600*1000).toISOString();

    let candidateEnd=dueMs,candidateStart=candidateEnd-durationMs,steps=0;
    const collisions=[];
    while(candidateStart>=Date.parse(windowStart)&&steps<500){
      const hits=await findScheduleConflicts(client,session,{
        startAt:new Date(candidateStart).toISOString(),
        endAt:new Date(candidateEnd).toISOString(),
        excludeEventId:eventId,
        userId:event.owner_id,
      });
      if(!hits.length) break;
      // Move back only as far as necessary. If several events overlap this
      // candidate, the latest-starting one is the first boundary before the
      // deadline; the next iteration resolves any earlier overlap.
      const hit=hits.reduce((latest,item)=>Date.parse(item.startAt)>Date.parse(latest.startAt)?item:latest);
      collisions.push(hit.seriesId&&hit.occurrenceAt?`${hit.seriesId}@${hit.occurrenceAt}`:hit.id);
      candidateEnd=Date.parse(hit.startAt);
      candidateStart=candidateEnd-durationMs;
      steps+=1;
    }
    if(candidateStart<Date.parse(windowStart)) throw fail('До срока не найден свободный слот той же длительности','NO_RESCHEDULE_SLOT',409);
    return {
      eventId:event.id,commitmentId:event.commitment_id,
      currentStartAt:new Date(startMs).toISOString(),currentEndAt:new Date(endMs).toISOString(),
      suggestedStartAt:new Date(candidateStart).toISOString(),suggestedEndAt:new Date(candidateEnd).toISOString(),
      deadline:new Date(dueMs).toISOString(),durationMinutes:Math.round(durationMs/60000),
      avoidedConflictCount:new Set(collisions).size,
      rationale:'latest_conflict_free_slot_before_deadline',
    };
  };

  /**
   * Кто видит встречу: организатор, весь штат для общей, приглашённый,
   * участник связанной комнаты — и тот, кому доверены чужие встречи (кроме
   * личных: «личная» значит только своя).
   * Правило одно на чтение и на правку: когда оно было записано дважды,
   * они разошлись, и руководитель получал 404 на собственную правку.
   */
  const VISIBLE_EVENT = `(
         e.owner_id=$3
         OR (e.visibility='workspace' AND $4<>'guest')
         OR EXISTS(SELECT 1 FROM calendar_event_participants p WHERE p.workspace_id=e.workspace_id AND p.calendar_event_id=e.id AND p.user_id=$3)
         OR EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.workspace_id=e.workspace_id AND cm.conversation_id=e.conversation_id AND cm.user_id=$3)
         OR ($5 AND e.visibility<>'private'))`;
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
    const linked = type !== 'calendar.cancelled';
    for (const recipient of targets) {
      await client.query(
        // Колонки под ссылку, встречу и позвавшего есть с миграции 007, но
        // календарь их не заполнял: приходило «Требуется ответ» без встречи,
        // без имени и без места, куда нажать.
        `INSERT INTO notifications(organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body,
           actor_user_id,calendar_event_id,url)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (workspace_id,dedupe_key) DO NOTHING`,
        [session.organizationId, session.workspaceId, recipient, randomUUID(), `${type}:${eventId}:${recipient}:${Date.now()}`, type, title, body,
          // Отменённую встречу связывать не с чем: связь стоит на каскадном
          // удалении, и вместе со встречей исчезло бы само извещение о том,
          // что её отменили. Остаётся имя отменившего — оно и есть новость.
          session.userId, linked ? eventId : null, linked ? `/#/calendar/${eventId}` : null],
      );
    }
  };

  /**
   * «Вся компания видит, что время занято»: чужому человеку — только занятость. Название, описание, беседа,
   * задача, участники и файлы остаются у организатора, приглашённых и тех, кто ведёт календарь команды.
   */
  const busyOnly = (session, row, participant) => {
    if (!row || row.visibility !== 'workspace') return row;
    if (row.ownerId === session.userId || participant || hasPermission(session.role, Permission.CALENDAR_MANAGE_TEAM)) return row;
    return {
      ...row, title: 'Занято', description: null, busyOnly: true, conversationId: null, conversationTitle: null,
      commitmentId: null, commitmentTitle: null, participantCount: 0, fileCount: 0,
    };
  };

  const repository = {
    async findConflicts(session,{startAt,endAt,excludeEventId=null}={}) {
      const client=await pool.connect();
      try {
        return await findScheduleConflicts(client,session,{startAt,endAt,excludeEventId});
      } finally {
        client.release();
      }
    },

    /**
     * Deterministic schedule proposal for a task block that now sits after a
     * task promise. Calendar remains authority: this returns a preview only.
     * The latest conflict-free slot of the same duration before the deadline
     * wins; no write happens until the user explicitly approves/edits it.
     */
    async suggestTaskBlockReschedule(session,eventId,{deadline}={}) {
      const client=await pool.connect();
      try { return await buildTaskBlockRescheduleProposal(client,session,eventId,deadline); }
      finally { client.release(); }
    },

    async resolveTaskBlockReschedule(session,eventId,{action,startAt=null,endAt=null,deadline,reason,expectedVersion,allowConflict=false}={}) {
      if(!['approve','reject'].includes(action)) throw fail('Нужно принять или отклонить предложение','INVALID_PROPOSAL_ACTION',400);
      return tx(async (client)=>{
        const event=await loadEvent(client,session,eventId);
        assertMayRun(session,event,'Перепланировать блок может его владелец или тот, кто ведёт чужие встречи');
        if(event.kind!=='task_block'||!event.commitment_id) throw fail('Это не блок работы по задаче','TASK_BLOCK_REQUIRED',409);
        const {rows:tasks}=await client.query(
          `SELECT id,organization_id "organizationId",workspace_id "workspaceId",title,outcome,owner_id "ownerId",requester_id "requesterId",acceptor_id "acceptorId",source_message_id "sourceMessageId",status,priority,promised_at "promisedAt",forecast_at "forecastAt",version,created_at "createdAt",updated_at "updatedAt"
             FROM commitments WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
          [session.workspaceId,event.commitment_id],
        );
        const task=tasks[0];
        if(!task) throw fail('Задача не найдена','TASK_NOT_FOUND',404);
        const normalizedReason=assertTaskScheduleAuthority(task,session,{expectedVersion,reason});
        const proposal=await buildTaskBlockRescheduleProposal(client,session,eventId,deadline??task.promisedAt);

        let resolvedStartAt=null,resolvedEndAt=null;
        if(action==='approve'){
          resolvedStartAt=startAt??proposal.suggestedStartAt;
          resolvedEndAt=endAt??proposal.suggestedEndAt;
          if(!resolvedStartAt||!resolvedEndAt||Date.parse(resolvedEndAt)<=Date.parse(resolvedStartAt)) throw fail('Некорректный предлагаемый слот','INVALID_CALENDAR_RANGE',400);
          await assertNoScheduleConflict(client,session,{startAt:resolvedStartAt,endAt:resolvedEndAt,excludeEventId:eventId,userId:event.owner_id,allowConflict:Boolean(allowConflict)});
          await client.query(
            `UPDATE calendar_events SET start_at=$3,end_at=$4,version=version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2`,
            [session.workspaceId,eventId,resolvedStartAt,resolvedEndAt],
          );
          const {rows:attendees}=await client.query(
            "UPDATE calendar_event_participants SET response_status='invited',responded_at=NULL WHERE workspace_id=$1 AND calendar_event_id=$2 AND response_status<>'invited' RETURNING user_id",
            [session.workspaceId,eventId],
          );
          await notify(client,session,{recipients:attendees.map(x=>x.user_id),type:'calendar.updated',eventId,title:event.title,body:'Время блока изменилось — подтвердите участие заново'});
          await client.query(
            `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
             VALUES($1,$2,'commitment',$3,'calendar.block_moved',$4,$5)`,
            [session.organizationId,session.workspaceId,event.commitment_id,session.userId,{calendarEventId:eventId,previousStartAt:event.start_at,previousEndAt:event.end_at,startAt:resolvedStartAt,endAt:resolvedEndAt,source:'schedule_proposal'}],
          );
        }

        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'commitment',$3,$4,$5,$6)`,
          [session.organizationId,session.workspaceId,event.commitment_id,action==='approve'?'calendar.reschedule_proposal_approved':'calendar.reschedule_proposal_rejected',session.userId,{
            calendarEventId:eventId,deadline:proposal.deadline,
            suggestedStartAt:proposal.suggestedStartAt,suggestedEndAt:proposal.suggestedEndAt,
            resolvedStartAt,resolvedEndAt,reason:normalizedReason,rationale:proposal.rationale,
          }],
        );
        return {decision:action,proposal,eventId};
      }).then(async result=>({...result,event:await repository.getEvent(session,eventId)}));
    },

    /** One event with everything a person needs before deciding to attend. */
    async getEvent(session, id) {
      if (!(await maySee(session, id))) throw fail('Event not found', 'CALENDAR_EVENT_NOT_FOUND', 404);
      const [event, participants, files] = await Promise.all([
        pool.query(
          `SELECT e.id,e.kind,e.title,e.description,e.owner_id "ownerId",e.start_at "startAt",e.end_at "endAt",
                  e.timezone,e.all_day "allDay",e.visibility,e.commitment_id "commitmentId",e.conversation_id "conversationId",
                  e.recurrence_rule "recurrenceRule",
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
      const shown = busyOnly(session, event.rows[0], Boolean(mine));
      return {
        ...shown,
        participants: shown.busyOnly ? [] : participants.rows.map(participantView),
        files: shown.busyOnly ? [] : files.rows,
        myResponse: mine?.response_status ?? null,
        // Карточка обещала кнопки только организатору, хотя вести чужие
        // встречи разрешено и по праву calendar.manage.team — иначе встречу
        // уволившегося снова оказывалось некому перенести.
        canEdit: event.rows[0].ownerId === session.userId
          || hasPermission(session.role, Permission.CALENDAR_MANAGE_TEAM),
        needsMyAnswer: mine?.response_status === 'invited',
        // Человеку правило читать незачем: карточка говорит словами.
        recurrenceText: describeRecurrence(safeRule(event.rows[0].recurrenceRule)),
      };
    },

    /**
     * A range read that also says, per event, whether this viewer still owes
     * an answer — which is what the month and week grids mark.
     */
    async listRange(session, { from = null, to = null, limit = 2000 } = {}) {
      // Без диапазона сервер честно собирал всю историю: пять лет работы —
      // это девять тысяч событий в одном ответе. Календарь всегда смотрят
      // вокруг какой-то даты, поэтому умолчание — три месяца в обе стороны.
      const since = from ?? new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
      const until = to ?? new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
      const size = Math.min(Math.max(Number(limit) || 2000, 1), 5000);
      const { rows } = await pool.query(
        `SELECT e.id,e.kind,e.title,e.owner_id "ownerId",e.start_at "startAt",e.end_at "endAt",e.all_day "allDay",
                -- Пояс встречи нужен сетке: «весь день» — это календарная
                -- дата в поясе того, кто её назначил, а не мгновение. Без
                -- этого поля клиент раскладывал события по своему поясу, и
                -- отчётный день 31 декабря у коллеги в Нью-Йорке
                -- оказывался тридцатым.
                e.timezone,
                e.visibility,e.commitment_id "commitmentId",e.conversation_id "conversationId",
                pa.response_status "myResponse",
                (SELECT count(*)::int FROM calendar_event_participants x WHERE x.workspace_id=e.workspace_id AND x.calendar_event_id=e.id) "participantCount",
                (SELECT count(*)::int FROM calendar_event_files ef WHERE ef.workspace_id=e.workspace_id AND ef.calendar_event_id=e.id) "fileCount"
         FROM calendar_events e
         LEFT JOIN calendar_event_participants pa ON pa.workspace_id=e.workspace_id AND pa.calendar_event_id=e.id AND pa.user_id=$4
         WHERE e.workspace_id=$1
           -- Серия сюда не попадает: её первая встреча — такое же
           -- вхождение, как остальные, и приходит раскрытой. Иначе
           -- первая планёрка показывалась в календаре дважды.
           AND e.recurrence_rule IS NULL
           AND ($2::timestamptz IS NULL OR e.start_at >= $2)
           AND ($3::timestamptz IS NULL OR e.start_at <= $3)
           AND (e.owner_id=$4
                OR (e.visibility='workspace' AND $5<>'guest')
                OR (e.visibility='participants' AND (pa.user_id IS NOT NULL
                    OR EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.workspace_id=e.workspace_id AND cm.conversation_id=e.conversation_id AND cm.user_id=$4))))
         ORDER BY e.start_at, e.id
         LIMIT $6`,
        [session.workspaceId, since, until, session.userId, session.role, size],
      );
      const single = rows.map((row) => ({ ...busyOnly(session, row, row.myResponse != null), needsMyAnswer: row.myResponse === 'invited' }));
      const series = await repository.expandSeries(session, { since, until, size });
      const layers = await repository.calendarLayers(session, { since, until });
      // Одиночные и вхождения серий — один список, отсортированный по
      // времени: сетке календаря всё равно, чем встреча была в базе.
      return [...single, ...series, ...layers].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)).slice(0, size);
    },

    /**
     * Вхождения повторяющихся встреч внутри окна.
     *
     * Серии отбираются не по окну: планёрка, заведённая год назад, лежит
     * строкой с прошлогодним `start_at`, а идёт по-прежнему каждую
     * неделю. Поэтому берём все серии, которые могли начаться до конца
     * окна, и раскрываем каждую.
     *
     * Вхождение получает составной признак `id@время`: по нему клиент
     * отличает одну планёрку от другой, а сервер понимает, о каком
     * вхождении речь, когда его просят отменить.
     */
    async expandSeries(session, { since, until, size }) {
      const { rows } = await pool.query(
        `SELECT e.id,e.kind,e.title,e.owner_id "ownerId",e.start_at "startAt",e.end_at "endAt",e.all_day "allDay",
                e.timezone,e.visibility,e.commitment_id "commitmentId",e.conversation_id "conversationId",
                e.recurrence_rule "recurrenceRule",
                pa.response_status "myResponse",
                (SELECT count(*)::int FROM calendar_event_participants x WHERE x.workspace_id=e.workspace_id AND x.calendar_event_id=e.id) "participantCount",
                (SELECT count(*)::int FROM calendar_event_files ef WHERE ef.workspace_id=e.workspace_id AND ef.calendar_event_id=e.id) "fileCount",
                COALESCE((SELECT jsonb_agg(jsonb_build_object('at',x.occurrence_at,'cancelled',x.cancelled,'startAt',x.start_at,'endAt',x.end_at,'title',x.title))
                   FROM calendar_event_exceptions x
                  WHERE x.workspace_id=e.workspace_id AND x.calendar_event_id=e.id),'[]') "exceptions"
         FROM calendar_events e
         LEFT JOIN calendar_event_participants pa ON pa.workspace_id=e.workspace_id AND pa.calendar_event_id=e.id AND pa.user_id=$3
         WHERE e.workspace_id=$1 AND e.recurrence_rule IS NOT NULL
           AND e.start_at <= $2
           AND (e.owner_id=$3
                OR (e.visibility='workspace' AND $4<>'guest')
                OR (e.visibility='participants' AND (pa.user_id IS NOT NULL
                    OR EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.workspace_id=e.workspace_id AND cm.conversation_id=e.conversation_id AND cm.user_id=$3))))`,
        [session.workspaceId, until, session.userId, session.role],
      );

      const out = [];
      for (const row of rows) {
        let rule;
        try { rule = parseRecurrence(row.recurrenceRule); }
        catch { continue; } // Испорченное правило не должно ронять весь календарь.
        const duration = row.endAt ? Date.parse(row.endAt) - Date.parse(row.startAt) : 0;
        const changes = new Map((row.exceptions ?? []).map((x) => [new Date(x.at).getTime(), x]));
        const occurrences = expandOccurrences({
          startAt: row.startAt, durationMs: duration, rule, timeZone: row.timezone || 'UTC',
          from: since, to: until, limit: Math.min(size, 200),
        });
        for (const at of occurrences) {
          const change = changes.get(at.getTime());
          if (change?.cancelled) continue;
          const startAt = change?.startAt ? new Date(change.startAt) : at;
          const endAt = change?.endAt ? new Date(change.endAt) : (duration ? new Date(startAt.getTime() + duration) : null);
          out.push(busyOnly(session, {
            ...row,
            // Идентификатор вхождения: строка события и момент по правилу.
            id: `${row.id}@${at.toISOString()}`,
            seriesId: row.id,
            occurrenceAt: at.toISOString(),
            title: change?.title ?? row.title,
            startAt: startAt.toISOString(),
            endAt: endAt ? endAt.toISOString() : null,
            moved: Boolean(change && !change.cancelled),
            recurrenceText: describeRecurrence(rule),
            needsMyAnswer: row.myResponse === 'invited',
            exceptions: undefined,
          }, row.myResponse != null));
        }
      }
      return out;
    },

    /**
     * Слои календаря: нерабочие дни и дни рождения.
     *
     * Это не события, которые кто-то заводит: производственный календарь
     * один на страну, а день рождения — свойство человека. Поэтому они
     * не лежат в `calendar_events`, не редактируются поштучно и не
     * попадают в отчёты о встречах — но в сетке календаря быть обязаны,
     * иначе планёрку назначают на 9 мая.
     */
    async calendarLayers(session, { since, until }) {
      const { rows: settings } = await pool.query(
        'SELECT show_birthdays "showBirthdays", show_holidays "showHolidays" FROM workspaces WHERE id=$1',
        [session.workspaceId]);
      const show = settings[0] ?? { showBirthdays: true, showHolidays: true };
      const out = [];

      if (show.showHolidays) {
        const { rows: custom } = await pool.query(
          `SELECT to_char(on_date,'YYYY-MM-DD') date, title, day_off "dayOff"
             FROM workspace_holidays WHERE workspace_id=$1 AND on_date BETWEEN $2::date AND $3::date`,
          [session.workspaceId, since.slice(0, 10), until.slice(0, 10)]);
        // Своя запись перекрывает встроенную: компания может работать в
        // праздник или объявить свой нерабочий день.
        const own = new Map(custom.map((row) => [row.date, row]));
        for (const day of holidaysBetween(since, until)) if (!own.has(day.date)) own.set(day.date, day);
        for (const [date, day] of own) {
          out.push({
            id: `holiday@${date}`, kind: 'holiday', title: day.title,
            startAt: `${date}T00:00:00.000Z`, endAt: null, allDay: true,
            dayOff: day.dayOff !== false, timezone: 'UTC', visibility: 'workspace',
            ownerId: null, participantCount: 0, fileCount: 0, needsMyAnswer: false, readOnly: true,
          });
        }
      }

      if (show.showBirthdays) {
        // Гостю дни рождения чужой компании не показываем: это личные
        // сведения её сотрудников, а он здесь на один проект.
        if (session.role === 'guest') return out;
        const { rows: people } = await pool.query(
          `SELECT p.user_id "userId", COALESCE(p.display_name,u.email) "displayName",
                  p.birth_day "birthDay", p.birth_month "birthMonth"
             FROM workspace_profiles p
             JOIN memberships m ON m.workspace_id=p.workspace_id AND m.user_id=p.user_id
             JOIN users u ON u.id=p.user_id
            WHERE p.workspace_id=$1 AND p.birth_day IS NOT NULL AND m.role<>'guest' AND u.disabled_at IS NULL`,
          [session.workspaceId]);
        const span = Math.ceil((Date.parse(until) - Date.parse(since)) / 86400000);
        for (const birthday of upcomingBirthdays(people, { from: new Date(since), days: Math.max(span, 0) })) {
          out.push({
            id: `birthday@${birthday.userId}@${birthday.date}`, kind: 'birthday',
            title: `День рождения — ${birthday.displayName}`,
            startAt: `${birthday.date}T00:00:00.000Z`, endAt: null, allDay: true,
            timezone: 'UTC', visibility: 'workspace', ownerId: birthday.userId,
            participantCount: 0, fileCount: 0, needsMyAnswer: false, readOnly: true,
          });
        }
      }
      return out;
    },

    /**
     * Всё, что ещё ждёт ответа этого человека, — для полосы внимания.
     *
     * Отбор шёл по времени начала самой строки события. У серии это
     * время её первой встречи: еженедельная планёрка, заведённая месяц
     * назад, через неделю исчезала отсюда навсегда — и ответа от людей
     * никто уже не ждал, хотя встречи шли. Серии берём целиком и дату
     * считаем по правилу: показываем ближайшую встречу, до которой
     * человек ещё может дойти.
     */
    async pendingInvitations(session) {
      const { rows } = await pool.query(
        `SELECT e.id,e.title,e.start_at "startAt",e.end_at "endAt",e.kind,e.timezone,
                e.recurrence_rule "recurrenceRule", pr.display_name "organiser"
         FROM calendar_event_participants pa
         JOIN calendar_events e ON e.workspace_id=pa.workspace_id AND e.id=pa.calendar_event_id
         LEFT JOIN workspace_profiles pr ON pr.workspace_id=e.workspace_id AND pr.user_id=e.owner_id
         WHERE pa.workspace_id=$1 AND pa.user_id=$2 AND pa.response_status='invited'
           AND (e.recurrence_rule IS NOT NULL OR e.start_at > now() - interval '1 day')
         ORDER BY e.start_at LIMIT 60`,
        [session.workspaceId, session.userId],
      );
      const now = Date.now();
      const horizon = new Date(now + 400 * 86400000);
      const out = [];
      for (const row of rows) {
        if (!row.recurrenceRule) { out.push(row); continue; }
        const rule = parseRecurrence(row.recurrenceRule);
        if (!rule) { out.push(row); continue; }
        const duration = row.endAt ? new Date(row.endAt) - new Date(row.startAt) : 0;
        // Ближайшее вхождение, которое ещё не прошло. Серия, которая вся
        // позади, отсюда честно уходит.
        const next = expandOccurrences({
          startAt: row.startAt, durationMs: duration, rule, timeZone: row.timezone || 'UTC',
          from: new Date(now - 86400000), to: horizon, limit: 1,
        })[0];
        if (!next) continue;
        out.push({ ...row, startAt: next.toISOString(), occurrenceAt: next.toISOString(), seriesId: row.id, id: `${row.id}@${next.toISOString()}` });
      }
      return out.sort((a, b) => new Date(a.startAt) - new Date(b.startAt)).slice(0, 20);
    },

    /**
     * Встреча вместе с приглашёнными, одной транзакцией.
     *
     * Клиент заводил событие, а потом отдельным запросом звал людей: если
     * второй запрос не проходил, в календаре оставалась встреча, на которую
     * никого не позвали, и никто об этом не знал. Либо есть встреча с
     * участниками, либо нет ничего.
     */
    async createWithParticipants(session, body, userIds = [], { optional = false } = {}) {
      const ids = [...new Set(userIds)].filter(Boolean);
      return tx(async (client) => {
        // Validate/normalize the submitted recurrence before conflict lookup.
        // Invalid input must fail as INVALID_RECURRENCE, not be masked by an
        // unrelated existing event in the same slot.
        const recurrenceRule=checkedRule(body.recurrenceRule,body.startAt);
        await assertNoScheduleConflict(client,session,{startAt:body.startAt,endAt:body.endAt,allowConflict:Boolean(body.allowConflict)});
        const id = randomUUID();
        const { rows } = await client.query(
          `INSERT INTO calendar_events(id,organization_id,workspace_id,kind,title,description,owner_id,start_at,end_at,timezone,all_day,visibility,commitment_id,conversation_id,recurrence_rule)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING id,kind,title,description,owner_id "ownerId",start_at "startAt",end_at "endAt",timezone,
                     all_day "allDay",visibility,commitment_id "commitmentId",conversation_id "conversationId",
                     recurrence_rule "recurrenceRule",created_at "createdAt",updated_at "updatedAt"`,
          [id, session.organizationId, session.workspaceId, body.kind || 'meeting', body.title, body.description,
           session.userId, body.startAt, body.endAt, body.timezone || 'UTC', Boolean(body.allDay),
           body.visibility || 'participants', body.commitmentId ?? null, body.conversationId ?? null,
           recurrenceRule],
        );
        const event = rows[0];
        if (event.kind === 'task_block' && event.commitmentId) {
          await client.query(
            `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
             VALUES($1,$2,'commitment',$3,'calendar.block_linked',$4,$5)`,
            [session.organizationId,session.workspaceId,event.commitmentId,session.userId,{calendarEventId:event.id,startAt:event.startAt,endAt:event.endAt}],
          );
        }
        if (!ids.length) return { event, invited: 0 };

        const { rows: staff } = await client.query(
          "SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=ANY($2::uuid[]) AND m.role<>'guest' AND u.disabled_at IS NULL",
          [session.workspaceId, ids],
        );
        if (staff.length !== ids.length) throw fail('Those people are not workspace staff', 'NOT_WORKSPACE_STAFF', 409);
        for (const row of staff) {
          await client.query(
            `INSERT INTO calendar_event_participants(organization_id,workspace_id,calendar_event_id,user_id,optional,invited_by)
             VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (workspace_id,calendar_event_id,user_id) DO NOTHING`,
            [session.organizationId, session.workspaceId, event.id, row.user_id, optional, session.userId],
          );
        }
        await notify(client, session, {
          recipients: staff.map((r) => r.user_id), type: 'calendar.invited', eventId: event.id,
          title: event.title, body: 'Приглашение на встречу — требуется ответ',
        });
        return { event, invited: staff.length };
      });
    },

    async invite(session, eventId, userIds, { optional = false } = {}) {
      return tx(async (client) => {
        const event = await loadEvent(client, session, eventId);
        assertMayRun(session, event, 'Приглашать может организатор или тот, кто ведёт чужие встречи');
        const ids = [...new Set(userIds)].filter(Boolean);
        if (!ids.length) throw fail('Nobody to invite', 'NO_PARTICIPANTS');
        const { rows: staff } = await client.query(
          "SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=ANY($2::uuid[]) AND m.role<>'guest' AND u.disabled_at IS NULL",
          [session.workspaceId, ids],
        );
        const allowed = staff.map((r) => r.user_id);
        // Раньше приглашались те, кого нашли, а остальные молча пропадали:
        // организатор видел «приглашено 2» вместо трёх и узнавал о пропаже
        // на самой встрече. Либо зовём всех названных, либо никого.
        if (allowed.length !== ids.length) {
          throw fail('Those people are not workspace staff', 'NOT_WORKSPACE_STAFF', 409);
        }
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
          // `RETURNING *` отдаёт только колонки самой строки, а имя и
          // должность лежат в профиле: ответивший получал в ответе
          // `displayName: null` и видел на экране пустое место вместо себя.
          `WITH answered AS (
             UPDATE calendar_event_participants SET response_status=$3, responded_at=now(), note=$4
              WHERE workspace_id=$1 AND calendar_event_id=$2 AND user_id=$5 RETURNING *)
           SELECT a.*, p.display_name, p.title FROM answered a
             LEFT JOIN workspace_profiles p ON p.workspace_id=a.workspace_id AND p.user_id=a.user_id`,
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
        const columns = { title: 'title', description: 'description', startAt: 'start_at', endAt: 'end_at', visibility: 'visibility', kind: 'kind', recurrenceRule: 'recurrence_rule', allDay: 'all_day' };
        const fields = Object.keys(columns).filter((f) => patch[f] !== undefined);
        if (!fields.length) throw fail('Nothing to update', 'EMPTY_PATCH');
        // Правило приводится к одному виду и проверяется здесь же: иначе
        // в базе оседает строка, которую раскрыть не удастся.
        if (patch.recurrenceRule !== undefined) patch.recurrenceRule = checkedRule(patch.recurrenceRule, patch.startAt ?? event.start_at);
        else if (patch.startAt && event.recurrence_rule) checkedRule(event.recurrence_rule, patch.startAt);
        const start = patch.startAt ?? event.start_at;
        const end = patch.endAt === undefined ? event.end_at : patch.endAt;
        if (end && new Date(end) <= new Date(start)) throw fail('Встреча должна закончиться после начала', 'INVALID_CALENDAR_RANGE');
        if ((fields.includes('startAt')||fields.includes('endAt'))&&end) {
          await assertNoScheduleConflict(client,session,{startAt:start,endAt:end,excludeEventId:eventId,userId:event.owner_id,allowConflict:Boolean(patch.allowConflict)});
        }

        const setters = fields.map((f, i) => `${columns[f]}=$${i + 3}`).join(',');
        const { rows } = await client.query(
          `UPDATE calendar_events SET ${setters}, version=version+1, updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *`,
          [session.workspaceId, eventId, ...fields.map((f) => patch[f])],
        );
        const timeChanged = fields.includes('startAt') || fields.includes('endAt');
        if (event.kind === 'task_block' && event.commitment_id) {
          await client.query(
            `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
             VALUES($1,$2,'commitment',$3,$4,$5,$6)`,
            [session.organizationId,session.workspaceId,event.commitment_id,timeChanged?'calendar.block_moved':'calendar.block_updated',session.userId,{calendarEventId:eventId,previousStartAt:event.start_at,previousEndAt:event.end_at,startAt:rows[0].start_at,endAt:rows[0].end_at}],
          );
        }
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

    /**
     * Отменить или перенести одно вхождение серии.
     *
     * Правило при этом не трогается: остальная планёрка остаётся на
     * месте. Иначе единственным способом пропустить одну встречу на
     * праздниках было бы разорвать серию надвое.
     */
    async amendOccurrence(session, eventId, occurrenceAt, { cancelled = false, startAt = null, endAt = null, title = null } = {}) {
      return tx(async (client) => {
        const event = await loadEvent(client, session, eventId);
        assertMayRun(session, event, 'Менять встречу может организатор или тот, кто ведёт чужие встречи');
        if (!event.recurrence_rule) throw fail('Это не повторяющаяся встреча', 'NOT_RECURRING', 409);
        const at = new Date(occurrenceAt);
        if (Number.isNaN(at.getTime())) throw fail('Не разбирается момент вхождения', 'INVALID_DATE');

        // Вхождение должно существовать по правилу: иначе в таблице
        // исключений копятся записи про встречи, которых не было.
        const rule = parseRecurrence(event.recurrence_rule);
        const exists = expandOccurrences({
          startAt: event.start_at, rule, timeZone: event.timezone || 'UTC',
          from: new Date(at.getTime() - 1000).toISOString(), to: new Date(at.getTime() + 1000).toISOString(), limit: 2,
        }).some((x) => x.getTime() === at.getTime());
        if (!exists) throw fail('В серии нет встречи на этот момент', 'OCCURRENCE_NOT_FOUND', 404);

        if (!cancelled && !startAt) throw fail('Перенос без нового времени — не перенос', 'INVALID_OCCURRENCE_PATCH');
        if (!cancelled && endAt && new Date(endAt) <= new Date(startAt)) {
          throw fail('Встреча должна закончиться после начала', 'INVALID_CALENDAR_RANGE');
        }

        await client.query(
          `INSERT INTO calendar_event_exceptions(organization_id,workspace_id,calendar_event_id,occurrence_at,cancelled,start_at,end_at,title,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (workspace_id,calendar_event_id,occurrence_at)
           DO UPDATE SET cancelled=EXCLUDED.cancelled,start_at=EXCLUDED.start_at,end_at=EXCLUDED.end_at,title=EXCLUDED.title,created_by=EXCLUDED.created_by`,
          [session.organizationId, session.workspaceId, eventId, at.toISOString(),
           Boolean(cancelled), cancelled ? null : startAt, cancelled ? null : endAt, cancelled ? null : title, session.userId],
        );

        const { rows: attendees } = await client.query(
          'SELECT user_id FROM calendar_event_participants WHERE workspace_id=$1 AND calendar_event_id=$2',
          [session.workspaceId, eventId]);
        await notify(client, session, {
          recipients: attendees.map((a) => a.user_id), type: cancelled ? 'calendar.cancelled' : 'calendar.updated', eventId,
          title: event.title,
          body: cancelled ? 'Одна встреча серии отменена' : 'Одна встреча серии перенесена',
        });
        return { amended: true, occurrenceAt: at.toISOString(), cancelled: Boolean(cancelled) };
      });
    },

    /** Вернуть отменённое или перенесённое вхождение в общий строй. */
    async restoreOccurrence(session, eventId, occurrenceAt) {
      return tx(async (client) => {
        const event = await loadEvent(client, session, eventId);
        assertMayRun(session, event, 'Менять встречу может организатор или тот, кто ведёт чужие встречи');
        const { rowCount } = await client.query(
          'DELETE FROM calendar_event_exceptions WHERE workspace_id=$1 AND calendar_event_id=$2 AND occurrence_at=$3',
          [session.workspaceId, eventId, new Date(occurrenceAt).toISOString()]);
        if (!rowCount) throw fail('Это вхождение ничем не отличается от серии', 'OCCURRENCE_NOT_AMENDED', 404);
        return { restored: true };
      });
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
        if (event.kind === 'task_block' && event.commitment_id) {
          await client.query(
            `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
             VALUES($1,$2,'commitment',$3,'calendar.block_unlinked',$4,$5)`,
            [session.organizationId,session.workspaceId,event.commitment_id,session.userId,{calendarEventId:eventId,startAt:event.start_at,endAt:event.end_at}],
          );
        }
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
