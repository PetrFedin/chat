# Delivery roadmap

Status legend: DONE / IN PROGRESS / NEXT / PLANNED / DEFERRED.

## P0 — domain foundation — DONE

- DONE: standalone repository initialized.
- DONE: explicit commitment lifecycle.
- DONE: one accountable owner invariant.
- DONE: owner must explicitly accept responsibility.
- DONE: Message -> Commitment source linkage.
- DONE: calendar block linkage with positive-range validation.
- DONE: evidence required before review.
- DONE: designated acceptor controls result acceptance.
- DONE: promised date and forecast date are separate.
- DONE: rescheduling requires a reason and retains previous values in audit.
- DONE: end-to-end traceability gate.
- DONE: golden-path and negative-path Node tests.
- DONE: CI executes domain tests on every main push and pull request.

## P1 — persistence and command safety — IN PROGRESS

- DONE: PostgreSQL base schema for organizations, workspaces, memberships, conversations, messages, commitments, calendar blocks, evidence, acceptances, audit events, outbox and idempotency keys.
- DONE: workspace-scoped composite foreign keys for message/thread/commitment references.
- DONE: database checks for calendar ranges, enums, non-empty values and idempotency-key uniqueness.
- DONE: database smoke tests for cross-workspace reference rejection, invalid calendar ranges and duplicate idempotency keys.
- DONE: CI PostgreSQL service applies migrations and runs constraint tests.
- DONE: permission matrix and server-enforced authorization boundary.
- DONE: optimistic concurrency command (`expectedVersion`).
- DONE: atomic Message -> Commitment command with audit + outbox in one transaction.
- DONE: atomic review accept/return command with evidence and designated-acceptor validation at persistence boundary.
- DONE: transactional outbox now has a consumer — events fan out to subscribed
  endpoints in the same transaction that marks them published, and a duplicate
  delivery for one (endpoint, event) pair is rejected by the schema.
- NEXT: `Idempotency-Key` on mutating commands. The `idempotency_keys` table has
  existed since 001 and is still unused, so replaying a POST still creates a
  second task. This is the last open item of the P1 exit gate.

Exit gate: replaying a command cannot duplicate a task/message/event; cross-workspace access is denied; unauthorized role actions are denied; all domain invariants survive direct persistence tests.

## P2 — API + realtime — DONE

Shipped ahead of the sequencing rule below: REST + `/openapi.json`, WebSocket
presence/typing/workspace events, read cursors, mentions, threads and a
notification projection are all in the running product.

- REST/OpenAPI command/query surface.
- WebSocket/SSE event stream with durable sequence/cursor.
- reconnect without duplicated messages.
- read state, mentions, threads and notification projection.

Exit gate: offline/reconnect and duplicate-submit scenarios are deterministic.

## P3 — calendar engine — PLANNED

- Month / Week / Agenda.
- recurring events and time zones.
- task time blocking.
- conflict detection.
- promised vs forecast vs planned vs actual views.
- Google/Outlook integration with loop prevention.

## P4 — execution UI — PLANNED

- Today; Inbox; Chats; Task inspector; Calendar; Review queue; Search.
- keyboard-first and mobile quick capture.
- one context inspector exposes message source, responsibility, plan, evidence, review and audit without page-hopping.

## P5 — management control — PLANNED

- overdue and stale commitments; blockers/dependencies; acceptance queue; workload; schedule drift; reopen rate; decisions requiring management action.

## P6 — automation and AI — PARTIALLY DONE

Meeting Intelligence (transcript, summary, proposed decisions and actions with
mandatory human confirmation) is shipped. The rules engine with dry-run and an
execution log is not.

- rules engine with dry-run and execution log.
- thread summaries; action-item proposals; unsaved-agreement detection; schedule proposals; risk detection.
- human confirmation for consequential actions.

## P7 — external collaboration and integrations — PLANNED

- guests/contractors; email-to-task; Slack/Teams/Telegram adapters; public API/webhooks; CSV/Excel imports with deduplication and provenance.
- generic EntityLink integration with external systems without coupling their domain models into this core.

## Current priority correction

The original rule said realtime chat and calendar UI start only after tenant
authorization, optimistic concurrency, idempotent replay and atomic
audit/outbox behaviour are proven. Three of those four are now proven; UI,
calls and Meeting Intelligence shipped before the fourth. Idempotent replay is
therefore the outstanding debt, not a future nicety, and it is the next item.

A second correction from the same review: the browser was never exercised. The
suite was green while the running page froze on load, because every UI test
parses source with regular expressions. A headless-browser smoke test belongs
in CI ahead of further feature work.
