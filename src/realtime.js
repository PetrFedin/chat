import { randomUUID } from 'node:crypto';

const CHANNEL = 'chat_rt';
const KEEP_SECONDS = 120;

export class RealtimeHub {
  constructor() {
    this.clients = new Map();
    this.instanceId = randomUUID();
    this.bus = null;
  }

  /**
   * Подключить шину между копиями приложения.
   *
   * Каждое событие, доставленное своим сокетам, дополнительно кладётся в таблицу и объявляется через
   * NOTIFY; остальные копии читают его и доставляют своим. Своё же событие копия пропускает (origin).
   * Сбой шины не должен ронять доставку на этой копии: ошибки только считаются.
   */
  async attachBus(pool, { log = () => {} } = {}) {
    if (!pool || this.bus) return false;
    const bus = { pool, listener: null, timer: null, stopped: false, errors: 0 };
    this.bus = bus;

    const deliver = async (id) => {
      try {
        const { rows } = await pool.query('SELECT origin, workspace_id, user_ids, event, data FROM realtime_events WHERE id=$1', [id]);
        const row = rows[0];
        if (!row || row.origin === this.instanceId) return;
        if (row.user_ids) this.#deliverUsers(row.workspace_id, row.user_ids, row.event, row.data);
        else this.#deliverWorkspace(row.workspace_id, row.event, row.data, null);
      } catch (error) { bus.errors += 1; log('warn', 'realtime.bus.read_failed', { err: String(error?.message ?? error) }); }
    };

    const listen = async () => {
      if (bus.stopped) return;
      try {
        const client = await pool.connect();
        bus.listener = client;
        client.on('notification', (message) => { if (message.channel === CHANNEL) void deliver(message.payload); });
        client.on('error', () => reconnect(client));
        client.on('end', () => reconnect(client));
        await client.query(`LISTEN ${CHANNEL}`);
      } catch (error) {
        bus.errors += 1;
        log('warn', 'realtime.bus.listen_failed', { err: String(error?.message ?? error) });
        setTimeout(listen, 2000).unref?.();
      }
    };
    const reconnect = (client) => {
      if (bus.listener !== client) return;
      bus.listener = null;
      try { client.release(true); } catch { /* уже закрыт */ }
      if (!bus.stopped) setTimeout(listen, 1000).unref?.();
    };
    await listen();

    // Старые события не нужны никому: копии читают их в течение секунд.
    bus.timer = setInterval(() => {
      pool.query(`DELETE FROM realtime_events WHERE created_at < now() - interval '${KEEP_SECONDS} seconds'`).catch(() => {});
    }, 60_000);
    bus.timer.unref?.();
    return true;
  }

  async detachBus() {
    const bus = this.bus;
    if (!bus) return;
    bus.stopped = true;
    clearInterval(bus.timer);
    try { await bus.listener?.query(`UNLISTEN ${CHANNEL}`); } catch { /* закрывается */ }
    try { bus.listener?.release(true); } catch { /* закрыт */ }
    this.bus = null;
  }

  #publish(workspaceId, userIds, event, data) {
    const bus = this.bus;
    if (!bus) return;
    bus.pool.query(
      'INSERT INTO realtime_events(origin, workspace_id, user_ids, event, data) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [this.instanceId, workspaceId, userIds, event, JSON.stringify(data ?? null)],
    ).then(({ rows }) => bus.pool.query(`SELECT pg_notify('${CHANNEL}', $1)`, [String(rows[0].id)]))
      .catch(() => { bus.errors += 1; });
  }

  add(workspaceId, userId, socket) {
    const key = `${workspaceId}:${userId}`;
    const bucket = this.clients.get(key) ?? new Set();
    bucket.add(socket);
    this.clients.set(key, bucket);
    return () => {
      bucket.delete(socket);
      if (!bucket.size) this.clients.delete(key);
    };
  }

  /**
   * Сколько людей сейчас на связи.
   *
   * В /healthz стояло `realtime:true` литералом: сколько вкладок открыто и
   * есть ли вообще хоть одна — узнать было негде.
   */
  size() {
    let sockets = 0;
    for (const bucket of this.clients.values()) sockets += bucket.size;
    return sockets;
  }

  /** Сколько пространств сейчас на связи — грубая мера активности. */
  workspaces() {
    return new Set([...this.clients.keys()].map((key) => key.split(':')[0])).size;
  }

  send(socket, event, data) {
    if (socket.readyState !== 1) return;
    socket.send(JSON.stringify({ event, data, at: new Date().toISOString() }));
  }

  #deliverWorkspace(workspaceId, event, data, except) {
    for (const [key, sockets] of this.clients) {
      if (!key.startsWith(`${workspaceId}:`)) continue;
      for (const socket of sockets) if (socket !== except) this.send(socket, event, data);
    }
  }

  #deliverUsers(workspaceId, userIds, event, data) {
    for (const userId of new Set(userIds)) {
      for (const socket of this.clients.get(`${workspaceId}:${userId}`) ?? []) {
        this.send(socket, event, data);
      }
    }
  }

  broadcastWorkspace(workspaceId, event, data, except = null) {
    this.#deliverWorkspace(workspaceId, event, data, except);
    this.#publish(workspaceId, null, event, data);
  }

  broadcastUsers(workspaceId, userIds, event, data) {
    const unique = [...new Set(userIds)];
    this.#deliverUsers(workspaceId, unique, event, data);
    this.#publish(workspaceId, unique, event, data);
  }
}
