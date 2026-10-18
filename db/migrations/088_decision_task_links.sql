BEGIN;

-- Canonical Decision and Task own all state; this table stores references only.
CREATE TABLE decision_task_links (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  commitment_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  PRIMARY KEY (decision_id, commitment_id),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, decision_id)
    REFERENCES decisions(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, commitment_id)
    REFERENCES commitments(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, linked_by)
    REFERENCES memberships(workspace_id, user_id)
);
CREATE INDEX decision_task_links_decision_idx
  ON decision_task_links(workspace_id,decision_id,linked_at DESC);
CREATE INDEX decision_task_links_task_idx
  ON decision_task_links(workspace_id,commitment_id,linked_at DESC);

COMMIT;
