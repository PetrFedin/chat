BEGIN;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
      'message.created',
      'message.mentioned',
      'task.assigned',
      'task.due',
      'task.updated',
      'task.rescheduled',
      'calendar.invited',
      'calendar.reminder',
      'review.requested',
      'meeting.review_ready'
    )
  );

COMMIT;
