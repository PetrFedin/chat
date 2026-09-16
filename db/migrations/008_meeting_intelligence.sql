BEGIN;

CREATE TABLE media_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('livekit')),
  provider_event_id text NOT NULL CHECK (length(btrim(provider_event_id)) > 0),
  event_type text NOT NULL CHECK (length(btrim(event_type)) > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','failed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  failed_at timestamptz,
  last_error text,
  UNIQUE(provider,provider_event_id)
);

CREATE TABLE meeting_intelligence_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  call_id uuid NOT NULL,
  recording_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','transcribing','summarizing','review_ready','failed','cancelled')),
  language text,
  transcript_provider text,
  transcript_model text,
  summary_provider text,
  summary_model text,
  source_sha256 text,
  summary_overview text,
  summary_json jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,recording_id),
  FOREIGN KEY (organization_id,workspace_id) REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,call_id) REFERENCES call_sessions(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,recording_id) REFERENCES call_recordings(workspace_id,id) ON DELETE CASCADE
);

CREATE TABLE meeting_intelligence_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('transcribe','summarize')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','dead_letter','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lock_token uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(workspace_id,run_id,kind),
  UNIQUE(workspace_id,id),
  FOREIGN KEY (organization_id,workspace_id) REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,run_id) REFERENCES meeting_intelligence_runs(workspace_id,id) ON DELETE CASCADE
);

CREATE TABLE meeting_transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  segment_index integer NOT NULL CHECK (segment_index >= 0),
  start_ms bigint NOT NULL CHECK (start_ms >= 0),
  end_ms bigint NOT NULL CHECK (end_ms >= start_ms),
  speaker_user_id uuid,
  speaker_label text,
  text text NOT NULL CHECK (length(btrim(text)) > 0),
  confidence numeric(6,5) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  language text,
  provider_segment_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,run_id,segment_index),
  FOREIGN KEY (organization_id,workspace_id) REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,run_id) REFERENCES meeting_intelligence_runs(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,speaker_user_id) REFERENCES memberships(workspace_id,user_id) ON DELETE SET NULL (speaker_user_id)
);

CREATE TABLE meeting_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  proposal_type text NOT NULL CHECK (proposal_type IN ('decision','action','risk','open_question')),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  body text,
  proposed_owner_id uuid,
  proposed_due_at timestamptz,
  confidence numeric(6,5) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected')),
  accepted_by uuid,
  accepted_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  created_commitment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  FOREIGN KEY (organization_id,workspace_id) REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,run_id) REFERENCES meeting_intelligence_runs(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,proposed_owner_id) REFERENCES memberships(workspace_id,user_id) ON DELETE SET NULL (proposed_owner_id),
  FOREIGN KEY (workspace_id,accepted_by) REFERENCES memberships(workspace_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,rejected_by) REFERENCES memberships(workspace_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,created_commitment_id) REFERENCES commitments(workspace_id,id) ON DELETE SET NULL (created_commitment_id),
  CHECK ((status='accepted' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND rejected_by IS NULL AND rejected_at IS NULL)
      OR (status='rejected' AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL AND accepted_by IS NULL AND accepted_at IS NULL)
      OR (status='proposed' AND accepted_by IS NULL AND accepted_at IS NULL AND rejected_by IS NULL AND rejected_at IS NULL)),
  CHECK (created_commitment_id IS NULL OR (proposal_type='action' AND status='accepted'))
);

CREATE TABLE meeting_proposal_sources (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  segment_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,proposal_id,segment_id),
  FOREIGN KEY (organization_id,workspace_id) REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,proposal_id) REFERENCES meeting_proposals(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,segment_id) REFERENCES meeting_transcript_segments(workspace_id,id) ON DELETE CASCADE
);

CREATE INDEX media_webhook_events_status_idx ON media_webhook_events(status,received_at);
CREATE INDEX meeting_intelligence_runs_call_idx ON meeting_intelligence_runs(workspace_id,call_id,created_at DESC);
CREATE INDEX meeting_intelligence_jobs_claim_idx ON meeting_intelligence_jobs(status,available_at,created_at) WHERE status IN ('pending','failed');
CREATE INDEX meeting_transcript_segments_run_time_idx ON meeting_transcript_segments(workspace_id,run_id,start_ms,segment_index);
CREATE INDEX meeting_transcript_segments_fts_idx ON meeting_transcript_segments USING gin(to_tsvector('simple'::regconfig,text));
CREATE INDEX meeting_proposals_run_status_idx ON meeting_proposals(workspace_id,run_id,status,proposal_type,created_at);

COMMIT;
