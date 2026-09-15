# Chat — conversations that become accountable work

Standalone corporate collaboration and work-management product that unifies employee chats, task/accountability planning, calendar scheduling, execution evidence, acceptance and notifications.

## Product invariant

A conversation is not managed work until it can be traced to an explicit commitment with:

- one accountable owner;
- a defined outcome;
- a promised date or explicit unscheduled state;
- scheduling context;
- execution evidence;
- an acceptance decision;
- an immutable audit trail of consequential changes.

## Core flow

`Message -> Commitment -> Accepted responsibility -> Calendar block/event -> Execution evidence -> Review -> Accepted result`

Chat, tasks and calendar are one work graph rather than three products connected only by links.

## SYNTH-V2 extraction

A verified source snapshot from `PetrFedin/synth-v2` is kept under `vendor/syntha-v2`. Reusable calendar and notification semantics were adapted into standalone collaboration modules without importing fashion/wholesale entities. The audit and exact extraction decisions are in `docs/SYNTHA_EXTRACTION.md`.

Important finding: current SYNTH-V2 contains a real calendar/read-model/notification implementation, but no production conversations/messages backend. Messaging in this repository is therefore implemented natively instead of being falsely represented as copied code.

## Current status

- P0 domain foundation: done.
- P1 persistence/command safety: in progress.
- SYNTH-V2 collaboration extraction baseline: done.
- Independent domain primitives now exist for Conversation/Message, CalendarEvent and Notification.
- PostgreSQL now distinguishes commitment time blocks from general calendar events and stores conversation members, event participants and user notifications.

See `docs/ROADMAP.md`, `docs/ARCHITECTURE.md` and `docs/SYNTHA_EXTRACTION.md`.
