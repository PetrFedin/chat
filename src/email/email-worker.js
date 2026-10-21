/**
 * A durable outbox driver. Repository claims are committed before network I/O;
 * expired dispatch leases become unknown_outcome and are never auto-retried.
 * This timer intentionally contains no message bodies, recipients or secrets.
 */
export function createEmailWorker(email, { pollMs = 5000, enabled = true } = {}) {
  let timer = null, running = null, stopped = true, lastRunAt = null, lastError = null;
  const interval = Math.max(250, Number(pollMs) || 5000);
  async function tick() {
    if (!enabled || !email?.durable) return { processed: 0, disabled: true };
    if (running) return running;
    running = (async () => {
      try {
        const result = await email.processOutbox();
        const sync = await email.processSync?.();
        const waiting = await email.processWaiting?.();
        lastRunAt = new Date().toISOString(); lastError = null;
        return { ...result, syncedMailboxes: sync?.processed ?? 0, waitingWorkspaces: waiting?.processed ?? 0 };
      } catch {
        // DB/provider exception messages may contain connection information.
        lastError = 'EMAIL_WORKER_FAILED';
        return { processed: 0, errorCode: lastError };
      } finally { running = null; }
    })();
    return running;
  }
  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => { await tick(); schedule(); }, interval);
    timer.unref?.();
  }
  return {
    start() { if (!stopped || !enabled || !email?.durable) return; stopped = false; schedule(); },
    async stop() { stopped = true; clearTimeout(timer); timer = null; await running; },
    tick,
    status() { return { enabled: Boolean(enabled && email?.durable), running: Boolean(running), stopped, lastRunAt, lastError }; },
  };
}
