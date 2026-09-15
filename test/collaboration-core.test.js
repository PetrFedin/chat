import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationKind, createConversation, createMessage, editMessage } from '../src/domain/conversation.js';
import { CalendarEventKind, CalendarVisibility, createCalendarEvent, rescheduleCalendarEvent } from '../src/domain/calendar.js';
import { NotificationType, createNotification, markNotificationRead } from '../src/domain/notification.js';

test('direct conversation is exactly two people and includes creator', () => {
  const conversation = createConversation({
    id: 'chat-1', workspaceId: 'ws-1', kind: ConversationKind.DIRECT,
    createdBy: 'u-1', participantIds: ['u-2'], createdAt: '2026-09-16T00:00:00Z'
  });
  assert.deepEqual(conversation.participantIds, ['u-1', 'u-2']);
  assert.throws(() => createConversation({
    id: 'bad', workspaceId: 'ws-1', kind: ConversationKind.DIRECT,
    createdBy: 'u-1', participantIds: ['u-2', 'u-3']
  }), { code: 'DIRECT_REQUIRES_TWO_PARTICIPANTS' });
});

test('team conversation requires an explicit title', () => {
  assert.throws(() => createConversation({
    id: 'team-1', workspaceId: 'ws-1', kind: ConversationKind.TEAM,
    createdBy: 'u-1', participantIds: ['u-2']
  }), { code: 'CONVERSATION_TITLE_REQUIRED' });
});

test('message supports thread source and author-only editing', () => {
  const message = createMessage({
    id: 'msg-2', workspaceId: 'ws-1', conversationId: 'chat-1', threadRootId: 'msg-1',
    authorId: 'u-1', body: '  Working answer  ', clientRequestId: 'client-1', createdAt: '2026-09-16T00:01:00Z'
  });
  assert.equal(message.body, 'Working answer');
  assert.equal(message.threadRootId, 'msg-1');
  assert.throws(() => editMessage(message, { actorId: 'u-2', body: 'tamper' }), { code: 'MESSAGE_AUTHOR_REQUIRED' });
  const edited = editMessage(message, { actorId: 'u-1', body: 'Final answer', now: '2026-09-16T00:02:00Z' });
  assert.equal(edited.body, 'Final answer');
  assert.equal(edited.editedAt, '2026-09-16T00:02:00Z');
});

test('calendar keeps SYNTH milestone semantics but supports meetings and task blocks', () => {
  const milestone = createCalendarEvent({
    id: 'event-1', workspaceId: 'ws-1', kind: CalendarEventKind.MILESTONE,
    title: 'Approval milestone', ownerId: 'u-1', startAt: '2026-09-20T09:00:00Z',
    visibility: CalendarVisibility.WORKSPACE
  });
  assert.equal(milestone.endAt, null);
  const meeting = createCalendarEvent({
    id: 'event-2', workspaceId: 'ws-1', kind: CalendarEventKind.MEETING,
    title: 'Weekly planning', ownerId: 'u-1', participantIds: ['u-2'],
    startAt: '2026-09-20T10:00:00Z', endAt: '2026-09-20T10:30:00Z', timezone: 'Europe/Stockholm'
  });
  assert.deepEqual(meeting.participantIds, ['u-1', 'u-2']);
  assert.throws(() => createCalendarEvent({
    id: 'bad', workspaceId: 'ws-1', kind: CalendarEventKind.TASK_BLOCK,
    title: 'Broken block', ownerId: 'u-1', startAt: '2026-09-20T12:00:00Z', endAt: '2026-09-20T11:00:00Z'
  }), { code: 'INVALID_CALENDAR_RANGE' });
});

test('calendar reschedule is explicit, versioned and reasoned', () => {
  const event = createCalendarEvent({
    id: 'event-3', workspaceId: 'ws-1', kind: CalendarEventKind.FOCUS,
    title: 'Analysis', ownerId: 'u-1', startAt: '2026-09-21T09:00:00Z', endAt: '2026-09-21T10:00:00Z'
  });
  assert.throws(() => rescheduleCalendarEvent(event, {
    startAt: '2026-09-21T10:00:00Z', endAt: '2026-09-21T11:00:00Z', actorId: 'u-1'
  }), { code: 'REASON_REQUIRED' });
  const moved = rescheduleCalendarEvent(event, {
    startAt: '2026-09-21T10:00:00Z', endAt: '2026-09-21T11:00:00Z', actorId: 'u-1', reason: 'Priority changed', now: '2026-09-16T01:00:00Z'
  });
  assert.equal(moved.version, 2);
  assert.equal(moved.lastChange.previousStartAt, '2026-09-21T09:00:00Z');
});

test('notification dedupe is deterministic and read is idempotent', () => {
  const notification = createNotification({
    id: 'n-1', workspaceId: 'ws-1', sourceEventId: 'e-1', recipientUserId: 'u-2',
    type: NotificationType.MESSAGE_MENTIONED, title: 'Mention', body: 'You were mentioned', createdAt: '2026-09-16T00:03:00Z'
  });
  assert.equal(notification.dedupeKey, 'e-1:u-2:message.mentioned');
  const read = markNotificationRead(notification, { actorId: 'u-2', now: '2026-09-16T00:04:00Z' });
  assert.equal(read.status, 'read');
  assert.strictEqual(markNotificationRead(read, { actorId: 'u-2', now: '2026-09-16T00:05:00Z' }), read);
  assert.throws(() => markNotificationRead(notification, { actorId: 'u-3' }), { code: 'NOTIFICATION_RECIPIENT_REQUIRED' });
});
