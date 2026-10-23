BEGIN;

-- One Decision register, with typed email provenance. Visibility of this
-- source is admitted through the current mailbox ACL in MeetingRepository.
ALTER TABLE decisions ADD COLUMN email_message_id uuid;
ALTER TABLE decisions ADD CONSTRAINT decisions_email_message_fk
  FOREIGN KEY(workspace_id,email_message_id)
  REFERENCES email_messages(workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE decisions DROP CONSTRAINT decisions_source_kind_check;
ALTER TABLE decisions ADD CONSTRAINT decisions_source_kind_check
  CHECK(source_kind IN ('meeting_proposal','meeting_note','email_message'));
ALTER TABLE decisions DROP CONSTRAINT decisions_check1;
ALTER TABLE decisions ADD CONSTRAINT decisions_source_position_kind_check
  CHECK (
    (source_kind='meeting_proposal' AND source_position IS NULL AND email_message_id IS NULL)
    OR (source_kind='meeting_note' AND source_position IS NOT NULL AND email_message_id IS NULL)
    OR (source_kind='email_message' AND source_position IS NULL AND email_message_id IS NOT NULL
        AND source_id=email_message_id AND call_id IS NULL AND calendar_event_id IS NULL)
  );
CREATE INDEX decisions_email_source_idx ON decisions(workspace_id,email_message_id,status)
  WHERE email_message_id IS NOT NULL;

COMMIT;
