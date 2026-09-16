BEGIN;

ALTER TABLE call_sessions
  ADD COLUMN provider text NOT NULL DEFAULT 'livekit' CHECK (provider IN ('livekit')),
  ADD COLUMN provider_room_name text,
  ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE call_participants
  ADD COLUMN last_media_at timestamptz,
  ADD COLUMN connection_state text NOT NULL DEFAULT 'invited'
    CHECK (connection_state IN ('invited','connecting','connected','reconnecting','disconnected'));

CREATE TABLE call_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  call_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'livekit' CHECK (provider IN ('livekit')),
  provider_recording_id text NOT NULL CHECK (length(btrim(provider_recording_id)) > 0),
  storage_key text NOT NULL CHECK (length(btrim(storage_key)) > 0),
  status text NOT NULL DEFAULT 'recording'
    CHECK (status IN ('recording','processing','ready','failed','cancelled')),
  started_by uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  ready_at timestamptz,
  failed_at timestamptz,
  transcript_status text NOT NULL DEFAULT 'not_requested'
    CHECK (transcript_status IN ('not_requested','queued','processing','ready','failed')),
  transcript text,
  summary_status text NOT NULL DEFAULT 'not_requested'
    CHECK (summary_status IN ('not_requested','queued','processing','ready','failed')),
  ai_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (provider, provider_recording_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, call_id) REFERENCES call_sessions(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, started_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (stopped_at IS NULL OR stopped_at >= started_at),
  CHECK (ready_at IS NULL OR ready_at >= started_at),
  CHECK (failed_at IS NULL OR failed_at >= started_at)
);

CREATE INDEX call_sessions_workspace_state_idx
  ON call_sessions(workspace_id, state, created_at DESC);
CREATE INDEX call_participants_user_state_idx
  ON call_participants(workspace_id, user_id, connection_state, call_id);
CREATE INDEX call_recordings_call_idx
  ON call_recordings(workspace_id, call_id, created_at DESC);
CREATE INDEX call_recordings_processing_idx
  ON call_recordings(status, transcript_status, summary_status, updated_at)
  WHERE status IN ('processing','ready');

COMMIT;
