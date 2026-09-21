/**
 * Сроки хранения.
 *
 * Во всём приложении был ровно один сборщик мусора — по ключам
 * идемпотентности. Всё остальное копилось вечно: опубликованные события
 * очереди, доставленные вебхуки, прочитанные уведомления, оборванные
 * сессии, использованные ссылки на смену пароля. На горизонте месяцев это
 * и есть основной рост базы, причём растёт то, что уже никому не нужно.
 *
 * Что здесь НЕ чистится и не будет: журнал (`audit_events`) и сама работа —
 * сообщения, задачи, встречи, файлы. Журнал ведут ровно затем, чтобы он
 * пережил тех, о ком написан; работу удаляет человек, а не уборщик.
 *
 * Правило одно: удаляем только то, что уже отработало, и только старше
 * срока. Событие очереди уходит, когда от него не осталось доставок, —
 * иначе уборка проглотила бы недоставленное.
 */

export function createRetentionSweeper(pool, env = process.env) {
  if (!pool) {
    return {
      enabled: false, sweep: async () => ({}), start: () => false, stop: () => {},
      status: () => ({ configured: false }),
    };
  }

  const enabled = env.RETENTION_ENABLED !== 'false';
  const days = Math.max(1, Number(env.RETENTION_DAYS ?? 90));
  const notificationDays = Math.max(1, Number(env.RETENTION_NOTIFICATION_DAYS ?? 30));
  const intervalMs = Math.max(60_000, Number(env.RETENTION_INTERVAL_MS ?? 6 * 3600 * 1000));
  const state = { running: false, stopping: false, lastRunAt: null, lastError: null, removed: {} };
  let timer = null;

  const older = (n) => `now() - interval '${Number(n)} days'`;

  async function sweep() {
    const removed = {};
    const run = async (name, sql) => { removed[name] = (await pool.query(sql)).rowCount; };

    // Сессия, которую уже не принимают: просроченная или отозванная.
    await run('sessions', `DELETE FROM user_sessions
      WHERE expires_at < ${older(days)} OR (revoked_at IS NOT NULL AND revoked_at < ${older(days)})`);

    // Ссылка на смену пароля живёт сутки и срабатывает один раз.
    await run('passwordResets', `DELETE FROM password_resets
      WHERE status <> 'pending' AND created_at < ${older(days)}`);

    // Прочитанное и убранное в архив — то, на что человек уже ответил.
    await run('notifications', `DELETE FROM notifications
      WHERE (archived_at IS NOT NULL AND archived_at < ${older(notificationDays)})
         OR (status = 'read' AND read_at < ${older(notificationDays)})`);

    // Доставка, с которой уже ничего не произойдёт.
    await run('deliveries', `DELETE FROM webhook_deliveries
      WHERE status IN ('delivered','dead')
        AND COALESCE(delivered_at, next_attempt_at, created_at) < ${older(days)}`);

    // Событие уходит только когда от него не осталось доставок.
    await run('outbox', `DELETE FROM outbox_events e
      WHERE e.published_at IS NOT NULL AND e.published_at < ${older(days)}
        AND NOT EXISTS (SELECT 1 FROM webhook_deliveries d WHERE d.event_id = e.id)`);

    await run('mediaWebhooks', `DELETE FROM media_webhook_events WHERE received_at < ${older(days)}`);

    state.removed = removed;
    state.lastRunAt = new Date().toISOString();
    return removed;
  }

  async function loop() {
    while (!state.stopping) {
      try { await sweep(); }
      catch (error) { state.lastError = String(error.message ?? error); }
      await new Promise((resolve) => { timer = setTimeout(resolve, intervalMs); timer.unref?.(); });
    }
    state.running = false;
  }

  return {
    enabled,
    sweep,
    start() {
      if (!enabled || state.running) return false;
      state.running = true;
      state.stopping = false;
      void loop();
      return true;
    },
    stop() { state.stopping = true; if (timer) clearTimeout(timer); },
    status: () => ({ configured: enabled, days, notificationDays, ...state }),
  };
}
