BEGIN;

ALTER TABLE conversation_members
  ADD COLUMN archived_at timestamptz;

CREATE INDEX conversation_members_personal_state_idx
  ON conversation_members(workspace_id,user_id,archived_at,muted_until,conversation_id);

CREATE TABLE message_pins (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  message_id uuid NOT NULL,
  pinned_by uuid NOT NULL,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,message_id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,message_id)
    REFERENCES messages(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,pinned_by)
    REFERENCES memberships(workspace_id,user_id) ON DELETE RESTRICT
);

CREATE INDEX message_pins_recent_idx
  ON message_pins(workspace_id,pinned_at DESC,message_id);

CREATE TABLE message_forwards (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  forwarded_message_id uuid NOT NULL,
  source_message_id uuid NOT NULL,
  forwarded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,forwarded_message_id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,forwarded_message_id)
    REFERENCES messages(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,source_message_id)
    REFERENCES messages(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,forwarded_by)
    REFERENCES memberships(workspace_id,user_id) ON DELETE RESTRICT,
  CHECK (forwarded_message_id<>source_message_id)
);

CREATE INDEX message_forwards_source_idx
  ON message_forwards(workspace_id,source_message_id,created_at DESC);

COMMIT;
