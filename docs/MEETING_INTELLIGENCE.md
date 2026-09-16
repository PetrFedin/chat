# Meeting Intelligence

## Product contract

Meeting Intelligence is not "LLM notes after a call". The product contract is a traceable execution lifecycle:

`Calendar event -> Call -> Consent -> Recording -> Durable media -> Transcript segments -> Summary -> Proposed decisions/actions -> Human confirmation -> Commitment -> Evidence -> Review -> Accepted result`

The recording and transcript remain the source evidence. AI-generated decisions and actions are proposals until a person explicitly resolves them.

## Hard invariants

1. Recording cannot start without the existing participant-consent gate.
2. A webhook is trusted only after the official LiveKit JWT + exact-body SHA verification succeeds.
3. Egress is considered successful only for LiveKit `EGRESS_COMPLETE`; failed, aborted and limit-reached terminal states never queue transcription as if media were valid.
4. A recording object must exist in object storage and be non-empty before transcription.
5. Transcript data is stored as ordered, timecoded segments, not only one unstructured text field.
6. Every persisted AI proposal must cite at least one valid transcript segment from the same intelligence run. Ungrounded or foreign-segment proposals are dropped before review.
7. AI cannot assign real responsibility, set an authoritative promised date, create an accepted task result, or accept its own proposal.
8. An action becomes a real `commitment` only after an authenticated user explicitly accepts the proposal.
9. Retryable background work has durable job state, attempts, lock tokens, bounded leases, stale-worker recovery and dead-letter state.
10. External provider absence is fail-closed. Chat must never manufacture a transcript or summary to keep a pipeline looking green.
11. Read and mutation access for transcript/proposals inherits the source conversation ACL; proposal UUID knowledge never grants access.

## LiveKit reconciliation

The public endpoint is:

`POST /api/v1/media/livekit/webhook`

It is intentionally outside normal user-session authentication. Authentication is the LiveKit webhook signature itself. Chat uses `WebhookReceiver` from the official `livekit-server-sdk`, which verifies both the LiveKit JWT and the SHA-256 of the exact request body.

`media_webhook_events` is the idempotency journal. A provider event is stored once using `(provider, provider_event_id)`. If the provider event ID is absent, Chat derives a stable SHA-256 identifier from the raw body.

For `egress_ended`:

- `EGRESS_COMPLETE (3)` with no error -> recording `ready`, call recording state `ready`, transcription queued;
- `EGRESS_FAILED (4)` -> recording and call recording state `failed`;
- `EGRESS_ABORTED (5)` -> recording and call recording state `failed`;
- `EGRESS_LIMIT_REACHED (6)` -> recording and call recording state `failed`;
- any unexpected terminal value -> fail-closed rather than assuming success.

Repeated reconciliation of the same successful Egress reuses the same intelligence run and transcription job and does not emit a second `meeting.recording.ready` outbox event.

## Durable processing

`meeting_intelligence_jobs` contains two initial job families:

- `transcribe`
- `summarize`

Workers claim jobs using `FOR UPDATE SKIP LOCKED`. Each claim receives a lock token and moves the visible run to `transcribing` or `summarizing`. Results are committed only when the current lock token still owns the job. Failed jobs receive a future `available_at`; the final allowed failure transitions both the job to `dead_letter` and the run to `failed`.

A claimed job is a bounded lease, not a permanent lock. If a worker dies after claiming a job, a later worker can reclaim that job after the lease expires with a new lock token and another attempt. A stale final attempt is retired to `dead_letter` rather than remaining in `processing` forever.

The processor contract validates object storage using `head()` before downloading media. It then hashes the actual recording bytes and persists `source_sha256` with the run. This lets later audits prove which media bytes produced a transcript.

The repository emits existing `outbox_events` topics at durable boundaries:

- `meeting.recording.ready`
- `meeting.transcript.ready`
- `meeting.intelligence.review_ready`
- `meeting.proposal.accepted`

This reuses Chat's existing outbox rather than inventing another delivery mechanism.

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

Transcript text is searchable with PostgreSQL FTS. A proposal-to-segment edge is stored in `meeting_proposal_sources`. Proposal materialization rejects any proposal whose supplied evidence does not resolve to at least one segment in the same run.

This graph supports UI citations such as:

`Action: Finish mobile QA -> 00:43–00:56, Speaker: Marina`

without trusting the AI to reproduce the source faithfully in prose.

## Proposal lifecycle

Supported proposal types:

- `decision`
- `action`
- `risk`
- `open_question`

Initial state is always `proposed`.

A proposal can become `accepted` or `rejected` only with a user ID and timestamp. For an action proposal, the acceptance request may explicitly provide:

- owner;
- acceptor;
- promised date.

Those users must be valid workspace members. Only then is a real `commitment` created. The proposal receives `created_commitment_id`, preserving a bidirectional audit path through queries:

`commitment <- meeting proposal -> transcript evidence -> run -> recording -> call`

The existing `evidence` ledger receives a note when the commitment is materialized. If the confirmed owner is another employee, the same `task.assigned` attention projection used by normal tasks is created in the Notification Center, so Meeting Intelligence does not form a parallel task system. A later schema pass may add a dedicated typed meeting-source edge if richer reverse navigation becomes necessary.

## Provider boundary

The repository and processor are production-capable without pretending a transcription provider exists. Default providers are disabled and expose that state through health/read APIs.

A production provider adapter must return deterministic structured data to this contract:

### Transcription

- language;
- model/provider identifiers;
- ordered `{startMs,endMs,text,speaker...}` segments.

### Summary

- overview;
- structured summary JSON;
- proposals;
- source segment IDs for every persisted proposal.

Provider selection should be made separately against current official documentation for diarization, timestamps, RU/EN quality, asynchronous large-media handling, retention/security and cost.

## API

- `GET /api/v1/calls/:callId/meeting`
- `POST /api/v1/meeting-proposals/:proposalId/accept`
- `POST /api/v1/meeting-proposals/:proposalId/reject`
- signed provider endpoint: `POST /api/v1/media/livekit/webhook`

Meeting visibility inherits the source conversation ACL for both reads and mutations. There is no independent "AI notes" permission island that could leak a private conversation through a transcript or allow an outsider to accept/reject a private proposal.

## Next user-visible layer

The foundation is intentionally separate from the presentation layer. The next slice should add a mobile-first meeting detail surface containing:

1. recording/processing state;
2. overview;
3. timecoded transcript;
4. proposed decisions/actions/risks/questions;
5. source jumps for every proposal;
6. explicit accept/reject controls;
7. action acceptance sheet with owner and promised date confirmation;
8. link from accepted action to the created task;
9. link from task back to transcript evidence.

A demo fixture may use a clearly marked synthetic transcript so the interface can be reviewed without presenting synthetic text as production transcription output.
