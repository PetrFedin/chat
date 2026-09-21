import { backoffMs, signPayload } from './webhook-signature.js';
import { checkOutboundTarget } from '../net/outbound-url.js';
import { log } from '../obs/log.js';

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
  // Сколько доставок держим в полёте разом и сколько из них — на одного
  // приёмника. Второе и есть защита от чужой медлительности: приёмник,
  // который думает полминуты, занимает свои два слота, а не всю очередь.
  const maxInFlight = Number(env.WEBHOOK_WORKER_CONCURRENCY ?? batchSize);
  const perEndpoint = Number(env.WEBHOOK_WORKER_PER_ENDPOINT ?? Math.max(1, Math.ceil(maxInFlight / 4)));
  const send = options.send ?? globalThis.fetch;
  // По умолчанию работник обслуживает всю базу; список пространств пригоден
  // для того, чтобы развести нагрузку по нескольким работникам.
  const workspaceIds = options.workspaceIds ?? null;
  const checkTarget = options.checkTarget ?? checkOutboundTarget;

  const state = { running: false, stopping: false, published: 0, delivered: 0, failed: 0, dead: 0, lostLease: 0, lastError: null, lastRunAt: null };
  let timer = null;

  /**
   * О двух событиях эксплуатация обязана узнать из журнала, а не от
   * заказчика: доставка окончательно умерла и приёмник отключён совсем.
   * Отдельные неудачные попытки не пишем — это шум.
   */
  function announce(delivery, result, reason) {
    if (result?.endpointDisabled) {
      log('error', 'webhook.endpoint.disabled', { endpointId: delivery.endpointId, deliveryId: delivery.id, reason });
    } else if (result?.dead) {
      log('warn', 'webhook.delivery.dead', { endpointId: delivery.endpointId, deliveryId: delivery.id, topic: delivery.topic, reason });
    }
  }

  async function deliver(delivery) {
    // Адрес принимали когда-то, а идём по нему сейчас: за это время имя
    // могло начать указывать внутрь нашей же сети.
    const target = await checkTarget(delivery.url);
    if (!target.ok) {
      const result = await repository.recordFailure(delivery, {
        error: `адрес отклонён перед отправкой: ${target.reason}`,
        terminal: true,
      });
      state[result.dead ? 'dead' : 'failed'] += 1;
      announce(delivery, result, `адрес отклонён: ${target.reason}`);
      return;
    }
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
        const written = await repository.recordSuccess(delivery, response.status);
        if (written?.applied === false) {
          // Аренду перехватил другой работник: доставка уйдёт ещё раз. Для
          // получателя это ожидаемо — договор «хотя бы один раз», — но знать
          // об этом нужно, иначе двойные доставки выглядят необъяснимыми.
          state.lostLease += 1;
          console.warn(`доставка ${delivery.id}: аренда истекла до записи успеха`);
          return;
        }
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
      announce(delivery, result, `receiver responded ${response.status}`);
    } catch (error) {
      const result = await repository.recordFailure(delivery, {
        error: error.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : String(error.message ?? error),
        retryInMs: backoffMs(delivery.attempts),
      });
      state[result.dead ? 'dead' : 'failed'] += 1;
      announce(delivery, result, error.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : String(error.message ?? error));
    } finally {
      clearTimeout(abort);
    }
  }

  const inFlight = new Map();
  const busyByEndpoint = new Map();

  function begin(delivery) {
    busyByEndpoint.set(delivery.endpointId, (busyByEndpoint.get(delivery.endpointId) ?? 0) + 1);
    const done = deliver(delivery).finally(() => {
      inFlight.delete(delivery.id);
      const left = (busyByEndpoint.get(delivery.endpointId) ?? 1) - 1;
      if (left > 0) busyByEndpoint.set(delivery.endpointId, left);
      else busyByEndpoint.delete(delivery.endpointId);
    });
    inFlight.set(delivery.id, done);
  }

  const saturated = () => [...busyByEndpoint].filter(([, busy]) => busy >= perEndpoint).map(([id]) => id);

  /** Забирает столько, сколько влезает в свободные слоты, и запускает — не дожидаясь. */
  async function pump() {
    const free = Math.min(batchSize, maxInFlight - inFlight.size);
    if (free <= 0) return 0;
    const due = await repository.claimDue({ limit: free, leaseMs, perEndpoint, excludeEndpointIds: saturated(), workspaceIds });
    for (const delivery of due) begin(delivery);
    return due.length;
  }

  const sleep = (ms) => new Promise((resolve) => { timer = setTimeout(resolve, ms); timer.unref?.(); });

  /** Один полный проход с ожиданием — то, что нужно тестам и ручному прогону. */
  async function tick() {
    state.lastRunAt = new Date().toISOString();
    const published = await repository.publishPending({ batchSize: batchSize * 5, workspaceIds });
    state.published += published.deliveries;
    const claimed = await pump();
    await Promise.allSettled([...inFlight.values()]);
    return { published, claimed };
  }

  async function loop() {
    while (!state.stopping) {
      try {
        state.lastRunAt = new Date().toISOString();
        const published = await repository.publishPending({ batchSize: batchSize * 5, workspaceIds });
        state.published += published.deliveries;
        const claimed = await pump();
        // Заодно раз в проход снимаем глубину очереди: по накопленным с
        // запуска счётчикам не понять, копится ли прямо сейчас.
        state.queue = await repository.backlog?.().catch(() => null) ?? state.queue ?? null;
        // Освободился слот — идём за следующей доставкой сразу, а не ждём,
        // пока договорит самый медленный собеседник.
        if (inFlight.size) await Promise.race([...inFlight.values(), sleep(claimed ? pollMs : Math.min(pollMs, 50))]);
        else if (!claimed) await sleep(pollMs);
      } catch (error) {
        state.lastError = String(error.message ?? error);
        await sleep(pollMs);
      }
    }
    await Promise.allSettled([...inFlight.values()]);
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
      await Promise.allSettled([...inFlight.values()]);
    },
    status: () => ({ configured: Boolean(repository) && enabled, inFlight: inFlight.size, queue: state.queue, ...state }),
  };
}
