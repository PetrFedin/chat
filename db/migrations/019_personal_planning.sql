BEGIN;

-- Personal planning: notes, to-dos and screenshots.
--
-- `commitments` models an obligation BETWEEN people: one accountable owner who
-- explicitly accepted it, a designated acceptor, an evidence gate before
-- review. That machinery is the product's core value and it must not be
-- weakened — but it is the wrong shape for "buy a cable", "read this" or a
-- screenshot pasted to look at later. Nobody promised those to anybody, there
-- is no acceptor, and an evidence gate only gets in the way.
--
-- So personal work is its own table. Importance, tags and folders come from
-- the labels of migration 018 through target_type 'note'; nothing about
-- priority is duplicated here.

CREATE TABLE personal_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'todo' CHECK (kind IN ('todo','note','screenshot','link')),
  title text NOT NULL CHECK (length(btrim(title)) > 0 AND length(title) <= 240),
  body text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  -- A plan has a shape: a deadline, or a window to do it in, or neither.
  due_at timestamptz,
  planned_start timestamptz,
  planned_end timestamptz,
  -- Linking to the calendar is optional and one-way: deleting the block does
  -- not delete the plan.
  calendar_event_id uuid,
  -- Manual ordering inside the list, independent of any date.
  position integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_end IS NULL OR planned_start IS NOT NULL),
  CHECK (planned_end IS NULL OR planned_end > planned_start),
  -- A finished item records when; an unfinished one must not pretend to.
  CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, owner_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, calendar_event_id) REFERENCES calendar_events(workspace_id, id) ON DELETE SET NULL (calendar_event_id)
);

-- The list is always "mine, open first, in my order".
CREATE INDEX personal_items_owner_idx ON personal_items(workspace_id, owner_id, status, position, created_at DESC);
CREATE INDEX personal_items_due_idx ON personal_items(workspace_id, owner_id, due_at) WHERE status = 'open';

CREATE TABLE personal_item_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, item_id) REFERENCES personal_items(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, author_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX personal_item_comments_item_idx ON personal_item_comments(workspace_id, item_id, created_at);

-- A note is often just the screenshot; the file is the content, not decoration.
CREATE TABLE personal_item_files (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  file_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, item_id, file_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, item_id) REFERENCES personal_items(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, file_id) REFERENCES files(workspace_id, id) ON DELETE CASCADE
);

COMMIT;
