# Delivery roadmap

Status legend: DONE / GAP / PLANNED.

Rewritten 2026-09-24 against the actual code (59 migrations, 1220 tests,
`src/`, `public/`). The previous version of this file called things
"PLANNED" that had been built and tested months earlier — idempotency
keys, the guest role, the calendar engine, the review queue — because it
was written once at the start and never updated as work landed. A
roadmap nobody trusts is worse than no roadmap: the next session, human
or agent, plans against what this file says, not against what `git log`
says. Keep this file honest going forward — update it in the same
commit as the feature, not as a separate cleanup later.

## What is actually built and tested

**Tenancy, identity and access**
Organizations, workspaces, memberships; five roles (owner, admin,
manager, member, guest) enforced server-side by `src/rbac.js`, not just
hidden in the UI. A guest gets 404 rather than 403 on anything outside
their room, so a refusal never confirms that a feature exists. Password
auth, two-factor (TOTP + recovery codes, a pending secret so re-running
setup can't silently disable an already-confirmed factor), password
reset by one-time link, session listing and revocation, self-service
join by verified email domain.

**Collaboration core**
Direct/group/channel conversations with read cursors, threads,
mentions, reactions, pins, forwarding (including from WhatsApp/Telegram
paste-in, attributed to the original author — not a live bot adapter,
a clipboard-format parser), voice messages, edit history, per-person
favourites/highlights/notes. Commitments (the task model) run a full
state machine — proposed → accepted → scheduled/in_progress →
blocked/in_review → accepted_result → closed — with an evidence gate
before review and a designated acceptor who alone can close the loop.
Calendar with recurrence (RRULE-subset), time zones, per-occurrence
edits and per-occurrence meeting notes, participant RSVPs, a
closed-department visibility model with real seat accounting.

**Realtime and reliability**
WebSocket presence/typing/event stream with durable cursors, calls
(LiveKit-backed) with declined/missed states distinct from cancelled,
transactional outbox with signed outbound webhooks and a consumer that
retries with jittered backoff, `Idempotency-Key` on every mutating
command (replaying a POST cannot duplicate a task, message or event),
optimistic concurrency (`expectedVersion`) on tasks and conversations.

**Meeting Intelligence**
Transcript ingestion, AI summary, proposed decisions/actions with
mandatory human confirmation, a cost-tracked processing queue with
retry (bounded budget, audited) — but no cancel path once a job is
queued, and no dry-run rules engine sits on top of any of it yet (see
Gaps).

**Search, files, personal tools**
Full-text search in Russian (`to_tsvector('russian', …)`) across
messages, tasks, files, people, calendar events and personal notes,
paginated by cursor with a date-range filter that actually applies to
every source including name-matched files. Content extraction from
plain text, docx, xlsx, pptx and PDFs with a text layer (scans are
honestly excluded, not silently unsearchable). Personal planning
(todos/notes/screenshots/links) with calendar time-blocking that moves
an existing block instead of leaving orphaned duplicates. One labelling
mechanism (priority/tag/folder) shared across every entity type instead
of a bespoke importance field per module. A password vault, AES-256-GCM,
reveal-gated and fully audited.

**Games and stories**
Chess, checkers and battleship with a real server-side rules engine
(illegal moves rejected, turn order enforced), ephemeral stories with
view tracking.

**Operability**
Docker image with a non-root user and a real `/readyz`; backup/restore
with an integrity check that actually spins up a scratch database and
counts rows before trusting the file; Prometheus metrics with no PII in
them; one structured JSON log line per request; retention sweeps for
expired sessions, spent reset links, archived notifications and
delivered/dead webhook deliveries — audit events and the work itself
are never swept. `POST /api/v1/notifications/archive-read` +
per-notification archive keep the inbox from growing forever. An
OpenAPI document whose own test (`openapi-sync.test.js`) fails if it
drifts from the routes the server actually serves, in either direction.

## Gaps — real, scoped, not yet done

Ordered by how much it costs the product that it's missing, not by how
hard it is to build.

- **No headless-browser check in CI.** Every UI-touching test parses
  `public/*.js` with regular expressions; none of them load the page.
  CI can be green while the running page is broken — this has happened
  before (see the git history around "the mutation-observer feedback
  loop that froze the UI"). This is being closed next (tracked
  separately, not in this file, since it's infrastructure rather than a
  product feature).
- **No cancel path for a meeting-processing job.** `cancelled` exists in
  the schema and is checked against, but nothing transitions a job into
  it — a stuck job only clears by lease expiry.
- **External calendar sync (Google/Outlook/ICS) does not exist.** No
  import, no export, no loop-prevention logic to build it against yet.
- **No live chat-platform adapters** (Slack/Teams/Telegram as bots or
  bridges). The WhatsApp/Telegram *paste-in* parser is not a substitute
  for this — it requires a human to copy text in, there is no
  connection to those platforms' APIs.
- **No public API surface for external integrators.** The whole REST
  API is cookie-session auth; outbound webhooks exist and are signed,
  but there is no API-key/OAuth path for a third party to call in.
- **No structured data import** (CSV/Excel with deduplication and
  provenance tracking). Office files are *searchable* once uploaded as
  attachments; there is no bulk-import pipeline that creates records
  from rows.
- **No automation/rules engine.** Meeting Intelligence proposes
  decisions and actions for a human to confirm; there is no dry-run
  rule ("when X, propose Y") layer above individual meetings, and no
  execution log for one.
- **Never deployed outside local development.** No `.env` has existed
  in this environment; no external provider (SMTP, LiveKit, an AI
  transcription provider, VAPID push) has ever been exercised against a
  real endpoint — only their absence-handling paths (`503` with an
  honest reason) have been tested. Everything above is proven against
  Docker Postgres and mocked/absent providers, not against the internet.

## Notes worth keeping

The original P0–P7 phase numbering assumed a strict build order (domain
→ persistence → API/realtime → calendar → UI → management control →
automation → integrations). In practice the UI, calls and Meeting
Intelligence shipped well ahead of that sequence, and the product is
better for it — the phase numbers are retired rather than carried
forward as fiction. What replaced them is simpler: build against real
usage, hunt regressions with live multi-agent walkthroughs (chat
histories under `git log` document dozens of these), and keep this file
matching what actually runs.
