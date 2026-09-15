BEGIN;

CREATE TABLE conversation_members (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','moderator','member','guest')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  muted_until timestamptz,
  last_read_at timestamptz,
  PRIMARY KEY (workspace_id, conversation_id, user_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('meeting','focus','task_block','deadline','reminder','milestone','other')),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description text,
  owner_id uuid NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  timezone text NOT NULL DEFAULT 'UTC' CHECK (length(btrim(timezone)) > 0),
  all_day boolean NOT NULL DEFAULT false,
  visibility text NOT NULL DEFAULT 'participants' CHECK (visibility IN ('private','workspace','participants')),
  commitment_id uuid,
  conversation_id uuid,
  recurrence_rule text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at IS NULL OR end_at > start_at),
  CHECK (kind NOT IN ('meeting','focus','task_block') OR end_at IS NOT NULL),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, owner_id) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, commitment_id) REFERENCES commitments(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations(workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE calendar_event_participants (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  calendar_event_id uuid NOT NULL,
  user_id uuid NOT NULL,
  response_status text NOT NULL DEFAULT 'invited' CHECK (response_status IN ('invited','accepted','tentative','declined')),
  optional boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, calendar_event_id, user_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, calendar_event_id) REFERENCES calendar_events(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  source_event_id uuid NOT NULL,
  dedupe_key text NOT NULL CHECK (length(btrim(dedupe_key)) > 0),
  type text NOT NULL CHECK (type IN ('message.created','message.mentioned','task.assigned','task.due','calendar.invited','calendar.reminder','review.requested')),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  status text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','read')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  read_by uuid,
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, recipient_user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, read_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, dedupe_key)
);

CREATE INDEX conversation_members_user_idx ON conversation_members(workspace_id, user_id, conversation_id);
CREATE INDEX calendar_events_owner_time_idx ON calendar_events(workspace_id, owner_id, start_at, id);
CREATE INDEX calendar_events_time_idx ON calendar_events(workspace_id, start_at, id);
CREATE INDEX calendar_participants_user_time_idx ON calendar_event_participants(workspace_id, user_id, calendar_event_id);
CREATE INDEX notifications_recipient_status_idx ON notifications(workspace_id, recipient_user_id, status, created_at DESC, id DESC);

COMMIT;
