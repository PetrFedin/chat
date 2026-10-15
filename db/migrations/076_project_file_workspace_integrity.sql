BEGIN;

-- The application always links a file inside the current workspace, but the
-- database must prove the same invariant. A bare project_id/file_id foreign key
-- only proves that both objects exist somewhere.
CREATE UNIQUE INDEX IF NOT EXISTS projects_workspace_id_uq
  ON projects(workspace_id,id);

CREATE UNIQUE INDEX IF NOT EXISTS files_workspace_id_uq
  ON files(workspace_id,id);

ALTER TABLE project_files
  ADD CONSTRAINT project_files_project_workspace_fk
  FOREIGN KEY(workspace_id,project_id)
  REFERENCES projects(workspace_id,id)
  ON DELETE CASCADE;

ALTER TABLE project_files
  ADD CONSTRAINT project_files_file_workspace_fk
  FOREIGN KEY(workspace_id,file_id)
  REFERENCES files(workspace_id,id)
  ON DELETE CASCADE;

COMMIT;
