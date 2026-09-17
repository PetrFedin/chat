# Meeting Intelligence

## Product contract

Meeting Intelligence is not "LLM notes after a call". The product contract is a traceable execution lifecycle:

`Calendar event -> Call -> Consent -> Recording -> Durable media -> Transcript segments -> Summary -> Proposed decisions/actions -> Human confirmation -> Commitment -> Evidence -> Review -> Accepted result`

The recording and transcript remain source evidence. AI-generated decisions and actions are proposals until a person explicitly resolves them.

## Hard invariants

1. Recording cannot start without the existing participant-consent gate.
2. A webhook is trusted only after the official LiveKit JWT + exact-body SHA verification succeeds.
3. Egress is considered successful only for LiveKit `EGRESS_COMPLETE`; failed, aborted and limit-reached terminal states never become valid media silently.
4. A recording source must exist in object storage and be non-empty before transcription.
5. Transcript data is stored as ordered, timecoded segments, not only one unstructured text field.
6. Every persisted AI proposal must cite at least one valid transcript segment from the same intelligence run. Ungrounded or foreign-segment proposals are dropped before review.
7. AI cannot silently assign real responsibility, set an authoritative promised date, create an accepted task result or accept its own proposal.
8. An action becomes a real `commitment` only after an authenticated user explicitly accepts it.
9. Retryable background work has durable job state, attempts, lock tokens, bounded leases, stale-worker recovery and dead-letter state.
10. External provider absence is fail-closed. Chat never manufactures a transcript or summary to keep a pipeline looking green.
11. Transcript/proposal visibility inherits the source conversation ACL; proposal UUID knowledge never grants access.
12. Provider output and notification projections happen only after durable repository commits. UI/realtime state never becomes the source of truth.
13. A transcription optimization must never replace the evidence archive silently. Archive and transcription source have separate lifecycle states.
14. Provider economics are measured from source usage/latency per attempt; historical source measurements are never overwritten by retries or changing price assumptions.

## LiveKit reconciliation

Provider endpoint:

`POST /api/v1/media/livekit/webhook`

It is intentionally outside normal user-session authentication. Authentication is the LiveKit webhook signature itself. Chat uses `WebhookReceiver` from the official `livekit-server-sdk`, validating both the JWT and the SHA-256 of the exact request body.

`media_webhook_events` is the idempotency journal. A provider event is stored once using `(provider, provider_event_id)`. If the provider event ID is absent, Chat derives a stable SHA-256 identifier from the raw body. A previously failed journal entry can be atomically reclaimed on provider redelivery; a processed/ignored entry remains a duplicate and is not executed twice.

For the primary archive Egress:

- `EGRESS_COMPLETE (3)` -> archive recording `ready`;
- `EGRESS_FAILED (4)` -> archive `failed`;
- `EGRESS_ABORTED (5)` -> archive `failed`;
- `EGRESS_LIMIT_REACHED (6)` -> archive `failed`;
- unexpected terminal values fail closed.

Repeated successful reconciliation reuses the same intelligence run/job and cannot emit a second first-queue transition.

## Dual media source strategy

The default recording path remains one LiveKit RoomComposite MP4. This is the review/evidence archive.

Long video can be an unnecessarily heavy speech-to-text source, so production deployments may explicitly enable a second audio-only Egress:

```bash
LIVEKIT_TRANSCRIPTION_EGRESS_ENABLED=true
```

When enabled, Chat starts:

- MP4 RoomComposite archive with the normal meeting layout;
- audio-only OGG RoomComposite sidecar for transcription.

The sidecar is **opt-in** because it is a second Egress and therefore can change infrastructure cost. There is no hidden automatic duplication.

`call_recordings` keeps separate fields for the transcription source:

- `transcription_provider_recording_id`;
- `transcription_storage_key`;
- `transcription_source_status`;
- `transcription_source_error`.

Selection/fallback semantics are deterministic:

1. no sidecar configured -> archive completion queues transcription exactly as before;
2. archive completes while sidecar is still processing -> wait for sidecar;
3. sidecar completes -> queue once and use sidecar;
4. sidecar fails after archive is ready -> queue from archive;
5. sidecar fails first -> wait for archive, then use archive if it succeeds;
6. archive fails but sidecar is ready -> transcription can continue from sidecar while archive remains honestly `failed`;
7. both sources fail -> transcript fails; no invented fallback source.

`source_sha256` is calculated from the media bytes actually submitted for transcription, so evidence provenance remains exact even when the sidecar is selected.

## Durable processing

`meeting_intelligence_jobs` contains two job families:

- `transcribe`
- `summarize`

PostgreSQL workers claim jobs using `FOR UPDATE SKIP LOCKED`. Each claim receives a lock token and moves the visible run to `transcribing` or `summarizing`. Results commit only when the current lock token still owns the job. Failed jobs receive a future `available_at`; the final allowed failure transitions both the job to `dead_letter` and the run to `failed`.

A claimed job is a bounded lease, not a permanent lock. If a process dies after claiming a job, a later worker can reclaim it after the lease expires with a new lock token and attempt. A stale final attempt is retired to `dead_letter` rather than remaining in `processing` forever.

`MeetingWorker` provides the production execution loop. It runs independent `transcribe` and `summarize` lanes, polls only enabled providers, wakes the summary lane immediately after successful transcription, can be kicked by Egress reconciliation, and reports lane counters/last error through health state. Shutdown invalidates the worker generation before waiting for in-flight work, so a provider call that finishes after shutdown timeout cannot resurrect a zombie polling loop. The durable lease remains the recovery mechanism for unfinished work.

Runtime controls:

```bash
MEETING_WORKER_ENABLED=true
MEETING_WORKER_POLL_MS=1500
MEETING_WORKER_PROVIDER_WAIT_MS=30000
MEETING_WORKER_SHUTDOWN_MS=5000
```

## Bounded media memory

The current HTTP transcription adapter submits multipart media bytes. Before downloading a source object, Chat calls object-storage `head()` and enforces its own memory ceiling:

```bash
MEETING_PROCESSING_MAX_IN_MEMORY_BYTES=67108864
```

Default: 64 MiB.

If the selected archive/sidecar is larger, processing fails before object download/provider invocation with `RECORDING_OBJECT_TOO_LARGE`. This is intentionally fail-safe: a worker must not OOM a service instance merely because one meeting is unusually long.

The audio sidecar is the preferred mitigation for normal long meetings because it removes video from the transcription source. A future provider/chunking pipeline can lift this ceiling without weakening the current memory invariant.

## Provider attempt observability

`meeting_provider_calls` is the source ledger for external processing attempts. One actual provider attempt creates one immutable lifecycle row keyed by `(workspace, job, attempt_number)`.

Recorded fields include:

- run/job and kind (`transcribe` / `summarize`);
- retry attempt number;
- provider and model;
- provider request ID;
- internal input metadata such as selected source kind and byte size;
- provider-reported usage;
- start/finish timestamps and measured latency;
- success/failure and failure code/message.

A retry creates a new attempt row; it does not rewrite previous provider behavior.

### Why currency cost is not stored as the source fact

Vendor prices change. Therefore Chat persists usage and model identity, not a hard-coded historical currency amount at the moment of processing. Cost reporting should join these measurements to a versioned price catalog effective for the provider/model/date. That yields reproducible historical economics without corrupting the provider-call source record when tariffs change.

The authenticated Meeting Center may expose safe operational metrics (provider/model, attempt, usage, latency, status). It does **not** expose provider request IDs or internal source metadata.

## Object evidence

Before transcription, the processor checks existence/non-empty size, enforces the memory ceiling, downloads the chosen source and hashes the exact bytes. `source_sha256` is persisted with the run. Later audits can establish which media bytes produced a transcript.

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

The mobile-first Meeting Center exposes:

1. meeting/recording processing state;
2. summary overview;
3. timecoded transcript;
4. decisions/actions/risks/questions;
5. source jumps from every proposal to transcript evidence;
6. explicit accept/reject controls;
7. action confirmation with owner and promised date;
8. link from accepted action to the created task;
9. review-ready notifications in Daily Work;
10. safe processing attempt metrics for diagnosis/economics.

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

After sidecar/fallback and attempt telemetry, the next production work should focus on control and quality:

1. versioned provider price catalog + cost rollups by meeting/workspace/company;
2. admin retry/dead-letter operations with audit trail and bounded authorization;
3. known-speaker references and speaker-to-workspace identity resolution;
4. richer reverse link from task to proposal/timecode;
5. retention and regional-processing controls for enterprise deployments;
6. RU/EN evaluation fixtures for transcription/diarization/summary grounding;
7. streaming or provider-native large-object transcription for sources that legitimately exceed the in-memory ceiling.
