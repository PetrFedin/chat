BEGIN;

-- Labels: importance, tags and folders are one mechanism, not three.
--
-- "Важное / второстепенное", "#смета" and a folder named "Ремстрой" differ
-- only in how they are presented and whether one of them may apply at a time.
-- Building three separate systems would give three incompatible filters, three
-- search paths and three places to fix a bug, so they share one table and one
-- attachment table.

CREATE TABLE labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  -- 'priority' is exclusive: one importance at a time, like a radio button.
  -- 'tag' and 'folder' are additive. 'status' is a free workflow marker.
  kind text NOT NULL DEFAULT 'tag' CHECK (kind IN ('priority','tag','folder','status')),
  name text NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 60),
  colour text NOT NULL DEFAULT 'neutral'
    CHECK (colour IN ('neutral','red','amber','green','teal','blue','violet','grey')),
  -- Orders importance from most to least, and folders in the sidebar.
  position integer NOT NULL DEFAULT 0,
  parent_id uuid,
  -- A private label is a personal folder nobody else sees; a shared one is
  -- workspace vocabulary.
  owner_id uuid,
  description text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, parent_id) REFERENCES labels(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, owner_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, created_by) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

-- Shared names are unique per kind; a personal label only has to be unique to
-- its owner, so two people may each keep a folder called "Личное".
CREATE UNIQUE INDEX labels_shared_name_idx ON labels(workspace_id, kind, lower(name)) WHERE owner_id IS NULL;
CREATE UNIQUE INDEX labels_personal_name_idx ON labels(workspace_id, owner_id, kind, lower(name)) WHERE owner_id IS NOT NULL;
CREATE INDEX labels_kind_idx ON labels(workspace_id, kind, position);

CREATE TABLE label_links (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  label_id uuid NOT NULL,
  -- Polymorphic on purpose: a label must work the same on a message, a file,
  -- a task, an event and a conversation, or people will not trust it.
  target_type text NOT NULL CHECK (target_type IN ('message','file','task','event','conversation','person','note')),
  target_id uuid NOT NULL,
  applied_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, label_id, target_type, target_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, label_id) REFERENCES labels(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, applied_by) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

-- "Everything labelled X" and "what is on this object" are the two reads.
CREATE INDEX label_links_label_idx ON label_links(workspace_id, label_id, created_at DESC);
CREATE INDEX label_links_target_idx ON label_links(workspace_id, target_type, target_id);

COMMIT;
