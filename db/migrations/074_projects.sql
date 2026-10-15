BEGIN;

-- Project is a native work context. It owns project metadata and relations,
-- but never copies Task state or Calendar state.
CREATE TABLE IF NOT EXISTS projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id    uuid NOT NULL,
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  goal            text CHECK (goal IS NULL OR length(goal) <= 4000),
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('planned','active','blocked','completed','cancelled','archived')),
  visibility      text NOT NULL DEFAULT 'members'
                  CHECK (visibility IN ('members','workspace')),
  owner_id        uuid NOT NULL,
  start_at        date,
  target_at       date,
  version         integer NOT NULL DEFAULT 1,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS projects_workspace_status_idx ON projects(workspace_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(workspace_id,owner_id,status);

CREATE TABLE IF NOT EXISTS project_members (
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  user_id      uuid NOT NULL,
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('lead','member','observer')),
  added_by     uuid NOT NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id,user_id)
);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members(workspace_id,user_id,project_id);

-- A task remains authoritative in commitments/task-authority. This table is
-- only the relation between a task and one Project context.
CREATE TABLE IF NOT EXISTS project_tasks (
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL,
  commitment_id uuid NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  linked_by     uuid NOT NULL,
  linked_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id,commitment_id),
  UNIQUE (workspace_id,commitment_id)
);
CREATE INDEX IF NOT EXISTS project_tasks_project_idx ON project_tasks(project_id,linked_at);

-- Milestones are Project-owned target points. Calendar may later project them,
-- but moving a calendar event must never silently mutate a milestone.
CREATE TABLE IF NOT EXISTS project_milestones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  title        text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description  text CHECK (description IS NULL OR length(description) <= 2000),
  target_at    timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','reached','cancelled')),
  version      integer NOT NULL DEFAULT 1,
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_milestones_project_time_idx ON project_milestones(project_id,target_at);

COMMIT;
