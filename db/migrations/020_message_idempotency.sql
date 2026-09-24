BEGIN;

-- Message idempotency belongs to the sender, not the workspace.
--
-- UNIQUE (workspace_id, client_request_id) meant a string one person chose
-- blocked a different person's send in a different conversation, and a retry
-- after a network timeout answered 409 instead of replaying the message that
-- was already stored. The key is now the sender and the room they sent to,
-- which is the scope a client can actually reason about.

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_workspace_id_client_request_id_key;
DROP INDEX IF EXISTS messages_workspace_id_client_request_id_key;

CREATE UNIQUE INDEX messages_sender_request_idx
  ON messages(workspace_id, conversation_id, author_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMIT;
