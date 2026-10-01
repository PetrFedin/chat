import { canViewTask, managesTeamTasks } from '../task/task-authority.js';

/**
 * Тайм-трекинг поверх задач-обязательств.
 *
 * Отдельного права не заводили: кто уже видит задачу (то же правило,
 * что во всём task-authority.js — владелец, постановщик, принимающий,
 * соисполнитель или руководитель команды), тот и отмеряет на ней время.
 * Второе право здесь означало бы вторую копию той же матрицы прав,
 * которая рано или поздно с первой разойдётся.
 *
 * Таймер — интервал, а не число часов: `endedAt=null` значит «идёт
 * сейчас». Один человек — один запущенный таймер на всё пространство
 * (уникальный индекс в БД, не только проверка в коде): нельзя честно
 * быть «в работе» сразу над двумя задачами, а разрешить это — значит
 * считать часы, которых не было.
 *
 * Только PostgreSQL, как и остальные недавние модули.
 */

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode, expose: true });

const TASK_FIELDS = `c.id,c.workspace_id "workspaceId",c.title,c.owner_id "ownerId",c.requester_id "requesterId",c.acceptor_id "acceptorId",c.status,
  COALESCE((SELECT jsonb_agg(tc.user_id) FROM task_collaborators tc WHERE tc.workspace_id=c.workspace_id AND tc.commitment_id=c.id),'[]') "collaboratorIds"`;

const ENTRY_COLUMNS = `id,task_id "taskId",user_id "userId",started_at "startedAt",ended_at "endedAt",note,created_at "createdAt"`;

const withDuration = (row) => ({
  ...row,
  durationSeconds: Math.max(0, Math.round(((row.endedAt ? new Date(row.endedAt) : new Date()) - new Date(row.startedAt)) / 1000)),
  running: row.endedAt === null,
});

export function createTimeEntryRepository(pool) {
  if (!pool) {
    const stop = () => { throw fail('Тайм-трекинг работает только с базой данных PostgreSQL', 'TIME_TRACKING_UNAVAILABLE', 503); };
    return { enabled: false, start: stop, stop, current: stop, listForTask: stop, report: stop, dailyTotals: stop };
  }

  async function loadVisibleTask(session, taskId) {
    const { rows } = await pool.query(`SELECT ${TASK_FIELDS} FROM commitments c WHERE c.workspace_id=$1 AND c.id=$2`, [session.workspaceId, taskId]);
    const task = rows[0];
    if (!task || !canViewTask(task, session)) throw fail('Задача не найдена', 'TASK_NOT_FOUND', 404);
    return task;
  }

  return {
    enabled: true,

    async start(session, taskId, { note = null } = {}) {
      const task = await loadVisibleTask(session, taskId);
      if (['accepted_result', 'closed', 'cancelled'].includes(task.status)) {
        throw fail('Задача уже завершена — время на неё не считается', 'TASK_FINISHED', 409);
      }
      const cleanNote = note ? String(note).trim().slice(0, 500) : null;
      try {
        const { rows } = await pool.query(
          `INSERT INTO time_entries(organization_id,workspace_id,task_id,user_id,note) VALUES($1,$2,$3,$4,$5) RETURNING ${ENTRY_COLUMNS}`,
          [session.organizationId, session.workspaceId, taskId, session.userId, cleanNote],
        );
        return withDuration(rows[0]);
      } catch (error) {
        // Уникальный индекс на «нет второй бегущей строки» — та же защита,
        // что и раньше, только теперь на уровне базы: два запроса из двух
        // вкладок не могут оба запустить таймер одновременно.
        if (error.code === '23505') throw fail('У вас уже идёт таймер на другой задаче — сначала остановите его', 'TIME_ENTRY_ALREADY_RUNNING', 409);
        throw error;
      }
    },

    async stop(session, entryId) {
      const { rows } = await pool.query(
        `UPDATE time_entries SET ended_at=now() WHERE workspace_id=$1 AND id=$2 AND user_id=$3 AND ended_at IS NULL RETURNING ${ENTRY_COLUMNS}`,
        [session.workspaceId, entryId, session.userId],
      );
      if (!rows[0]) throw fail('Запущенный таймер не найден', 'TIME_ENTRY_NOT_FOUND', 404);
      return withDuration(rows[0]);
    },

    async current(session) {
      const { rows } = await pool.query(
        `SELECT t.id,t.task_id "taskId",t.user_id "userId",t.started_at "startedAt",t.ended_at "endedAt",t.note,t.created_at "createdAt",c.title "taskTitle"
           FROM time_entries t JOIN commitments c ON c.workspace_id=t.workspace_id AND c.id=t.task_id
          WHERE t.workspace_id=$1 AND t.user_id=$2 AND t.ended_at IS NULL`,
        [session.workspaceId, session.userId],
      );
      return rows[0] ? withDuration(rows[0]) : null;
    },

    async listForTask(session, taskId) {
      await loadVisibleTask(session, taskId);
      const { rows } = await pool.query(
        `SELECT ${ENTRY_COLUMNS} FROM time_entries WHERE workspace_id=$1 AND task_id=$2 ORDER BY started_at DESC`,
        [session.workspaceId, taskId],
      );
      const entries = rows.map(withDuration);
      const totalSeconds = entries.reduce((sum, e) => sum + e.durationSeconds, 0);
      return { items: entries, totalSeconds };
    },

    /**
     * Отчёт по времени за период: свои часы — всегда, чужие — только
     * тому, кому и так доверено вести чужие задачи (task.manage.team).
     */
    async report(session, { from, to, scope = 'mine' } = {}) {
      const wantsTeam = scope === 'team' && managesTeamTasks(session);
      const params = [session.workspaceId];
      const where = ['t.workspace_id=$1', 't.ended_at IS NOT NULL'];
      if (!wantsTeam) { params.push(session.userId); where.push(`t.user_id=$${params.length}`); }
      if (from) { params.push(from); where.push(`t.started_at>=$${params.length}`); }
      if (to) { params.push(to); where.push(`t.started_at<=$${params.length}`); }
      const { rows } = await pool.query(
        `SELECT t.user_id "userId",c.id "taskId",c.title "taskTitle",
                sum(extract(epoch FROM (t.ended_at-t.started_at)))::bigint "totalSeconds",
                count(*)::int "entries"
           FROM time_entries t JOIN commitments c ON c.workspace_id=t.workspace_id AND c.id=t.task_id
          WHERE ${where.join(' AND ')}
          GROUP BY t.user_id,c.id,c.title
          ORDER BY "totalSeconds" DESC`,
        params,
      );
      return { items: rows, totalSeconds: rows.reduce((sum, r) => sum + Number(r.totalSeconds), 0) };
    },

    /** Дневной ряд трекнутого времени — материал для графика, не для таблицы. */
    async dailyTotals(session, { from, to, scope = 'mine' } = {}) {
      const wantsTeam = scope === 'team' && managesTeamTasks(session);
      const params = [session.workspaceId, from, to];
      const mine = wantsTeam ? '' : (params.push(session.userId), ` AND t.user_id=$${params.length}`);
      const { rows } = await pool.query(
        `WITH scoped AS (SELECT t.started_at,t.ended_at FROM time_entries t WHERE t.workspace_id=$1 AND t.ended_at IS NOT NULL${mine})
         SELECT d::date "date", COALESCE(sum(extract(epoch FROM (LEAST(scoped.ended_at,d+interval '1 day')-GREATEST(scoped.started_at,d)))) FILTER (WHERE scoped.started_at<d+interval '1 day' AND scoped.ended_at>d),0)::bigint "totalSeconds"
           FROM generate_series($2::date,$3::date,interval '1 day') d
           LEFT JOIN scoped ON scoped.started_at<d+interval '1 day' AND scoped.ended_at>d
          GROUP BY d ORDER BY d`,
        params,
      );
      return rows.map((row) => ({ date: row.date, totalSeconds: Number(row.totalSeconds) }));
    },
  };
}
