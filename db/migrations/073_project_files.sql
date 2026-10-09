BEGIN;

-- Project <-> File is a relation only. The file remains authoritative in
-- files/object storage; Project never copies file metadata, bytes or ACL state.
CREATE TABLE IF NOT EXISTS project_files (
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  file_id      uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  linked_by    uuid NOT NULL,
  linked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id,file_id)
);

CREATE INDEX IF NOT EXISTS project_files_file_idx
  ON project_files(workspace_id,file_id,linked_at DESC);

CREATE INDEX IF NOT EXISTS project_files_project_idx
  ON project_files(project_id,linked_at DESC);

COMMIT;
