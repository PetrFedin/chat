# Meeting Intelligence

## Product contract

Meeting Intelligence is not "LLM notes after a call". The product contract is a traceable execution lifecycle:

`Calendar event -> Call -> Consent -> Recording -> Durable media -> Transcript segments -> Summary -> Proposed decisions/actions -> Human confirmation -> Commitment -> Evidence -> Review -> Accepted result`

The recording and transcript remain source evidence. AI-generated decisions and actions are proposals until a person explicitly resolves them.

## Hard invariants

1. Recording cannot start without the existing participant-consent gate.
2. A webhook is trusted only after the official LiveKit JWT + exact-body SHA verification succeeds.
3. Egress is considered successful only for LiveKit `EGRESS_COMPLETE`; failed, aborted and limit-reached terminal states never queue transcription as valid media.
4. A recording object must exist in object storage and be non-empty before transcription.
5. Transcript data is stored as ordered, timecoded segments, not only one unstructured text field.
6. Every persisted AI proposal must cite at least one valid transcript segment from the same intelligence run. Ungrounded or foreign-segment proposals are dropped before review.
7. AI cannot silently assign real responsibility, set an authoritative promised date, create an accepted task result or accept its own proposal.
8. An action becomes a real `commitment` only after an authenticated user explicitly accepts it.
9. Retryable background work has durable job state, attempts, lock tokens, bounded leases, stale-worker recovery and dead-letter state.
10. External provider absence is fail-closed. Chat never manufactures a transcript or summary to keep a pipeline looking green.
11. Transcript/proposal visibility inherits the source conversation ACL; proposal UUID knowledge never grants access.
12. Provider output and notification projections happen only after durable repository commits. UI/realtime state never becomes the source of truth.

## LiveKit reconciliation

Provider endpoint:

`POST /api/v1/media/livekit/webhook`

It is intentionally outside normal user-session authentication. Authentication is the LiveKit webhook signature itself. Chat uses `WebhookReceiver` from the official `livekit-server-sdk`, validating both the JWT and the SHA-256 of the exact request body.

`media_webhook_events` is the idempotency journal. A provider event is stored once using `(provider, provider_event_id)`. If the provider event ID is absent, Chat derives a stable SHA-256 identifier from the raw body. A previously failed journal entry can be atomically reclaimed on provider redelivery; a processed/ignored entry remains a duplicate and is not executed twice.

For `egress_ended`:

- `EGRESS_COMPLETE (3)` with no error -> recording `ready`, call recording state `ready`, transcription queued;
- `EGRESS_FAILED (4)` -> recording and call recording state `failed`;
- `EGRESS_ABORTED (5)` -> recording and call recording state `failed`;
- `EGRESS_LIMIT_REACHED (6)` -> recording and call recording state `failed`;
- any unexpected terminal value -> fail-closed rather than assuming success.

Repeated reconciliation of the same successful Egress reuses the same intelligence run and transcription job and does not emit a second `meeting.recording.ready` outbox event.

## Durable processing

`meeting_intelligence_jobs` contains two job families:

- `transcribe`
- `summarize`

PostgreSQL workers claim jobs using `FOR UPDATE SKIP LOCKED`. Each claim receives a lock token and moves the visible run to `transcribing` or `summarizing`. Results commit only when the current lock token still owns the job. Failed jobs receive a future `available_at`; the final allowed failure transitions both the job to `dead_letter` and the run to `failed`.

A claimed job is a bounded lease, not a permanent lock. If a process dies after claiming a job, a later worker can reclaim it after the lease expires with a new lock token and attempt. A stale final attempt is retired to `dead_letter` rather than remaining in `processing` forever.

`MeetingWorker` provides the production execution loop. It runs independent `transcribe` and `summarize` lanes, polls only enabled providers, wakes the summary lane immediately after successful transcription, can be kicked by an Egress webhook, and reports lane counters/last error through health state. Shutdown invalidates the worker generation before waiting for in-flight work, so a provider call that finishes after shutdown timeout cannot resurrect a zombie polling loop. The durable lease remains the recovery mechanism for unfinished work.

Runtime controls:

```bash
MEETING_WORKER_ENABLED=true
MEETING_WORKER_POLL_MS=1500
MEETING_WORKER_PROVIDER_WAIT_MS=30000
MEETING_WORKER_SHUTDOWN_MS=5000
```

The server starts the worker in normal memory/PostgreSQL runtime. Custom/injected server tests do not auto-start it unless explicitly requested.

## Object evidence

Before transcription, the processor calls object storage `head()` and rejects a missing or empty recording. It then hashes the actual recording bytes and persists `source_sha256` with the run. Later audits can therefore establish which media bytes produced a transcript.

The repository emits existing `outbox_events` topics at durable boundaries:

- `meeting.recording.ready`
- `meeting.transcript.ready`
- `meeting.intelligence.review_ready`
- `meeting.proposal.accepted`

This reuses Chat's outbox instead of inventing another delivery mechanism.

## Transcript evidence model

`meeting_transcript_segments` stores:

- sequential index;
- start/end milliseconds;
- resolved workspace speaker ID when known;
- provider speaker label when identity is not known;
- text;
- confidence;
- language;
- provider segment ID.

Transcript text is searchable with PostgreSQL FTS. Proposal-to-segment edges are stored in `meeting_proposal_sources`. Proposal materialization rejects any proposal whose evidence does not resolve to at least one segment in the same run.

This supports citations such as:

`Action: Finish mobile QA -> 00:43–00:56, Speaker: Marina`

without trusting AI to reproduce the source faithfully in prose.

## Provider boundary

Provider selection is explicit. An API key alone does not turn Meeting Intelligence on.

```bash
OPENAI_API_KEY=...
MEETING_TRANSCRIPTION_PROVIDER=openai
MEETING_SUMMARY_PROVIDER=openai
```

The OpenAI transcription adapter uses `gpt-4o-transcribe-diarize` by default with `response_format=diarized_json` and `chunking_strategy=auto`, producing timestamped speaker segments. The summary adapter uses the Responses API with a strict JSON Schema and `store:false`; `gpt-5.6` is the default summary model and remains configurable.

Optional controls:

```bash
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize
OPENAI_MEETING_SUMMARY_MODEL=gpt-5.6
OPENAI_MEETING_SUMMARY_REASONING=low
MEETING_TRANSCRIPTION_LANGUAGE=ru
MEETING_TRANSCRIPTION_TIMEOUT_MS=180000
MEETING_SUMMARY_TIMEOUT_MS=180000
OPENAI_BASE_URL=https://api.openai.com/v1
```

The adapter does not let the model create authoritative work. The model returns only an overview and evidence-linked proposals. Repository validation is a second defense layer: invalid proposal types, empty titles and proposals without same-run source segments are dropped.

No OpenAI response storage is requested by Chat: summary calls always use `store:false`.

## Review-ready projection

Only after the summary transaction has committed does the processor invoke the review-ready projector. It creates idempotent `meeting.review_ready` notifications in the existing Attention Center for the meeting audience, broadcasts realtime state and optionally sends Web Push. This avoids a second AI inbox.

If that projection fails, the durable meeting summary remains `review_ready`; notification delivery failure cannot roll back or fabricate meeting intelligence state.

## Proposal lifecycle

Supported proposal types:

- `decision`
- `action`
- `risk`
- `open_question`

Initial state is always `proposed`.

A proposal becomes `accepted` or `rejected` only with an authenticated user ID and timestamp. For an action proposal, the acceptance request may explicitly provide owner, acceptor and promised date. Those users must be valid workspace members. Only then is a real `commitment` created.

The proposal receives `created_commitment_id`, preserving the trace:

`commitment <- meeting proposal -> transcript evidence -> run -> recording -> call`

The existing `evidence` ledger receives a note when the commitment is materialized. If the confirmed owner is another employee, the same `task.assigned` attention projection used by normal tasks is created, so Meeting Intelligence does not form a parallel task system.

## Product surface

The mobile-first Meeting Center is now part of the product surface. It exposes:

1. meeting/recording processing state;
2. summary overview;
3. timecoded transcript;
4. decisions/actions/risks/questions;
5. source jumps from every proposal to transcript evidence;
6. explicit accept/reject controls;
7. action confirmation with owner and promised date;
8. link from accepted action to the created task;
9. review-ready notifications in Daily Work.

Demo content uses an explicitly synthetic transcript fixture. Synthetic content is never represented as production transcription truth.

## API

- `GET /api/v1/meetings`
- `GET /api/v1/calls/:callId/meeting`
- `POST /api/v1/meeting-proposals/:proposalId/accept`
- `POST /api/v1/meeting-proposals/:proposalId/reject`
- signed provider endpoint: `POST /api/v1/media/livekit/webhook`
- runtime state: `GET /healthz`

Meeting visibility inherits the source conversation ACL for reads and mutations. There is no independent AI-notes permission island that can leak a private conversation.

## Next engineering slice

The next work should improve production economics and evidence depth rather than weakening the contract:

1. provider-cost/latency metrics and per-run usage accounting;
2. large-recording strategy so long composite video does not require unbounded application-memory buffering;
3. optional known-speaker references and speaker-to-workspace identity resolution;
4. richer reverse link from task to proposal/timecode;
5. admin retry/dead-letter operations with audit trail;
6. retention and regional-processing controls for enterprise deployments;
7. quality evaluation fixtures for RU/EN transcription and summary grounding.
