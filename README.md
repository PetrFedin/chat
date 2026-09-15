# Chat — корпоративная коммуникация и исполнение в одном приложении

Chat is a standalone multi-tenant corporate work application: a company registers a workspace, adds employees and runs messages, channels, tasks, calendar, meetings, calls, files, notifications and execution control in one connected work graph.

## Product invariant

A conversation becomes managed work when it can be traced to an explicit commitment with one accountable owner, expected outcome, promised/forecast dates, scheduling context, evidence, review and an immutable history of consequential changes.

## Core graph

`Organization -> Workspace -> People/Teams -> Conversation -> Message -> Work item -> Calendar/Meeting -> Execution -> Evidence -> Review -> Accepted result`

Files, calls, notifications, search, integrations and AI are cross-cutting capabilities rather than isolated products.

## Current executable baseline

- PostgreSQL multi-tenant schema for organizations/workspaces/memberships.
- Direct/group/channel/project/task/meeting conversation model.
- Threads, replies, scheduled/rich message kinds and soft-delete domain semantics.
- Tasks/commitments with accountability and acceptance lifecycle.
- General calendar events and task time blocks.
- Employee profiles, invitations, teams and presence persistence.
- File assets, generic file linking and voice-message metadata.
- Projects, collaborators, dependencies and checklists.
- Audio/video call session model with participant recording consent.
- Meeting notes/transcript/AI-summary persistence boundary.
- Notifications, audit, outbox and idempotency primitives.
- Mobile-first dependency-free PWA shell under `public/`.

Run locally:

```bash
npm start
```

Then open `http://localhost:3000`. Run tests with `npm test`.

## Product documentation

- `docs/PRODUCT_BLUEPRINT.md` — full application scope and delivery sequence.
- `docs/ARCHITECTURE.md` — architectural invariants and reliability boundaries.
- `docs/ROADMAP.md` — implementation gates.
- `docs/SYNTHA_EXTRACTION.md` — SYNTH-V2 source extraction audit.

## SYNTH-V2 relationship

`PetrFedin/synth-v2` remains an independent product and is not modified by Chat development. Chat may keep verified source snapshots/reference material from SYNTH-V2, while all new corporate-product behavior evolves independently in this repository.
