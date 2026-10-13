BEGIN;

-- A Page points at canonical commitments; it never stores or owns Task state.
-- Composite foreign keys are the cross-workspace boundary even if an HTTP path
-- accidentally misses its scope predicate. Task visibility stays in Task Authority.
CREATE TABLE wiki_page_tasks (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,
  commitment_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id,commitment_id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,page_id)
    REFERENCES wiki_pages(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,commitment_id)
    REFERENCES commitments(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,linked_by)
    REFERENCES memberships(workspace_id,user_id)
);

CREATE INDEX wiki_page_tasks_task_idx
  ON wiki_page_tasks(workspace_id,commitment_id,linked_at DESC);

CREATE INDEX wiki_page_tasks_page_idx
  ON wiki_page_tasks(workspace_id,page_id,linked_at DESC);

COMMIT;
