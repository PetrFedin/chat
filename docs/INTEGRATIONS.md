# Outbound integrations

Chat emits work-graph events to endpoints you register. This is the transport
every other integration is built on: a Telegram bot, a CRM sync and an
intranet portal all consume the same signed delivery.

## Why a webhook and not an adapter per system

Every adapter written into this repository is a dependency this repository has
to keep alive: an API that changes, a token that expires, a vendor that leaves
the market. One signed, documented event stream moves that work outside, where
a customer can point n8n, a Cloud Function or a hand-written receiver at it.
Adapters are then worth writing only where the volume justifies them.

## Registering an endpoint

`POST /api/v1/integrations/webhooks` — requires `integration.manage`
(owner and admin).

```json
{ "label": "Ops portal", "url": "https://ops.example.com/chat-events", "topics": ["meeting.*", "task.transitioned"] }
```

The response carries `secret` **once**. It is never returned again: listing
endpoints omits it, so a leaked read of the configuration cannot forge our
signatures. Store it when you create the endpoint.

`topics` accepts exact names (`task.transitioned`), prefix patterns
(`meeting.*`), `*`, or an empty list, which means every topic.

| Route | Method | Purpose |
|---|---|---|
| `/api/v1/integrations/webhooks` | GET | list endpoints (no secrets) |
| `/api/v1/integrations/webhooks` | POST | create; returns the secret once |
| `/api/v1/integrations/webhooks/{id}/enable` | POST | resume delivery, reset the failure counter |
| `/api/v1/integrations/webhooks/{id}/disable` | POST | stop delivery, keep the history |
| `/api/v1/integrations/webhooks/{id}` | DELETE | remove the endpoint and its deliveries |
| `/api/v1/integrations/deliveries` | GET | delivery log, newest first |

Without `DATABASE_URL` these routes answer `503 INTEGRATIONS_UNAVAILABLE`: the
in-memory store has no durable queue, and a webhook you cannot retry is worse
than no webhook.

## The delivery

```
POST /your/endpoint
content-type: application/json
x-chat-delivery-id: 6f1c…      unique per attempt target; de-duplicate on it
x-chat-event-id: 2b70…         stable across retries of the same event
x-chat-topic: task.transitioned
x-chat-signature: v1,t=1789844085,s=7116bf…
```

```json
{
  "id": "2b70…",
  "topic": "task.transitioned",
  "occurredAt": "2026-09-19T18:42:11.204Z",
  "workspaceId": "…",
  "aggregateId": "…",
  "data": { "from": "in_progress", "to": "in_review" }
}
```

## Verifying the signature

The signed string is `<timestamp>.<raw body>`, HMAC-SHA256, hex. Verify
against the **raw** bytes, before any JSON parsing, and compare in constant
time. The timestamp is inside the signed string, so it cannot be moved to buy
a fresh window — reject anything older than five minutes.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, rawBody, header, toleranceSeconds = 300) {
  const [version, t, s] = header.split(',');
  if (version !== 'v1') return false;
  const timestamp = Number(t.slice(2));
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  const actual = Buffer.from(s.slice(2), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```

`src/integrations/webhook-signature.js` exports this same `verifySignature`,
and the tests exercise it, so the documented contract cannot drift from the
implementation.

## Retries, and what your endpoint must do

Answer `2xx` as soon as you have durably accepted the event; do the work
afterwards. Chat waits 10 s.

- `2xx` — delivered.
- `408`, `429`, `5xx` — retried with exponential backoff and full jitter, up to
  6 attempts, capped at one hour between tries.
- any other `4xx` — treated as "never send this again" and marked `dead`
  immediately, because retrying a rejection only burns the budget.

Retries mean **at-least-once**: the same `x-chat-event-id` can arrive twice.
De-duplicate on it. Deliveries are per endpoint, so one unreachable receiver
never delays another customer's events.

## Available topics

| Topic | Emitted when |
|---|---|
| `meeting.recording.ready` | a recording is validated in object storage |
| `meeting.transcript.ready` | timecoded transcript segments are stored |
| `meeting.intelligence.review_ready` | a summary and its proposals await human review |
| `meeting.proposal.accepted` | a person confirmed an AI proposal |
| `meeting.job.requeued` | an operator recovered a dead-lettered job |

Work-graph topics (`task.transitioned`, `task.evidence.added`,
`commitment.accepted`) are written to `audit_events` today and are the next to
be mirrored into the outbox.

## Operating it

`GET /healthz` reports `integrations.outbound`: whether the worker is
configured and running, and counters for published, delivered, failed and dead
deliveries. `consecutive_failures` on an endpoint is the signal to alert on —
a receiver that has been failing all day is a broken integration, not a blip.
