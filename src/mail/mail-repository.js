const view = (row) => ({
  id: row.id,
  kind: row.kind,
  to: row.to_email,
  subject: row.subject,
  status: row.status,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  nextAttemptAt: row.next_attempt_at,
  error: row.error ?? null,
  createdAt: row.created_at,
  sentAt: row.sent_at ?? null,
});

/**
 * Очередь исходящих писем.
 *
 * Устроена как очередь доставок вебхуков и по тем же причинам: письмо
 * нельзя «отправить в обработчике запроса». Почтовый сервер отвечает
 * секунды, иногда отказывает, иногда просит подождать — и всё это не
 * должно ни задерживать ответ на «пригласить сотрудника», ни терять
 * приглашение, если отправка не удалась с первого раза.
 */
export function createMailRepository(pool) {
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

  return {
    /**
     * Ставит письмо в очередь.
     *
     * `sourceId` — приглашение или запрос на сброс, породившие письмо.
     * По нему стоит уникальный индекс: повторный вызов маршрута не
     * ставит второе письмо, и человек не получает два приглашения.
     */
    async enqueue({ organizationId = null, workspaceId = null, kind, to, subject, text, html = null, sourceId = null, actorId = null }) {
      const { rows } = await pool.query(
        `INSERT INTO mail_messages(organization_id,workspace_id,kind,to_email,subject,text_body,html_body,source_id,actor_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (kind,source_id) WHERE source_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [organizationId, workspaceId, kind, String(to).toLowerCase(), subject, text, html, sourceId, actorId],
      );
      // Ничего не вставилось — письмо на это событие уже в очереди.
      return rows[0] ? view(rows[0]) : null;
    },

    async list(session, { limit = 50, kind = null } = {}) {
      const { rows } = await pool.query(
        `SELECT * FROM mail_messages
         WHERE workspace_id=$1 AND ($2::text IS NULL OR kind=$2)
         ORDER BY created_at DESC LIMIT $3`,
        [session.workspaceId, kind, Math.min(Number(limit) || 50, 200)],
      );
      return rows.map(view);
    },

    /**
     * Берёт готовые к отправке письма под аренду.
     *
     * Условие повторяется и в блокирующем скане: если оставить его
     * только во вложенном запросе, `FOR UPDATE SKIP LOCKED` нечего
     * перепроверять после снятия блокировки, и одно письмо достаётся
     * двум работникам — человек получает два приглашения.
     */
    async claimDue({ limit = 10, leaseMs = 60_000, now = new Date(), workspaceIds = null } = {}) {
      const { rows } = await pool.query(
        `UPDATE mail_messages m
         SET status='sending', lock_token=gen_random_uuid(),
             locked_until=$2::timestamptz + make_interval(secs => $3), attempts=m.attempts+1
         FROM (
           SELECT id FROM mail_messages
           WHERE ((status IN ('pending','failed') AND next_attempt_at <= $2::timestamptz)
                  OR (status='sending' AND locked_until < $2::timestamptz))
             AND id IN (
               SELECT id FROM mail_messages
               WHERE ((status IN ('pending','failed') AND next_attempt_at <= $2::timestamptz)
                      OR (status='sending' AND locked_until < $2::timestamptz))
                 AND ($4::uuid[] IS NULL OR workspace_id = ANY($4::uuid[]))
               ORDER BY next_attempt_at, id LIMIT $1
             )
           FOR UPDATE SKIP LOCKED
         ) due
         WHERE m.id = due.id
         RETURNING m.*`,
        [limit, now.toISOString(), Math.ceil(leaseMs / 1000), workspaceIds],
      );
      return rows.map((row) => ({
        ...view(row),
        text: row.text_body,
        html: row.html_body ?? null,
        lockToken: row.lock_token,
        organizationId: row.organization_id,
        workspaceId: row.workspace_id,
        actorId: row.actor_id ?? null,
      }));
    },

    /** Успех записывается только под своей арендой — как у доставок. */
    async recordSent(message) {
      const { rowCount } = await pool.query(
        `UPDATE mail_messages SET status='sent', sent_at=now(), error=NULL, lock_token=NULL, locked_until=NULL
         WHERE id=$1 AND lock_token=$2`,
        [message.id, message.lockToken],
      );
      return { applied: rowCount > 0 };
    },

    /**
     * `permanent` — сервер сказал «такого ящика нет». Повторять такое
     * значит жечь попытки и репутацию отправителя: письмо сразу мёртвое.
     */
    async recordFailure(message, { error = 'отправка не удалась', retryInMs = 0, permanent = false } = {}) {
      const exhausted = permanent || message.attempts >= message.maxAttempts;
      await tx(async (client) => {
        await client.query(
          `UPDATE mail_messages
           SET status=$2, error=$3, lock_token=NULL, locked_until=NULL,
               next_attempt_at=now() + make_interval(secs => $4)
           WHERE id=$1 AND lock_token=$5`,
          [message.id, exhausted ? 'dead' : 'failed', String(error).slice(0, 500), Math.ceil(retryInMs / 1000), message.lockToken],
        );
        // Журнал требует действующего лица, и это правильно: «система»
        // не отвечает на вопрос, кого спрашивать, почему коллега не
        // пришёл. Письма без него в журнал не попадают — только в лог.
        if (!exhausted || !message.workspaceId || !message.actorId) return;
        // Непришедшее приглашение выглядит для компании как «человек не
        // отвечает». Пусть в журнале останется, что письмо не дошло.
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'mail',$3,'mail.undelivered',$4,$5)`,
          [message.organizationId, message.workspaceId, message.id, message.actorId,
            { kind: message.kind, to: message.to, reason: String(error).slice(0, 500) }],
        );
      });
      return { dead: exhausted };
    },

    /** Глубина очереди — для /readyz и эксплуатации. */
    async backlog() {
      const { rows } = await pool.query(
        `SELECT status, count(*)::int n, EXTRACT(EPOCH FROM (now() - min(created_at)))::int age
         FROM mail_messages WHERE status IN ('pending','failed') GROUP BY status`,
      );
      const depth = { pending: 0, failed: 0, oldestAgeSec: 0 };
      for (const row of rows) {
        depth[row.status] = row.n;
        depth.oldestAgeSec = Math.max(depth.oldestAgeSec, row.age ?? 0);
      }
      return depth;
    },

    /**
     * Сколько раз за окно просили сброс пароля на этот адрес.
     *
     * Маршрут «забыл пароль» открыт без входа, и без счётчика он —
     * готовая рассылка по чужим ящикам от нашего имени.
     */
    async countResetRequests(email, windowMs) {
      await pool.query('INSERT INTO password_reset_requests(email) VALUES($1)', [String(email).toLowerCase()]);
      const { rows } = await pool.query(
        `SELECT count(*)::int n FROM password_reset_requests
         WHERE email=$1 AND requested_at > now() - make_interval(secs => $2)`,
        [String(email).toLowerCase(), Math.ceil(windowMs / 1000)],
      );
      return rows[0]?.n ?? 0;
    },
  };
}
