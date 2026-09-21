import { createEndpointSecret, topicMatches } from './webhook-signature.js';
import { checkOutboundUrl } from '../net/outbound-url.js';

const endpointView = (row, { includeSecret = false } = {}) => ({
  id: row.id,
  label: row.label,
  url: row.url,
  topics: row.topics ?? [],
  enabled: row.enabled,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastDeliveryAt: row.last_delivery_at ?? null,
  lastFailureAt: row.last_failure_at ?? null,
  lastFailureReason: row.last_failure_reason ?? null,
  consecutiveFailures: row.consecutive_failures ?? 0,
  ...(includeSecret ? { secret: row.secret } : {}),
});

const deliveryView = (row) => ({
  id: row.id,
  endpointId: row.endpoint_id,
  eventId: row.event_id,
  topic: row.topic,
  status: row.status,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  nextAttemptAt: row.next_attempt_at,
  responseStatus: row.response_status ?? null,
  error: row.error ?? null,
  createdAt: row.created_at,
  deliveredAt: row.delivered_at ?? null,
});

const invalid = (message, code) => Object.assign(new Error(message), { code, statusCode: 400 });

export function createWebhookRepository(pool, { env = process.env } = {}) {
  // Сколько неудач подряд считать приговором приёмнику.
  const failureLimit = Math.max(1, Number(env.WEBHOOK_ENDPOINT_FAILURE_LIMIT ?? 20));
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
    async listEndpoints(session) {
      const { rows } = await pool.query(
        'SELECT * FROM webhook_endpoints WHERE workspace_id=$1 ORDER BY created_at DESC',
        [session.workspaceId],
      );
      return rows.map((row) => endpointView(row));
    },

    async createEndpoint(session, { label, url, topics = [] }) {
      const outbound = checkOutboundUrl(url);
      if (!outbound.ok) throw invalid(outbound.reason, 'INVALID_ENDPOINT_URL');
      if (!String(label ?? '').trim()) throw invalid('Endpoint label is required', 'INVALID_ENDPOINT_LABEL');
      if (!Array.isArray(topics)) throw invalid('Topics must be an array of patterns', 'INVALID_TOPICS');
      const secret = createEndpointSecret();
      const { rows } = await pool.query(
        `INSERT INTO webhook_endpoints(organization_id,workspace_id,label,url,secret,topics,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [session.organizationId, session.workspaceId, String(label).trim(), url, secret, topics, session.userId],
      );
      // The secret is shown once, here, and never again: the list endpoint
      // omits it so a leaked read of the config cannot forge our signatures.
      return endpointView(rows[0], { includeSecret: true });
    },

    async setEndpointEnabled(session, id, enabled) {
      const { rows } = await pool.query(
        `UPDATE webhook_endpoints SET enabled=$3, updated_at=now(),
           consecutive_failures=CASE WHEN $3 THEN 0 ELSE consecutive_failures END
         WHERE workspace_id=$1 AND id=$2 RETURNING *`,
        [session.workspaceId, id, Boolean(enabled)],
      );
      if (!rows[0]) throw Object.assign(new Error('Endpoint not found'), { code: 'ENDPOINT_NOT_FOUND', statusCode: 404 });
      return endpointView(rows[0]);
    },

    async deleteEndpoint(session, id) {
      const { rowCount } = await pool.query('DELETE FROM webhook_endpoints WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id]);
      if (!rowCount) throw Object.assign(new Error('Endpoint not found'), { code: 'ENDPOINT_NOT_FOUND', statusCode: 404 });
      return { deleted: true };
    },

    async listDeliveries(session, { endpointId = null, limit = 50 } = {}) {
      const { rows } = await pool.query(
        `SELECT * FROM webhook_deliveries
         WHERE workspace_id=$1 AND ($2::uuid IS NULL OR endpoint_id=$2)
         ORDER BY created_at DESC LIMIT $3`,
        [session.workspaceId, endpointId, Math.min(Number(limit) || 50, 200)],
      );
      return rows.map(deliveryView);
    },

    /**
     * Claims a batch of unpublished outbox events, fans each one out to the
     * endpoints subscribed to its topic, and marks it published — all in one
     * transaction, so an event is never published without its deliveries.
     *
     * FOR UPDATE SKIP LOCKED matches the meeting worker: several application
     * instances can run the publisher against one database.
     */
    async publishPending({ batchSize = 50, workspaceIds: only = null } = {}) {
      return tx(async (client) => {
        const { rows: events } = await client.query(
          `SELECT id,organization_id,workspace_id,topic,aggregate_id,payload,created_at
           FROM outbox_events WHERE published_at IS NULL
             AND ($2::uuid[] IS NULL OR workspace_id = ANY($2::uuid[]))
           ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
          [batchSize, only],
        );
        if (!events.length) return { events: 0, deliveries: 0 };

        const workspaceIds = [...new Set(events.map((event) => event.workspace_id))];
        const { rows: endpoints } = await client.query(
          'SELECT id,workspace_id,topics FROM webhook_endpoints WHERE enabled AND workspace_id = ANY($1::uuid[])',
          [workspaceIds],
        );

        let deliveries = 0;
        for (const event of events) {
          const targets = endpoints.filter(
            (endpoint) => endpoint.workspace_id === event.workspace_id && topicMatches(endpoint.topics, event.topic),
          );
          for (const endpoint of targets) {
            const body = {
              id: event.id,
              topic: event.topic,
              occurredAt: event.created_at,
              workspaceId: event.workspace_id,
              aggregateId: event.aggregate_id,
              data: event.payload,
            };
            // ON CONFLICT DO NOTHING plus the (endpoint_id, event_id) unique
            // key is what makes a re-run of a crashed publisher harmless.
            const inserted = await client.query(
              `INSERT INTO webhook_deliveries(organization_id,workspace_id,endpoint_id,event_id,topic,payload)
               VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (endpoint_id,event_id) DO NOTHING`,
              [event.organization_id, event.workspace_id, endpoint.id, event.id, event.topic, body],
            );
            deliveries += inserted.rowCount;
          }
        }

        await client.query('UPDATE outbox_events SET published_at=now() WHERE id = ANY($1::uuid[])', [events.map((e) => e.id)]);
        return { events: events.length, deliveries };
      });
    },

    /**
     * Claims due deliveries under a bounded lease, fairly.
     *
     * The ordering is round-robin across endpoints, not first-come: a customer
     * with a thousand pending events must not fill every slot while another
     * customer's single event waits behind them. `perEndpoint` caps one
     * endpoint's share of a single claim; `excludeEndpointIds` lets the worker
     * skip endpoints whose deliveries are still in flight.
     */
    async claimDue({ limit = 10, leaseMs = 30_000, now = new Date(), perEndpoint = limit, excludeEndpointIds = [], workspaceIds = null } = {}) {
      const { rows } = await pool.query(
        `UPDATE webhook_deliveries d
         SET status='delivering', lock_token=gen_random_uuid(), locked_until=$2::timestamptz + make_interval(secs => $3),
             attempts=d.attempts+1
         FROM (
           SELECT id FROM webhook_deliveries
           WHERE id IN (
             SELECT id FROM (
               SELECT id, next_attempt_at,
                      row_number() OVER (PARTITION BY endpoint_id ORDER BY next_attempt_at, id) AS place
               FROM webhook_deliveries
               WHERE ((status IN ('pending','failed') AND next_attempt_at <= $2::timestamptz)
                      OR (status='delivering' AND locked_until < $2::timestamptz))
                 AND NOT (endpoint_id = ANY($5::uuid[]))
                 AND ($6::uuid[] IS NULL OR workspace_id = ANY($6::uuid[]))
             ) ranked
             WHERE place <= $4
             ORDER BY place, next_attempt_at
             LIMIT $1
           )
           FOR UPDATE SKIP LOCKED
         ) due
         WHERE d.id = due.id
         RETURNING d.*, (SELECT url FROM webhook_endpoints e WHERE e.id=d.endpoint_id) url,
                   (SELECT secret FROM webhook_endpoints e WHERE e.id=d.endpoint_id) secret`,
        [limit, now.toISOString(), Math.ceil(leaseMs / 1000), Math.max(1, perEndpoint), excludeEndpointIds, workspaceIds],
      );
      return rows.map((row) => ({ ...deliveryView(row), url: row.url, secret: row.secret, lockToken: row.lock_token, payload: row.payload }));
    },

    /**
     * Успех записывается только под своей арендой.
     *
     * Если аренда протухла и строку успел забрать другой работник, запись
     * не применяется — и раньше об этом никто не узнавал: работник считал
     * доставку успешной, а в базе она оставалась чужой. Теперь метод честно
     * говорит, применилась ли запись.
     */
    async recordSuccess(delivery, responseStatus) {
      let applied = false;
      await tx(async (client) => {
        const { rowCount } = await client.query(
          `UPDATE webhook_deliveries SET status='delivered', delivered_at=now(), response_status=$2,
             error=NULL, lock_token=NULL, locked_until=NULL
           WHERE id=$1 AND lock_token=$3`,
          [delivery.id, responseStatus, delivery.lockToken],
        );
        applied = rowCount > 0;
        if (!applied) return;
        await client.query(
          `UPDATE webhook_endpoints SET last_delivery_at=now(), consecutive_failures=0, last_failure_reason=NULL
           WHERE id=$1`,
          [delivery.endpointId],
        );
      });
      return { applied };
    },

    /** `terminal` is the receiver saying "never send this again" — a 4xx that
     *  is not 408 or 429. Retrying it only burns the attempt budget. */
    async recordFailure(delivery, { responseStatus = null, error = 'delivery failed', retryInMs = 0, terminal = false }) {
      const exhausted = terminal || delivery.attempts >= delivery.maxAttempts;
      let disabled = false;
      await tx(async (client) => {
        await client.query(
          `UPDATE webhook_deliveries
           SET status=$2, response_status=$3, error=$4, lock_token=NULL, locked_until=NULL,
               next_attempt_at=now() + make_interval(secs => $5)
           WHERE id=$1 AND lock_token=$6`,
          [delivery.id, exhausted ? 'dead' : 'failed', responseStatus, String(error).slice(0, 500), Math.ceil(retryInMs / 1000), delivery.lockToken],
        );
        // Приёмник, который не отвечает подряд столько раз, — не «временно
        // недоступен», а снят с эксплуатации: его забыли выключить, домен
        // отдали другим, служба закрыта. Долбиться в него бесконечно значит
        // копить мёртвые доставки и тратить на них очередь живых. Отключаем
        // и оставляем причину: владелец включит обратно одним движением,
        // и счётчик обнулится.
        const { rows } = await client.query(
          `UPDATE webhook_endpoints
           SET last_failure_at=now(), last_failure_reason=$2, consecutive_failures=consecutive_failures+1,
               enabled=CASE WHEN consecutive_failures+1 >= $3 THEN false ELSE enabled END,
               updated_at=now()
           WHERE id=$1 RETURNING enabled, consecutive_failures`,
          [delivery.endpointId, String(error).slice(0, 500), failureLimit],
        );
        disabled = rows[0] ? rows[0].enabled === false : false;
        if (disabled) {
          // Ждущие доставки отключённого приёмника больше не занимают очередь.
          await client.query(
            `UPDATE webhook_deliveries SET status='dead', lock_token=NULL, locked_until=NULL,
               error=COALESCE(error,'приёмник отключён после череды неудач')
             WHERE endpoint_id=$1 AND status IN ('pending','failed')`,
            [delivery.endpointId],
          );
        }
      });
      return { dead: exhausted, endpointDisabled: disabled };
    },
  };
}
