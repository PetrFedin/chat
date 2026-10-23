BEGIN;

-- Product email is separate from the system invitation/reset mail_messages queue.
CREATE TABLE email_workspace_locks (
  workspace_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE email_mailboxes (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('personal','shared')),
  address text NOT NULL,
  provider_id text NOT NULL,
  deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  UNIQUE (workspace_id,id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,owner_id)
    REFERENCES memberships(workspace_id,user_id)
);

CREATE TABLE email_mailbox_members (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('reader','responder','manager')),
  revoked_at timestamptz,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  UNIQUE (workspace_id,mailbox_id,user_id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,mailbox_id)
    REFERENCES email_mailboxes(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,user_id)
    REFERENCES memberships(workspace_id,user_id)
);

CREATE TABLE email_threads (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  UNIQUE (workspace_id,id),
  UNIQUE (workspace_id,mailbox_id,id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,mailbox_id)
    REFERENCES email_mailboxes(workspace_id,id) ON DELETE CASCADE
);

CREATE TABLE email_messages (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  provider_message_id text,
  internet_message_id text,
  raw_sha256 text,
  raw_mime bytea,
  deleted_at timestamptz,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  UNIQUE (workspace_id,id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,mailbox_id,thread_id)
    REFERENCES email_threads(workspace_id,mailbox_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX email_messages_provider_idx
  ON email_messages(workspace_id,mailbox_id,provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX email_messages_reference_idx
  ON email_messages(workspace_id,mailbox_id,internet_message_id);
CREATE INDEX email_messages_thread_idx
  ON email_messages(workspace_id,thread_id);

CREATE TABLE email_drafts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  thread_id uuid,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  UNIQUE (workspace_id,id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,mailbox_id)
    REFERENCES email_mailboxes(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,mailbox_id,thread_id)
    REFERENCES email_threads(workspace_id,mailbox_id,id)
);

CREATE TABLE email_notes (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  author_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('internal','private')),
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,mailbox_id,thread_id)
    REFERENCES email_threads(workspace_id,mailbox_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,author_id)
    REFERENCES memberships(workspace_id,user_id)
);

CREATE TABLE email_waiting (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  controller_id uuid NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,mailbox_id,thread_id)
    REFERENCES email_threads(workspace_id,mailbox_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,controller_id)
    REFERENCES memberships(workspace_id,user_id)
);

CREATE TABLE email_labels (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE email_templates (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE email_preferences (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  UNIQUE (workspace_id,user_id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,user_id)
    REFERENCES memberships(workspace_id,user_id)
);

-- Protected bytes belong to email until an explicit canonical File disclosure.
-- They are never registered as workspace-wide files or in the generic file search.
CREATE TABLE email_attachments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  content bytea,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  UNIQUE (workspace_id,id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,mailbox_id)
    REFERENCES email_mailboxes(workspace_id,id) ON DELETE CASCADE
);

CREATE TABLE email_resource_links (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  message_id uuid NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('task','event','page','decision')),
  resource_id uuid NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  UNIQUE (workspace_id,message_id,resource_kind,resource_id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,mailbox_id)
    REFERENCES email_mailboxes(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,message_id)
    REFERENCES email_messages(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX email_resource_links_inverse_idx
  ON email_resource_links(workspace_id,resource_kind,resource_id);

CREATE TABLE email_commands (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_key text NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  UNIQUE (workspace_id,actor_id,command_key),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE email_send_intents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN
    ('queued','scheduled','dispatching','provider_accepted','unknown_outcome','failed','cancelled')),
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object'),
  UNIQUE (workspace_id,id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,mailbox_id)
    REFERENCES email_mailboxes(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,draft_id)
    REFERENCES email_drafts(workspace_id,id)
);
CREATE INDEX email_send_intents_work_idx
  ON email_send_intents(status,workspace_id);

COMMIT;
