# ChatX — Product Completion & Integration Plan (2026-10-11)

**Назначение:** канонический рабочий реестр недостающих, частично реализованных, не показанных в UI и не проверенных в реальной среде функций ChatX. Это **план**, а не утверждение об их выпуске в production.

**Читать вместе с:** [Integration Master Plan](CHATX_INTEGRATION_MASTER_PLAN_2026-10-01.md), [Delivery Roadmap](ROADMAP.md), [Product Blueprint](PRODUCT_BLUEPRINT.md), [Architecture](ARCHITECTURE.md). Приоритет: точный исходный код + тестовое свидетельство конкретного SHA > актуальный Roadmap > исходный Product Blueprint > идеи. Не переносить пометки GREEN с одной ветки на другую без соответствующего merge и CI.

## A. Доказательная база аудита

Проверены 11.10.2026:
- Репозиторий: https://github.com/PetrFedin/chat
- `main`: `9781ed58372773e1ec65e59bbaccc264c7e1ac6a`.
- Draft PR #21: https://github.com/PetrFedin/chat/pull/21 , head `348cedcf82aa90b660c292f0352ae25ed75c5667`, base `work/chatx-p0-postgres-golden-path` at `fc7c6b6ef1bfb4532ad368b4e4a391443229287b`.
- GitHub Actions CI #390: https://github.com/PetrFedin/chat/actions/runs/38166491934 , `domain-tests=success`, `database-tests=success`; PostgreSQL run: **1324/1324 passed, 0 failed, 0 skipped**. Пройдены PostgreSQL constraints, browser Golden Path, Multi-role Tenant, Parallel Workday, Failure & Recovery, Cross-role Leakage, Project/Files/Discussion/Decision/Calendar и Page↔Project.
- PR #19 (Projects) и PR #20 (Project↔Calendar) merged в **рабочую базовую ветку PR #21**; не считать это доказательством их присутствия в `main`.
- Compare `main...PR21`: ветки расходятся (на момент проверки PR21 на 171 коммит впереди и на 1 позади main). Не использовать status GREEN для автоматического слияния в main без отдельной стратегии интеграции.
- Реальную production-публикацию, внешние SMTP/LiveKit/S3/Web Push/OpenAI и физические iOS/Android устройства эта проверка **не подтвердила**. `ROADMAP.md` сам сообщает, что внешние провайдеры не были испытаны на настоящих endpoint.
- `public/app.js`: Wiki/Pages показывает `page.content` как экранированный plain text и редактирует legacy content через textarea; для `hasStructuredDocument` доступно лишь изменение заголовка. `src/wiki/page-document.js` + migration 079 + `wiki-repository.js` поддерживают canonical structured JSON и историю, но визуального редактора нет.
- `package.json` в head PR #21 не содержит Tiptap. Поэтому не маркировать визуальный Rich Editor как готовый.
- `src/persistence/daily-work-search-store.js` по умолчанию ищет message/conversation/task/file/person/event. `public/daily-work.js` не предлагает отдельные unified-search типы Project/Page/Decision. Wiki имеет отдельный поиск.
- `test/p0-browser-postgres.test.js` проверяет Chromium desktop/tablet/phone с viewports 1440×900, 834×1112, 390×844. Наличие headless browser-теста не доказывает качество физического iPhone/Safari, Android/Chrome или UX-оценку реальными пользователями.

**Статусы:**
- `GREEN-on-PR` — есть CI доказательство на head PR #21, но нет release merge и production admission.
- `BUILT-no-real-provider` — код и mock/внутренние тесты есть, внешняя интеграция не подтверждена.
- `PARTIAL` — API/данные существуют, пользовательский контур неполон.
- `OPEN` — запланировано, текущие доступные источники не подтверждают реализацию.
- `CONDITIONAL` — делать только после подтверждения нужды/масштаба.

## B. Неизменяемые правила продукта

1. Один owner истины на сущность: **Task / Calendar / Project / File / Conversation / Decision / Page / Request**. Связи являются relation-only, проекции пересчитываются, не копируют чужой state/ACL.
2. Аутентификация не равна авторизации. Любая выдача (API, search, WebSocket, notification, summary, preview, deep link, offline cache) перепроверяет фактические права.
3. Для скрытого объекта не раскрывать ID, title, count, existence, event metadata. Где предписано — 404 + отсутствие в discovery.
4. Business mutation: authenticated command → policy → validation → optimistic version/idempotency → PostgreSQL transaction → audit/outbox → projected UI.
5. AI предлагает; человек подтверждает назначение, сроки, решение, приёмку, запись и внешнюю отправку.
6. Не вводить отдельно Plane/Vikunja task engine, отдельный project calendar, wiki-task status, writable Kanban status, независимый executive KPI store.
7. Критерий DONE: **API + PostgreSQL + UI + навигация + роли + отказоустойчивость + mobile + аудит + документация + test evidence exact SHA**.

## C. Исполнительная последовательность (закрывать по одному gate)

| Этап | Приоритет | Что выпускаем | Зависимости | Блокирующий критерий |
|---|---|---|---|---|
| 00 | P0 | Зафиксированная release topology PR #21 → базовая ветка → main; ревью, актуальный exact-head CI | зелёный #390, GitHub permissions | нет неявного merge, версионирование и целевые ветки однозначны |
| 01 | P0 | Полный UI/role/device маршрут и дефект-реестр | 00 | нет критических dead end/blank/crash и leakage |
| 02 | P0 | Pages Rich Editor v1 + format rendering | 00,01, migration 079 | rich document create/edit/reopen/history без потери форматирования |
| 03 | P1 | Pages links Task/Meeting/Channel + per-page ACL | 02 | relation-only, 404/omission, no ACL escalation |
| 04 | P1 | Unified Search v2 (Project/Page/Decision/Meeting) | 03 + stable entities | корректная выдача, provenance, ACL, deep links |
| 05 | P1 | Decision Register v2 + Decisions→Tasks | existing decisions migration 076/077 | owner/date/supersedes/evidence + human confirmation |
| 06 | P1 | Daily Work и Project Cockpit UX polish + risk/capacity | 01,04,05 | реальные маршруты без копии Task/Calendar truth |
| 07 | P1 | Requests attachments, SLA, delegation | 01,Task,File,Request | request→approval→task→acceptance, versions preserved |
| 08 | P1 | Durable Files/media/upload/recovery | 01,File,storage | restart+restore доказаны, quota/error paths |
| 09 | P1 | Внешняя инфраструктура pilot / production admission | 00–08 | real SMTP/Push/LiveKit/S3/backup drill без unsafe claims |
| 10 | P2 | Calendar external import/sync | calendar, identity/OAuth | loops/conflicts/ownership/revocation tested |
| 11 | P2 | Automation dry-run / event-driven approvals | outbox,Decision,Task,Request | policy, idempotency, execution log |
| 12 | P2 | AI Catch-up / Copilot (read-only→proposals) | Search,ACL,DLP | source citations, human checkpoints, cost/egress policy |
| 13 | P3 | Advanced work graph, collaboration, enterprise | trusted project/decision model | multi-tenant/permission/evidence gates |
| 14 | P4 | Marketplace, external workrooms, receipts | 09,11–13 | justified by customers; sandbox/certification, no automatic scope creep |

## D. Functional gap register — требования, связи и acceptance

### 00. Release integrity / operational baseline — P0

- [ ] **CHATX-RLS-001** Зафиксировать, что PR #21 GREEN только на head `348cedcf`; получить код-ревью и ревью правил доступа, явно согласовать Draft→Ready, не менять SHA ради косметики до проверки.
- [ ] **CHATX-RLS-002** Объяснить и закрыть divergence `main` vs `work/chatx-p0-postgres-golden-path` vs PR #21: выбрать последовательность интеграции, проверять новый integration SHA отдельным CI; не считать merged #19/#20 в рабочую ветку опубликованным main.
- [ ] **CHATX-RLS-003** Для каждой новой миграции: clean PostgreSQL 17 + upgrade from last real schema + check constraints + rollback/recovery procedure; никогда не редактировать применённую миграцию.
- [ ] **CHATX-RLS-004** Сформировать release manifest: commit SHA, schema version, app build, feature flags, expected dependencies, тестовые доказательства, известные проблемы, QA screenshots.
- [ ] **CHATX-RLS-005** Проверить пустую организацию и подготовленную demo компанию отдельно, чтобы фикстуры не маскировали broken empty state.

### 01. Real UX Completion Audit — P0

- [ ] **CHATX-UX-001** Chromium: desktop 1440×900, tablet 834×1112, phone 390×844; дополнительно 320/375 px, keyboard+screen reader checks, landscape/zoom 200%. Сохранять screenshot артефакты при тестах.
- [ ] **CHATX-UX-002** Физические Safari/iOS и Chrome/Android: вход, прокрутка, клавиатура, safe areas, запись voice, file picker, upload progress, уведомление, PWA launch/reconnect. Пометить `NOT TESTED` до фактического прогона.
- [ ] **CHATX-UX-003** Экранные состояния для каждого модуля: loading, empty, error/retry, no permission, hidden 404, stale 409, offline, expired session, slow response, long names/files, deleted relation.
- [ ] **CHATX-UX-004** Navigation matrix: Today ↔ Messages ↔ Tasks ↔ Calendar ↔ Projects ↔ Files ↔ Wiki/Pages ↔ Decisions ↔ Requests ↔ Meetings ↔ People ↔ Notifications. Назад/закрыть/deep link всегда возвращают в рабочий контекст.
- [ ] **CHATX-UX-005** Задача из сообщения: открыть источник, назначить owner/acceptor, принять, запланировать, начать, заблокировать/возобновить, прикрепить evidence, запросить review, вернуть, повторно отправить, принять результат, закрыть, открыть history.
- [ ] **CHATX-UX-006** Доступность: visible focus, aria labels, focus trap/restore, keyboard alternatives for drag, contrast, reduced motion; инструментальные Axe/ARIA scans + ручная клавиатура. Текущий статический `test/accessibility-shell.test.js` не равнозначен WCAG audit.
- [ ] **CHATX-UX-007** Никаких кнопок-заглушек: каждое действие открывает корректный канонический экран, меняет только разрешённое состояние, подтверждает успех и отображает ошибку с восстановлением.

### 02. Pages / Tiptap v1 — P0 (самый явный текущий product gap)

- [ ] **CHATX-PAGE-001** Без второго Page store подключить open-source Tiptap/ProseMirror к `wiki_pages.document` (canonical JSON) и `content` (derived text/search projection); legacy text страницы открывать, редактировать и безопасно мигрировать при первом rich save.
- [ ] **CHATX-PAGE-002** Toolbar: H1–H3, paragraph, bold/italic/underline/strike/code, bullet/number lists, quotes, code block, horizontal rule, safe links, undo/redo; mobile toolbar без горизонтальной перегрузки.
- [ ] **CHATX-PAGE-003** Renderer использует whitelist node/mark и безопасное DOM построение; не raw HTML, не опасные URI/inline handlers; unit+browser проверки XSS/paste; расширения редактора согласовать с server normalizePageDocument.
- [ ] **CHATX-PAGE-004** Сохранение с expectedVersion; conflict 409 показывает текущую/локальную версии с явным решением, не затирает введённое; unsaved changes prompt + disabled button while saving + debounced/explicit save policy.
- [ ] **CHATX-PAGE-005** Full history: author/timestamp, diff, preview и explicit restore as new version; archive/restore, вложенные страницы, проверка soft-deleted parent.
- [ ] **CHATX-PAGE-006** Browser E2E: create rich → format → save → reload → view same rendering → second user stale edit → 409/conflict recovery → history/restore → project link. Phone/tablet/monitor screenshots.
- [ ] **CHATX-PAGE-007** Escape/page not found/error UI, status loading, deep-link canonical Page URL; текст из legacy не должен незаметно становиться plain text после rich save.

### 03. Pages relations + ACL + optional realtime — P1

- [ ] **CHATX-PAGE-008** Page↔Task, Page↔Meeting, Page↔Channel — FK relation-only, workspace-scoped; канонические команды и ссылки/preview, обратные ссылки из объекта.
- [ ] **CHATX-PAGE-009** Per-page visibility policy: workspace/public-to-members, restricted/private, project-linked visibility only when explicitly authorized. Отдельная политика наследования от родителя с тестами. Связь с Project **не** выдаёт права на Page или Project автоматически.
- [ ] **CHATX-PAGE-010** Query/search/realtime/offline/cache: revoked user и Guest/Observer/removed member не видят content/title/relation/count. Exact 404/omission checks.
- [ ] **CHATX-PAGE-011** Только после v1 editor+ACL: Yjs/Hocuspocus rooms, authenticated sync, presence, durable snapshots, offline merge vs revoked access, load/performance; временное отсутствие collaboration server не ломает обычный просмотр и сохранение.
- [ ] **CHATX-PAGE-012** Контент Page не является источником status Task или decision acceptance; извлечение действия происходит через explicit command/human confirmation.

### 04. Search / retrieval / file semantics — P1

- [ ] **CHATX-SRCH-001** Расширить Global Search на `page`, `project`, `decision`, meeting notes/transcripts; сохранить server-side source ACL и отдельный authorised preview/snapshot.
- [ ] **CHATX-SRCH-002** Сопоставить фильтры UI/API, deep-link/открытие объекта, cursor pagination, date/project/workspace filters, ranking и русскую морфологию.
- [ ] **CHATX-SRCH-003** Отдельные leakage tests: hidden private project in page/search, archived item, edited/deleted file, revoked membership, stale index, file text content, meeting restricted transcript.
- [ ] **CHATX-SRCH-004** Оставить PostgreSQL full text as initial authority/index, индекс восстанавливаемый. Typesense/Tika sidecar **только** если появятся измеренные задачи, которые текущие извлечение/поиск не решают.
- [ ] **CHATX-SRCH-005** Файлы в Office и PDF с текстовым слоем уже извлекаются; OCR/scanned PDFs — отдельный явный status и opt-in queued processing, без обещаний стопроцентного извлечения.

### 05. Project and Decision operating system — P1

- [ ] **CHATX-DEC-001** Расширить существующий canonical Decision Register: responsible owner, effective date, decision status, supersedes/related IDs, explicit evidence and affected projects; сохранять identity/retractions.
- [ ] **CHATX-DEC-002** UI: Register list/detail/filter, source jump, human confirm/retract, history, links to Project/Meeting/Task and «создать задачу по решению».
- [ ] **CHATX-DEC-003** Решение AI — proposal, никогда сразу authoritative confirmed decision. Исполнительные Task связи — через canonical Task.
- [ ] **CHATX-PROJ-001** Project Home: ясная цель, owner, milestone, blocker, next step, decisions, files, discussion, tasks, team, workload, time, history; обычная карточка → canonical route.
- [ ] **CHATX-PROJ-002** Project portfolio: проекты с понятным статусом, progress, overdue/blocked, milestone schedule, capacity, trends; значения вычислять из существующих authorities.
- [ ] **CHATX-PROJ-003** Поддержать task dependency propagation, critical-path hints и explainable deterministic risk signals; не строить скрытую оценку эффективности сотрудников.
- [ ] **CHATX-PROJ-004** Guarded Kanban transition: owner/acceptor/version/reason/evidence; не писать статус непосредственно из drag/drop. На touch нужен альтернативный явный action.
- [ ] **CHATX-PROJ-005** Семь ролей, параллельные изменения, удаление участника с unfinished work, stale links, Calendar project filter и Project↔Decision history — постоянный release gate.

### 06. Daily Work, tasks, calendar, notifications — P1

- [ ] **CHATX-WORK-001** Today/Inbox/My/Assigned/Review/Team — единая фильтрация над Task; deadline/forecast/calendar block не смешивать в одно поле.
- [ ] **CHATX-WORK-002** Контроль обещания: accountable owner, requester, acceptor, collaborators, checklists/dependencies, review/evidence, cancellation/deferral audit, explicit task history.
- [ ] **CHATX-WORK-003** Schedule Impact: deadline update → approved proposal → Calendar conflict/RRULE/working hours/absence checks → move audit. Проверить DST/timezone/offline/edit/recur.
- [ ] **CHATX-WORK-004** Обратная навигация: из Calendar block в Task/Project, из Task в Calendar, из уведомления в точное событие/доказательство, без ghost blocks.
- [ ] **CHATX-WORK-005** Notification preferences и digest без многократных дублей, уважение mute/DND, immediate security/role invalidation; Web Push проверить на реальном провайдере.
- [ ] **CHATX-WORK-006** UX-low-cost: project/week filters, «Что требует моего действия», понятная сортировка, состояние отсутствия назначений, явный owner/acceptor.
- [ ] **CHATX-WORK-007** Более поздние: full resource calendar, splits/shift scheduling, Google/Microsoft two-way sync (после provider и business-ownership модели).

### 07. Conversation, files, voice, calls, meeting — P1/P2

- [ ] **CHATX-CHAT-001** Полная роль/канал/group/message матрица: join/remove/mute/archive, reply/pin/forward/reaction/edit-history, attachment and voice; проверить повторную авторизацию каждого read/write.
- [ ] **CHATX-CHAT-002** Product Blueprint advanced backlog отдельно: scheduled send, synchronized drafts, read/delivery preference, polls, rich previews/code, offline outbox and reconnection. Реализовывать по подтверждённому пользовательскому приоритету, не мешая P0.
- [ ] **CHATX-FILE-001** Durable file storage + backed-up metadata/object consistency; quota/checksum/content-type; private canonical preview; failed/retry/incomplete upload states; verify restore.
- [ ] **CHATX-FILE-002** Request/Task/Page/Meeting/File links — только через File Authority; link removal не удаляет сам файл без отдельной delete policy.
- [ ] **CHATX-FILE-003** Malware scan/quarantine and resumable tus upload — после подтверждения basic durable upload/permissions. Не использовать сканирование в синхронном request critical path.
- [ ] **CHATX-MEDIA-001** Реальные браузеры и provider: mic/camera/screen share, room admission, reconnect, consent/revoke, recording/Egress, transcription sidecar, processing/retry, human evidence review, privacy/retention.
- [ ] **CHATX-MEDIA-002** Open-source `faster-whisper` лишь как fallback с явными ресурсами/quality/evidence gates; коммерческий STT/LLM не включать без учёта затрат и разрешения организации.
- [ ] **CHATX-MEDIA-003** Upload large recordings → durable store → worker → segments → reviewed summary → confirmed decision/task. Не путать mock-provider green с live proof.

### 08. Requests, approvals and business forms — P1

- [ ] **CHATX-REQ-001** Existing templates/versioning/approval chain/task idempotency сохранять; добавить controlled request attachments через canonical File.
- [ ] **CHATX-REQ-002** Approval delegation, approver absence, SLA reminders, queue filters/ownership/history; self-approval prohibition persists.
- [ ] **CHATX-REQ-003** Forms schema/editor improvements after real demand; server validation version is authoritative, JSON Forms is optional UI only.
- [ ] **CHATX-REQ-004** E2E: submit → request info → reply → approve/reject → canonical Task → execution/evidence → acceptance; permissions, stale version, cancellation and duplicate submit.

### 09. Production admission, recovery and privacy — P0/P1

- [ ] **CHATX-OPS-001** Отдельная staging/production PostgreSQL 17; secrets вне репозитория; migration status; no memory fallback in production; readiness checks.
- [ ] **CHATX-OPS-002** S3-compatible durable object storage or equivalent verified persistent backend, private credentials, rotation; never present filesystem temporary uploads as permanent.
- [ ] **CHATX-OPS-003** Backup + **isolated restore of DB and objects**, verify manifest, evidence referential integrity; agree RPO/RTO targets only after measuring.
- [ ] **CHATX-OPS-004** Real mail sender + invitation/reset; Web Push delivery and permission changes; LiveKit TURN/Egress/recording; webhook signatures; retries/dead letters; reproduce failure paths.
- [ ] **CHATX-OPS-005** Logging/metrics/traces keyed by correlation ID without message/transcript/secret contents; user-facing incident explanation and support runbook.
- [ ] **CHATX-OPS-006** Performance/load: p95 endpoint & page-interaction baseline, many messages/files/projects, database pool, WebSocket reconnect, upload concurrency; targets after measurement, not invented numbers.
- [ ] **CHATX-OPS-007** Security: session revocation, password/TOTP, admin step-up passkeys later; tenant authz, resource traversal, search leakage, DLP/retention. Independent audit before customer onboarding.
- [ ] **CHATX-OPS-008** First pilot: actual company roles, repeatable daily journey, field defects backlog, release/rollback drill, acceptance signed by product owner.

### 10. External sync and interoperable workflows — P2

- [ ] **CHATX-EXT-001** Existing personal ICS subscription = one-way export; add bounded ICS import with mapping/ownership/conflict log before bilateral OAuth sync.
- [ ] **CHATX-EXT-002** Google/Microsoft Calendar OAuth: refresh token storage, revoke, event mapping, last-write/origin policy, recurrence, timezones, rate limits, replay/loop prevention.
- [ ] **CHATX-EXT-003** Telegram real Bot API pilot (current fake API round trip != real external test); Slack/Teams only where customer demands.
- [ ] **CHATX-EXT-004** Signed outbound event gateway is partially represented by existing outbox/webhook architecture; extend domain payloads/events by schema version, not a second queue.
- [ ] **CHATX-EXT-005** Retention/SCIM/OIDC/SAML connectors only when enterprise customer and identity requirements justify them.

### 11. Governed automation, AI and advanced layers — P2/P3/P4

- [ ] **CHATX-AUT-001** Versioned native rules: trigger + conditions + proposal/action + dry-run + human approval + idempotent domain command + audit/execution log.
- [ ] **CHATX-AI-001** Read-only sourced briefs «Что изменилось / что делать дальше» over authorized Tasks, Decisions, Projects, Pages, Files and Meetings.
- [ ] **CHATX-AI-002** Proposal layer: draft task/decision/calendar/request, preview/edit/approve/reject; external side effect only after explicit domain action and policy.
- [ ] **CHATX-AI-003** Privacy egress: classification, secret screening, provider permission, redaction, source version freshness, cross-tenant tests. Local inference is optional and still needs compute.
- [ ] **CHATX-GRAPH-001** Derived Work Graph and deterministic Risk Radar after Decision/task/project relations stable, with explainable citations and zero employee black-box scoring.
- [ ] **CHATX-ENT-001** Enterprise phase: OIDC/SAML/SCIM, passkeys, legal hold/eDiscovery, DLP, data boundary, cross-organisation workrooms.
- [ ] **CHATX-PLATFORM-001** Only later: extension SDK/capability sandbox, marketplace, per-version certification, receipts and portable verified execution; no premature commercialization infrastructure.

## E. Full acceptance matrix — what “fully working” means

**Персоны:** Owner, Admin, Manager/Project Lead, Employee, Reviewer, Observer, Guest, Removed/Revoked member.

**Сценарии (каждый прогнать UI/API/DB при доступном provider):**
1. Register→invite/bulk CSV→join→group/channel→message/reply/pin/forward/file/voice.
2. Message→canonical Task→accept→schedule→block/resume→evidence→review→return→resubmit→accept→close.
3. Project→members→milestone→task→Kanban→calendar projection→file/discussion/decision→deep link.
4. Page→rich write→history→conflict→Project/Task/Meeting/Channel links→permission change→search.
5. Meeting→consent→record/upload→transcript→summary→decision proposal→human confirm→Task.
6. Request→approval with absent/delegated approver→Task/Decision→evidence→receipt.
7. Calendar move/overlap/recurrence/working schedule/absence→explicit choice→audit.
8. Search/realtime/Web Push/notifications from visible and invisible entities.
9. Lost response, retry, duplicate submit, slow network, refresh, offline/reconnect, session revoked.
10. Backup→restore in isolated env→link and blob recheck, plus rollback of release.

**Пересечения ролей:** собственное действие, другой workspace, чужой private Project, removed member with stale ID, guest with deep link, observer no write, admin vs participant source authority. Проверять visibility до и после изменения членства.

**Приёмочные артефакты для каждой истории:** exact SHA; CI run + named test; API/DB/audit assertions; screenshots 390×844 / 834×1112 / 1440×900; ручное device proof там, где нужно; non-leakage; expected failure & recovery; документация; known issues & fallback.

**Релизные уровни:**
- L0 Spec/plan;
- L1 Code written;
- L2 Unit/API GREEN;
- L3 PostgreSQL + browser E2E GREEN;
- L4 real-provider + real-device pilot GREEN;
- L5 release/deploy/restore/operations proven;
- L6 customer acceptance.
Нельзя писать «полностью готово» при L2–L3.

## F. Экономика внедрения и запрет скрытых затрат

- По умолчанию использовать **существующие PostgreSQL 17, Node.js, Playwright, native Postgres full-text search, Docker, self-hosted software**.
- Tiptap Editor Core, Yjs и Hocuspocus могут быть внедрены по open-source лицензиям; перед добавлением конкретного npm-пакета проверять его актуальную лицензию и supply-chain.
- Не покупать Tiptap Cloud, Typesense Cloud, SaaS observability, paid AI services и платные extension kits для реализации MVP, пока нет письменного business-case.
- **Нулевые дополнительные лицензии ≠ нулевые эксплуатационные затраты.** Стабильный сервер, PostgreSQL storage/backups, TURN/LiveKit Egress, S3 object storage, e-mail deliverability, SMS, AI inference и облачный bandwidth могут требовать ресурсов или денег. Фиксировать фактические затраты по каждому deployment profile.
- У платных провайдеров — feature flag OFF by default, явный quota/limit, предупреждение о бюджете, stop/fallback.
- Search engine, external auth/automation/semantic stores подключать только после измеренного bottleneck: увеличение количества сервисов само по себе не делает продукт сильнее.

## G. Порядок ближайших решений

1. **Release #21:** review existing GREEN, confirm target branch and fix divergent branch integration; do not merge automatically. 
2. **Pages v1:** UI Tiptap + renderer, current JSON schema + legacy compatibility, version/conflict/history, browser & ACL.
3. **Pages composition + Unified Search:** related Task/Meeting/Channel, per-page ACL, Projects/Decisions/Pages in search.
4. **Decision Register semantics + Project Cockpit UX** with canonical links.
5. **Customer pilot readiness:** file durability, real providers, mobile/desktop visual QA, backup/restore.
6. **Requests/Automation/AI/enterprise** by evidence and customer priority.

**Правило обновления:** при завершении каждого пункта в том же PR исправлять здесь status, связывать exact SHA/run/test/screenshots и синхронизировать `ROADMAP.md`/`CHATX_INTEGRATION_MASTER_PLAN_2026-10-01.md`. Ни одно слово GREEN не переносить «по памяти».
