export class RealtimeHub {
  constructor() { this.clients = new Map(); }

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

  broadcastWorkspace(workspaceId, event, data, except = null) {
    for (const [key, sockets] of this.clients) {
      if (!key.startsWith(`${workspaceId}:`)) continue;
      for (const socket of sockets) if (socket !== except) this.send(socket, event, data);
    }
  }

  broadcastUsers(workspaceId, userIds, event, data) {
    for (const userId of new Set(userIds)) {
      for (const socket of this.clients.get(`${workspaceId}:${userId}`) ?? []) {
        this.send(socket, event, data);
      }
    }
  }
}
