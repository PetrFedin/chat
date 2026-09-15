# Delivery roadmap

Status legend: DONE / NEXT / PLANNED / DEFERRED.

## P0 — domain foundation

- DONE: standalone repository initialized.
- DONE: explicit commitment lifecycle.
- DONE: one accountable owner invariant.
- DONE: owner must explicitly accept responsibility.
- DONE: message source linkage.
- DONE: calendar block linkage with range validation.
- DONE: evidence required before review.
- DONE: designated acceptor controls result acceptance.
- DONE: promised date and forecast date are separate.
- DONE: rescheduling requires a reason and retains previous values in audit.
- DONE: end-to-end traceability gate.
- DONE: golden-path and negative-path Node tests committed.

## P1 — persistence and command safety — NEXT

1. PostgreSQL schema: organizations, workspaces, memberships, commitments, versions, conversations, messages, calendar blocks, evidence, acceptances, audit events, outbox.
2. Tenant isolation and permission matrix.
3. Idempotency keys and optimistic concurrency.
4. Atomic Message -> Commitment creation.
5. Atomic acceptance/rejection and audit event creation.
6. Migration tests and database constraints.

Exit gate: replaying a command cannot duplicate a task/message/event; cross-workspace access is denied; all domain invariants survive direct persistence tests.

## P2 — API + realtime

- REST/OpenAPI command/query surface.
- WebSocket/SSE event stream with durable sequence/cursor.
- reconnect without duplicated messages.
- read state, mentions, threads and notification projection.

Exit gate: offline/reconnect and duplicate-submit scenarios are deterministic.

## P3 — calendar engine

- Month / Week / Agenda.
- recurring events and time zones.
- task time blocking.
- conflict detection.
- promised vs forecast vs planned vs actual views.
- Google/Outlook integration with loop prevention.

## P4 — execution UI

- Today.
- Inbox.
- Chats.
- Task inspector.
- Calendar.
- Review queue.
- Search.
- Keyboard-first quick capture.

## P5 — management control

- overdue and stale commitments.
- blockers and dependencies.
- acceptance queue.
- workload.
- schedule drift.
- reopen rate.
- decisions requiring management action.

## P6 — automation and AI

- rules engine with dry-run and execution log.
- thread summaries.
- action-item proposals.
- unsaved-agreement detection.
- schedule proposals.
- risk detection.
- human confirmation for consequential actions.

## P7 — external collaboration and integrations

- guests/contractors.
- email-to-task.
- Slack/Teams/Telegram adapters.
- public API/webhooks.
- CSV/Excel imports with deduplication and provenance.
- generic EntityLink integration with SYNTHA/SYNTH-V2 without coupling their domain models into this core.

## Current priority correction

The next highest-value work is persistence and authorization, not more UI. Until tenant isolation, idempotency, versioning and atomic audit/outbox behavior are proven, realtime chat and calendar UI would create fragile surface area on top of an unverified core.
