import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationKind, ConversationVisibility, MessageKind, createConversation, createMessage, deleteMessage } from '../src/domain/conversation.js';
import { WorkspaceRole, createCompanySignup, createInvitation, acceptInvitation } from '../src/domain/organization.js';
import { createFileAsset, createVoiceMessage } from '../src/domain/media.js';
import { CallMode, CallState, createCallSession, startCall, endCall, enableRecording } from '../src/domain/meeting.js';

test('company signup bootstraps owner and default channels', () => {
  const signup = createCompanySignup({
    organizationId: 'org-1', workspaceId: 'ws-1', ownerUserId: 'u-1',
    organizationName: 'Acme', ownerName: 'Petr', ownerEmail: 'petr@example.com', createdAt: '2026-09-16T00:00:00Z'
  });
  assert.equal(signup.owner.role, WorkspaceRole.OWNER);
  assert.equal(signup.bootstrapChannels.length, 2);
});

test('employee invitation is expiring and explicit', () => {
  const invite = createInvitation({ id: 'i-1', workspaceId: 'ws-1', invitedBy: 'u-1', email: 'a@example.com', role: 'member', createdAt: '2026-09-16T00:00:00Z' });
  const accepted = acceptInvitation(invite, { userId: 'u-2', now: '2026-09-16T01:00:00Z' });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.acceptedBy, 'u-2');
});

test('channels and rich message kinds are first-class', () => {
  const channel = createConversation({ id: 'c-1', workspaceId: 'ws-1', createdBy: 'u-1', participantIds: ['u-2'], kind: ConversationKind.CHANNEL, title: 'Product', visibility: ConversationVisibility.WORKSPACE });
  assert.equal(channel.kind, 'channel');
  const voice = createMessage({ id: 'm-1', workspaceId: 'ws-1', conversationId: 'c-1', authorId: 'u-1', kind: MessageKind.VOICE, metadata: { durationMs: 1200 } });
  assert.equal(voice.body, null);
  const deleted = deleteMessage(voice, { actorId: 'u-1', now: '2026-09-16T02:00:00Z' });
  assert.equal(deleted.deletedAt, '2026-09-16T02:00:00Z');
});

test('file and voice metadata validate upload boundaries', () => {
  const file = createFileAsset({ id: 'f-1', workspaceId: 'ws-1', uploadedBy: 'u-1', name: 'voice.m4a', mimeType: 'audio/mp4', sizeBytes: 1024, storageKey: 'ws-1/f-1' });
  const voice = createVoiceMessage({ id: 'v-1', workspaceId: 'ws-1', messageId: 'm-1', fileId: file.id, durationMs: 1250 });
  assert.equal(voice.durationMs, 1250);
  assert.throws(() => createFileAsset({ id: 'f-2', workspaceId: 'ws-1', uploadedBy: 'u-1', name: 'x', mimeType: 'x/x', sizeBytes: 0, storageKey: 'x' }), { code: 'INVALID_FILE_SIZE' });
});

test('video call lifecycle and recording require participant consent', () => {
  let call = createCallSession({ id: 'call-1', workspaceId: 'ws-1', conversationId: 'c-1', createdBy: 'u-1', participantIds: ['u-2'], mode: CallMode.VIDEO });
  call = startCall(call, { actorId: 'u-1', now: '2026-09-16T03:00:00Z' });
  assert.equal(call.state, CallState.ACTIVE);
  assert.throws(() => enableRecording(call, { actorId: 'u-1', consentedParticipantIds: ['u-1'] }), { code: 'RECORDING_CONSENT_REQUIRED' });
  call = enableRecording(call, { actorId: 'u-1', consentedParticipantIds: ['u-1', 'u-2'] });
  assert.equal(call.recordingStatus, 'recording');
  call = endCall(call, { actorId: 'u-2', now: '2026-09-16T03:30:00Z' });
  assert.equal(call.state, CallState.ENDED);
});
