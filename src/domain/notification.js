import { DomainError } from './commitment.js';

export const NotificationType = Object.freeze({
  MESSAGE_CREATED: 'message.created',
  MESSAGE_MENTIONED: 'message.mentioned',
  TASK_ASSIGNED: 'task.assigned',
  TASK_DUE: 'task.due',
  CALENDAR_INVITED: 'calendar.invited',
  CALENDAR_REMINDER: 'calendar.reminder',
  REVIEW_REQUESTED: 'review.requested'
});

const TYPES = new Set(Object.values(NotificationType));

function required(value, code, message) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DomainError(code, message);
  return value.trim();
}

export function notificationDedupeKey(sourceEventId, recipientUserId, type) {
  return `${sourceEventId}:${recipientUserId}:${type}`;
}

export function createNotification(input) {
  const id = required(input?.id, 'NOTIFICATION_ID_REQUIRED', 'Notification id is required');
  const workspaceId = required(input?.workspaceId, 'NOTIFICATION_WORKSPACE_REQUIRED', 'workspaceId is required');
  const sourceEventId = required(input?.sourceEventId, 'NOTIFICATION_SOURCE_REQUIRED', 'sourceEventId is required');
  const recipientUserId = required(input?.recipientUserId, 'NOTIFICATION_RECIPIENT_REQUIRED', 'recipientUserId is required');
  const type = required(input?.type, 'NOTIFICATION_TYPE_REQUIRED', 'Notification type is required');
  if (!TYPES.has(type)) throw new DomainError('NOTIFICATION_TYPE_INVALID', `Unsupported notification type: ${type}`);
  const title = required(input?.title, 'NOTIFICATION_TITLE_REQUIRED', 'Notification title is required');
  const body = required(input?.body, 'NOTIFICATION_BODY_REQUIRED', 'Notification body is required');
  const createdAt = input.createdAt ?? new Date().toISOString();
  return Object.freeze({
    id,
    workspaceId,
    dedupeKey: notificationDedupeKey(sourceEventId, recipientUserId, type),
    sourceEventId,
    recipientUserId,
    type,
    title,
    body,
    status: 'unread',
    version: 1,
    createdAt,
    readAt: null,
    readBy: null,
    updatedAt: createdAt
  });
}

export function markNotificationRead(notification, { actorId, now = new Date().toISOString() }) {
  if (actorId !== notification.recipientUserId) throw new DomainError('NOTIFICATION_RECIPIENT_REQUIRED', 'Only the recipient can mark a notification as read');
  if (notification.status === 'read') return notification;
  if (notification.status !== 'unread') throw new DomainError('NOTIFICATION_STATUS_INVALID', 'Notification status is invalid');
  return Object.freeze({
    ...notification,
    status: 'read',
    version: notification.version + 1,
    readAt: now,
    readBy: actorId,
    updatedAt: now
  });
}
