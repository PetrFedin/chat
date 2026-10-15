BEGIN;

-- Project <-> Discussion is a relation only.
-- Conversation membership, visibility, messages, archive state and moderation
-- remain owned by Conversation Authority.
CREATE TABLE IF NOT EXISTS project_discussions (
  project_id      uuid NOT NULL,
  workspace_id    uuid NOT NULL,
  conversation_id uuid NOT NULL,
  linked_by       uuid NOT NULL,
  linked_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id,conversation_id),
  FOREIGN KEY (workspace_id,project_id)
    REFERENCES projects(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,conversation_id)
    REFERENCES conversations(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,linked_by)
    REFERENCES memberships(workspace_id,user_id)
);

CREATE INDEX IF NOT EXISTS project_discussions_conversation_idx
  ON project_discussions(workspace_id,conversation_id,linked_at DESC);

CREATE INDEX IF NOT EXISTS project_discussions_project_idx
  ON project_discussions(project_id,linked_at DESC);

COMMIT;
