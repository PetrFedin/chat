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
paste-in, attributed to the original author, and — for Telegram only —
a live bot bridge that mirrors a conversation both ways, see Gaps for
its untested-against-a-real-bot caveat), voice messages, edit history,
per-person favourites/highlights/notes. Commitments (the task model) run a full
state machine — proposed → accepted → scheduled/in_progress →
blocked/in_review → accepted_result → closed — with an evidence gate
before review and a designated acceptor who alone can close the loop.
Calendar with recurrence (RRULE-subset), time zones, per-occurrence
edits and per-occurrence meeting notes, participant RSVPs, a
closed-department visibility model with real seat accounting, and a
personal, revocable `.ics` subscription for reading it from an
external calendar app (see Gaps for what that does not cover).

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
retry and cancel (both bounded/reasoned and audited) — but no dry-run
rules engine sits on top of any of it yet (see Gaps).

**Chat assistant**
A "Conversation overview" button (recent thread → grounded summary plus
short highlights) and a "Suggest a reply" button (up to three drafts
for the last message) inside every conversation. Same discipline as
Meeting Intelligence: the model is instructed not to invent facts,
dates or commitments beyond what the fetched messages contain, and a
suggested reply only fills the composer — it is never sent on the
person's behalf. Reuses the same OpenAI Responses API integration
(`OPENAI_API_KEY`/`OPENAI_BASE_URL`, structured JSON output) as meeting
summaries, gated by its own `CHAT_ASSISTANT_PROVIDER` so it can be
enabled independently; honest `503` with the real reason when it
is not configured.

**Wiki**
A tree of shared pages (`wiki_pages`, unlimited parent/child nesting)
that any staff member can create and edit — the opposite division of
labour from the knowledge base, where one curator writes and the whole
company reads. Editing is optimistic-concurrency protected the same
way tasks and conversations are (`expectedVersion`, `409` on a stale
save), and every edit writes the prior title/content into
`wiki_page_versions` in the same transaction before applying the
change, so a page's history can never drift from what was actually
saved. Full-text search in Russian across titles and content
(`to_tsvector('russian', …)`, `ts_headline` snippets), and archiving is
soft — an archived page drops out of the tree and search but stays
reachable by direct link and in history. PostgreSQL-only, like the
other recent modules; a guest sees the section as simply not existing
(`404`, not `403`), the same rule audit/vault/AI already follow.

**Time tracking**
A start/stop timer on any commitment (`time_entries`), visible right
on the task card. No new permission was added: whoever can already
see the task (owner, requester, acceptor, collaborator, or a team
manager — the same rule as everywhere else in task-authority.js) can
track time on it. One running timer per person across the whole
workspace, enforced by a partial unique index in the database, not
just a code check — starting a second one is a clean `409`, not a
silently stolen first timer. A "Time report" screen under More sums
tracked seconds per task (and, for a team manager, per person too)
over a week/month/year, with `scope=team` silently falling back to the
caller's own hours for anyone without `task.manage.team`.

**Dashboard**
A "Dashboard" screen under More: KPI tiles (open, overdue, closed in
period, promises kept %) plus two day-by-day charts (created vs.
closed tasks, hours tracked), rendered as small dependency-free inline
SVG bar charts. Deliberately not a third source of truth: `GET
/api/v1/dashboard` computes its totals by calling the *same*
`task-report.js`/`time-entry-repository.js` code the standalone Task
report and Time report screens already use, and only adds the daily
series a chart needs (`task-report`'s new `daily` field, `time-entry`'s
new `dailyTotals`) — a test asserts the numbers agree exactly with
those two existing reports for the same range, so the three screens
can't quietly drift apart.

**Structured requests and approvals**
The "Request Template Authority" / "Approval Workflow" slice of
`CHATX_INTEGRATION_MASTER_PLAN_2026-10-01.md`, built natively (no JSON Forms
dependency — the field set is a small, server-validated subset: text, textarea,
number, money, date, select, checkbox). Owners/admins keep versioned templates
(`request_templates` + immutable `request_template_versions`: fields, an
ordered approval chain by role or person with an optional numeric threshold such
as "admin only above 100 000", and an optional task mapping). Any staff member
submits a request (`requests`, values validated against the template *version*
it was filed on), approvers answer step by step (approve / reject / ask for
details — a comment is mandatory for the last two; nobody approves their own
request, and an outsider gets 404 rather than 403), the requester replies to a
question or withdraws, and a history (`request_events`) records every move.
Approval can create one ordinary task, exactly once, with the requester as the
acceptor — the task stays the execution authority, the request never copies its
status. A step nobody else could answer (a company of one owner) is skipped
with a note rather than hanging forever. Queue numbers (pending, needs-info,
in execution, average age/cycle) are aggregate only — deliberately not broken
down per employee. UI: More → Requests (`public/requests.js`, same overlay layer
as Search/Files), with starter templates for time off, purchase and access.
Gaps left on purpose: JSON-Forms-grade layouts, file attachments on requests,
SLA reminders for approvers, and delegation while an approver is away.

**Structured data import (CSV)**
The bulk-invite screen ("Invite in bulk" under Invite) now accepts an
actual `.csv` file exported from HR or Excel, not only hand-typed
lines: the file is read client-side and fills the same reviewable
textarea the paste flow already used, so nothing is sent unseen. This
reuses the existing `/api/v1/invitations/bulk` endpoint and all its
deduplication/provenance logic (per-row invited/duplicate/already-here/
role-too-high/etc. status) unchanged — the gap was the file upload
step, not the dedup logic, which already existed. Fixing this also
turned up and fixed a pre-existing markup bug (an unclosed `<textarea>`
tag) that had silently broken the whole bulk-invite form's rendering,
plus several untranslated English-mode strings in the same screen.

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
reveal-gated and fully audited. A company knowledge base with a
search-based HR bot: no generation, it full-text searches articles and
returns the best match with a highlighted excerpt (`ts_headline`), and
says so honestly when nothing matches rather than inventing an answer.

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

**Public API access**
Personal API keys (`POST /api/v1/api-keys`), each acting with its own
owner's exact permissions — no separate integration role, `rbac.js`
stays the single source of truth. The raw secret is shown once, at
creation, and only its hash is stored; a request authenticates with
`Authorization: Bearer <key>` as an alternative to the cookie session,
enforced in the same `requireSession` funnel every route already goes
through. A key can be marked read-only, rejecting anything but
GET/HEAD before it reaches a route handler. Revocation is immediate
(checked on every request, not cached). PostgreSQL-only, like the other
recent integrations (Telegram, the .ics feed): honest `503` in memory
mode rather than a second, untested code path.

## Gaps — real, scoped, not yet done

Ordered by how much it costs the product that it's missing, not by how
hard it is to build.

**Golden Path / Task-Calendar status, verified 2026-10-06.** The release
gate now runs against real PostgreSQL and Chromium instead of only the
isolated commitment model. It covers membership mutations, reply/pin/
forward, file and voice messages, task execution/review/rework/closure,
deep-links and a linked Calendar task block. The task block can be
created, moved and deleted while task status/version remain authoritative
and unchanged by Calendar. Single Task Authority is also verified: the
historical parallel commitment implementation is gone, and both stores use
`src/task/task-authority.js`. Concrete non-recurring double-booking is now
blocked with `CALENDAR_CONFLICT` unless the user explicitly confirms an
override. Deadline changes now surface linked work blocks that end after
the new promise as an explicit Schedule Impact instead of silently moving
Calendar. Schedule Impact now has a deterministic proposal/approval flow:
preserve duration, find the latest free concrete slot before the deadline,
preview/edit/approve/reject, then audit the decision and canonical Calendar
move. The collision check follows the task-block owner's calendar even when a
manager performs the move. Remaining calendar work is recurring-series
conflict detection, working-hours/availability-aware slot scoring and richer
phone/tablet/desktop scheduling interaction.

For local product QA, `/preview.html` provides a development-only device
switcher for 390x844 phone, 834x1112 tablet and 1440x900 monitor viewports.
It embeds the real application and therefore must never acquire business
logic of its own.

- **External calendar sync: export exists (ICS subscription), import/OAuth does not.**
  Any person can get a private `.ics` subscription link (personal
  token, revocable, visibility-filtered the same way the in-app
  calendar is) to paste into Google/Outlook/Apple Calendar; it emits
  real `RRULE`/`EXDATE`/`RECURRENCE-ID`, not pre-expanded occurrences,
  so the calendar app expands recurrence itself. One-way only: nothing
  writes back into ChatX from an external calendar, and there is no
  Google/Outlook OAuth flow — that needs a registered OAuth application
  and secrets nobody has created yet.
- **No live Slack/Teams adapters yet; Telegram has one, but untested against a real bot.**
  A ChatX conversation can bridge to a Telegram chat through a bot: the
  bot token is verified with a real `getMe` call, sealed the same way
  as a vault secret, and messages flow both ways through the Bot API
  (inbound via webhook, attributed honestly as "Из Telegram" — the same
  attribution the manual paste-in parser uses — outbound as best-effort
  delivery that never blocks the conversation). Built and tested against
  an injected fake Telegram API (getMe/setWebhook/sendMessage/deleteWebhook,
  full round-trip including the honest-failure path), but never against
  a real bot token or a real Telegram chat — nobody has created one to
  test with yet. Slack/Teams remain unbuilt.
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
