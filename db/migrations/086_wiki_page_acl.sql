BEGIN;

ALTER TABLE wiki_pages
  ADD COLUMN visibility text NOT NULL DEFAULT 'workspace'
    CHECK (visibility IN ('workspace','restricted'));

CREATE TABLE wiki_page_grants (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,
  user_id uuid NOT NULL,
  access text NOT NULL CHECK (access IN ('view','edit')),
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id,user_id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,page_id)
    REFERENCES wiki_pages(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,user_id)
    REFERENCES memberships(workspace_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,granted_by)
    REFERENCES memberships(workspace_id,user_id) ON DELETE RESTRICT
);

CREATE INDEX wiki_page_grants_user_idx
  ON wiki_page_grants(workspace_id,user_id,page_id);

COMMIT;
