BEGIN;

CREATE TABLE email_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  condition jsonb NOT NULL CHECK(jsonb_typeof(condition)='object'),
  action jsonb NOT NULL CHECK(jsonb_typeof(action)='object'),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,mailbox_id,name),
  FOREIGN KEY(organization_id,workspace_id) REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,mailbox_id) REFERENCES email_mailboxes(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,user_id)
);
CREATE INDEX email_rules_mailbox_idx ON email_rules(workspace_id,mailbox_id,created_at);

CREATE TABLE email_booking_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  message_id uuid NOT NULL,
  created_by uuid NOT NULL,
  request_key text,
  request_fingerprint text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
  timezone text NOT NULL,
  slots jsonb NOT NULL CHECK(jsonb_typeof(slots)='array' AND jsonb_array_length(slots) BETWEEN 1 AND 60),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','booked','revoked')),
  calendar_event_id uuid,
  booking_request_hash text,
  booking_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  booked_at timestamptz,
  UNIQUE(workspace_id,created_by,request_key),
  FOREIGN KEY(organization_id,workspace_id) REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,mailbox_id) REFERENCES email_mailboxes(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,message_id) REFERENCES email_messages(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,created_by) REFERENCES memberships(workspace_id,user_id),
  FOREIGN KEY(workspace_id,calendar_event_id) REFERENCES calendar_events(workspace_id,id) ON DELETE SET NULL(calendar_event_id)
);
CREATE INDEX email_booking_mailbox_idx ON email_booking_links(workspace_id,mailbox_id,created_at DESC);

COMMIT;
