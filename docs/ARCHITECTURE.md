# Architecture decisions

## 1. Modular monolith first

The initial production architecture is a modular monolith backed by PostgreSQL. Chat, tasks, calendar, acceptance, notifications and audit are separate domain modules but share one transactional boundary where a business action must be atomic.

Microservices are deferred until measured scaling or organizational boundaries justify them.

## 2. Shared work context, not cross-product links

Core graph:

`Workspace -> Conversation -> Message -> Commitment -> CalendarBlock -> Evidence -> Acceptance`

A commitment may originate elsewhere, but its source is explicit. Every consequential mutation emits an immutable audit event. External systems are represented by generic EntityLink records rather than fashion-specific identifiers.

## 3. Dates are semantically different

The model must not collapse these into one due date:

- promisedAt: commitment made to the requester;
- forecastAt: current best completion forecast;
- calendar start/end: time reserved for execution;
- completedAt: execution claimed complete;
- acceptedAt: result accepted.

## 4. Responsibility and acceptance

A commitment has exactly one accountable owner. Collaborators may be many. Completion by the owner does not equal acceptance. A designated acceptor reviews evidence and accepts or returns work.

## 5. Consequential changes are auditable

Owner, outcome, promised date, acceptance criteria, cancellation and deferral must never be silently overwritten. They create versioned/audit events with actor and reason where required.

## 6. Reliability requirements for persistence phase

P1 persistence must add:

- PostgreSQL tenant isolation by workspace/organization;
- optimistic concurrency/version checks;
- idempotency keys on mutating commands;
- transactional outbox;
- append-only audit events;
- database constraints mirroring domain invariants;
- migrations tested forward on a clean database and upgrade path.

## 7. AI boundary

AI may propose summaries, commitments, schedules and risk flags. It may not silently accept responsibility, change a promised date, accept a result, delete history, or send consequential external messages.
