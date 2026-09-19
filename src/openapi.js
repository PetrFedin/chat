export const openapi = Object.freeze({
  openapi: '3.1.0',
  info: {
    title: 'Chat Corporate Workspace API',
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
    { name: 'Push' }
  ],
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
    '/api/v1/search': { get: { tags: ['Search'], summary: 'Search accessible messages, conversations, tasks, files, people and calendar events', responses: { '200': { description: 'Permission-filtered search results' } } } },
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
      get: { tags: ['Messaging'], summary: 'List conversation messages', responses: { '200': { description: 'Messages' } } },
      post: { tags: ['Messaging'], summary: 'Send text or structured message and resolve supported @mentions', responses: { '201': { description: 'Message created' } } }
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
    '/api/v1/integrations/deliveries': { get: { tags: ['Integrations'], summary: 'Delivery log, newest first. Deliveries are at-least-once: de-duplicate on the event id.', responses: { '200': { description: 'Deliveries' }, '403': { description: 'Requires integration.manage' } } } }
  }
});
