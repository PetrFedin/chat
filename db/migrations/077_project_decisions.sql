BEGIN;

-- Project <-> Decision is a relation only.
-- Decision identity, source, acceptance/retraction and visibility remain owned
-- by canonical Decision Authority. Project membership is never an ACL grant.
CREATE TABLE project_decisions (
  project_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id,decision_id),
  FOREIGN KEY (workspace_id,project_id)
    REFERENCES projects(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,decision_id)
    REFERENCES decisions(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,linked_by)
    REFERENCES memberships(workspace_id,user_id)
);

CREATE INDEX project_decisions_decision_idx
  ON project_decisions(workspace_id,decision_id,linked_at DESC);

CREATE INDEX project_decisions_project_idx
  ON project_decisions(project_id,linked_at DESC);

COMMIT;
