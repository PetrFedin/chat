-- Outbound integration delivery.
--
-- outbox_events has been written since 001 and never read: six call sites
-- insert, nothing publishes. This migration gives those events a consumer, so
-- an external system can learn that a commitment moved, a meeting is ready for
-- review or a proposal was accepted, without polling the API.
--
-- The delivery row is the unit of retry. One outbox event fans out to every
-- subscribed endpoint, and each endpoint's attempts are tracked separately: a
-- customer whose receiver is down must not stall anyone else's delivery.

CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  url text NOT NULL CHECK (url ~ '^https?://'),
  -- Signing secrets must be readable to sign with, as at every webhook
  -- provider. They are returned to an admin exactly once, at creation.
  secret text NOT NULL CHECK (length(secret) >= 32),
  topics text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_delivery_at timestamptz,
  last_failure_at timestamptz,
  last_failure_reason text,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, created_by) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX webhook_endpoints_workspace_idx ON webhook_endpoints(workspace_id) WHERE enabled;

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivering', 'delivered', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 6 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  -- Claim lease, mirroring the meeting worker: a crashed dispatcher must not
  -- strand a delivery in 'delivering' for ever.
  lock_token uuid,
  locked_until timestamptz,
  response_status integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (endpoint_id, event_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX webhook_deliveries_due_idx
  ON webhook_deliveries(next_attempt_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX webhook_deliveries_endpoint_idx ON webhook_deliveries(endpoint_id, created_at DESC);

-- The publisher claims unpublished events through this index.
CREATE INDEX outbox_unpublished_created_idx ON outbox_events(created_at) WHERE published_at IS NULL;
