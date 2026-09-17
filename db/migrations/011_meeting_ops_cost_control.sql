BEGIN;

-- Pricing is append-only and versioned. A new tariff creates a new version instead of
-- mutating historical provider usage or previous price assumptions.
CREATE TABLE meeting_price_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  provider text NOT NULL CHECK (length(btrim(provider)) > 0),
  model text NOT NULL CHECK (length(btrim(model)) > 0),
  kind text NOT NULL CHECK (kind IN ('transcribe','summarize')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  effective_from timestamptz NOT NULL,
  source_ref text,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,provider,model,kind,effective_from),
  FOREIGN KEY (organization_id,workspace_id) REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,created_by) REFERENCES memberships(workspace_id,user_id) ON DELETE RESTRICT
);

CREATE TABLE meeting_price_items (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  price_version_id uuid NOT NULL,
  metric_name text NOT NULL CHECK (metric_name ~ '^[a-z][a-z0-9_]{0,63}$'),
  usage_path text NOT NULL CHECK (usage_path ~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$'),
  unit_quantity numeric(24,8) NOT NULL CHECK (unit_quantity > 0),
  unit_price numeric(24,10) NOT NULL CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,price_version_id,metric_name),
  UNIQUE(workspace_id,price_version_id,usage_path),
  FOREIGN KEY (organization_id,workspace_id) REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,price_version_id) REFERENCES meeting_price_versions(workspace_id,id) ON DELETE CASCADE
);

CREATE INDEX meeting_price_versions_lookup_idx
  ON meeting_price_versions(workspace_id,provider,model,kind,effective_from DESC,created_at DESC);

-- Manual job recovery remains an action on the existing durable job. No parallel retry
-- queue is introduced. Audit events record who re-opened the retry budget and why.
CREATE INDEX meeting_jobs_ops_idx
  ON meeting_intelligence_jobs(workspace_id,status,updated_at DESC,id)
  WHERE status IN ('failed','dead_letter','processing');

CREATE INDEX meeting_job_audit_idx
  ON audit_events(workspace_id,aggregate_type,aggregate_id,created_at DESC,sequence DESC)
  WHERE aggregate_type='meeting_job';

COMMIT;
