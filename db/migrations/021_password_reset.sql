-- Password recovery without a mail server.
--
-- Recovery normally means «we email you a link», and this product has no
-- channel to send one: deciding on a mail provider was blocking the feature
-- entirely, and a person who forgot their password had no way back in at all.
--
-- A corporate workspace has something a consumer product does not: an
-- administrator who already knows who works here. They issue the link and
-- hand it over the way they hand over an invitation. The token is stored as a
-- hash, is single-use, and dies on a clock — the same shape as an invitation,
-- for the same reasons.
--
-- When a mail channel does arrive, self-service recovery writes rows into
-- this same table; nothing here assumes an administrator issued it.

CREATE TABLE password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  -- Who issued it. Null leaves room for a self-service request later.
  issued_by uuid,
  token_hash text NOT NULL CHECK (length(token_hash) >= 32),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','used','revoked','expired')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE,
  CHECK (expires_at > created_at),
  -- A used link records when; a pending one has not been used.
  CHECK ((status = 'used') = (used_at IS NOT NULL)),
  UNIQUE (workspace_id, token_hash)
);

-- One live link per person: issuing a second one replaces the first rather
-- than leaving two keys to the same door.
CREATE UNIQUE INDEX password_resets_one_live_idx
  ON password_resets(workspace_id, user_id)
  WHERE status = 'pending';

CREATE INDEX password_resets_expiry_idx ON password_resets(expires_at) WHERE status = 'pending';
