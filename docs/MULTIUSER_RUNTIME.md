# Multi-user runtime

## Runtime boundary

The application has three runtime surfaces:

1. REST commands/queries for durable state.
2. WebSocket events for ephemeral realtime state and fast invalidation.
3. Web Push for device delivery when the app is not foregrounded.

PostgreSQL remains authoritative for durable business state. WebSocket typing signals are deliberately ephemeral.

## Identity and tenancy

A global `users` identity can belong to one or more workspaces through `memberships`. Workspace role controls permissions. A session is bound to a user and one workspace; switching workspaces creates or selects a different workspace session context rather than trusting a client-supplied tenant id.

Roles:

- owner — company ownership and every workspace capability;
- admin — administration except ownership transfer;
- manager — people invitations, channels, team tasks/calendar, audit visibility;
- member — ordinary messaging, tasks, calendar, calls and files;
- guest — constrained collaboration.

## Realtime events

Server -> client:

- `session.ready`
- `conversation.created`
- `message.created`
- `message.reaction`
- `conversation.read`
- `presence.updated`
- `typing.start`
- `typing.stop`
- `task.created`
- `calendar.created`
- `file.created`

Client -> server:

- `typing.start`
- `typing.stop`
- `presence.set`

Durable commands still go through REST so validation, audit, idempotency and database transactions can be applied consistently.

Private conversation events are routed only to conversation participants. Workspace-visible channels are routed to workspace members. Realtime transport must never widen an entity's authorization scope.

## Mobile interaction rules

The UI follows an immediate-response interaction model:

- controls react on pointer/touch down through `:active`, not hover-only;
- mobile navigation lives in a safe-area-aware bottom sheet;
- dark graphite surfaces use hierarchy, spacing and typography rather than heavy borders;
- primary actions remain reachable by thumb;
- chat composer, voice recording and attachments are usable without leaving the conversation;
- desktop adds space and context but does not introduce a separate product model.

## Next production hardening

- existing-account invitation acceptance and workspace switching;
- rate limiting, account lockout and email verification;
- optimistic concurrency on REST mutations;
- request idempotency integration for message/task/event commands;
- S3-compatible object storage + antivirus/quarantine worker;
- APNs/FCM native push adapters;
- WebRTC signaling, TURN and SFU for group calls and screen sharing;
- call recording/transcoding pipeline;
- full-text/semantic search;
- background jobs for reminders, digests and notification fanout;
- observability, retention and organization security policies.
