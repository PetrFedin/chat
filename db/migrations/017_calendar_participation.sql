BEGIN;

-- Calendar participation.
--
-- calendar_event_participants has existed since 003 with a response_status of
-- invited / accepted / tentative / declined, and nothing ever wrote a row: an
-- event had an owner and no attendees, so "this needs your confirmation"
-- had no data behind it. This migration makes participation real and lets an
-- event carry the files people actually need to read before it starts.

ALTER TABLE calendar_event_participants ADD COLUMN responded_at timestamptz;
ALTER TABLE calendar_event_participants ADD COLUMN note text;
ALTER TABLE calendar_event_participants ADD COLUMN invited_by uuid;
ALTER TABLE calendar_event_participants
  ADD CONSTRAINT calendar_event_participants_invited_by_fk
  FOREIGN KEY (workspace_id, invited_by) REFERENCES memberships(workspace_id, user_id) ON DELETE SET NULL;

-- An answer and a timestamp travel together: a status of 'accepted' with no
-- responded_at is a row nobody can audit.
ALTER TABLE calendar_event_participants
  ADD CONSTRAINT calendar_event_participants_answer_ck
  CHECK ((response_status = 'invited' AND responded_at IS NULL) OR (response_status <> 'invited' AND responded_at IS NOT NULL));

-- "What still needs my answer" is the query the day view runs on every open.
CREATE INDEX calendar_participants_pending_idx
  ON calendar_event_participants(workspace_id, user_id)
  WHERE response_status = 'invited';

CREATE TABLE calendar_event_files (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  calendar_event_id uuid NOT NULL,
  file_id uuid NOT NULL,
  added_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, calendar_event_id, file_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, calendar_event_id) REFERENCES calendar_events(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, file_id) REFERENCES files(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, added_by) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX calendar_event_files_event_idx ON calendar_event_files(workspace_id, calendar_event_id);

-- An organiser changing the time is a different fact from being invited, and
-- the people who already answered need to hear about it.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'message.created','message.mentioned',
    'task.assigned','task.due','task.updated','task.rescheduled',
    'calendar.invited','calendar.reminder','calendar.updated','calendar.cancelled','calendar.responded',
    'review.requested','meeting.review_ready'
  )
);

COMMIT;
