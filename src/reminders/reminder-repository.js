import { pageSize, toDateOrNull } from '../http/helpers.js';
import { openConversationSql } from '../persistence/visibility.js';
import { randomUUID } from 'node:crypto';

/**
 * Напоминания человека самому себе.
 *
 * Задача в этом продукте — обязательство перед кем-то: у неё есть
 * ответственный, принимающий, доказательство и проверка. Напоминание —
 * другое: «позвонить подрядчику в 15:00», «вернуться к этому завтра».
 * Заводить ради такого обязательство с доказательством значит заставлять
 * человека притворяться, поэтому это отдельная сущность с одним обещанием:
 * в назначенный час она сама придёт в центр внимания.
 *
 * Срабатывание построено как durable-очередь, а не таймер в памяти:
 * перезапуск сервера не теряет ни одного напоминания, а два процесса не
 * разбудят человека дважды — строка забирается FOR UPDATE SKIP LOCKED и
 * меняет состояние в той же транзакции, где появляется уведомление.
 */

const fail = (message, code, statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

const MAX_TITLE = 200;
const MAX_NOTE = 2000;
const SOURCES = new Set(['message', 'task', 'event', 'conversation']);

const COLUMNS = `id,title,note,remind_at "remindAt",status,source_type "sourceType",
  source_id "sourceId",conversation_id "conversationId",fired_at "firedAt",
  completed_at "completedAt",created_at "createdAt"`;

const view = (row) => ({
  id: row.id,
  title: row.title,
  note: row.note,
  remindAt: row.remindAt,
  status: row.status,
  sourceType: row.sourceType,
  sourceId: row.sourceId,
  conversationId: row.conversationId,
  firedAt: row.firedAt,
  completedAt: row.completedAt,
  createdAt: row.createdAt,
});

function readWhen(value, { allowPast = false } = {}) {
  // Через общий строгий разбор: 31 ноября молча уезжало на 1 декабря, а
  // 31 февраля — на 3 марта, и человек читал отказ «нельзя ставить
  // напоминание больше чем на сутки назад» про дату, которую назначил в
  // будущем. Отказ объяснял не то, что случилось.
  let iso;
  try { iso = toDateOrNull(value); } catch { throw fail('Такой даты не бывает', 'INVALID_REMIND_AT', 400); }
  if (!iso) throw fail('У напоминания должно быть время', 'INVALID_REMIND_AT', 400);
  const at = new Date(iso);
  const yearAhead = Date.now() + 366 * 24 * 3600 * 1000;
  if (at.getTime() > yearAhead) throw fail('Напоминание нельзя поставить больше чем на год вперёд', 'REMIND_AT_TOO_FAR', 400);
  if (!allowPast && at.getTime() < Date.now() - 24 * 3600 * 1000) {
    throw fail('Напоминание нельзя поставить больше чем на сутки назад', 'REMIND_AT_TOO_OLD', 400);
  }
  return at.toISOString();
}

function readTitle(value) {
  const title = String(value ?? '').trim();
  if (!title) throw fail('У напоминания должно быть название', 'INVALID_REMINDER_TITLE', 400);
  if (title.length > MAX_TITLE) throw fail(`A reminder title is at most ${MAX_TITLE} characters`, 'INVALID_REMINDER_TITLE', 400);
  return title;
}

export function createReminderRepository(pool) {
  if (!pool) {
    const unavailable = () => {
      throw fail('Reminders need the PostgreSQL store', 'REMINDERS_UNAVAILABLE', 503);
    };
    return { enabled: false, list: unavailable, create: unavailable, update: unavailable, remove: unavailable, due: unavailable };
  }

  return {
    enabled: true,

    /** Свои напоминания: сработавшие впереди, дальше по времени. */
    async list(session, { status = 'open', limit = 100 } = {}) {
      const size = pageSize(limit, 100, 200);
      const states = status === 'done' ? ['done', 'cancelled']
        : status === 'all' ? ['pending', 'fired', 'done', 'cancelled']
        : ['pending', 'fired'];
      const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM reminders
          WHERE workspace_id=$1 AND user_id=$2 AND status = ANY($3)
          ORDER BY (status='fired') DESC, remind_at ASC LIMIT $4`,
        [session.workspaceId, session.userId, states, size],
      );
      return rows.map(view);
    },

    async create(session, body = {}) {
      const title = readTitle(body.title);
      const remindAt = readWhen(body.remindAt);
      const note = body.note == null || body.note === '' ? null : String(body.note).slice(0, MAX_NOTE);
      const sourceType = body.sourceType == null || body.sourceType === '' ? null : String(body.sourceType);
      if (sourceType && !SOURCES.has(sourceType)) throw fail('Такого источника напоминания нет', 'INVALID_REMINDER_SOURCE', 400);
      // Беседа проверяется на существование и на доступность: напоминание
      // цеплялось к любому опознавателю, в том числе выдуманному и к
      // чужой личной переписке. Когда оно срабатывало, человека вели по
      // этой связи — в никуда либо в чужую комнату, где его встречал 404.
      if (body.conversationId) {
        const { rowCount } = await pool.query(
          `SELECT 1 FROM conversations c
             LEFT JOIN conversation_members cm ON cm.workspace_id=c.workspace_id AND cm.conversation_id=c.id AND cm.user_id=$3
            WHERE c.workspace_id=$1 AND c.id=$2 AND c.archived_at IS NULL
              AND (${openConversationSql(session, 'c')} OR cm.user_id IS NOT NULL)`,
          [session.workspaceId, body.conversationId, session.userId],
        );
        if (!rowCount) throw fail('Такой беседы нет', 'CONVERSATION_NOT_FOUND', 404);
      }
      const { rows } = await pool.query(
        `INSERT INTO reminders(organization_id,workspace_id,user_id,title,note,remind_at,source_type,source_id,conversation_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLUMNS}`,
        [session.organizationId, session.workspaceId, session.userId, title, note, remindAt,
         sourceType, sourceType ? (body.sourceId ?? null) : null, body.conversationId ?? null],
      );
      return view(rows[0]);
    },

    /** Отложить, отметить сделанным, переписать. */
    async update(session, id, patch = {}) {
      const sets = [];
      const params = [session.workspaceId, session.userId, id];
      const push = (column, value) => { params.push(value); sets.push(`${column}=$${params.length}`); };

      if (patch.title !== undefined) push('title', readTitle(patch.title));
      if (patch.note !== undefined) push('note', patch.note == null || patch.note === '' ? null : String(patch.note).slice(0, MAX_NOTE));
      if (patch.remindAt !== undefined) {
        push('remind_at', readWhen(patch.remindAt));
        // Перенос будит напоминание заново: сработавшее снова ждёт часа.
        push('status', 'pending');
        push('fired_at', null);
        push('completed_at', null);
      }
      if (patch.status !== undefined) {
        const status = String(patch.status);
        if (!['pending', 'done', 'cancelled'].includes(status)) {
          throw fail('A reminder can only be reopened, completed or cancelled', 'INVALID_REMINDER_STATUS', 400);
        }
        push('status', status);
        push('completed_at', status === 'done' ? new Date().toISOString() : null);
      }
      if (!sets.length) throw fail('Nothing to change', 'EMPTY_REMINDER_PATCH', 400);
      sets.push('updated_at=now()');

      const { rows } = await pool.query(
        `UPDATE reminders SET ${sets.join(',')} WHERE workspace_id=$1 AND user_id=$2 AND id=$3 RETURNING ${COLUMNS}`,
        params,
      );
      if (!rows[0]) throw fail('Reminder not found', 'REMINDER_NOT_FOUND', 404);
      return view(rows[0]);
    },

    async remove(session, id) {
      const { rowCount } = await pool.query(
        'DELETE FROM reminders WHERE workspace_id=$1 AND user_id=$2 AND id=$3',
        [session.workspaceId, session.userId, id],
      );
      if (!rowCount) throw fail('Reminder not found', 'REMINDER_NOT_FOUND', 404);
    },

    /** Разбудить всё, чему пришёл час. */
    async due({ limit = 50, now = new Date() } = {}) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `SELECT id,organization_id "organizationId",workspace_id "workspaceId",user_id "userId",
                  title,note,conversation_id "conversationId",
                  source_type "sourceType",source_id "sourceId"
             FROM reminders
            WHERE status='pending' AND remind_at <= $1
            ORDER BY remind_at
            FOR UPDATE SKIP LOCKED
            LIMIT $2`,
          [now.toISOString(), pageSize(limit, 50, 200)],
        );
        for (const row of rows) {
          await client.query(
            // Связь с тем, о чём напоминали, терялась: человек сам указал
            // встречу или задачу, а извещение приходило без неё и без
            // ссылки — за предметом надо было идти искать руками.
            `INSERT INTO notifications(organization_id,workspace_id,recipient_user_id,source_event_id,
                                       dedupe_key,type,title,body,conversation_id,calendar_event_id,commitment_id,url)
             VALUES($1,$2,$3,$4,$5,'calendar.reminder',$6,$7,$8,$9,$10,$11)
             ON CONFLICT (workspace_id,dedupe_key) DO NOTHING`,
            [row.organizationId, row.workspaceId, row.userId, randomUUID(),
             `reminder:${row.id}`, row.title,
             row.note?.trim() ? row.note : 'Вы просили напомнить.', row.conversationId,
             row.sourceType === 'event' ? row.sourceId : null,
             row.sourceType === 'task' ? row.sourceId : null,
             row.sourceType === 'event' && row.sourceId ? `/#/calendar/${row.sourceId}`
               : row.sourceType === 'task' && row.sourceId ? `/#/tasks/${row.sourceId}`
               : row.conversationId ? `/#/chats/${row.conversationId}` : null],
          );
          await client.query(
            "UPDATE reminders SET status='fired',fired_at=now(),updated_at=now() WHERE id=$1",
            [row.id],
          );
        }
        await client.query('COMMIT');
        return { fired: rows.length, ids: rows.map((row) => row.id) };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * Работник очереди: спит между проходами и не держит процесс живым.
 */
/**
 * `calls` — необязательный сосед: тот же обход времени закрывает звонки,
 * которых никто не взял. Отдельного работника ради этого заводить не
 * стоит, а без обхода звонок оставался «звонящим» навсегда: срока у
 * состояния не было, и понятия «пропущенный» в продукте не существовало.
 */
export function createReminderWorker(repository, { intervalMs, env = process.env, calls = null, onMissedCalls = null } = {}) {
  // Как часто заглядывать в напоминания и включён ли обход вообще — решение
  // эксплуатации, а не константа в коде.
  const everyMs = Math.max(1000, Number(intervalMs ?? env.REMINDER_WORKER_POLL_MS ?? 30_000));
  const enabled = env.REMINDER_WORKER_ENABLED !== 'false';
  let timer = null;
  let running = false;
  const schedule = (loop) => { timer = setTimeout(loop, everyMs); timer.unref?.(); };
  return {
    async sweepCalls() {
      if (!calls?.sweepUnanswered) return [];
      const missed = await calls.sweepUnanswered({ after: env.CALL_RINGING_TIMEOUT ?? '5 minutes' });
      if (missed.length && onMissedCalls) await onMissedCalls(missed);
      return missed;
    },
    async tick() {
      await this.sweepCalls().catch(() => {});
      if (!repository?.enabled) return { fired: 0 };
      return repository.due({});
    },
    start() {
      // Обход нужен и тогда, когда напоминаний нет: звонки, которых
      // никто не взял, закрывает он же.
      if (!enabled || running) return;
      if (!repository?.enabled && !calls?.sweepUnanswered) return;
      running = true;
      const loop = async () => {
        try { await this.sweepCalls(); } catch { /* следующий проход попробует снова */ }
        if (repository?.enabled) try { await repository.due({}); } catch { /* следующий проход попробует снова */ }
        if (running) schedule(loop);
      };
      // Первый обход — сразу, а не через интервал: после перезапуска
      // напоминания, чей час уже настал, ждали ещё полминуты.
      void loop();
    },
    stop() { running = false; if (timer) clearTimeout(timer); timer = null; },
  };
}
