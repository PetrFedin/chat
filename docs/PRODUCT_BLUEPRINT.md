# Chat — product blueprint

## Product definition

Chat is a multi-tenant corporate work application where a company signs up, creates a workspace, invites employees and then runs daily communication and execution in one connected model: conversations, channels, messages, tasks, projects, calendars, meetings, calls, files, notifications, evidence, review and AI assistance.

The product must be excellent on a phone first, while desktop/web expands density and management views rather than changing the underlying workflow.

## Core graph

`Organization -> Workspace -> People/Teams -> Conversation -> Message -> Work item -> Calendar/Meeting -> Execution -> Evidence -> Review -> Accepted result`

Cross-cutting objects: files, calls, notifications, search, audit, integrations and AI.

## 1. Company onboarding and administration

1. Self-service company registration: company name, owner identity, workspace name, locale/timezone.
2. Bootstrap `# general` and `# announcements` channels.
3. Invite employees by email/link; bulk CSV import later; roles owner/admin/manager/member/guest.
4. Employee directory with avatar, job title, department, manager, timezone, status and contact data.
5. Teams/departments, team leads and team-based channel/project membership.
6. Deactivation must preserve authored messages, tasks, decisions and audit history.
7. Enterprise phase: SSO/SAML, SCIM, domain claiming, retention, legal hold/eDiscovery, data residency, DLP and device/session administration.

## 2. Messaging

Conversation types: direct, group, channel, team, project, task, meeting, decision, approval, control, incident and external.

Required messaging capabilities:
- text, emoji, reactions, mentions, replies and threads;
- edit with audit metadata and soft delete;
- saved/starred messages and later reminders;
- scheduled send and drafts synchronized between devices;
- read/delivery state with privacy controls;
- pinned messages, channel purpose/topic and announcement-only channels;
- forward/share message to another conversation with provenance;
- polls, code blocks, link previews and structured message cards;
- global search and in-conversation search;
- offline send queue and deterministic replay on reconnect.

A consequential message should be convertible to task, calendar event, decision, approval or meeting without losing the source message.

## 3. Voice messages and files

Voice message UX: hold/tap to record, pause/resume, scrub waveform, playback speed, optional transcript, reply/forward/save and convert transcript action items into tasks.

Files:
- resumable upload to object storage;
- images/video/document/audio/archive support;
- preview where safe, virus/malware scanning, quarantine state;
- file version/history for project documents later;
- same file can be linked to message, task, meeting, calendar event or project;
- workspace file browser by owner/type/project/date and full-text extraction where supported;
- signed URLs, tenant isolation, retention and deletion policy.

## 4. Tasks and accountability

A task/commitment includes title, expected outcome, one accountable owner, requester, acceptor, collaborators, project, parent task, priority, promised date, forecast date, estimate, checklist, dependencies, comments, attachments, source context, calendar blocks, evidence and acceptance history.

Views: Today, Inbox, My tasks, Assigned by me, Team, Board, List, Timeline, Workload, Calendar and Review queue.

The system distinguishes `completed` from `accepted result`. A manager can see overdue work, stale work, blockers, changed forecasts, pending reviews and reopened results.

## 5. Calendar and planning

Calendar objects: meeting, focus block, task block, deadline, reminder, milestone and other event.

Required:
- day/week/month/agenda on desktop; agenda + 1/2/3-day mobile views;
- recurring events, timezones, working hours and all-day events;
- participant response (accepted/tentative/declined) and optional participants;
- task time-blocking and drag rescheduling with audit reason for consequential changes;
- teammate availability and later meeting-room/resource calendars;
- project milestones and deadlines;
- external Google/Outlook synchronization with loop prevention and source ownership.

## 6. Meetings and calls

Calls are launched directly from a DM/channel/project or from a calendar event.

Phase target:
- 1:1 and group audio/video;
- ringing/in-call/reconnect states;
- mute, camera, speaker route and device selection;
- screen sharing on supported clients;
- call chat/thread and files remain in the source conversation;
- scheduled call and instant huddle modes;
- participant roster, hand raise/reactions and host controls;
- call quality telemetry and graceful network degradation;
- recording only after explicit consent policy; recording retention separately configurable;
- transcript, notes, decisions and action items connected to the meeting object.

Media architecture should use WebRTC with an SFU for group calls; signaling, TURN/STUN, recording and transcoding are infrastructure concerns separated from the domain model.

## 7. Mobile application

Primary bottom navigation: Today, Messages, Tasks, Calendar, More.

Mobile non-negotiables:
- safe-area aware layout, one-handed primary actions and large touch targets;
- fast message composer with camera/file/voice/task/calendar actions;
- swipe reply/save/read actions only where discoverable and reversible;
- native push deep-links directly to the exact message/task/meeting;
- background upload/download, voice recording and call reconnection;
- cached recent conversations/tasks/calendar for poor connectivity;
- drafts and optimistic sends survive process termination;
- biometric app lock option for enterprise users;
- share sheet: send a file/link into a conversation/task;
- call UI integrates with OS audio routing and interruption behavior.

The repository now contains a dependency-free responsive PWA shell under `public/` as an executable UX baseline. Native iOS/Android packaging remains a separate delivery layer once API/realtime contracts stabilize.

## 8. Notifications and attention management

Notification center categories: mentions, messages, tasks, deadlines, calendar, meetings, approvals/reviews and system.

Policies:
- per-conversation mute and custom notification levels;
- quiet hours / do-not-disturb and presence-aware suppression;
- push, in-app and optional email digests;
- priority notification path for urgent mentions/tasks;
- bundling/deduplication to prevent notification storms;
- daily/weekly digest with action-oriented summaries.

## 9. Presence and people

Presence states: online, away, busy, do-not-disturb, offline. User status may include text/emoji and expiry. Calendar can influence busy/DND but must not expose private event details unless permission allows.

## 10. Projects and team planning

Project = persistent context for conversations, tasks, meetings, files, milestones and decisions.

Project home should answer: what is the goal, who owns it, current status, next milestone, what is blocked, what changed, which decisions are open and what requires management attention.

## 11. Search and knowledge

Unified search spans messages, threads, files, extracted file text, tasks, projects, meeting notes/transcripts, people and calendar events while enforcing the requesting user's access boundary before ranking.

Later knowledge layer:
- pinned project/channel canvas;
- lightweight collaborative docs/notes;
- reusable channel/project templates;
- decision log and meeting memory;
- semantic search with citations back to source objects.

## 12. Automation and AI

AI is embedded into work, not a separate novelty chat.

High-value uses:
- summarize unread channel/thread activity;
- summarize a project/week/day;
- transcribe voice and meetings;
- extract proposed decisions, owners, dates and action items;
- detect unanswered asks and unsaved agreements;
- draft tasks/events from natural language;
- find schedule conflicts and suggest time blocks;
- retrieve answers from authorized workspace knowledge with source links;
- manager briefing: blockers, risk, overdue/stale commitments and review queue.

AI may propose consequential changes but never silently assign responsibility, change a promised date, approve/accept a result, start recording, delete history or send external messages.

## 13. Automation/workflows

No-code rules later: trigger -> conditions -> actions, e.g. form submitted -> create task -> assign manager -> post to channel -> schedule reminder. Every automation execution requires an inspectable log and idempotency key.

## 14. External collaboration and integrations

Priority: Google Calendar, Microsoft Outlook, Google Drive, OneDrive/SharePoint, GitHub, Figma, email, Telegram; then CRM/ERP/1C and customer-specific adapters.

Guests/external shared spaces need narrower defaults, explicit file policies and clear visual separation from internal conversations.

## 15. Security and reliability

- strict organization/workspace tenant isolation at query and persistence layers;
- least-privilege role/capability matrix;
- encryption in transit and at rest at infrastructure layer;
- idempotent mutations, optimistic concurrency and transactional outbox;
- append-only audit for consequential changes;
- signed object-storage access and malware scanning;
- rate limits, abuse controls and session/device revocation;
- backup/restore drills and observable SLOs;
- WebSocket/SSE reconnect with durable sequence/cursor and no duplicated messages.

## Delivery sequence

1. Tenant security, permissions, command safety and identity onboarding.
2. Realtime channels/DMs, threads, mentions, reactions, read state, files and voice.
3. Tasks/projects + mobile Today.
4. Calendar engine + availability + external calendar sync.
5. Audio/video calls and huddles; then screen sharing/recording.
6. Meeting notes/transcripts/action items.
7. Global search, knowledge/canvas and workflow automation.
8. AI summaries/action extraction/retrieval with human confirmation gates.
9. Enterprise administration/compliance and broader integrations.

This sequence keeps the product usable after each phase without compromising tenant isolation or auditability.
