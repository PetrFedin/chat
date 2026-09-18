export const openapi = Object.freeze({
  openapi: '3.1.0',
  info: {
    title: 'Chat Corporate Workspace API',
    version: '0.8.0',
    description: 'Company workspace API with daily attention, permission-aware search and files, realtime messaging and calls, consent-gated recording, evidence-first meeting intelligence, governed processing recovery and versioned provider cost accounting. AI output remains proposed until explicitly confirmed by a human.'
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
      get: { tags: ['Workspace'], summary: 'List tasks relevant to current user', responses: { '200': { description: 'Task list' } } },
      post: { tags: ['Workspace'], summary: 'Create a task with accountable owner and due date', responses: { '201': { description: 'Task created' } } }
    },
    '/api/v1/calendar-events': {
      get: { tags: ['Workspace'], summary: 'List calendar events', responses: { '200': { description: 'Calendar events' } } },
      post: { tags: ['Workspace'], summary: 'Create meeting, focus block, deadline or reminder', responses: { '201': { description: 'Calendar event created' } } }
    },
    '/api/v1/conversations': {
      get: { tags: ['Messaging'], summary: 'List visible conversations with computed unread and mention counts', responses: { '200': { description: 'Conversation list' } } },
      post: { tags: ['Messaging'], summary: 'Create a channel, group or direct conversation', responses: { '201': { description: 'Conversation created' } } }
    },
    '/api/v1/conversations/{conversationId}/messages': {
      get: { tags: ['Messaging'], summary: 'List conversation messages', responses: { '200': { description: 'Messages' } } },
      post: { tags: ['Messaging'], summary: 'Send text or structured message and resolve supported @mentions', responses: { '201': { description: 'Message created' } } }
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
      post: { tags: ['Files'], summary: 'Upload an authenticated binary file to local or S3 object storage', responses: { '201': { description: 'File stored' } } }
    },
    '/api/v1/files/{fileId}/content': { get: { tags: ['Files'], summary: 'Download an authenticated and context-authorized file', responses: { '200': { description: 'Binary file content' }, '404': { description: 'File not visible' } } } },
    '/api/v1/files/{fileId}/preview': { get: { tags: ['Files'], summary: 'Preview authorized image, PDF or text content inline', responses: { '200': { description: 'Preview content' }, '404': { description: 'File not visible' }, '415': { description: 'Preview unavailable' } } } },
    '/api/v1/conversations/{conversationId}/voice': { post: { tags: ['Files', 'Messaging'], summary: 'Upload and send a voice message', responses: { '201': { description: 'Voice message created' } } } },
    '/api/v1/push-subscriptions': { post: { tags: ['Push'], summary: 'Register a Web Push subscription', responses: { '201': { description: 'Subscription stored' } } } },
    '/ws': { get: { tags: ['Realtime'], summary: 'WebSocket upgrade endpoint for typing, presence, call and workspace events', responses: { '101': { description: 'Switching Protocols' } } } }
  }
});
