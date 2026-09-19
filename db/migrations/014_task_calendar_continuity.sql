BEGIN;

ALTER TABLE calendar_events
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','cancelled')),
  ADD COLUMN task_sync text NOT NULL DEFAULT 'none'
    CHECK (task_sync IN ('none','deadline')),
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD CONSTRAINT calendar_events_lifecycle_check CHECK (
    (status='active' AND completed_at IS NULL AND cancelled_at IS NULL)
    OR (status='completed' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='cancelled' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
  ),
  ADD CONSTRAINT calendar_events_task_sync_check CHECK (
    task_sync='none'
    OR (task_sync='deadline' AND kind='deadline' AND commitment_id IS NOT NULL)
  );

CREATE UNIQUE INDEX calendar_events_task_deadline_uq
  ON calendar_events(workspace_id,commitment_id)
  WHERE task_sync='deadline' AND commitment_id IS NOT NULL;

CREATE INDEX calendar_events_task_lifecycle_idx
  ON calendar_events(workspace_id,commitment_id,status,start_at,id)
  WHERE commitment_id IS NOT NULL;

COMMIT;
