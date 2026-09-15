BEGIN;

-- Close cross-workspace reference paths that a single-column UUID FK would otherwise allow.
ALTER TABLE messages
  ADD CONSTRAINT messages_workspace_id_id_key UNIQUE (workspace_id, id);

ALTER TABLE messages
  DROP CONSTRAINT messages_thread_root_id_fkey,
  ADD CONSTRAINT messages_thread_root_workspace_fkey
    FOREIGN KEY (workspace_id, thread_root_id)
    REFERENCES messages(workspace_id, id)
    ON DELETE RESTRICT;

ALTER TABLE commitments
  DROP CONSTRAINT commitments_source_message_id_fkey,
  ADD CONSTRAINT commitments_source_message_workspace_fkey
    FOREIGN KEY (workspace_id, source_message_id)
    REFERENCES messages(workspace_id, id)
    ON DELETE RESTRICT;

COMMIT;
