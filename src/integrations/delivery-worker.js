import { backoffMs, signPayload } from './webhook-signature.js';

const RETRYABLE_STATUS = (status) => status === 408 || status === 429 || status >= 500;

/**
 * Publishes outbox events into per-endpoint deliveries, then sends them.
 *
 * Kept separate from the meeting worker on purpose: a slow customer receiver
 * must never delay transcription, and vice versa.
 */
export function createDeliveryWorker(repository, env = process.env, options = {}) {
  const enabled = options.enabled ?? env.WEBHOOK_WORKER_ENABLED !== 'false';
  const pollMs = Number(env.WEBHOOK_WORKER_POLL_MS ?? 2000);
  const batchSize = Number(env.WEBHOOK_WORKER_BATCH ?? 10);
  const timeoutMs = Number(env.WEBHOOK_DELIVERY_TIMEOUT_MS ?? 10_000);
  const leaseMs = Number(env.WEBHOOK_DELIVERY_LEASE_MS ?? 30_000);
  const send = options.send ?? globalThis.fetch;

  const state = { running: false, stopping: false, published: 0, delivered: 0, failed: 0, dead: 0, lastError: null, lastRunAt: null };
  let timer = null;

  async function deliver(delivery) {
    const rawBody = JSON.stringify(delivery.payload);
    const signature = signPayload(delivery.secret, rawBody);
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await send(delivery.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Chat-Webhooks/1',
          'x-chat-delivery-id': delivery.id,
          'x-chat-event-id': delivery.eventId,
          'x-chat-topic': delivery.topic,
          'x-chat-signature': signature,
        },
        body: rawBody,
        signal: controller.signal,
        redirect: 'manual',
      });
      if (response.ok) {
        await repository.recordSuccess(delivery, response.status);
        state.delivered += 1;
        return;
      }
      const retryable = RETRYABLE_STATUS(response.status);
      const result = await repository.recordFailure(delivery, {
        responseStatus: response.status,
        error: retryable ? `receiver responded ${response.status}` : `receiver rejected with ${response.status}; not retryable`,
        retryInMs: retryable ? backoffMs(delivery.attempts) : 0,
        terminal: !retryable,
      });
      state[result.dead ? 'dead' : 'failed'] += 1;
    } catch (error) {
      const result = await repository.recordFailure(delivery, {
        error: error.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : String(error.message ?? error),
        retryInMs: backoffMs(delivery.attempts),
      });
      state[result.dead ? 'dead' : 'failed'] += 1;
    } finally {
      clearTimeout(abort);
    }
  }

  async function tick() {
    state.lastRunAt = new Date().toISOString();
    const published = await repository.publishPending({ batchSize: batchSize * 5 });
    state.published += published.deliveries;
    const due = await repository.claimDue({ limit: batchSize, leaseMs });
    await Promise.allSettled(due.map(deliver));
    return { published, claimed: due.length };
  }

  async function loop() {
    while (!state.stopping) {
      try {
        const { claimed } = await tick();
        if (!claimed) await new Promise((resolve) => { timer = setTimeout(resolve, pollMs); timer.unref?.(); });
      } catch (error) {
        state.lastError = String(error.message ?? error);
        await new Promise((resolve) => { timer = setTimeout(resolve, pollMs); timer.unref?.(); });
      }
    }
    state.running = false;
  }

  return {
    tick,
    start() {
      if (!enabled || !repository || state.running) return false;
      state.running = true;
      state.stopping = false;
      void loop();
      return true;
    },
    async stop() {
      state.stopping = true;
      if (timer) clearTimeout(timer);
    },
    status: () => ({ configured: Boolean(repository) && enabled, ...state }),
  };
}
