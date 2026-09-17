BEGIN;

-- Keep the review/archive recording separate from the media optimized for speech-to-text.
-- The sidecar is optional: existing recordings continue to use storage_key as the source.
ALTER TABLE call_recordings
  ADD COLUMN transcription_provider_recording_id text,
  ADD COLUMN transcription_storage_key text,
  ADD COLUMN transcription_source_status text NOT NULL DEFAULT 'not_requested'
    CHECK (transcription_source_status IN ('not_requested','recording','processing','ready','failed')),
  ADD COLUMN transcription_source_error text,
  ADD CONSTRAINT call_recordings_transcription_source_shape_check CHECK (
    (transcription_provider_recording_id IS NULL
      AND transcription_storage_key IS NULL
      AND transcription_source_status = 'not_requested')
    OR
    (transcription_provider_recording_id IS NOT NULL
      AND length(btrim(transcription_provider_recording_id)) > 0
      AND transcription_storage_key IS NOT NULL
      AND length(btrim(transcription_storage_key)) > 0
      AND transcription_source_status <> 'not_requested')
  );

CREATE UNIQUE INDEX call_recordings_transcription_provider_id_uq
  ON call_recordings(provider, transcription_provider_recording_id)
  WHERE transcription_provider_recording_id IS NOT NULL;

CREATE INDEX call_recordings_transcription_source_idx
  ON call_recordings(workspace_id, transcription_source_status, updated_at)
  WHERE transcription_provider_recording_id IS NOT NULL;

-- Provider attempts duplicate run/kind for efficient operational queries. Bind those values
-- back to the exact durable job so telemetry can never claim a different run or job family.
ALTER TABLE meeting_intelligence_jobs
  ADD CONSTRAINT meeting_intelligence_jobs_provider_call_identity_uq
  UNIQUE(workspace_id,run_id,id,kind);

-- One row per actual external provider attempt. This deliberately stores provider-reported
-- usage rather than a hard-coded money amount: historical cost can later be calculated
-- against a versioned price catalog without rewriting the source measurement.
CREATE TABLE meeting_provider_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  job_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('transcribe','summarize')),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider text NOT NULL CHECK (length(btrim(provider)) > 0),
  model text NOT NULL CHECK (length(btrim(model)) > 0),
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','succeeded','failed')),
  provider_request_id text,
  input_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  usage jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  latency_ms bigint CHECK (latency_ms IS NULL OR latency_ms >= 0),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,job_id,attempt_number),
  FOREIGN KEY (organization_id,workspace_id) REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,run_id,job_id,kind)
    REFERENCES meeting_intelligence_jobs(workspace_id,run_id,id,kind) ON DELETE CASCADE,
  CHECK (
    (status='started' AND finished_at IS NULL AND latency_ms IS NULL AND error_code IS NULL AND error_message IS NULL)
    OR
    (status='succeeded' AND finished_at IS NOT NULL AND latency_ms IS NOT NULL AND error_code IS NULL AND error_message IS NULL)
    OR
    (status='failed' AND finished_at IS NOT NULL AND latency_ms IS NOT NULL)
  )
);

CREATE INDEX meeting_provider_calls_run_idx
  ON meeting_provider_calls(workspace_id,run_id,started_at,id);
CREATE INDEX meeting_provider_calls_provider_idx
  ON meeting_provider_calls(provider,model,kind,started_at);
CREATE INDEX meeting_provider_calls_failed_idx
  ON meeting_provider_calls(workspace_id,started_at DESC)
  WHERE status='failed';

COMMIT;
