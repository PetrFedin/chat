# Chat — conversations that become accountable work

Standalone work-management application that unifies chats, tasks, calendar planning, execution evidence, and acceptance.

## Product invariant

A conversation is not managed work until it can be traced to an explicit commitment with:

- one accountable owner;
- a defined outcome;
- a promised date or explicit unscheduled state;
- scheduling context;
- execution evidence;
- an acceptance decision;
- an immutable audit trail of consequential changes.

## P0 flow

`Message -> Commitment -> Accepted responsibility -> Calendar block -> Execution evidence -> Review -> Accepted result`

The project deliberately starts with domain invariants before UI. The goal is to avoid a common failure mode where chat, task, and calendar are three separate products connected only by links.

## Status

P0 domain foundation is being implemented first. See `docs/ROADMAP.md` and `docs/ARCHITECTURE.md`.
