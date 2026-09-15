BEGIN;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (position('@' in email) > 1),
  email_verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users(lower(email));

CREATE TABLE auth_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL CHECK (length(password_hash) >= 64),
  password_salt text NOT NULL CHECK (length(password_salt) >= 16),
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz
);

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  token_hash text NOT NULL CHECK (length(token_hash) = 64),
  expires_at timestamptz NOT NULL,
  user_agent text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (token_hash),
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  endpoint text NOT NULL CHECK (length(btrim(endpoint)) > 0),
  p256dh text NOT NULL CHECK (length(btrim(p256dh)) > 0),
  auth text NOT NULL CHECK (length(btrim(auth)) > 0),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (workspace_id, user_id, endpoint),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

-- Existing installations can backfill users before these constraints are validated.
ALTER TABLE memberships
  ADD CONSTRAINT memberships_user_identity_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE conversation_members
  ADD COLUMN last_read_message_id uuid,
  ADD CONSTRAINT conversation_members_read_message_fkey
    FOREIGN KEY (workspace_id, last_read_message_id)
    REFERENCES messages(workspace_id, id)
    ON DELETE SET NULL (last_read_message_id);

CREATE UNIQUE INDEX workspace_pending_invite_email_uq
  ON workspace_invitations(workspace_id, lower(email))
  WHERE status = 'pending';
CREATE INDEX user_sessions_active_idx ON user_sessions(user_id, workspace_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions(workspace_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX messages_mentions_target_idx ON message_mentions(workspace_id, mentioned_user_id, created_at DESC);
CREATE INDEX message_receipts_user_unread_idx ON message_receipts(workspace_id, user_id, read_at) WHERE read_at IS NULL;

COMMIT;
