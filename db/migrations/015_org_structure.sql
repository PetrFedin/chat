-- Organisational structure.
--
-- Until now a company was a flat list of people with two free-text fields on
-- the profile, `title` and `department`, that no endpoint could even write.
-- A real company is a tree: departments hold divisions, divisions hold teams,
-- each unit has someone accountable for it, and headcount is planned rather
-- than discovered. This migration makes that structure a first-class object
-- so responsibility and capacity can be read off it.

CREATE TABLE org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  parent_id uuid,
  kind text NOT NULL DEFAULT 'department'
    CHECK (kind IN ('company','department','division','team','office','guild')),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  purpose text,
  -- Planned headcount. NULL means "not planned"; a number caps the members.
  seat_limit integer CHECK (seat_limit IS NULL OR seat_limit > 0),
  -- The one person accountable for the unit. Kept nullable because a unit may
  -- exist before anyone is appointed to run it.
  head_user_id uuid,
  -- Materialised depth, so a tree read needs no recursion and a cycle cannot
  -- hide behind a deep chain. The root is 0.
  depth integer NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 6),
  position integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, parent_id, name),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  -- A unit can only sit under a unit of the same workspace.
  FOREIGN KEY (workspace_id, parent_id) REFERENCES org_units(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, head_user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id, created_by) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX org_units_parent_idx ON org_units(workspace_id, parent_id, position);
CREATE UNIQUE INDEX org_units_root_name_idx ON org_units(workspace_id, name) WHERE parent_id IS NULL;

CREATE TABLE org_unit_members (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  user_id uuid NOT NULL,
  -- 'head' is the accountable person, 'admin' may run the unit's roster and
  -- invite into it, 'member' works in it. A person may belong to several
  -- units: a matrix organisation is normal, not an error.
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('head','admin','member')),
  assigned_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, unit_id, user_id),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, unit_id) REFERENCES org_units(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, assigned_by) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX org_unit_members_user_idx ON org_unit_members(workspace_id, user_id);

-- At most one head per unit, enforced by the database rather than by hope.
CREATE UNIQUE INDEX org_unit_single_head_idx ON org_unit_members(workspace_id, unit_id) WHERE role = 'head';

-- An invitation may be issued into a unit, so a unit admin can grow their own
-- team without holding workspace-wide rights.
ALTER TABLE workspace_invitations ADD COLUMN org_unit_id uuid;
ALTER TABLE workspace_invitations
  ADD CONSTRAINT workspace_invitations_unit_fk
  FOREIGN KEY (workspace_id, org_unit_id) REFERENCES org_units(workspace_id, id) ON DELETE SET NULL;
