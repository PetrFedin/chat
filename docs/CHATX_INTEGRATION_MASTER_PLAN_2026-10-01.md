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

**Implementation status (2026-10-06): Golden Path GREEN; Single Task Authority GREEN.**

The canonical P0 is now exercised against the real application and PostgreSQL rather than only the isolated `commitment.js` domain model:

`registration -> employees -> group -> membership -> message -> reply/pin/forward/file/voice -> task -> accept -> start -> block/resume -> evidence -> review -> return -> resubmit -> accept result -> close -> notifications/deep links`

Current proof:
- API + PostgreSQL Golden Path is mandatory in `npm run test:p0`;
- real Chromium boot is verified against PostgreSQL on desktop and mobile viewports;
- a multi-session browser workflow drives owner and worker through group -> message -> task -> return -> resubmit -> accepted result -> close;
- unexpected API `5xx` responses fail the browser gate;
- group creation is now reachable from the Messages UI instead of existing only as dormant modal code;
- file and voice payloads, membership add/remove and exact message/task deep-links are covered by the same P0 contract.

Local visual QA uses `/preview.html` with live **Phone 390x844 / Tablet 834x1112 / Monitor 1440x900** shells. This is a development/QA surface only; it must not become a separate product UI or source of responsive truth.

Single Task Authority proof:
- the historical parallel `commitment.js` implementation no longer exists in the repository;
- transition graph, actor permissions, evidence gate, reason rules and optimistic-version checks are canonical in `src/task/task-authority.js`;
- both memory and PostgreSQL stores call that authority rather than maintaining independent transition tables;
- UI renders server-provided `allowedTransitions`; its local reason prompt is presentation only and server validation remains decisive.

Remaining Phase 0 work:
1. keep the browser Golden Path as a mandatory release gate;
2. prevent future transition/state-machine duplication with authority-focused tests/code review;
3. preserve one canonical transition/evidence/acceptance model across PostgreSQL, API and UI.

## Phase 1 — Task <-> Calendar

**Implementation status (2026-10-06): core authority slice GREEN; scheduling UX expansion remains open.**

Task may propose/own scheduling context; Calendar owns time blocks/events. Move/delete/reschedule are audited. Calendar status never becomes a second task status. Add ICS interoperability later via ical.js.

Already proven in P0:
- `task_block` cannot exist without a canonical `commitmentId`;
- a task exposes its linked calendar blocks without copying calendar state into task status;
- moving a task block updates Calendar while leaving task status/version unchanged;
- deleting a task block removes scheduling context while leaving task execution state unchanged;
- link/move/unlink events are written into the task audit trail;
- the browser workflow creates, opens, moves and removes a task block through the UI;
- concrete non-recurring collisions are rejected with `409 CALENDAR_CONFLICT`;
- the user must explicitly confirm `allowConflict` before saving over an existing personal calendar block;
- changing a task deadline never moves Calendar silently: linked blocks ending after the new promise are surfaced as **Schedule Impact / needs rescheduling** in the task card and remain directly openable for correction.

Remaining Phase 1:
- turn Schedule Impact into a first-class reschedule proposal/action (suggested new slot, explicit approve/reject, audit);
- recurring-series conflict detection and richer conflict detail for participants/team calendars;
- replace the temporary browser confirm with a first-class in-app conflict-resolution surface;
- day/week/agenda interaction hardening on phone/tablet/desktop;
- drag/move semantics where supported, with auditable reason for consequential changes;
- later external interchange/sync per the calendar integration phases.

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

## Additional wave — enterprise identity, retention/eDiscovery and signed integration events

This wave comes after the single Task authority / Calendar / Projects prerequisites. It makes ChatX fit larger organisations without replacing its native workspace identity and domain graph.

### Enterprise OIDC/SAML federation — ADAPT

Reference identity broker: https://github.com/keycloak/keycloak

Add an enterprise federation boundary so an organisation can map an external identity to an existing ChatX user/member.

Model:

- organisation identity provider;
- issuer/provider;
- subject/external user ID;
- mapped ChatX user;
- verified email/domain claims where appropriate;
- login method/status;
- last authentication metadata.

Keycloak or another IdP broker can provide OIDC/SAML integration, but ChatX remains source for workspace membership, project permissions and domain roles.

External authentication success must not grant a workspace role that has not been provisioned/mapped.

### SCIM 2.0 Provisioning Adapter — ADOPT/CONDITIONAL

For organisations that require directory-driven lifecycle, implement a bounded SCIM endpoint/adapter:

- create/invite member;
- update basic profile mapping;
- activate/deactivate;
- group-to-organisation-role mapping where explicitly configured.

Deactivation must trigger ChatX session/access revocation but must not delete historical messages/tasks/files.

Every SCIM mutation is idempotent and audited with provider + external ID.

### Retention / Legal Hold / eDiscovery Export — ADOPT

Create policy-controlled retention metadata for:

- conversations/messages;
- files;
- meeting recordings/transcripts;
- tasks/decisions;
- audit/security events.

Support:

- organisation retention policy/version;
- legal hold scope;
- scheduled deletion eligibility;
- hold override;
- export snapshot.

An eDiscovery/export package should include a manifest with IDs, timestamps, source relationships and checksums.

Retention deletion must respect legal hold and existing evidence/acceptance relationships.

### Signed Webhook / Integration Event Gateway — ADOPT

Expose approved ChatX domain events to external systems through a controlled outbox-driven gateway.

Examples:

- task created/completed;
- project/milestone changed;
- decision confirmed;
- meeting summary confirmed;
- file review requested.

Every delivery includes:

- event ID/type/version;
- occurred_at;
- organisation/workspace scope;
- bounded payload;
- delivery attempt;
- signature/key ID;
- retry/dead-letter status.

Consumers acknowledge events but cannot mutate ChatX by replying to the webhook. Mutations must use authenticated domain APIs.

### Collaborative Whiteboard — DEFER/ADAPT

Reference: https://github.com/tldraw/tldraw

Only after Pages/Projects are stable, consider an embedded collaborative canvas linked to project/meeting/page.

Whiteboard source document is versioned and access-controlled; exported images are derivatives.

Do not store tasks/decisions solely as shapes. A shape can link/create a canonical Task/Decision through explicit domain commands.

### Additional acceptance

- external IdP authenticates identity but cannot bypass ChatX membership/role checks;
- SCIM deactivate revokes access without erasing history;
- retention/hold decisions are versioned and auditable;
- webhook retries are idempotent and signatures verifiable;
- whiteboard links to, but never replaces, Task/Decision authorities.

**Sequencing:** single authority/Projects first -> enterprise federation -> SCIM where required -> retention/legal-hold -> signed integration events -> optional whiteboard.

## Additional wave — CRDT collaborative pages and presence

This wave activates real-time editing for the planned Workspace Pages layer after single Task authority, Projects and the basic Tiptap page model are stable.

### Yjs shared-document model — ADOPT

Reference: https://github.com/yjs/yjs

Use Yjs as the collaboration state mechanism for page/editor content that genuinely needs concurrent editing.

Boundaries:

- ChatX page ID/version/ACL remains canonical;
- Yjs document represents collaborative page content;
- tasks/decisions/projects remain native ChatX entities;
- attachments remain File authority;
- final snapshots/version history remain persisted by ChatX.

Do not move task status, project membership or permissions into CRDT documents.

### Hocuspocus collaboration server — ADAPT/SIDECAR

Reference: https://github.com/ueberdosis/hocuspocus

Use Hocuspocus or an equivalent Yjs server when multi-user editing needs durable rooms, auth hooks and persistence adapters.

Connection admission must verify:

- user identity/session;
- workspace/page permission;
- document/page ID;
- organisation scope.

The collaboration server must not trust a page ID supplied by the client without ChatX authorization.

### Presence / Awareness — ADOPT

Expose ephemeral collaboration presence:

- currently editing;
- cursor/selection;
- user display identity;
- connection state.

Awareness state is transient and must not be stored as audit/business history.

Do not use presence to infer employee productivity.

### Snapshot / Version bridge — ADOPT

Periodically or on meaningful save/publish points:

Yjs state -> deterministic page snapshot -> ChatX page version -> index/search/update event

Store:

- page version ID;
- source collaboration document/version reference;
- author/editor set where appropriate;
- created_at;
- content hash.

This allows rollback/history without replaying an unbounded CRDT log.

### Offline edit / reconnect rules — ADOPT

Yjs can merge concurrent edits, but business-side conflicts still require explicit behavior:

- page deleted/archived while offline;
- user loses permission;
- workspace membership revoked;
- attachment removed;
- page relation points to deleted project/task.

On reconnect, authorization is rechecked before accepting/syncing document state.

### Additional acceptance

- two users can edit the same page concurrently without destructive last-write-wins;
- collaboration cannot bypass page/workspace ACL;
- losing access revokes future sync/room admission;
- page snapshots are searchable/versioned and reproducible;
- CRDT content cannot directly mutate Tasks/Decisions without explicit ChatX commands;
- collaboration service outage degrades to safe read/edit fallback where possible rather than breaking messaging/tasks.

**Sequencing:** single Task authority -> Projects -> basic Pages/Tiptap -> Yjs -> Hocuspocus/presence -> snapshot/search integration.

**Dependency note:** Yjs/Hocuspocus remain collaboration infrastructure, not ChatX domain authorities.

## Additional wave — structured requests, approvals and schema-driven forms

This wave turns repeated work requests into structured ChatX workflows without building a separate low-code system.

### JSON Forms renderer — ADOPT/ADAPT

Reference:

https://github.com/eclipsesource/jsonforms

Use JSON Forms as the UI layer for versioned structured request templates.

Examples:

- access request;
- purchase/request-to-buy;
- vacation/absence request;
- creative/design brief;
- document review request;
- IT/service request;
- project intake;
- approval checklist;
- incident report;
- meeting/event request.

The renderer does not own workflow state.

### Request Template Authority — ADOPT

Create:

- request_template;
- template_version;
- JSON Schema;
- UI Schema;
- allowed workspace/org scope;
- submitter roles;
- approval rule;
- default project/channel;
- task-generation mapping;
- effective/status dates.

Used template versions are immutable.

### Structured Request Entity — ADOPT

Submission stores:

- requester;
- organisation/workspace;
- template/version;
- structured values;
- attachments;
- submitted_at;
- status;
- approver(s);
- linked Task/Project/Decision;
- audit history.

The request is a first-class entity, not a long message with hidden semantics.

### Approval Workflow — ADOPT

Support bounded states such as:

draft -> submitted -> needs-info -> approved/rejected -> execution -> completed/cancelled

Approval may create/update:

- canonical Task;
- Project intake;
- Decision record;
- calendar event;
- file review.

These are explicit domain commands with idempotent links.

### Form-to-Task Mapping — ADOPT

Template configuration can map selected fields into:

- task title/description;
- assignee/team candidate;
- due date;
- project;
- checklist;
- evidence requirements.

The resulting Task becomes the execution authority; subsequent task status should not be duplicated in form fields.

### Request SLA / Queue View — ADOPT

Provide queue metrics:

- new/pending;
- age;
- approval waiting;
- execution waiting;
- returned for information;
- completed cycle time.

Do not turn SLA metrics into hidden employee-performance scoring.

### Additional acceptance

- server validates submitted schema/version;
- request template edits do not alter old submissions;
- approval cannot bypass ChatX ACL/role rules;
- generated Tasks/Decisions are idempotently linked;
- structured request does not duplicate canonical Task status;
- JSON Forms outage/render bug cannot corrupt persisted structured values.

**Sequencing:** single Task authority + Projects first -> request template/entity -> JSON Forms UI -> approval -> Task/Decision linkage -> automation rules.

**Dependency note:** JSON Forms is currently MIT-licensed upstream and remains presentation infrastructure, not workflow authority.

## Premium innovation wave — governed Action Copilot and semantic workspace memory

This wave positions ChatX as a Work Communication OS rather than another messenger: AI understands work context and prepares actions while domain authorities and humans stay in control.

### Semantic Workspace Memory — ADOPT/ADAPT

Optional vector infrastructure:

https://github.com/qdrant/qdrant

Build a rebuildable semantic projection over authorised:

- Pages;
- files/extracted text;
- confirmed Decisions;
- Tasks/Projects;
- meeting transcripts/summaries;
- selected message windows.

Every chunk stores canonical source ID/version, workspace scope, ACL projection, source type, time and embedding model/version.

Keep Typesense for lexical/filter search; use hybrid retrieval where it improves quality.

### Governed Action Copilot — ADOPT

Typed-agent pattern:

https://github.com/pydantic/pydantic-ai

For complex stateful flows evaluate:

https://github.com/langchain-ai/langgraph

Tool classes:

Read tools:
- search;
- fetch page/file/message context;
- inspect project/task/calendar;
- inspect confirmed decision.

Proposal tools:
- draft task;
- draft project update;
- draft decision;
- draft calendar block;
- draft request/form;
- draft follow-up message.

Side-effect tools:
- create/update/send actions requiring explicit approval/policy unless a narrowly defined organisation automation already authorises them.

### Approval Checkpoint — REQUIRED

user intent -> retrieval -> proposal -> structured preview -> human approve/edit/reject -> canonical domain command -> result/evidence

Model text never mutates DB directly.

### What should I do next? — ADOPT

Create a source-linked brief from:

- due/blocked tasks;
- decisions awaiting execution;
- mentions/questions;
- calendar conflicts;
- meeting follow-ups;
- requests awaiting approval;
- milestones.

### Cross-object Reasoning — ADOPT

Premium workflows:

- turn confirmed decision into tasks/calendar blocks;
- show what changed in a project;
- prepare for a meeting from workspace sources;
- explain blockers;
- find commitments that never became tasks;
- draft weekly project update from verified progress.

### Safety / Evaluation — ADOPT

Measure groundedness, proposal accuracy, wrong-workspace leakage, stale-source use, tool-call correctness and user edit/reject rate.

Fail closed on unresolved permissions/authority.

### Additional acceptance

- factual brief items resolve to source;
- semantic retrieval enforces ACL;
- model cannot bypass Task/Calendar/Decision authorities;
- writes have approval/policy evidence;
- system falls back to ordinary search/workflows if AI/vector provider is unavailable.

**Sequencing:** single Task authority + Projects + Pages/Search -> semantic projection -> read-only copilot -> proposal actions -> approval checkpoint -> governed side effects.

## Premium commercial wave — Work Graph and Execution Risk Radar

This wave converts ChatX's existing communication/execution graph into a management-intelligence product without inventing opaque employee scores.

### Work Graph Projection — ADOPT

Create a rebuildable graph/read model from canonical entities:

- people/teams;
- project/milestone;
- task;
- dependency;
- decision;
- meeting;
- request/approval;
- page/file;
- conversation/message source;
- calendar event;
- evidence/acceptance.

Edges may include:

- owns;
- depends-on;
- decided-in;
- created-from;
- blocks;
- evidenced-by;
- scheduled-as;
- mentioned-in;
- belongs-to;
- supersedes.

PostgreSQL/domain entities remain authority.

### Graph UI — ADAPT

Use Cytoscape.js as a possible bounded visualization layer:

https://github.com/cytoscape/cytoscape.js

Views:

- project execution graph;
- decision -> tasks -> evidence;
- blocker chain;
- milestone dependency;
- meeting-to-execution chain.

Graph layout is visualization, not business truth.

### Execution Risk Signals — ADOPT

Generate explainable deterministic signals such as:

- blocked task with downstream dependants;
- milestone depends on overdue task;
- confirmed decision has no execution task;
- task has no owner;
- due task has no calendar/plan context where policy expects one;
- evidence returned/rejected repeatedly;
- approval/request aging;
- dependency cycle;
- upcoming overload/conflict from explicit assignments/calendar.

Each signal exposes the exact underlying source facts.

Do not label a person "low performer" or infer competence.

### Impact Propagation — ADOPT

When a task/date/decision changes, show affected graph:

changed node -> downstream tasks/milestones/calendar commitments -> owners -> suggested review list

This is deterministic impact discovery, not automatic rescheduling.

### Management Radar — ADOPT

Project/owner view:

- top unresolved blockers;
- orphan decisions;
- critical dependency chains;
- approvals aging;
- milestones at risk by explicit rule;
- evidence/review bottlenecks;
- actions needing decision.

Every card deep-links to source.

### AI Explanation Layer — ADAPT

The existing Action Copilot may summarize:

- why a milestone is flagged;
- what changed;
- which decisions/tasks are connected;
- suggested next review actions.

It cannot create hidden risk scores or override the deterministic signal layer.

### Additional acceptance

- graph rebuilds from canonical ChatX entities;
- every risk signal has transparent rule/source IDs;
- no people ranking/scoring is generated;
- graph cycle/impact calculations are deterministic/tested;
- AI text cannot create/change the underlying signal;
- removed/permission-restricted content disappears from user-visible projection.

**Sequencing:** single Task authority + Projects/Dependencies + Decisions -> Work Graph -> deterministic risk signals -> impact propagation -> management radar -> AI explanation.

**Commercial framing:** ChatX gains an executive execution-control layer similar to a live organisational digital twin, while retaining evidence-level traceability.

## Premium enterprise wave — AI Privacy Gateway and data-loss prevention

This wave makes ChatX significantly safer for enterprise AI usage by separating "AI can access this" from ordinary workspace access.

### PII / Sensitive-data Detector — ADAPT

Reference:

https://github.com/data-privacy-stack/presidio

Use Presidio-style analyzers as a bounded detection/redaction service for selected AI/export/connectors flows.

Candidate classes:

- email/phone/address;
- government/account identifiers;
- payment/bank-like identifiers;
- secrets/tokens/credentials;
- organisation-specific patterns.

Detection is probabilistic/heuristic and must not be treated as perfect.

### Data Classification Authority — ADOPT

Allow organisation/workspace policies such as:

- PUBLIC;
- INTERNAL;
- CONFIDENTIAL;
- RESTRICTED;
- AI_EXTERNAL_DENY;
- EXPORT_DENY.

Classification can exist at:

- workspace/channel;
- page/file;
- meeting recording/transcript;
- message range where explicitly tagged;
- project/decision.

Inherited/effective classification must be visible.

### AI Egress Policy — ADOPT

Before external model/tool invocation:

requested context -> ACL check -> classification check -> minimisation -> PII/secret scan -> optional redaction/tokenisation -> policy decision -> model/provider call

Persist:

- policy version;
- provider/model;
- data categories detected;
- redaction/minimisation summary;
- allow/deny result;
- actor/request purpose;
- trace ID.

Do not store raw sensitive prompt content in policy logs unless explicitly necessary.

### Provider Boundary — ADOPT

Organisation policy may choose:

- approved external provider;
- self-hosted/local provider;
- no generative AI;
- specific model allowed only for specific classification.

Action Copilot must respect this policy before retrieval/tool execution.

### Secret / Credential Guard — ADOPT

Detect likely:

- API keys;
- passwords;
- private tokens;
- connection strings;
- signing material.

If found in an AI/export request, default to block/redact and surface a user warning.

This is a safety net, not a substitute for secret management.

### DLP Export Gate — ADOPT

Apply similar policy to:

- external webhook payload;
- file export/share;
- eDiscovery package;
- automation connector;
- copied AI context.

The domain action still uses ordinary ChatX permissions; DLP is an additional outbound policy.

### Additional acceptance

- ACL is checked before DLP/AI processing;
- restricted classification can block AI egress deterministically;
- redaction is reviewable where user-visible output requires context;
- false-positive/override path is audited;
- provider policy is versioned per organisation;
- privacy gateway outage fails closed for protected egress paths;
- Presidio/provider can be replaced without changing ChatX data authority.

**Sequencing:** Pages/Search + enterprise identity + Action Copilot -> classification -> Presidio-style detection -> AI egress policy -> export/DLP gates -> organisation controls.

**Commercial framing:** this makes ChatX's AI story enterprise-grade: governed AI with explicit data boundaries rather than "send workspace content to a model".

## Moat wave — cross-company secure workrooms

This wave extends ChatX from internal Work OS into secure external collaboration for client, supplier, agency, contractor and partner work.

### External Organisation Authority — ADOPT

Create:

- external organisation;
- verified domain/identity metadata;
- invited members;
- relationship owner;
- allowed workrooms;
- security policy;
- expiry/offboarding state.

An external user is not silently added to the internal organisation graph.

### Workroom Authority — ADOPT

A workroom is a bounded shared scope containing only explicitly shared:

- conversation/thread;
- project/milestone;
- tasks;
- decisions;
- requests/approvals;
- files/pages;
- meetings/calendar;
- evidence/deliverables.

Internal-only data remains outside the workroom.

### Relationship Authorization — REUSE

Use the already planned OpenFGA-style relationship authorization to model:

organisation -> workroom -> member -> resource -> permission

Reference:

https://github.com/openfga/openfga

Every cross-company read/write must resolve through server-side relationship policy.

### Data Boundary / Share Projection — REQUIRED

Do not simply expose the internal canonical object with all fields.

For shared objects define:

- public/shared projection;
- internal fields;
- redactions;
- comments visibility;
- attachment visibility;
- history visibility.

Internal notes stay internal.

### External Deliverable / Acceptance Flow — ADOPT

Useful sequence:

internal task -> shareable deliverable -> external review -> comment/request change -> resubmit -> accept -> evidence/receipt

This reuses ChatX's Golden Path and evidence/acceptance authority.

### External Decision / Approval — ADOPT

Support explicit bilateral decisions:

- proposal approved/rejected;
- deliverable accepted;
- scope change approved;
- request confirmed.

Every decision records both organisation context and source artefacts.

### Secure Guest Lifecycle — ADOPT

invited -> verified -> active -> access changed -> expired/revoked

Offboarding must remove future access while preserving audit history.

### Cross-company AI Boundary — REQUIRED

Action Copilot / semantic retrieval can access only the external/shared projection inside a workroom.

Internal organisation content cannot leak into an external AI-generated brief.

### Additional acceptance

- external user cannot enumerate internal workspaces/resources;
- shared projection is explicit and tested;
- access revocation takes effect immediately for future requests;
- deliverable acceptance is attributable to the correct organisation/user;
- internal comments/files never appear in external retrieval;
- workroom can be exported/closed without merging organisations.

**Sequencing:** enterprise identity + OpenFGA + Projects/Pages/Decisions -> external org -> workroom -> share projections -> external review/acceptance -> AI boundary.

**Commercial framing:** opens agency-client, supplier, professional-services and enterprise project collaboration markets without turning ChatX into an insecure guest-enabled messenger.

## Platform economics wave — Extension SDK, sandboxed runtime and App Marketplace

This wave turns ChatX into an extensible Work OS platform where partners and customers can build governed capabilities without forking the core product.

### Extension Manifest — ADOPT

Every extension declares:

- extension ID/version;
- publisher;
- requested capabilities/scopes;
- UI surfaces;
- event subscriptions;
- commands/actions;
- storage needs;
- network destinations;
- organisation/workspace eligibility;
- minimum ChatX version;
- privacy/security metadata.

No undeclared capability access.

### Extension SDK — ADOPT

Provide typed interfaces for:

- read workspace context;
- create proposal/draft;
- register command;
- subscribe to approved events;
- render panel/card/action;
- call external service through approved connector;
- store tenant-scoped extension state.

No direct DB access.

### Sandboxed Extension Runtime — ADOPT/ADAPT

References:

- https://github.com/extism/extism
- https://github.com/bytecodealliance/wasmtime

Evaluate a WebAssembly/WASI-style runtime for third-party compute where it fits the Node architecture.

Goals:

- bounded memory/time;
- explicit host functions;
- no arbitrary filesystem/network access;
- deterministic capability grant;
- kill/timeout isolation.

Not every extension needs WASM; trusted first-party integrations may remain ordinary services.

### Capability Gateway — ADOPT

Host functions are explicitly granted, e.g.:

- search.read;
- task.propose;
- task.write;
- calendar.read;
- decision.read;
- file.read;
- notification.send.

High-risk write scopes require organisation admin approval and normal domain permission checks.

### Extension Event Bus — ADOPT

Versioned events:

- task changed;
- project milestone changed;
- decision confirmed;
- meeting completed;
- request approved;
- file review requested.

Extensions cannot mutate state by replying to events; they use authenticated commands.

### App Marketplace — ADOPT

Marketplace record:

- publisher;
- description;
- scopes;
- pricing;
- privacy/security statement;
- supported tenants;
- certification state;
- versions/changelog;
- install count/usage aggregates;
- support contact.

Installation requires explicit organisation admin action.

### Extension Certification — ADOPT

Before marketplace publication test:

- manifest/scopes;
- tenant isolation;
- secret handling;
- webhook signatures;
- latency/resource limits;
- UI safety;
- uninstall cleanup;
- data retention;
- malicious/forbidden calls.

Labels can be "reviewed" / "verified contract" / "first-party"; never claim broad security certification without basis.

### Revenue / Usage Metering — ADAPT

Reference:

https://github.com/openmeterio/openmeter

Possible economics:

- paid extension;
- per-seat;
- per-workspace;
- metered action/AI usage;
- revenue share.

Marketplace billing state remains separate from Task/Project authority.

### Additional acceptance

- extension has no DB access;
- all capabilities are declared and server-enforced;
- sandbox limits are testable;
- uninstall revokes future access;
- cross-tenant state leakage is impossible by contract/tests;
- marketplace publication requires review;
- core ChatX works with all third-party extensions disabled.

**Sequencing:** stable APIs/events + OpenFGA + AI Privacy Gateway -> manifest/SDK -> capability gateway -> sandbox runtime -> certification -> marketplace -> metering.

**Commercial framing:** third parties can build on ChatX, creating ecosystem lock-in and distribution while the core retains high-trust authority boundaries.

## Defensibility wave — Execution Receipt Standard and verified extension ecosystem

This wave creates a proprietary evidence format for work execution and a trust system for third-party extensions without converting ChatX into a black-box employee scoring tool.

### Execution Receipt Standard — ADOPT

For an important completed business action, generate a structured receipt:

- organisation/workspace;
- originating decision/request/task;
- responsible actor/role;
- action performed;
- source version;
- result;
- evidence/attachment IDs;
- approval/acceptance state;
- timestamp;
- workflow/standard version;
- receipt hash/version.

Examples:

- decision implemented;
- deliverable accepted;
- request approved/completed;
- external workroom deliverable signed off;
- meeting commitment converted and completed.

### Receipt Evidence Levels — ADOPT

Explicit levels may distinguish:

- self-declared completion;
- source-linked completion;
- reviewer-approved;
- external/bilateral acceptance;
- system/provider-verified.

No generic "trust score".

### Workflow Certification Profile — ADOPT

Define reusable workflow profiles such as:

- Decision-to-Execution;
- Request-to-Approval;
- Deliverable-to-Acceptance;
- Meeting-to-Action;
- External Workroom Handoff.

A profile states required entities/events/evidence.

Organisations can use these as operating standards.

### Verified Extension Status — ADOPT

For marketplace extensions, show factual statuses:

- publisher identity verified;
- manifest/scopes reviewed;
- sandbox contract passed;
- tenant-isolation tests passed;
- privacy/DLP declaration reviewed;
- current version compatible;
- last review date.

Do not imply external security certification unless one exists.

### Publisher Reputation Graph — ADOPT

Graph:

publisher -> extension -> versions -> certification results -> incidents -> organisation installs -> support lifecycle

Useful dimensions:

- verified identity;
- reviewed extension count;
- unresolved incident state;
- compatibility maintenance;
- support responsiveness where explicitly tracked.

No popularity-only trust score.

### Portable Receipt / Credential — CONDITIONAL

For cross-company workflows, a bounded execution receipt may be exportable/verifiable without exposing internal workspace content.

Examples:

- deliverable accepted;
- compliance step completed;
- integration qualified.

### Additional acceptance

- receipt resolves to canonical source/action/evidence;
- receipt cannot be generated for an uncompleted/unauthorised workflow state;
- receipt export minimizes hidden/internal data;
- extension status is factual and version-specific;
- publisher reputation preserves incident/revocation history;
- no employee performance score is derived from receipts.

**Sequencing:** Work Graph + External Workrooms + Extension Marketplace -> receipt standard -> workflow profiles -> verified extension registry -> publisher graph.

**Moat:** ChatX can become a trusted execution network where work completion and extension quality are independently verifiable rather than merely asserted.

