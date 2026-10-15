BEGIN;

-- Page -> Decision is a reference. Acceptance, retraction, provenance and
-- participant-scoped visibility are always owned by Decision Authority.
CREATE TABLE wiki_page_decisions (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, decision_id),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, page_id)
    REFERENCES wiki_pages(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, decision_id)
    REFERENCES decisions(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, linked_by)
    REFERENCES memberships(workspace_id, user_id)
);

CREATE INDEX wiki_page_decisions_page_idx
  ON wiki_page_decisions(workspace_id, page_id, linked_at DESC);
CREATE INDEX wiki_page_decisions_decision_idx
  ON wiki_page_decisions(workspace_id, decision_id, linked_at DESC);

COMMIT;
