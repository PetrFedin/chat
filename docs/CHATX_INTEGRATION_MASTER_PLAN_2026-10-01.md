# ChatX — Integration Master Plan

**Status:** PLANNED  
**Date:** 2026-10-01  
**Canonical file:** `docs/CHATX_INTEGRATION_MASTER_PLAN_2026-10-01.md`

## Purpose
Strengthen ChatX after its communication/task foundation without creating duplicate Task, Calendar, Meeting or Project authorities.

## Mandatory prerequisite
Before major new integrations:
1. real browser + PostgreSQL Golden Path;
2. unify duplicate task authority;
3. make P0 tests exercise real application/API flow;
4. complete Task <-> Calendar authority.

Meeting Intelligence stays frozen except bug/security fixes until these gates are green.

## Integration map

| Capability | Source | Decision |
|---|---|---|
| Projects/milestones | native | ADOPT |
| Pages/wiki | AppFlowy/Docmost patterns | ADAPT |
| Editor | Tiptap | ADOPT |
| Automation | Activepieces patterns | ADAPT |
| Relationship auth | OpenFGA | CONDITIONAL |
| Search | Typesense | ADAPT/SIDECAR |
| Document extraction | Apache Tika | ADOPT/SIDECAR |
| Resumable upload | tus | ADOPT |
| STT fallback | faster-whisper | SIDECAR |
| AI trace | Langfuse | ADAPT |
| Decision Register | native | ADOPT |
| Diagrams | Mermaid | ADOPT |
| Calendar interchange | ical.js | ADOPT |
| External PM | Plane/Vikunja | REFERENCE |

## Phase 0 — Golden Path and single task authority
Run:
`registration -> employees -> group -> membership -> message -> reply/pin/forward/file/voice -> task -> accept -> start -> block/resume -> evidence -> review -> return -> resubmit -> accept result -> close -> notifications/deep links`

Then collapse current duplicate task truth into one domain model.

## Phase 1 — Task <-> Calendar
Task may propose/own scheduling context; Calendar owns time blocks/events. Move/delete/reschedule are audited. Calendar status never becomes a second task status. Add ICS interoperability later via ical.js.

## Phase 2 — Projects
Native project, milestone, dependency, checklist and collaborator entities reference existing tasks/files/channels/decisions. Plane/Vikunja are design references only.

## Phase 3 — Pages/wiki
Use Tiptap with hierarchy, links, mentions, history, ACL and relations to project/task/meeting/channel. Critical task state never lives only in page text.

## Phase 4 — Document extraction + search
Tika extracts authorised content from common office/PDF files with file/version/page/section lineage. Typesense indexes messages/pages/files/tasks/projects/decisions/people as rebuildable search. Application checks permission on every result.

## Phase 5 — tus upload
Resumable upload for large files, voice and meeting recordings:
`intent -> chunks -> checksum -> object storage -> file record -> processing`.
Incomplete upload is not canonical.

## Phase 6 — faster-whisper fallback
Add self-hosted STT provider behind existing Meeting Intelligence interface. Keep timecoded segments/provider/version/evidence semantics unchanged.

## Phase 7 — Decision Register
Confirmed decision contains source meeting/message, owner, affected project, effective date, supersedes links and evidence. AI may propose; human confirms.

## Phase 8 — Source-linked AI Catch-up
Summarise changes, decisions, tasks, blockers, mentions and files with source links. Langfuse traces/evaluates AI while respecting workspace privacy.

## Phase 9 — Automation Builder
Use native ChatX event/action contracts; Activepieces is a pattern/reference or future connector runtime. Automation invokes domain APIs, never direct DB mutation.

## Phase 10 — OpenFGA gate
Only if relationship complexity outgrows RBAC. ChatX remains source for org/workspace/project/channel/file relationships.

## Phase 11 — Mermaid + ICS
Mermaid renders safe diagrams in pages/messages. ical.js adds import/export/recurrence; imported events do not auto-create tasks.

## Prohibited
- major new features before task authority cleanup;
- new Meeting Intelligence features before Golden Path;
- search deciding authorization;
- AI confirming decisions;
- wiki text acting as task authority;
- automation direct DB writes;
- parallel Plane/Vikunja task systems.

## Issue order
1. CHATX-INT-00 PostgreSQL Golden Path
2. CHATX-INT-01 Single Task Authority
3. CHATX-INT-02 Task <-> Calendar
4. CHATX-INT-03 Projects
5. CHATX-INT-04 Pages/Tiptap
6. CHATX-INT-05 Tika + Typesense
7. CHATX-INT-06 tus
8. CHATX-INT-07 faster-whisper
9. CHATX-INT-08 Decision Register
10. CHATX-INT-09 AI Catch-up
11. CHATX-INT-10 Automation
12. CHATX-INT-11 OpenFGA gate
13. CHATX-INT-12 Mermaid/ICS

**Implementation instruction:** every new surface resolves to the same Task/Calendar/Project/Decision authorities.

## Additional wave — privileged identity and end-to-end operational tracing

### Passkeys for organisation/workspace administrators — ADOPT

Reference: https://github.com/MasterKale/SimpleWebAuthn

Attach WebAuthn credentials to the existing ChatX user identity.

Start with privileged roles/actions:

- organisation owner/admin;
- workspace admin;
- member/role administration;
- data export;
- security/integration configuration;
- deletion/retention controls.

Use step-up authentication for high-impact operations even when the user already has an active session.

Recovery/removal of a passkey is itself a privileged audited event.

Do not make passkey possession a replacement for workspace/project authorization.

### OpenTelemetry end-to-end tracing — ADOPT

Reference: https://github.com/open-telemetry/opentelemetry-js

Trace operational paths after the single Task authority is stable:

`request/websocket -> authz -> message/task/calendar/project command -> PostgreSQL -> outbox/job -> push/file/STT provider -> result`

Meeting processing can add spans for:

- upload;
- transcription provider;
- transcript persistence;
- summary proposal;
- human confirmation.

Never include message/file/transcript text or secrets in telemetry by default.

Use stable correlation IDs to connect mobile/web/API/job/provider failures.

### OpenTelemetry Collector — ADAPT

Reference: https://github.com/open-telemetry/opentelemetry-collector-contrib

Use a collector only when multiple services/providers need unified routing/redaction/sampling. Do not introduce it during the earliest single-process cleanup if direct export is simpler.

Collector config becomes versioned infrastructure and must enforce attribute redaction.

### Acceptance extension

- privileged admin actions can require recent passkey verification;
- tracing follows task/message/job execution without leaking workspace content;
- telemetry unavailability does not block core messaging/task execution;
- Meeting Intelligence evidence semantics remain unchanged.

**Sequencing:** Task/Calendar authority cleanup first; tracing can then be layered over canonical commands; passkeys can proceed once identity/session flows are stable.

