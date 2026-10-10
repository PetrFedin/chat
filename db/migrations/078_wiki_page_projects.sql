BEGIN;

-- Pages may reference Projects, but neither side owns the other.
-- Project visibility remains canonical in Project Authority; this table is only
-- a workspace-bounded relation with provenance.
CREATE TABLE wiki_page_projects (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,
  project_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id,project_id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,page_id)
    REFERENCES wiki_pages(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,project_id)
    REFERENCES projects(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,linked_by)
    REFERENCES memberships(workspace_id,user_id)
);

CREATE INDEX wiki_page_projects_project_idx
  ON wiki_page_projects(workspace_id,project_id,linked_at DESC);

CREATE INDEX wiki_page_projects_page_idx
  ON wiki_page_projects(page_id,linked_at DESC);

COMMIT;
