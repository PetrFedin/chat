BEGIN;

CREATE TABLE workspace_profiles (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  email text,
  title text,
  department text,
  avatar_url text,
  locale text NOT NULL DEFAULT 'ru',
  timezone text NOT NULL DEFAULT 'UTC',
  status_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  email text NOT NULL CHECK (position('@' in email) > 1),
  role text NOT NULL CHECK (role IN ('admin','manager','member','guest')),
  invited_by uuid NOT NULL,
  token_hash text NOT NULL CHECK (length(token_hash) >= 32),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at timestamptz NOT NULL,
  accepted_by uuid,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, invited_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  UNIQUE (workspace_id, token_hash)
);

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, created_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE TABLE team_members (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('lead','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, team_id, user_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, team_id) REFERENCES teams(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

ALTER TABLE conversations DROP CONSTRAINT conversations_kind_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_kind_check CHECK (kind IN ('direct','group','channel','team','project','task','decision','approval','control','incident','meeting','external'));
ALTER TABLE conversations
  ADD COLUMN purpose text,
  ADD COLUMN slug text,
  ADD COLUMN visibility text NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('private','workspace','organization','external')),
  ADD COLUMN announcement_only boolean NOT NULL DEFAULT false,
  ADD COLUMN archived_at timestamptz;
CREATE UNIQUE INDEX conversations_workspace_slug_uq ON conversations(workspace_id, slug) WHERE slug IS NOT NULL AND archived_at IS NULL;

ALTER TABLE messages ALTER COLUMN body DROP NOT NULL;
ALTER TABLE messages DROP CONSTRAINT messages_body_check;
ALTER TABLE messages
  ADD COLUMN kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','system','voice','file','call','task','calendar','poll')),
  ADD COLUMN reply_to_id uuid,
  ADD COLUMN scheduled_for timestamptz,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT messages_body_by_kind_check CHECK ((kind IN ('text','poll') AND body IS NOT NULL AND length(btrim(body)) > 0) OR kind NOT IN ('text','poll')),
  ADD CONSTRAINT messages_reply_workspace_fkey FOREIGN KEY (workspace_id, reply_to_id) REFERENCES messages(workspace_id, id) ON DELETE RESTRICT;

CREATE TABLE message_reactions (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  reaction text NOT NULL CHECK (length(btrim(reaction)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, message_id, user_id, reaction),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, message_id) REFERENCES messages(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE message_mentions (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  message_id uuid NOT NULL,
  mentioned_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, message_id, mentioned_user_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, message_id) REFERENCES messages(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, mentioned_user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE message_receipts (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  delivered_at timestamptz,
  read_at timestamptz,
  PRIMARY KEY (workspace_id, message_id, user_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, message_id) REFERENCES messages(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE,
  CHECK (read_at IS NULL OR delivered_at IS NOT NULL)
);

CREATE TABLE saved_messages (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, message_id, user_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, message_id) REFERENCES messages(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  uploaded_by uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  mime_type text NOT NULL CHECK (length(btrim(mime_type)) > 0),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2147483648),
  storage_key text NOT NULL CHECK (length(btrim(storage_key)) > 0),
  sha256 text,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('uploading','processing','ready','quarantined','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, storage_key),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, uploaded_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE TABLE file_links (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  file_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('message','task','calendar','meeting','project','profile')),
  entity_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, file_id, entity_type, entity_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, file_id) REFERENCES files(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, linked_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE TABLE voice_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  message_id uuid NOT NULL,
  file_id uuid NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 250 AND 3600000),
  waveform jsonb NOT NULL DEFAULT '[]'::jsonb,
  transcript_status text NOT NULL DEFAULT 'not_requested' CHECK (transcript_status IN ('not_requested','queued','processing','ready','failed')),
  transcript text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, message_id) REFERENCES messages(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, file_id) REFERENCES files(workspace_id, id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, message_id)
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','on_hold','completed','cancelled','archived')),
  start_at timestamptz,
  target_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, owner_id) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (target_at IS NULL OR start_at IS NULL OR target_at >= start_at)
);

CREATE TABLE project_members (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','lead','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, user_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

ALTER TABLE commitments
  ADD COLUMN project_id uuid,
  ADD COLUMN parent_commitment_id uuid,
  ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','low')),
  ADD COLUMN estimate_minutes integer CHECK (estimate_minutes IS NULL OR estimate_minutes > 0),
  ADD CONSTRAINT commitments_project_workspace_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT commitments_parent_workspace_fkey FOREIGN KEY (workspace_id, parent_commitment_id) REFERENCES commitments(workspace_id, id) ON DELETE RESTRICT;

CREATE TABLE task_collaborators (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  commitment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, commitment_id, user_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, commitment_id) REFERENCES commitments(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE task_dependencies (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  commitment_id uuid NOT NULL,
  depends_on_commitment_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'blocks' CHECK (kind IN ('blocks','relates_to')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, commitment_id, depends_on_commitment_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, commitment_id) REFERENCES commitments(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, depends_on_commitment_id) REFERENCES commitments(workspace_id, id) ON DELETE CASCADE,
  CHECK (commitment_id <> depends_on_commitment_id)
);

CREATE TABLE task_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  commitment_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  position integer NOT NULL DEFAULT 0,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, commitment_id) REFERENCES commitments(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, completed_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT,
  CHECK ((completed_by IS NULL AND completed_at IS NULL) OR (completed_by IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE TABLE call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  calendar_event_id uuid,
  created_by uuid NOT NULL,
  title text,
  mode text NOT NULL CHECK (mode IN ('audio','video')),
  state text NOT NULL CHECK (state IN ('scheduled','ringing','active','ended','cancelled')),
  scheduled_for timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  recording_status text NOT NULL DEFAULT 'off' CHECK (recording_status IN ('off','consent_pending','recording','processing','ready','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, calendar_event_id) REFERENCES calendar_events(workspace_id, id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id, created_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (ended_at IS NULL OR started_at IS NOT NULL),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE call_participants (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  call_id uuid NOT NULL,
  user_id uuid NOT NULL,
  joined_at timestamptz,
  left_at timestamptz,
  audio_enabled boolean NOT NULL DEFAULT true,
  video_enabled boolean NOT NULL DEFAULT true,
  screen_sharing boolean NOT NULL DEFAULT false,
  recording_consented_at timestamptz,
  PRIMARY KEY (workspace_id, call_id, user_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, call_id) REFERENCES call_sessions(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE,
  CHECK (left_at IS NULL OR joined_at IS NOT NULL),
  CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE TABLE meeting_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  calendar_event_id uuid,
  call_id uuid,
  created_by uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  notes text,
  transcript text,
  ai_summary text,
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility text NOT NULL DEFAULT 'participants' CHECK (visibility IN ('private','participants','workspace')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, calendar_event_id) REFERENCES calendar_events(workspace_id, id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id, call_id) REFERENCES call_sessions(workspace_id, id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id, created_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (calendar_event_id IS NOT NULL OR call_id IS NOT NULL)
);

CREATE TABLE user_presence (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'offline' CHECK (state IN ('online','away','busy','do_not_disturb','offline')),
  last_seen_at timestamptz,
  status_emoji text,
  status_text text,
  status_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE TABLE device_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios','android','web','desktop')),
  push_token_hash text,
  device_name text,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX workspace_invitations_email_idx ON workspace_invitations(workspace_id, lower(email), status);
CREATE INDEX team_members_user_idx ON team_members(workspace_id, user_id, team_id);
CREATE INDEX messages_scheduled_idx ON messages(workspace_id, scheduled_for) WHERE scheduled_for IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX files_workspace_created_idx ON files(workspace_id, created_at DESC, id DESC);
CREATE INDEX projects_owner_status_idx ON projects(workspace_id, owner_id, status);
CREATE INDEX commitments_project_status_idx ON commitments(workspace_id, project_id, status);
CREATE INDEX calls_conversation_created_idx ON call_sessions(workspace_id, conversation_id, created_at DESC, id DESC);
CREATE INDEX presence_state_idx ON user_presence(workspace_id, state, updated_at DESC);

COMMIT;
