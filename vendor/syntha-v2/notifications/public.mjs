import { invariant } from '../../core/errors.mjs';

const NOTIFICATION_TYPES = Object.freeze([
  'selection-submitted',
  'order-terms-accepted',
  'deal-opened',
]);

export function createNotification({
  id,
  sourceEventId,
  recipientOrganisationId,
  type,
  title,
  body,
  createdAt,
}) {
  invariant(id && sourceEventId, 'NOTIFICATION_IDENTITY_REQUIRED', 'Notification id and source event are required');
  invariant(recipientOrganisationId, 'NOTIFICATION_RECIPIENT_REQUIRED', 'Recipient organisation is required');
  invariant(NOTIFICATION_TYPES.includes(type), 'NOTIFICATION_TYPE_INVALID', 'Unsupported notification type', { type });
  invariant(typeof title === 'string' && title.trim().length > 1, 'NOTIFICATION_TITLE_REQUIRED', 'Notification title is required');
  invariant(typeof body === 'string' && body.trim().length > 1, 'NOTIFICATION_BODY_REQUIRED', 'Notification body is required');
  return Object.freeze({
    id,
    dedupeKey: notificationDedupeKey(sourceEventId, recipientOrganisationId),
    sourceEventId,
    recipientOrganisationId,
    type,
    title: title.trim(),
    body: body.trim(),
    status: 'unread',
    version: 1,
    createdAt,
    readAt: null,
    readBy: null,
    updatedAt: createdAt,
  });
}

export function markNotificationRead(notification, actorId, updatedAt) {
  invariant(notification.status === 'unread' || notification.status === 'read', 'NOTIFICATION_STATUS_INVALID', 'Notification status is invalid');
  if (notification.status === 'read') return notification;
  return Object.freeze({
    ...notification,
    status: 'read',
    readAt: updatedAt,
    readBy: actorId,
    version: notification.version + 1,
    updatedAt,
  });
}

export function notificationDedupeKey(sourceEventId, recipientOrganisationId) {
  return `${sourceEventId}:${recipientOrganisationId}`;
}
