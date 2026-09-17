BEGIN;

-- Meeting review is part of the same employee attention stream as messages,
-- tasks and calendar events. Extend the existing closed notification contract
-- rather than introducing a second inbox.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'message.created',
    'message.mentioned',
    'task.assigned',
    'task.due',
    'calendar.invited',
    'calendar.reminder',
    'review.requested',
    'meeting.review_ready'
  ));

CREATE INDEX call_sessions_workspace_recent_idx
  ON call_sessions(workspace_id, created_at DESC, id DESC);

CREATE INDEX notifications_meeting_review_idx
  ON notifications(workspace_id, recipient_user_id, created_at DESC)
  WHERE type='meeting.review_ready' AND archived_at IS NULL;

COMMIT;
