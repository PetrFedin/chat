export const openapi = Object.freeze({
  openapi: '3.1.0',
  info: {
    title: 'ChatX Corporate Workspace API',
    version: '0.11.0',
    description: 'Company workspace API with server-authoritative conversation membership, personal archive/mute, saved and pinned messages, immutable forward provenance, controlled message editing/deletion, versioned accountable task execution, evidence-gated review and acceptance, daily attention, permission-aware search and files, realtime messaging and calls, consent-gated recording, evidence-first meeting intelligence, governed processing recovery and versioned provider cost accounting. AI output remains proposed until explicitly confirmed by a human.'
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Auth' },
    { name: 'Workspace' },
    { name: 'Attention' },
    { name: 'Search' },
    { name: 'Messaging' },
    { name: 'Realtime' },
    { name: 'Calls' },
    { name: 'Meeting Intelligence' },
    { name: 'Meeting Operations' },
    { name: 'Files' },
    { name: 'Push' },
    { name: 'People' },
    { name: 'Personal' },
    { name: 'Labels' },
    { name: 'Games' },
    { name: 'API Keys' },
    { name: 'Chat Assistant' }
  ],
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'chat_session' },
      apiKey: { type: 'http', scheme: 'bearer', description: 'A personal API key created under /api/v1/api-keys, acting with its owner’s own permissions.' }
    }
  },
  security: [{ sessionCookie: [] }, { apiKey: [] }],
  paths: {
    '/api/v1/auth/register-company': { post: { tags: ['Auth'], summary: 'Register a company and owner', responses: { '201': { description: 'Company created' } } } },
    '/api/v1/invitations/accept': { post: { tags: ['Auth', 'Workspace'], summary: 'Accept an employee invitation and create the invited account', responses: { '201': { description: 'Invitation accepted and session created' } } } },
    '/api/v1/auth/login': { post: { tags: ['Auth'], summary: 'Create an authenticated session', responses: { '200': { description: 'Authenticated' }, '401': { description: 'Invalid credentials' } } } },
    '/api/v1/auth/logout': { post: { tags: ['Auth'], summary: 'Revoke current session', responses: { '204': { description: 'Session revoked' } } } },
    '/api/v1/bootstrap': { get: { tags: ['Workspace'], summary: 'Current user, workspace and initial navigation data', responses: { '200': { description: 'Bootstrap state' } } } },
    '/api/v1/invitations': { post: { tags: ['Workspace'], summary: 'Invite an employee', responses: { '201': { description: 'Invitation created' }, '403': { description: 'Forbidden' } } } },
    '/api/v1/attention': { get: { tags: ['Attention'], summary: 'Get current user attention counters: unread, mentions, overdue and due-soon work', responses: { '200': { description: 'Attention summary' } } } },
    '/api/v1/notifications': { get: { tags: ['Attention'], summary: 'List current user notification inbox, optionally filtered by status or type', responses: { '200': { description: 'Notification list' } } } },
    '/api/v1/notifications/read-all': { post: { tags: ['Attention'], summary: 'Mark current notification scope as read', responses: { '200': { description: 'Read count' } } } },
    '/api/v1/notifications/{notificationId}/read': { post: { tags: ['Attention'], summary: 'Mark one notification as read', responses: { '200': { description: 'Notification read state' }, '404': { description: 'Notification not visible' } } } },
    '/api/v1/mentions': { get: { tags: ['Attention'], summary: 'List current user mentions', responses: { '200': { description: 'Mention notification list' } } } },
    '/api/v1/search': { get: { tags: ['Search'], summary: 'Search accessible messages, conversations, tasks, files, people and calendar events', description: 'Files match on their name and on their text: plain text, docx, xlsx, pptx and PDFs with a text layer are read on upload. Scans and password-protected files are not indexed — the first needs recognition, the second cannot be opened, and pretending they are searchable is worse than saying so. A hit inside a file carries insideFile:true and a snippet where the matched word is wrapped in \\u0002 and \\u0003 rather than markup.', responses: { '200': { description: 'Permission-filtered search results' } } } },
    '/api/v1/tasks': {
      get: { tags: ['Workspace'], summary: 'List tasks visible to the current accountable workflow participant',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 }, description: 'Page size, clamped to 200' },
          { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Keyset cursor from a previous page\'s nextCursor: promisedAt|createdAt|id, with "-" for an undated task' },
        ],
        responses: { '200': { description: 'One page of tasks with current version and allowed transitions, plus nextCursor (null on the last page)' }, '400': { description: 'Malformed cursor' } } },
      post: { tags: ['Workspace'], summary: 'Create a proposed task with one accountable owner and designated result acceptor', responses: { '201': { description: 'Task created at version 1' }, '400': { description: 'Invalid task participant or payload' } } }
    },
    '/api/v1/tasks/{taskId}': {
      get: { tags: ['Workspace'], summary: 'Get authoritative task detail, evidence, acceptance decisions and audit history', responses: { '200': { description: 'Task detail' }, '404': { description: 'Task is not visible' } } }
    },
    '/api/v1/tasks/{taskId}/transitions': {
      post: {
        tags: ['Workspace'],
        summary: 'Perform an actor-authorized, optimistic-version task state transition',
        description: 'The server enforces the accountable owner, requester and designated acceptor roles. Review requires execution evidence. Blocking, deferral, cancellation and review return/reopen paths require explicit reasons. expectedVersion rejects stale actions.',
        responses: { '200': { description: 'Updated task with next allowed transitions' }, '400': { description: 'Reason or transition input required' }, '403': { description: 'Actor is not authorized for this transition' }, '404': { description: 'Task is not visible' }, '409': { description: 'Stale version, missing evidence or invalid state transition' } }
      }
    },
    '/api/v1/tasks/{taskId}/evidence': {
      post: {
        tags: ['Workspace'],
        summary: 'Attach auditable execution evidence to a visible task',
        description: 'Evidence is append-only through this endpoint and advances the task version so stale review actions cannot race with new evidence. The value is checked against the declared type: a url must be http or https, a metric must start with a number, and a file or message must resolve to something the actor can see.',
        responses: { '201': { description: 'Evidence appended and task version advanced' }, '400': { description: 'Unsupported evidence type, or a value that does not match its type (INVALID_EVIDENCE_VALUE)' }, '403': { description: 'Evidence authority denied' }, '404': { description: 'Task is not visible' }, '409': { description: 'Stale or terminal task' } }
      }
    },
    '/api/v1/tasks/{taskId}/schedule': {
      patch: {
        tags: ['Workspace'],
        summary: 'Reschedule promised/forecast time with a mandatory audited reason',
        responses: { '200': { description: 'Task schedule and version updated' }, '400': { description: 'Reason required' }, '403': { description: 'Scheduling authority denied' }, '404': { description: 'Task is not visible' }, '409': { description: 'Stale or terminal task' } }
      }
    },
    '/api/v1/calendar-events': {
      get: { tags: ['Workspace'], summary: 'List calendar events', responses: { '200': { description: 'Calendar events' } } },
      post: { tags: ['Workspace'], summary: 'Create meeting, focus block, deadline or reminder', responses: { '201': { description: 'Calendar event created' } } }
    },
    '/api/v1/conversations': {
      get: { tags: ['Messaging'], summary: 'List visible conversations with computed unread and mention counts', responses: { '200': { description: 'Conversation list' } } },
      post: { tags: ['Messaging'], summary: 'Create a channel, group or direct conversation', responses: { '201': { description: 'Conversation created' } } }
    },
    '/api/v1/conversations/archived': {
      get: { tags: ['Messaging'], summary: 'List conversations personally archived by the current user', responses: { '200': { description: 'Personal archive' } } }
    },
    '/api/v1/conversations/{conversationId}/preferences': {
      patch: { tags: ['Messaging'], summary: 'Update personal archive and mute state for one conversation', description: 'Archive and mute state are per-user. They do not archive the shared conversation or remove realtime membership.', responses: { '200': { description: 'Updated personal preferences' }, '404': { description: 'Conversation not visible' } } }
    },
    '/api/v1/conversations/{conversationId}/pins': {
      get: { tags: ['Messaging'], summary: 'List non-deleted messages pinned in a visible conversation', responses: { '200': { description: 'Pinned messages' }, '404': { description: 'Conversation not visible' } } }
    },
    '/api/v1/saved-messages': {
      get: { tags: ['Messaging'], summary: 'List messages personally saved by the current user', responses: { '200': { description: 'Saved messages in still-visible contexts' } } }
    },
    '/api/v1/conversations/{conversationId}/members': {
      get: { tags: ['Messaging'], summary: 'List visible conversation members and current management authority', responses: { '200': { description: 'Conversation members' }, '404': { description: 'Conversation not visible' } } },
      post: { tags: ['Messaging'], summary: 'Add workspace members to a managed group or channel', responses: { '200': { description: 'Updated conversation members' }, '403': { description: 'Conversation management permission required' }, '409': { description: 'Direct conversation membership is immutable' } } }
    },
    '/api/v1/conversations/{conversationId}/members/{userId}': {
      patch: { tags: ['Messaging'], summary: 'Change a conversation member role while preserving at least one owner', responses: { '200': { description: 'Updated conversation members' }, '403': { description: 'Conversation management permission required' }, '409': { description: 'Last owner or immutable direct conversation' } } },
      delete: { tags: ['Messaging'], summary: 'Remove a member from a managed group or private channel', responses: { '200': { description: 'Updated conversation members' }, '403': { description: 'Conversation management permission required' }, '409': { description: 'Last owner or immutable direct conversation' } } }
    },
    '/api/v1/conversations/{conversationId}/messages': {
      get: { tags: ['Messaging'], summary: 'List conversation messages', description: 'The flow carries no thread replies — a message that started one carries replyCount and lastReplyAt instead. thread=<id> returns that thread: its root first, then the replies in order. around=<id> returns a window centred on one message.', parameters: [{ name: 'thread', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Read one thread instead of the flow' }, { name: 'around', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'before', in: 'query', schema: { type: 'string' }, description: 'Cursor: createdAt|id' }, { name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Messages' }, '400': { description: 'Malformed message id or cursor' }, '404': { description: 'No such message to open a thread on' } } },
      post: { tags: ['Messaging'], summary: 'Send text or structured message and resolve supported @mentions', description: 'threadRootId puts the message in a thread under that message, out of the flow. A thread cannot start inside another thread.', responses: { '201': { description: 'Message created' }, '400': { description: 'The referenced message is not in this conversation' }, '409': { description: 'A thread cannot start inside another thread' } } }
    },
    '/api/v1/messages/{messageId}': {
      patch: { tags: ['Messaging'], summary: 'Edit an authored text message', description: 'Forwarded copies are immutable so their copied content cannot diverge from provenance.', responses: { '200': { description: 'Edited message' }, '403': { description: 'Only the author may edit' }, '409': { description: 'Forwarded or non-text message is not editable' } } },
      delete: { tags: ['Messaging'], summary: 'Soft-delete a message under author/admin authority', responses: { '200': { description: 'Deleted message projection' }, '403': { description: 'Delete authority denied' } } }
    },
    '/api/v1/messages/{messageId}/save': {
      post: { tags: ['Messaging'], summary: 'Save a visible message for the current user', responses: { '200': { description: 'Saved' }, '404': { description: 'Message not visible' } } },
      delete: { tags: ['Messaging'], summary: 'Remove a message from the current user saved list', responses: { '200': { description: 'Unsaved' } } }
    },
    '/api/v1/messages/{messageId}/pin': {
      post: { tags: ['Messaging'], summary: 'Pin a visible message in its conversation', description: 'Direct participants may pin in direct chats. Other conversation kinds require conversation management authority.', responses: { '200': { description: 'Pinned' }, '403': { description: 'Pin authority denied' } } },
      delete: { tags: ['Messaging'], summary: 'Unpin a message under the same shared-state authority', responses: { '200': { description: 'Unpinned' }, '403': { description: 'Pin authority denied' } } }
    },
    '/api/v1/messages/{messageId}/forward': {
      post: { tags: ['Messaging'], summary: 'Forward a visible message into another visible conversation', description: 'Creates a new message plus immutable server-side provenance. Provenance details are redacted for viewers who cannot access the source conversation. Announcement-only policy is enforced on the target.', responses: { '201': { description: 'Forwarded message' }, '403': { description: 'Target publishing policy denied' }, '404': { description: 'Source or target not visible' } } }
    },
    '/api/v1/messages/{messageId}/reactions': { post: { tags: ['Messaging'], summary: 'Add or remove a reaction', responses: { '200': { description: 'Reaction state' } } } },
    '/api/v1/conversations/{conversationId}/read': { post: { tags: ['Messaging', 'Attention'], summary: 'Move current user read cursor and clear related conversation notifications', responses: { '204': { description: 'Read state updated' } } } },
    '/api/v1/presence': { post: { tags: ['Realtime'], summary: 'Set presence and custom status', responses: { '200': { description: 'Presence updated' } } } },
    '/api/v1/conversations/{conversationId}/calls': { post: { tags: ['Calls'], summary: 'Create an audio or video call bound to a conversation', responses: { '201': { description: 'Call created' }, '403': { description: 'Forbidden' } } } },
    '/api/v1/calls/{callId}': { get: { tags: ['Calls'], summary: 'Get call state, participants and recording state', responses: { '200': { description: 'Call state' }, '404': { description: 'Call not visible' } } } },
    '/api/v1/calls/{callId}/join': { post: { tags: ['Calls'], summary: 'Join call and mint short-lived LiveKit credentials', responses: { '200': { description: 'Join credentials' }, '503': { description: 'Media provider is not configured' } } } },
    '/api/v1/calls/{callId}/leave': { post: { tags: ['Calls'], summary: 'Leave the current call', responses: { '200': { description: 'Participant left' } } } },
    '/api/v1/calls/{callId}/media': { patch: { tags: ['Calls'], summary: 'Persist participant mic, camera, screen-share and connection state', responses: { '200': { description: 'Participant state updated' } } } },
    '/api/v1/calls/{callId}/recording-consent': { post: { tags: ['Calls'], summary: 'Record current participant consent before recording', responses: { '200': { description: 'Consent stored' } } } },
    '/api/v1/calls/{callId}/recording/start': { post: { tags: ['Calls'], summary: 'Start composite meeting recording after all active participants consent', responses: { '201': { description: 'Recording started' }, '409': { description: 'Consent missing or call not active' } } } },
    '/api/v1/calls/{callId}/recording/stop': { post: { tags: ['Calls'], summary: 'Stop active meeting recording and move it to processing', responses: { '200': { description: 'Recording stopped' } } } },
    '/api/v1/calls/{callId}/end': { post: { tags: ['Calls'], summary: 'End call for all participants', responses: { '200': { description: 'Call ended' }, '403': { description: 'Only creator or call manager may end' } } } },
    '/api/v1/media/livekit/webhook': {
      post: {
        tags: ['Meeting Intelligence'],
        summary: 'Receive a signed LiveKit webhook and reconcile recording lifecycle',
        description: 'Authenticated with the official LiveKit webhook JWT/body-SHA contract. Egress completion is idempotently mapped to persisted archive/transcription sources. A previously failed webhook journal entry may be atomically reclaimed on provider redelivery; processed events remain duplicates.',
        responses: { '200': { description: 'Webhook processed, reclaimed, ignored or already seen' }, '401': { description: 'Invalid webhook signature' }, '503': { description: 'LiveKit webhook verification is not configured' } }
      }
    },
    '/api/v1/meetings': {
      get: {
        tags: ['Meeting Intelligence'],
        summary: 'List meeting reviews visible to the current user',
        description: 'Returns a permission-aware meeting-center projection including processing state, review counts, transcript availability and summary preview. Private conversation boundaries are preserved.',
        responses: { '200': { description: 'Accessible meeting list' } }
      }
    },
    '/api/v1/calls/{callId}/meeting': {
      get: {
        tags: ['Meeting Intelligence'],
        summary: 'Get meeting recording intelligence, transcript segments, proposals, evidence links and safe provider-attempt telemetry',
        description: 'Visibility is inherited from the call conversation. Provider request IDs and internal input metadata are not exposed. Proposed actions and decisions remain non-authoritative until a human explicitly accepts or rejects them.',
        responses: { '200': { description: 'Meeting intelligence state' }, '404': { description: 'Meeting not visible' } }
      }
    },
    '/api/v1/meeting-proposals/{proposalId}/accept': {
      post: {
        tags: ['Meeting Intelligence'],
        summary: 'Explicitly accept an AI-proposed meeting item',
        description: 'For action proposals this human action creates the real commitment. Optional owner, acceptor and promised date may be supplied and are validated against workspace membership. AI never performs this transition on its own.',
        responses: { '200': { description: 'Proposal accepted and, for an action, commitment created' }, '403': { description: 'Missing AI/task permission' }, '404': { description: 'Proposal not visible' }, '409': { description: 'Proposal already resolved' } }
      }
    },
    '/api/v1/meeting-proposals/{proposalId}/reject': {
      post: {
        tags: ['Meeting Intelligence'],
        summary: 'Reject an AI-proposed meeting item',
        responses: { '200': { description: 'Proposal rejected by authenticated user' }, '404': { description: 'Pending proposal not visible' } }
      }
    },
    '/api/v1/admin/meeting-jobs': {
      get: {
        tags: ['Meeting Operations'],
        summary: 'List durable meeting processing jobs for owner/admin operations',
        description: 'Returns operational job metadata only; transcript and private meeting content are not exposed by this admin projection.',
        responses: { '200': { description: 'Processing jobs and worker state' }, '403': { description: 'Meeting operations permission required' } }
      }
    },
    '/api/v1/admin/meeting-jobs/{jobId}/retry': {
      post: {
        tags: ['Meeting Operations'],
        summary: 'Explicitly retry a failed or dead-letter meeting job',
        description: 'Requires a human reason. Past attempts are never reset. Dead-letter recovery adds a bounded future attempt budget, requeues the same durable job and writes audit/outbox evidence.',
        responses: { '200': { description: 'Job requeued' }, '403': { description: 'Meeting operations permission required' }, '404': { description: 'Job not found' }, '409': { description: 'Job is not retryable' } }
      }
    },
    '/api/v1/admin/meeting-jobs/{jobId}/cancel': {
      post: {
        tags: ['Meeting Operations'],
        summary: 'Explicitly cancel a queued, failed or dead-letter meeting job',
        description: 'Requires a human reason. A job already being processed cannot be cancelled this way, to avoid racing the worker holding its lease. Marks the job and its meeting run cancelled and writes audit/outbox evidence.',
        responses: { '200': { description: 'Job cancelled' }, '403': { description: 'Meeting operations permission required' }, '404': { description: 'Job not found' }, '409': { description: 'Job is not cancellable' } }
      }
    },
    '/api/v1/admin/meeting-jobs/{jobId}/audit': {
      get: {
        tags: ['Meeting Operations'],
        summary: 'Read meeting job recovery audit trail',
        responses: { '200': { description: 'Audit events' }, '403': { description: 'Audit permission required' } }
      }
    },
    '/api/v1/admin/meeting-prices': {
      get: {
        tags: ['Meeting Operations'],
        summary: 'List immutable provider price catalog versions',
        responses: { '200': { description: 'Price versions and usage mappings' }, '403': { description: 'Meeting cost permission required' } }
      },
      post: {
        tags: ['Meeting Operations'],
        summary: 'Create a new provider price catalog version',
        description: 'Price versions are append-only through the application API. Each item maps a provider usage JSON path to a unit quantity and unit price.',
        responses: { '201': { description: 'Price version created and audited' }, '403': { description: 'Meeting cost management permission required' }, '409': { description: 'Version already exists at effective timestamp' } }
      }
    },
    '/api/v1/admin/meeting-costs': {
      get: {
        tags: ['Meeting Operations'],
        summary: 'Calculate meeting provider costs from persisted usage and effective price versions',
        description: 'Provider usage remains the immutable source measurement. Calls without a matching price version or compatible usage schema are reported as unpriced rather than silently treated as zero cost.',
        responses: { '200': { description: 'Cost rollup and priced/unpriced provider attempts' }, '403': { description: 'Meeting cost permission required' } }
      }
    },
    '/api/v1/files': {
      get: { tags: ['Files'], summary: 'List files visible through uploader ownership or accessible work context', responses: { '200': { description: 'File list with linked context' } } },
      post: { tags: ['Files'], summary: 'Upload an authenticated binary file to local or S3 object storage', description: "Send the raw bytes as the body, the filename URL-encoded in the x-file-name header and the media type in content-type; there is no multipart form and no JSON envelope. Sharing is a second step: the upload alone is visible to the uploader only, and the file reaches a conversation when a message of kind 'file' carries its id in metadata.fileId. The file then inherits that conversation's access. A conversationId query parameter is not read.", responses: { '201': { description: 'File stored; visible to the uploader until a message shares it' }, '400': { description: 'Empty body' }, '413': { description: 'Larger than the 50 MiB limit' } } }
    },
    '/api/v1/files/{fileId}/content': { get: { tags: ['Files'], summary: 'Download an authenticated and context-authorized file', responses: { '200': { description: 'Binary file content' }, '404': { description: 'File not visible' } } } },
    '/api/v1/files/{fileId}/preview': { get: { tags: ['Files'], summary: 'Preview authorized image, PDF or text content inline', responses: { '200': { description: 'Preview content' }, '404': { description: 'File not visible' }, '415': { description: 'Preview unavailable' } } } },
    '/api/v1/conversations/{conversationId}/voice': { post: { tags: ['Files', 'Messaging'], summary: 'Upload and send a voice message', responses: { '201': { description: 'Voice message created' } } } },
    '/api/v1/push-subscriptions': { post: { tags: ['Push'], summary: 'Register a Web Push subscription', responses: { '201': { description: 'Subscription stored' } } } },
    '/ws': { get: { tags: ['Realtime'], summary: 'WebSocket upgrade endpoint for typing, presence, call and workspace events', responses: { '101': { description: 'Switching Protocols' } } } },
    '/api/v1/integrations/webhooks': {
      get: { tags: ['Integrations'], summary: 'List outbound webhook endpoints. Signing secrets are never returned here.', responses: { '200': { description: 'Endpoints' }, '403': { description: 'Requires integration.manage' }, '503': { description: 'Requires a PostgreSQL deployment' } } },
      post: { tags: ['Integrations'], summary: 'Register an endpoint. The signing secret is returned exactly once, in this response.', description: "topics accepts exact names, prefix patterns such as 'meeting.*', '*', or an empty list meaning every topic.", responses: { '201': { description: 'Endpoint created with its one-time secret' }, '400': { description: 'Invalid URL, label or topics' }, '403': { description: 'Requires integration.manage' } } }
    },
    '/api/v1/integrations/webhooks/{id}/enable': { post: { tags: ['Integrations'], summary: 'Resume delivery and reset the consecutive failure counter', responses: { '200': { description: 'Endpoint enabled' }, '404': { description: 'Endpoint not found' } } } },
    '/api/v1/integrations/webhooks/{id}/disable': { post: { tags: ['Integrations'], summary: 'Stop delivery without discarding the delivery history', responses: { '200': { description: 'Endpoint disabled' }, '404': { description: 'Endpoint not found' } } } },
    '/api/v1/integrations/webhooks/{id}': { delete: { tags: ['Integrations'], summary: 'Remove an endpoint and its deliveries', responses: { '204': { description: 'Endpoint removed' }, '404': { description: 'Endpoint not found' } } } },
    '/api/v1/labels': {
      get: { tags: ['Labels'], summary: 'Shared vocabulary plus this person\u2019s own labels', description: "One mechanism behind importance, tags and folders: they differ in presentation and in whether more than one may apply at a time, not in substance. Filter with ?kind=priority|tag|folder|status.", responses: { '200': { description: 'Labels with usage counts' }, '503': { description: 'Requires a PostgreSQL deployment' } } },
      post: { tags: ['Labels'], summary: 'Create a label', description: 'kind priority is exclusive on a target; tag and folder accumulate. Only folders nest. A label with personal:true belongs to its creator and is unreachable for anybody else, even by id. Shared names are unique per kind, case-insensitively.', responses: { '201': { description: 'Label created' }, '409': { description: 'LABEL_NESTING_NOT_ALLOWED or a duplicate shared name' } } }
    },
    '/api/v1/labels/{id}': {
      patch: { tags: ['Labels'], summary: 'Rename, recolour, re-describe or reorder', responses: { '200': { description: 'Label updated' }, '404': { description: 'Not yours and not shared' } } },
      delete: { tags: ['Labels'], summary: 'Delete the label and every mark it made', responses: { '204': { description: 'Deleted' } } }
    },
    '/api/v1/labels/{id}/links/{targetType}/{targetId}': {
      put: { tags: ['Labels'], summary: 'Put the label on a message, file, task, event, conversation, person or note', description: 'Applying an importance replaces whichever importance was on the object. The target must already be visible to the caller: a label never widens access.', responses: { '200': { description: 'Applied' }, '404': { description: 'LABEL_NOT_FOUND or TARGET_NOT_FOUND' } } },
      delete: { tags: ['Labels'], summary: 'Take the label off', responses: { '204': { description: 'Removed' }, '404': { description: 'LABEL_NOT_APPLIED' } } }
    },
    '/api/v1/labels/{id}/targets': { get: { tags: ['Labels'], summary: 'Everything carrying this label', description: 'Visibility is re-checked per row rather than trusted from the link table, so a label cannot surface an object the viewer lost access to.', responses: { '200': { description: 'Targets with readable titles' } } } },
    '/api/v1/labelled/{targetType}/{targetId}': { get: { tags: ['Labels'], summary: 'What is on one object, importance first', responses: { '200': { description: 'Labels on the target' } } } },
    '/api/v1/calendar-events/{id}': {
      get: { tags: ['Calendar'], summary: 'One event with participants, answers and attachments', responses: { '200': { description: 'Event detail' }, '404': { description: 'Not visible to you' } } },
      patch: { tags: ['Calendar'], summary: 'Edit the event; moving it re-asks everyone', description: 'Organiser only. Changing startAt or endAt resets every answer to invited and notifies the attendees: an answer to the old time is not an answer to the new one.', responses: { '200': { description: 'Event updated' }, '403': { description: 'Not the organiser' }, '400': { description: 'The event must end after it starts' } } },
      delete: { tags: ['Calendar'], summary: 'Cancel the event and tell the attendees', responses: { '204': { description: 'Cancelled' }, '403': { description: 'Not the organiser' } } }
    },
    '/api/v1/calendar-events/{id}/participants': { post: { tags: ['Calendar'], summary: 'Invite staff; guests are refused', responses: { '201': { description: 'Invited' }, '409': { description: 'NOT_WORKSPACE_STAFF' } } } },
    '/api/v1/calendar-events/{id}/participants/{userId}': { delete: { tags: ['Calendar'], summary: 'Remove somebody from the guest list', responses: { '204': { description: 'Removed' } } } },
    '/api/v1/calendar-events/{id}/respond': { post: { tags: ['Calendar'], summary: 'Answer an invitation: accepted, tentative or declined, with an optional note', responses: { '200': { description: 'Answer recorded with its timestamp' }, '404': { description: 'You are not invited' } } } },
    '/api/v1/calendar-events/{id}/files': { post: { tags: ['Calendar'], summary: 'Attach an already uploaded file to the event', responses: { '201': { description: 'Attached' }, '403': { description: 'Not the organiser' } } } },
    '/api/v1/calendar-invitations': { get: { tags: ['Calendar'], summary: 'Everything still awaiting this person\u2019s answer', responses: { '200': { description: 'Pending invitations' } } } },
    '/api/v1/org/units': {
      get: { tags: ['Organisation'], summary: 'The unit tree with headcount against planned seats', description: 'Readable by everyone in the workspace: knowing who runs what is the point of a chart. The response also names the units this caller may manage.', responses: { '200': { description: 'Units, canManage and managedUnitIds' }, '503': { description: 'Requires a PostgreSQL deployment' } } },
      post: { tags: ['Organisation'], summary: 'Create a department, division or team', description: 'A top-level unit needs org.structure.manage. A sub-unit may be created by whoever runs the parent, which is how a department head staffs their own department without workspace-wide rights. Depth is capped at six levels.', responses: { '201': { description: 'Unit created' }, '403': { description: 'You do not manage the parent unit' }, '409': { description: 'Depth exceeded or the name is taken among siblings' } } }
    },
    '/api/v1/org/units/{id}': {
      patch: { tags: ['Organisation'], summary: 'Rename, re-describe, move, re-plan or appoint a head', description: 'Moving a unit and changing its planned headcount reshape the company and stay with org.structure.manage. A unit admin may edit their own unit otherwise. The head must already be a member of the unit, a unit cannot move under its own descendant, and the plan cannot drop below the people already in it.', responses: { '200': { description: 'Unit updated' }, '409': { description: 'ORG_CYCLE, ORG_DEPTH_EXCEEDED, HEAD_NOT_IN_UNIT or SEAT_LIMIT_BELOW_HEADCOUNT' } } },
      delete: { tags: ['Organisation'], summary: 'Remove an empty unit', responses: { '204': { description: 'Unit removed' }, '409': { description: 'The unit still holds sub-units or people' } } }
    },
    '/api/v1/org/units/{id}/members': {
      get: { tags: ['Organisation'], summary: 'Who is in the unit, head first', responses: { '200': { description: 'Unit roster' } } },
      post: { tags: ['Organisation'], summary: 'Place a person in the unit as head, admin or member', description: 'Guests are refused: they are somebody else\u2019s employee and would make the chart lie. A planned headcount is enforced here, counted under the unit row lock so two concurrent adds cannot both take the last seat. Adding somebody already in the unit changes their role rather than consuming a seat.', responses: { '201': { description: 'Placed' }, '409': { description: 'SEAT_LIMIT_REACHED or NOT_WORKSPACE_STAFF' } } }
    },
    '/api/v1/org/units/{id}/members/{userId}': { delete: { tags: ['Organisation'], summary: 'Remove a person from the unit; removing the head clears the post', responses: { '204': { description: 'Removed' }, '404': { description: 'Not a member of this unit' } } } },
    '/api/v1/org/people/{userId}/chain': { get: { tags: ['Organisation'], summary: 'The units a person belongs to and their reporting line upwards', description: 'Derived from the tree rather than stored on the person, so moving a unit moves everyone\u2019s reporting line with it and the two can never disagree.', responses: { '200': { description: 'Units and chain' } } } },
    '/api/v1/integrations/deliveries': { get: { tags: ['Integrations'], summary: 'Delivery log, newest first. Deliveries are at-least-once: de-duplicate on the event id.', responses: { '200': { description: 'Deliveries' }, '403': { description: 'Requires integration.manage' } } } },

    // Половина работающих маршрутов не была описана вовсе: справочник людей,
    // журнал, сейф паролей, напоминания, личные пометки, дела, игры и
    // настройки компании. Спецификация, умалчивающая о половине API, хуже
    // отсутствующей — по ней судят, что в продукте есть.
    '/api/v1/me': { get: { tags: ['Auth'], summary: 'Current session with the permissions this role actually has', responses: { '200': { description: 'Session' }, '401': { description: 'Not signed in' } } } },
    '/api/v1/demo': { get: { tags: ['Workspace'], summary: 'Demonstration workspace state, when the server runs with DEMO_MODE', responses: { '200': { description: 'Demo state' } } } },
    '/api/v1/people': { get: { tags: ['People'], summary: 'Staff directory. A guest sees only the people they share a room with.', responses: { '200': { description: 'People' } } } },
    '/api/v1/people/{userId}': {
      get: { tags: ['People'], summary: 'One person: profile, units, reporting line, workload and recent activity', responses: { '200': { description: 'Person' }, '404': { description: 'Not visible' } } },
      patch: { tags: ['People'], summary: 'Edit own card, or anybody\u2019s with member.manage', responses: { '200': { description: 'Updated' }, '403': { description: 'Somebody else\u2019s card' } } },
    },
    '/api/v1/people/{userId}/activity': { get: { tags: ['People'], summary: 'What this person has been doing, from the audit trail', responses: { '200': { description: 'Activity' } } } },
    '/api/v1/people/{userId}/deactivate': { post: { tags: ['People'], summary: 'Dismiss an employee: access closes immediately, work history stays', description: 'Requires member.manage and a lower place on the role ladder. The owner and yourself cannot be dismissed.', responses: { '200': { description: 'Dismissed' }, '403': { description: 'Not allowed' } } } },
    '/api/v1/people/{userId}/reactivate': { post: { tags: ['People'], summary: 'Bring a dismissed employee back', responses: { '200': { description: 'Reinstated' }, '403': { description: 'Not allowed' } } } },
    '/api/v1/contacts': { get: { tags: ['People'], summary: 'The people this person actually deals with: shared rooms and own units', responses: { '200': { description: 'Contacts' } } } },
    '/api/v1/password-resets': { post: { tags: ['People'], summary: 'Issue a one-time password reset link for an employee', responses: { '201': { description: 'Link issued' }, '403': { description: 'Requires member.invite' } } } },
    '/api/v1/auth/password': { post: { tags: ['People'], summary: 'Change your own password; the current one is required and every other session is closed', responses: { '200': { description: 'Changed, with the number of sessions closed' }, '403': { description: 'Current password is wrong' }, '400': { description: 'The new password is too weak' } } } },
    '/api/v1/auth/sessions': { get: { tags: ['People'], summary: 'Where you are signed in: device, address and last seen', responses: { '200': { description: 'Sessions, one marked current' } } } },
    '/api/v1/auth/sessions/revoke-others': { post: { tags: ['People'], summary: 'Sign out everywhere except here', responses: { '200': { description: 'How many were closed' } } } },
    '/api/v1/auth/sessions/{id}': { delete: { tags: ['People'], summary: 'Close one of your own sessions; somebody else\'s answers 404', responses: { '200': { description: 'Closed' }, '404': { description: 'Not your session' } } } },
    '/api/v1/password-resets/request': { post: { tags: ['People'], summary: 'Ask for a reset link by email; always answers 204 so the route cannot be used to discover who works here', responses: { '204': { description: 'Request accepted, whether or not the address is ours' }, '429': { description: 'Too many requests for this address' } } } },
    '/api/v1/tasks/{id}/checklist': { post: { tags: ['Commitments'], summary: 'Add a step inside a commitment — one promise with five steps is honester than five promises', responses: { '201': { description: 'Added' }, '403': { description: 'Somebody else\'s commitment' }, '409': { description: 'A closed commitment is not reshaped' } } } },
    '/api/v1/tasks/{id}/checklist/{itemId}': { patch: { tags: ['Commitments'], summary: 'Tick a step; a collaborator may do this too', responses: { '200': { description: 'Updated' } } }, delete: { tags: ['Commitments'], summary: 'Remove a step', responses: { '200': { description: 'Removed' } } } },
    '/api/v1/tasks/{id}/collaborators': { post: { tags: ['Commitments'], summary: 'Add someone who helps: they see the task and tick steps, while the owner still answers for it', responses: { '201': { description: 'Added' }, '400': { description: 'Not staff, or a guest' } } } },
    '/api/v1/tasks/{id}/collaborators/{userId}': { delete: { tags: ['Commitments'], summary: 'Remove a collaborator; the task stops being visible to them', responses: { '200': { description: 'Removed' } } } },
    '/api/v1/tasks/{id}/dependencies': { post: { tags: ['Commitments'], summary: 'Say what this commitment waits for; a cycle is refused', responses: { '201': { description: 'Linked' }, '409': { description: 'These would wait on each other for ever' } } } },
    '/api/v1/tasks/{id}/dependencies/{dependsOn}': { delete: { tags: ['Commitments'], summary: 'Unlink', responses: { '200': { description: 'Unlinked' } } } },
    '/api/v1/tasks/report': { get: { tags: ['Commitments'], summary: 'Who keeps their word, who is overloaded, what is stuck and who asks whom', parameters: [{ name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'scope', in: 'query', schema: { type: 'string', enum: ['team', 'mine'] }, description: 'team needs task.manage.team; without it the answer is always your own numbers' }], responses: { '200': { description: 'Report' }, '400': { description: 'Unparseable range' }, '403': { description: 'Guests carry no commitments' } } } },
    '/api/v1/calendar-events/{id}/occurrences/{at}': { post: { tags: ['Calendar'], summary: 'Skip or move one occurrence of a series without touching the rule', responses: { '200': { description: 'Amended' }, '404': { description: 'The series has no meeting at that moment' }, '409': { description: 'Not a recurring event' } } }, delete: { tags: ['Calendar'], summary: 'Put a skipped or moved occurrence back in line with the series', responses: { '200': { description: 'Restored' }, '404': { description: 'This occurrence never differed from the series' } } } },
    '/api/v1/onboarding': { get: { tags: ['Daily work'], summary: 'First steps for a new colleague, derived from real state rather than ticked by hand; null when there is nothing to show', responses: { '200': { description: 'Steps, or null' } } } },
    '/api/v1/onboarding/dismiss': { post: { tags: ['Daily work'], summary: 'Hide the first-steps card for good', responses: { '200': { description: 'Hidden' } } } },
    '/api/v1/conversations/catalogue': { get: { tags: ['Messaging'], summary: 'Open channels of the workspace with purpose, size and recent activity; private channels are absent, not hidden', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' }, description: 'Matches title, slug and purpose' }], responses: { '200': { description: 'Channels' } } } },
    '/api/v1/conversations/{id}/join': { post: { tags: ['Messaging'], summary: 'Join an open channel — the way back after leaving one', responses: { '200': { description: 'Joined' }, '403': { description: 'A guest joins only where invited' }, '404': { description: 'No such open channel' } } } },
    '/api/v1/messages/{id}/versions': { get: { tags: ['Messaging'], summary: 'What the message said before each edit; visible to whoever can see the conversation', responses: { '200': { description: 'Earlier versions, newest first' }, '404': { description: 'Not visible to you' } } } },
    '/api/v1/people/{id}/access': { put: { tags: ['People'], summary: 'Limit how long somebody keeps access — chiefly a guest whose project has ended; null lifts the limit', responses: { '200': { description: 'Set' }, '409': { description: 'Not for yourself' }, '404': { description: 'Not found, or the owner' } } } },
    '/api/v1/notification-preferences': { get: { tags: ['Daily work'], summary: 'What to push and when to stay quiet; defaults to everything on', responses: { '200': { description: 'Preferences' } } }, put: { tags: ['Daily work'], summary: 'Save them; quiet hours are local to the person and need both bounds', responses: { '200': { description: 'Saved' }, '400': { description: 'Half an interval is not an interval' } } } },
    '/api/v1/digest': { get: { tags: ['Daily work'], summary: 'What happened while you were away: mentions, commitments awaiting your answer, deadlines that passed, moves made without you', parameters: [{ name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Defaults to your previous session — that is what "while I was away" means' }], responses: { '200': { description: 'Digest' }, '400': { description: 'Unparseable from' } } } },
    '/api/v1/conversations/{conversationId}/external-forwards': { post: { tags: ['Messaging'], summary: 'Bring a stretch of WhatsApp or Telegram into the conversation, keeping where it came from', description: 'The pasted text is parsed for the service lines those apps put on the clipboard, so the original author and time survive the move. Times carry no zone in an export, so they are read in the zone of whoever moves them (offsetMinutes). The whole stretch becomes one message rather than one per line.', responses: { '201': { description: 'Brought across' }, '400': { description: 'Nothing to bring' }, '413': { description: 'Too long a stretch' }, '503': { description: 'Needs a PostgreSQL deployment' } } } },
    '/api/v1/conversations/{conversationId}/archive': { get: { tags: ['Messaging'], summary: 'What the conversation holds, by kind: photos, video, links, things brought across, files, voice', parameters: [{ name: 'kind', in: 'query', schema: { type: 'string', enum: ['all', 'photo', 'video', 'link', 'forward', 'external', 'file', 'voice'] } }, { name: 'source', in: 'query', schema: { type: 'string', enum: ['whatsapp', 'telegram', 'sms', 'email', 'other'] }, description: 'Narrows to one messenger it was brought from' }, { name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'Material, newest first' }, '400': { description: 'No such kind or source' }, '404': { description: 'Conversation not visible' } } } },
    '/api/v1/calendar-events/{id}/notes': { get: { tags: ['Meetings'], summary: 'The record of a meeting that was never recorded', description: 'Transcription and review exist only for a recorded call; a meeting in a room, a site briefing or a phone call with the client went unrecorded. One record per meeting, visible to the same people as the meeting itself.', responses: { '200': { description: 'The record, or null' }, '404': { description: 'The meeting is not visible to you' } } }, put: { tags: ['Meetings'], summary: 'Write or correct it; decisions join the company-wide list', responses: { '200': { description: 'Saved' }, '404': { description: 'The meeting is not visible to you' } } } },
    '/api/v1/calendar-events/{id}/notes/commit': { post: { tags: ['Meetings'], summary: 'Turn one item of the record into a commitment', description: 'Until an item has an owner and a date it is not an agreement but a good intention.', responses: { '201': { description: 'The task' }, '404': { description: 'No such item, or no record' } } } },
    '/api/v1/meetings/decisions': { get: { tags: ['Meetings'], summary: 'Every decision taken in meetings you attended, newest first', description: 'A decision used to live inside the card of its own meeting, so recalling what was settled about a site meant recalling which meeting settled it. Only accepted proposals of the decision kind: a proposal is not yet a decision, and a rejected one never became one. Action items are tasks and are not listed here.', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' }, description: 'Matches the decision and its detail' }, { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } }], responses: { '200': { description: 'Decisions' }, '503': { description: 'Needs a PostgreSQL deployment' } } } },
    '/api/v1/stories': { get: { tags: ['Daily work'], summary: 'Stories running right now across the company, newest first', responses: { '200': { description: 'Stories' }, '404': { description: 'Guests are not told this exists' } } }, post: { tags: ['Daily work'], summary: 'Post a photo for a day; it stays in your own archive afterwards', description: 'The photo is an ordinary uploaded file, so it goes through the same checks as any attachment. hours may shorten or lengthen the life between 1 and 72.', responses: { '201': { description: 'Posted' }, '400': { description: 'Not a photo' }, '404': { description: 'No such file, or a guest asked' } } } },
    '/api/v1/stories/archive': { get: { tags: ['Daily work'], summary: 'Your own stories, including the ones that have gone out', responses: { '200': { description: 'Yours, newest first' } } } },
    '/api/v1/stories/{id}/seen': { post: { tags: ['Daily work'], summary: 'Mark that you watched it; counted once per person', responses: { '200': { description: 'Marked' } } } },
    '/api/v1/stories/{id}/viewers': { get: { tags: ['Daily work'], summary: 'Who watched — the author only; for anybody else the list is empty', responses: { '200': { description: 'Viewers' } } } },
    '/api/v1/stories/{id}': { delete: { tags: ['Daily work'], summary: 'Take your own down before it goes out', responses: { '200': { description: 'Removed' }, '404': { description: 'Not yours, or already gone' } } } },
    '/api/v1/calls/scheduled': { get: { tags: ['Calls'], summary: 'Calls scheduled with you in them, soonest first, with their topic, people and documents', parameters: [{ name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } }], responses: { '200': { description: 'Scheduled calls' }, '503': { description: 'Needs a PostgreSQL deployment' } } }, post: { tags: ['Calls'], summary: 'Schedule a call: topic, time, who is called and what to read first', description: 'A scheduled call and a calendar meeting are one event rather than two similar ones, so the conversation gets a reminder, a place in the day and an accept-or-decline of its own. Documents attach to that event.', responses: { '201': { description: 'Scheduled' }, '400': { description: 'Unparseable time, or people outside the conversation' }, '404': { description: 'No such conversation for you' } } } },
    '/api/v1/calls/{id}/cancel': { post: { tags: ['Calls'], summary: 'Call it off — only whoever scheduled it, and the calendar meeting goes with it', responses: { '200': { description: 'Cancelled' }, '403': { description: 'Somebody else scheduled this' }, '404': { description: 'Not visible to you' } } } },
    '/api/v1/auth/two-factor': { get: { tags: ['Auth'], summary: 'Whether a second factor is on, and how many recovery codes are left', responses: { '200': { description: 'State' } } }, post: { tags: ['Auth'], summary: 'Begin setting one up: a fresh secret and an otpauth link', description: 'Nothing about signing in changes until a code is confirmed, so a mistake in setup cannot lock anybody out.', responses: { '201': { description: 'Secret and link' }, '503': { description: 'Needs VAULT_KEY: the secret is sealed with it' } } }, delete: { tags: ['Auth'], summary: 'Turn it off; requires the password, because a stolen session must not be able to', responses: { '200': { description: 'Off' }, '403': { description: 'Wrong password' } } } },
    '/api/v1/auth/two-factor/confirm': { post: { tags: ['Auth'], summary: 'Confirm setup with a code and receive the recovery codes — the only time they are shown', responses: { '201': { description: 'On, with recovery codes' }, '400': { description: 'The code did not match' }, '409': { description: 'Setup was not begun, or it is already on' } } } },
    '/api/v1/auth/two-factor/recovery-codes': { post: { tags: ['Auth'], summary: 'Issue a fresh set of recovery codes, invalidating the old ones; requires the password', responses: { '201': { description: 'New codes' }, '403': { description: 'Wrong password' }, '409': { description: 'The second factor is off' } } } },
    '/api/v1/export': { get: { tags: ['Workspace'], summary: 'Everything the workspace holds as one ZIP: people, conversations, messages, commitments, calendar, audit journal and the attachments themselves', description: 'Requires organization.manage. Streamed, so no content-length: the size is known only once it is written. JSON Lines inside, one record per line. files=0 leaves the attachments out. Every attempt is written to the audit journal before the first byte leaves.', parameters: [{ name: 'files', in: 'query', schema: { type: 'string', enum: ['0', '1'] }, description: '0 exports the records without the attachments' }], responses: { '200': { description: 'The archive' }, '403': { description: 'Owner only' }, '404': { description: 'Guests are not told this exists' }, '503': { description: 'Needs a PostgreSQL deployment' } } } },
    '/api/v1/mail': { get: { tags: ['People'], summary: 'Outbound mail for this workspace: invitations and password resets, with delivery state', responses: { '200': { description: 'Recent messages' }, '403': { description: 'Requires member.invite' } } } },

    '/api/v1/workspace': { patch: { tags: ['Workspace'], summary: 'Rename the company and the workspace', description: 'Requires organization.manage \u2014 the one right that separates the owner from an administrator.', responses: { '200': { description: 'Renamed' }, '403': { description: 'Owner only' } } } },
    '/api/v1/workspace/owner': { post: { tags: ['Workspace'], summary: 'Transfer ownership; the previous owner stays on as an administrator', responses: { '200': { description: 'Transferred' }, '403': { description: 'Owner only' }, '409': { description: 'Somebody else got there first, or the person is a guest or dismissed' } } } },
    '/api/v1/audit': { get: { tags: ['Workspace'], summary: 'Workspace journal: invitations, joins, password links, vault reveals, task movement', description: 'Requires audit.read. Paged by the cursor from nextCursor; filtered by type and actor. What a reader sees depends on their standing: vault, sign-in, password and session rows are personal, so they reach only somebody with organization.manage — and every person about their own doings. A department head sees the work of the company (invitations, conversations, org units, commitments) but not who opened whose password.', responses: { '200': { description: 'Journal page' }, '403': { description: 'Requires audit.read' } } } },

    '/api/v1/reminders': {
      get: { tags: ['Personal'], summary: 'Own reminders, fired first', responses: { '200': { description: 'Reminders' } } },
      post: { tags: ['Personal'], summary: 'Set a reminder; it arrives in the attention centre at the hour asked', responses: { '201': { description: 'Reminder set' } } },
    },
    '/api/v1/reminders/{id}': {
      patch: { tags: ['Personal'], summary: 'Snooze, complete, cancel or reword a reminder', responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Personal'], summary: 'Delete a reminder', responses: { '204': { description: 'Deleted' } } },
    },
    '/api/v1/vault': {
      get: { tags: ['Personal'], summary: 'Own password vault. Secrets are never listed \u2014 only titles and logins.', responses: { '200': { description: 'Entries' }, '503': { description: 'VAULT_KEY is not configured' } } },
      post: { tags: ['Personal'], summary: 'Store a password, sealed with AES-256-GCM', responses: { '201': { description: 'Stored' } } },
    },
    '/api/v1/vault/{id}': {
      patch: { tags: ['Personal'], summary: 'Change a stored entry', responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Personal'], summary: 'Delete an entry', responses: { '204': { description: 'Deleted' } } },
    },
    '/api/v1/vault/{id}/reveal': { post: { tags: ['Personal'], summary: 'Reveal one secret. Every reveal is written to the journal.', responses: { '200': { description: 'Secret' }, '404': { description: 'Not yours' } } } },
    '/api/v1/favourites': { get: { tags: ['Personal'], summary: 'Own favourites across conversations, messages, tasks, events and files', responses: { '200': { description: 'Favourites' } } } },
    '/api/v1/favourites/{type}/{id}': {
      put: { tags: ['Personal'], summary: 'Add to favourites', responses: { '200': { description: 'Added' }, '404': { description: 'Not visible to you' } } },
      delete: { tags: ['Personal'], summary: 'Remove from favourites', responses: { '204': { description: 'Removed' } } },
    },
    '/api/v1/highlights': {
      get: { tags: ['Personal'], summary: 'Own highlighter marks over message text', responses: { '200': { description: 'Highlights' } } },
      post: { tags: ['Personal'], summary: 'Paint a fragment of a message; the mark survives reloads and is private', responses: { '201': { description: 'Highlighted' } } },
    },
    '/api/v1/highlights/{id}': { delete: { tags: ['Personal'], summary: 'Remove a highlight', responses: { '204': { description: 'Removed' } } } },
    '/api/v1/message-notes': {
      get: { tags: ['Personal'], summary: 'Own notes on messages: important, remember, ask, plain', responses: { '200': { description: 'Notes' } } },
      post: { tags: ['Personal'], summary: 'Write a note on a message', responses: { '201': { description: 'Noted' } } },
    },
    '/api/v1/message-notes/{id}': {
      patch: { tags: ['Personal'], summary: 'Reword a note', responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Personal'], summary: 'Delete a note', responses: { '204': { description: 'Deleted' } } },
    },
    '/api/v1/personal-items': {
      get: { tags: ['Personal'], summary: 'Own list of personal work, outside commitments to anybody', responses: { '200': { description: 'Items' } } },
      post: { tags: ['Personal'], summary: 'Add a personal item', responses: { '201': { description: 'Added' } } },
    },
    '/api/v1/personal-items/{id}': {
      patch: { tags: ['Personal'], summary: 'Change a personal item', responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Personal'], summary: 'Delete a personal item', responses: { '204': { description: 'Deleted' } } },
    },
    '/api/v1/labels': {
      get: { tags: ['Labels'], summary: 'Shared company vocabulary plus own personal labels', responses: { '200': { description: 'Labels' } } },
      post: { tags: ['Labels'], summary: 'Create a label. A guest may only create personal ones.', responses: { '201': { description: 'Created' }, '403': { description: 'Guests cannot touch the shared vocabulary' } } },
    },
    '/api/v1/games': {
      get: { tags: ['Games'], summary: 'Own games with colleagues', responses: { '200': { description: 'Games' } } },
      post: { tags: ['Games'], summary: 'Invite a colleague to chess, draughts or battleship', responses: { '201': { description: 'Invited' } } },
    },
    '/api/v1/knowledge': {
      get: { tags: ['Knowledge'], summary: 'Company knowledge base articles, optionally full-text searched', responses: { '200': { description: 'Articles' }, '503': { description: 'Needs a PostgreSQL deployment' } } },
      post: { tags: ['Knowledge'], summary: 'Write a new article', description: 'Owner, admin or manager only — a wrong HR answer costs more than a wrong file tag.', responses: { '201': { description: 'Created' }, '403': { description: 'Knowledge-manage permission required' } } },
    },
    '/api/v1/knowledge/ask': {
      post: { tags: ['Knowledge'], summary: 'Ask the HR bot a question', description: 'No generation: full-text search over articles, ranked, with a highlighted excerpt via ts_headline. Never invents an answer that is not in an article.', responses: { '200': { description: 'Ranked matches, possibly empty' } } },
    },
    '/api/v1/knowledge/{id}': {
      get: { tags: ['Knowledge'], summary: 'Read one article', responses: { '200': { description: 'Article' }, '404': { description: 'Not found' } } },
      patch: { tags: ['Knowledge'], summary: 'Edit an article', responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Knowledge'], summary: 'Remove an article', responses: { '200': { description: 'Removed' } } },
    },
    '/api/v1/integrations/telegram': {
      get: { tags: ['Integrations'], summary: 'List Telegram bridges for this workspace', responses: { '200': { description: 'Bridges' } } },
      post: { tags: ['Integrations'], summary: 'Link a ChatX conversation to a Telegram chat via a bot', description: 'The bot token is verified with a real getMe call and sealed the same way as a vault secret; never returned afterward.', responses: { '201': { description: 'Bridge created' }, '502': { description: 'Telegram rejected the token or the webhook registration' } } },
    },
    '/api/v1/integrations/telegram/{id}': {
      delete: { tags: ['Integrations'], summary: 'Remove a bridge and best-effort deregister its webhook', responses: { '200': { description: 'Removed' } } },
    },
    '/api/v1/integrations/telegram/webhook/{secret}': {
      post: { tags: ['Integrations'], summary: 'Telegram calls this with incoming updates', description: 'No session: authenticated by the X-Telegram-Bot-Api-Secret-Token header matching the secret Telegram was given at setWebhook time.', responses: { '200': { description: 'Accepted' }, '404': { description: 'Unknown or inactive bridge' } } },
    },
    '/api/v1/calendar/ics': {
      get: { tags: ['Calendar'], summary: 'Get (creating if needed) this person’s private calendar subscription token', responses: { '200': { description: 'Token' } } },
      post: { tags: ['Calendar'], summary: 'Regenerate the subscription token, invalidating the old link', responses: { '200': { description: 'New token' } } },
      delete: { tags: ['Calendar'], summary: 'Revoke the subscription entirely', responses: { '200': { description: 'Revoked' } } },
    },
    '/api/v1/calendar/ics/{token}': {
      get: { tags: ['Calendar'], summary: 'The .ics feed itself — what a calendar app subscribes to', description: 'No session: authenticated by the token in the URL. Emits RRULE/EXDATE/RECURRENCE-ID directly — recurrence is described, not pre-expanded, so the calendar app can expand it indefinitely.', responses: { '200': { description: 'text/calendar body' }, '404': { description: 'Unknown token' } } },
    },
    '/api/v1/api-keys': {
      get: { tags: ['API Keys'], summary: 'List this person’s own API keys', description: 'Never returns the secret itself, only its prefix, name, scope and use timestamps.', responses: { '200': { description: 'Key list' } } },
      post: { tags: ['API Keys'], summary: 'Create a new API key acting with the caller’s own permissions', description: 'The full secret is returned exactly once, in this response, and never again. Set readOnly to restrict the key to GET/HEAD requests only.', responses: { '201': { description: 'Key created; body includes the one-time secret' }, '400': { description: 'Name required' } } }
    },
    '/api/v1/api-keys/{id}': {
      delete: { tags: ['API Keys'], summary: 'Revoke an API key immediately', responses: { '200': { description: 'Revoked' }, '404': { description: 'Key not found' } } }
    },
    '/api/v1/conversations/{conversationId}/assistant/summarize': {
      post: { tags: ['Chat Assistant'], summary: 'Summarize the recent thread of a conversation', description: 'Grounded only in the fetched messages; never invents facts. Returns a short paragraph plus optional highlights. Requires a configured CHAT_ASSISTANT_PROVIDER.', responses: { '200': { description: 'Summary' }, '400': { description: 'Nothing to summarize yet' }, '404': { description: 'Conversation not visible' }, '503': { description: 'Assistant not configured' } } }
    },
    '/api/v1/conversations/{conversationId}/assistant/suggest-replies': {
      post: { tags: ['Chat Assistant'], summary: 'Draft up to three candidate replies to the last message', description: 'A suggestion only fills the composer — it is never sent on the person’s behalf. Grounded only in the fetched messages.', responses: { '200': { description: 'Reply drafts' }, '400': { description: 'Nothing to reply to yet' }, '404': { description: 'Conversation not visible' }, '503': { description: 'Assistant not configured' } } }
    }
  }
});
