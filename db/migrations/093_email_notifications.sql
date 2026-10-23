BEGIN;

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'message.created','message.mentioned','task.assigned','task.due','task.updated','task.rescheduled',
  'calendar.invited','calendar.reminder','calendar.updated','calendar.cancelled','calendar.responded',
  'review.requested','meeting.review_ready','meeting.failed','integration.disabled','call.started','call.declined','call.missed',
  'request.submitted','request.decided',
  'email.received','email.assigned','email.waiting_due','email.send_attention'
]));

ALTER TABLE email_messages ADD CONSTRAINT email_messages_mailbox_identity_key
  UNIQUE (workspace_id,mailbox_id,id);
ALTER TABLE email_send_intents ADD CONSTRAINT email_send_intents_mailbox_identity_key
  UNIQUE (workspace_id,mailbox_id,id);
ALTER TABLE email_resource_links ADD CONSTRAINT email_resource_links_exact_mailbox_fk
  FOREIGN KEY(workspace_id,mailbox_id,message_id)
  REFERENCES email_messages(workspace_id,mailbox_id,id) ON DELETE CASCADE;

ALTER TABLE notifications ADD COLUMN email_mailbox_id uuid;
ALTER TABLE notifications ADD COLUMN email_thread_id uuid;
ALTER TABLE notifications ADD COLUMN email_message_id uuid;
ALTER TABLE notifications ADD COLUMN email_send_intent_id uuid;
ALTER TABLE notifications ADD CONSTRAINT notifications_email_mailbox_fk
  FOREIGN KEY(workspace_id,email_mailbox_id)
  REFERENCES email_mailboxes(workspace_id,id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT notifications_email_thread_fk
  FOREIGN KEY(workspace_id,email_mailbox_id,email_thread_id)
  REFERENCES email_threads(workspace_id,mailbox_id,id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT notifications_email_message_fk
  FOREIGN KEY(workspace_id,email_mailbox_id,email_message_id)
  REFERENCES email_messages(workspace_id,mailbox_id,id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT notifications_email_send_intent_fk
  FOREIGN KEY(workspace_id,email_mailbox_id,email_send_intent_id)
  REFERENCES email_send_intents(workspace_id,mailbox_id,id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT notifications_email_source_kind_check
  CHECK (
    (type LIKE 'email.%' AND email_mailbox_id IS NOT NULL
      AND (email_thread_id IS NOT NULL OR email_send_intent_id IS NOT NULL))
    OR
    (type NOT LIKE 'email.%' AND email_mailbox_id IS NULL
      AND email_thread_id IS NULL AND email_message_id IS NULL AND email_send_intent_id IS NULL)
  );
CREATE INDEX notifications_email_source_idx
  ON notifications(workspace_id,recipient_user_id,email_mailbox_id,created_at DESC)
  WHERE email_mailbox_id IS NOT NULL;

COMMIT;
