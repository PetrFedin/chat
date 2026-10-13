BEGIN;

-- Page <-> Channel is a reference only, not message duplication or re-sharing.
-- Workspace-composite foreign keys defend against cross-tenant UUID injection.
-- Conversation membership, archival and metadata remain Conversation Authority.
CREATE TABLE wiki_page_channels (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id,conversation_id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,page_id)
    REFERENCES wiki_pages(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,conversation_id)
    REFERENCES conversations(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,linked_by)
    REFERENCES memberships(workspace_id,user_id)
);

CREATE INDEX wiki_page_channels_channel_idx
  ON wiki_page_channels(workspace_id,conversation_id,linked_at DESC);

CREATE INDEX wiki_page_channels_page_idx
  ON wiki_page_channels(workspace_id,page_id,linked_at DESC);

COMMIT;
