BEGIN;

-- CHATX Project Planning v1. Planning is owned by Project Authority; the
-- canonical Task, Calendar, Conversation, Decision and File records never move.
-- 085-087 are reserved for the independent Page draft stack.
-- PostgreSQL requires a unique referenced key for composite workspace/project FKs.
CREATE UNIQUE INDEX IF NOT EXISTS projects_workspace_plan_fk_uq
  ON projects(workspace_id,id);

CREATE TABLE project_plan_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  start_at date NOT NULL,
  end_at date NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_at <= end_at),
  UNIQUE (workspace_id,project_id,id),
  FOREIGN KEY (workspace_id,project_id)
    REFERENCES projects(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX project_plan_phases_project_dates_idx
  ON project_plan_phases(workspace_id,project_id,start_at,end_at);

-- Composite keys ensure cross-project and cross-tenant task IDs cannot be
-- linked through a planning row, even in manually constructed SQL.
CREATE UNIQUE INDEX project_tasks_workspace_plan_fk_uq
  ON project_tasks(workspace_id,project_id,commitment_id);

CREATE TABLE project_plan_tasks (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  phase_id uuid,
  planned_start date NOT NULL,
  planned_end date NOT NULL,
  estimate_minutes integer NOT NULL DEFAULT 0 CHECK (estimate_minutes BETWEEN 0 AND 1000000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id,task_id),
  CHECK (planned_start <= planned_end),
  FOREIGN KEY (workspace_id,project_id,task_id)
    REFERENCES project_tasks(workspace_id,project_id,commitment_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,project_id,phase_id)
    REFERENCES project_plan_phases(workspace_id,project_id,id) ON DELETE SET NULL (phase_id)
);
CREATE INDEX project_plan_tasks_dates_idx
  ON project_plan_tasks(workspace_id,project_id,planned_start,planned_end);

CREATE TABLE project_plan_dependencies (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  predecessor_task_id uuid NOT NULL,
  successor_task_id uuid NOT NULL,
  lag_days integer NOT NULL DEFAULT 0 CHECK (lag_days BETWEEN 0 AND 365),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id,predecessor_task_id,successor_task_id),
  CHECK (predecessor_task_id <> successor_task_id),
  FOREIGN KEY (workspace_id,project_id,predecessor_task_id)
    REFERENCES project_tasks(workspace_id,project_id,commitment_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,project_id,successor_task_id)
    REFERENCES project_tasks(workspace_id,project_id,commitment_id) ON DELETE CASCADE
);
CREATE INDEX project_plan_dependencies_successor_idx
  ON project_plan_dependencies(workspace_id,project_id,successor_task_id);

COMMIT;
