import { randomUUID } from 'node:crypto';

const clone = (value) => value == null ? value : structuredClone(value);
const now = () => new Date().toISOString();

export async function claimWebhookEvent(repository, value) {
  if (repository?.pool) {
    const { rows } = await repository.pool.query(`INSERT INTO media_webhook_events(
      provider,provider_event_id,event_type,payload
    ) VALUES($1,$2,$3,$4)
    ON CONFLICT(provider,provider_event_id) DO UPDATE SET
      event_type=EXCLUDED.event_type,
      payload=EXCLUDED.payload,
      status='received',
      received_at=now(),
      processed_at=NULL,
      failed_at=NULL,
      last_error=NULL
    WHERE media_webhook_events.status='failed'
    RETURNING id,provider,provider_event_id "providerEventId",event_type "eventType",status,received_at "receivedAt"`,
    [value.provider, value.providerEventId, value.eventType, value.payload ?? {}]);
    if (rows[0]) return { claimed:true, event:rows[0] };
    const existing = (await repository.pool.query(`SELECT id,provider,provider_event_id "providerEventId",event_type "eventType",status,received_at "receivedAt"
      FROM media_webhook_events WHERE provider=$1 AND provider_event_id=$2`, [value.provider, value.providerEventId])).rows[0] ?? null;
    return { claimed:false, event:existing };
  }

  if (repository?.webhooks instanceof Map) {
    const key = typeof repository.webhookKey === 'function'
      ? repository.webhookKey(value.provider, value.providerEventId)
      : `${value.provider}:${value.providerEventId}`;
    const existing = repository.webhooks.get(key);
    if (!existing) {
      const event = { id:randomUUID(), status:'received', receivedAt:now(), ...value };
      repository.webhooks.set(key, event);
      return { claimed:true, event:clone(event) };
    }
    if (existing.status === 'failed') {
      Object.assign(existing, value, {
        status:'received',
        receivedAt:now(),
        processedAt:null,
        failedAt:null,
        lastError:null,
      });
      return { claimed:true, reclaimed:true, event:clone(existing) };
    }
    return { claimed:false, event:clone(existing) };
  }

  const legacy = await repository.recordWebhook(value);
  return { claimed:Boolean(legacy?.inserted), event:legacy?.event ?? null };
}
