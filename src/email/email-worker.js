/**
 * A durable outbox driver. Repository claims are committed before network I/O;
 * expired dispatch leases become unknown_outcome and are never auto-retried.
 * This timer intentionally contains no message bodies, recipients or secrets.
 */
export function createEmailWorker(email, { pollMs = 5000, enabled = true } = {}) {
  let timer = null, stopped = true, lastRunAt = null;
  const running = { outbox: null, sync: null, waiting: null };
  const phaseErrors = {};
  const interval = Math.max(250, Number(pollMs) || 5000);
  function phase(name, code, run) {
    if (running[name]) return running[name];
    // Install the promise before calling an adapter. A synchronous exception
    // must not pin an already-settled promise as an in-flight phase forever.
    running[name] = Promise.resolve().then(run).then(result => {
      const value = result ?? {};
      const error = value.failedOperations > 0 || value.errorCode ? code : null;
      if (error) phaseErrors[name] = error; else delete phaseErrors[name];
      return { value, error };
    }, () => {
      // DB/provider exception messages may contain mailbox credentials.
      phaseErrors[name] = code;
      return { value: {}, error: code };
    }).finally(() => {
      lastRunAt = new Date().toISOString();
      running[name] = null;
    });
    return running[name];
  }
  function launch() {
    return [
      phase('outbox', 'EMAIL_OUTBOX_FAILED', () => email.processOutbox()),
      phase('sync', 'EMAIL_SYNC_FAILED', () => email.processSync?.()),
      phase('waiting', 'EMAIL_WAITING_FAILED', () => email.processWaiting?.()),
    ];
  }
  async function tick() {
    if (!enabled || !email?.durable) return { processed: 0, disabled: true };
    // A blocked IMAP request retains only the sync slot. Due sends and waiting
    // deadlines can run on the next timer tick without duplicating that sync.
    const [outbox, sync, waiting] = await Promise.all(launch());
    const errors = Object.fromEntries([['outbox', outbox.error], ['sync', sync.error], ['waiting', waiting.error]].filter(([, error]) => error));
    return {
      ...outbox.value, processed: outbox.value.processed ?? 0,
      syncedMailboxes: sync.value.processed ?? 0, waitingWorkspaces: waiting.value.processed ?? 0,
      ...(Object.keys(errors).length ? { errorCode: 'EMAIL_WORKER_FAILED', phaseErrors: errors } : {}),
    };
  }
  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      if (stopped) return;
      // Background polling retains only three phase promises, not another
      // aggregate waiter for every tick while an IMAP call remains blocked.
      launch();
      schedule();
    }, interval);
    timer.unref?.();
  }
  return {
    start() { if (!stopped || !enabled || !email?.durable) return; stopped = false; schedule(); },
    async stop() { stopped = true; clearTimeout(timer); timer = null; await Promise.all(Object.values(running)); },
    tick,
    status() { return { enabled: Boolean(enabled && email?.durable), running: Object.values(running).some(Boolean), stopped, lastRunAt, lastError: Object.keys(phaseErrors).length ? 'EMAIL_WORKER_FAILED' : null, phaseErrors: { ...phaseErrors } }; },
  };
}
