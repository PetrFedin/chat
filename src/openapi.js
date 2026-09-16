export const openapi = Object.freeze({
  openapi: '3.1.0',
  info: {
    title: 'Chat Corporate Workspace API',
    version: '0.4.0',
    description: 'Company registration, workspace identity, channels, direct messages, tasks, calendar, realtime collaboration, files, voice messages, push subscriptions and LiveKit-backed audio/video calls.'
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Auth' },
    { name: 'Workspace' },
    { name: 'Messaging' },
    { name: 'Realtime' },
    { name: 'Calls' },
    { name: 'Files' },
    { name: 'Push' }
  ],
  paths: {
    '/api/v1/auth/register-company': {
      post: { tags: ['Auth'], summary: 'Register a company and owner', responses: { '201': { description: 'Company created' } } }
    },
    '/api/v1/invitations/accept': {
      post: { tags: ['Auth', 'Workspace'], summary: 'Accept an employee invitation and create the invited account', responses: { '201': { description: 'Invitation accepted and session created' } } }
    },
    '/api/v1/auth/login': {
      post: { tags: ['Auth'], summary: 'Create an authenticated session', responses: { '200': { description: 'Authenticated' }, '401': { description: 'Invalid credentials' } } }
    },
    '/api/v1/auth/logout': {
      post: { tags: ['Auth'], summary: 'Revoke current session', responses: { '204': { description: 'Session revoked' } } }
    },
    '/api/v1/bootstrap': {
      get: { tags: ['Workspace'], summary: 'Current user, workspace and initial navigation data', responses: { '200': { description: 'Bootstrap state' } } }
    },
    '/api/v1/invitations': {
      post: { tags: ['Workspace'], summary: 'Invite an employee', responses: { '201': { description: 'Invitation created' }, '403': { description: 'Forbidden' } } }
    },
    '/api/v1/tasks': {
      get: { tags: ['Workspace'], summary: 'List tasks relevant to current user', responses: { '200': { description: 'Task list' } } },
      post: { tags: ['Workspace'], summary: 'Create a task with accountable owner and due date', responses: { '201': { description: 'Task created' } } }
    },
    '/api/v1/calendar-events': {
      get: { tags: ['Workspace'], summary: 'List calendar events', responses: { '200': { description: 'Calendar events' } } },
      post: { tags: ['Workspace'], summary: 'Create meeting, focus block, deadline or reminder', responses: { '201': { description: 'Calendar event created' } } }
    },
    '/api/v1/conversations': {
      get: { tags: ['Messaging'], summary: 'List visible conversations', responses: { '200': { description: 'Conversation list' } } },
      post: { tags: ['Messaging'], summary: 'Create a channel, group or direct conversation', responses: { '201': { description: 'Conversation created' } } }
    },
    '/api/v1/conversations/{conversationId}/messages': {
      get: { tags: ['Messaging'], summary: 'List conversation messages', responses: { '200': { description: 'Messages' } } },
      post: { tags: ['Messaging'], summary: 'Send text or structured message', responses: { '201': { description: 'Message created' } } }
    },
    '/api/v1/messages/{messageId}/reactions': {
      post: { tags: ['Messaging'], summary: 'Add or remove a reaction', responses: { '200': { description: 'Reaction state' } } }
    },
    '/api/v1/conversations/{conversationId}/read': {
      post: { tags: ['Messaging'], summary: 'Move current user read cursor', responses: { '204': { description: 'Read state updated' } } }
    },
    '/api/v1/presence': {
      post: { tags: ['Realtime'], summary: 'Set presence and custom status', responses: { '200': { description: 'Presence updated' } } }
    },
    '/api/v1/conversations/{conversationId}/calls': {
      post: { tags: ['Calls'], summary: 'Create an audio or video call bound to a conversation', responses: { '201': { description: 'Call created' }, '403': { description: 'Forbidden' } } }
    },
    '/api/v1/calls/{callId}': {
      get: { tags: ['Calls'], summary: 'Get call state, participants and recording state', responses: { '200': { description: 'Call state' }, '404': { description: 'Call not visible' } } }
    },
    '/api/v1/calls/{callId}/join': {
      post: { tags: ['Calls'], summary: 'Join call and mint short-lived LiveKit credentials', responses: { '200': { description: 'Join credentials' }, '503': { description: 'Media provider is not configured' } } }
    },
    '/api/v1/calls/{callId}/leave': {
      post: { tags: ['Calls'], summary: 'Leave the current call', responses: { '200': { description: 'Participant left' } } }
    },
    '/api/v1/calls/{callId}/media': {
      patch: { tags: ['Calls'], summary: 'Persist participant mic, camera, screen-share and connection state', responses: { '200': { description: 'Participant state updated' } } }
    },
    '/api/v1/calls/{callId}/recording-consent': {
      post: { tags: ['Calls'], summary: 'Record current participant consent before recording', responses: { '200': { description: 'Consent stored' } } }
    },
    '/api/v1/calls/{callId}/recording/start': {
      post: { tags: ['Calls'], summary: 'Start composite meeting recording after all active participants consent', responses: { '201': { description: 'Recording started' }, '409': { description: 'Consent missing or call not active' } } }
    },
    '/api/v1/calls/{callId}/recording/stop': {
      post: { tags: ['Calls'], summary: 'Stop active meeting recording and move it to processing', responses: { '200': { description: 'Recording stopped' } } }
    },
    '/api/v1/calls/{callId}/end': {
      post: { tags: ['Calls'], summary: 'End call for all participants', responses: { '200': { description: 'Call ended' }, '403': { description: 'Only creator or call manager may end' } } }
    },
    '/api/v1/files': {
      post: { tags: ['Files'], summary: 'Upload an authenticated binary file to local or S3 object storage', responses: { '201': { description: 'File stored' } } }
    },
    '/api/v1/files/{fileId}/content': {
      get: { tags: ['Files'], summary: 'Download an authenticated file', responses: { '200': { description: 'Binary file content' } } }
    },
    '/api/v1/files/{fileId}/preview': {
      get: { tags: ['Files'], summary: 'Preview supported image, PDF or text content inline', responses: { '200': { description: 'Preview content' }, '415': { description: 'Preview unavailable' } } }
    },
    '/api/v1/conversations/{conversationId}/voice': {
      post: { tags: ['Files', 'Messaging'], summary: 'Upload and send a voice message', responses: { '201': { description: 'Voice message created' } } }
    },
    '/api/v1/push-subscriptions': {
      post: { tags: ['Push'], summary: 'Register a Web Push subscription', responses: { '201': { description: 'Subscription stored' } } }
    },
    '/ws': {
      get: { tags: ['Realtime'], summary: 'WebSocket upgrade endpoint for typing, presence, call and workspace events', responses: { '101': { description: 'Switching Protocols' } } }
    }
  }
});
