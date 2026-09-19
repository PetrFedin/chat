\set ON_ERROR_STOP on

INSERT INTO organizations(id, name) VALUES ('00000000-0000-0000-0000-0000000000f1', 'Org Structure Co');
INSERT INTO workspaces(id, organization_id, name) VALUES ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'Structure WS');
INSERT INTO users(id, email) VALUES
  ('90000000-0000-0000-0000-0000000000f1', 'head@example.com'),
  ('90000000-0000-0000-0000-0000000000f2', 'staff@example.com');
INSERT INTO memberships(organization_id, workspace_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', '90000000-0000-0000-0000-0000000000f1', 'owner'),
  ('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', '90000000-0000-0000-0000-0000000000f2', 'member');

INSERT INTO org_units(id, organization_id, workspace_id, kind, name, depth, created_by) VALUES
  ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'company', 'Root', 0, '90000000-0000-0000-0000-0000000000f1');
INSERT INTO org_units(id, organization_id, workspace_id, parent_id, kind, name, seat_limit, depth, created_by) VALUES
  ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-000000000001', 'department', 'Design', 3, 1, '90000000-0000-0000-0000-0000000000f1');

DO $$
BEGIN
  -- Two departments with the same name under the same parent is a tree nobody
  -- can navigate.
  BEGIN
    INSERT INTO org_units(organization_id, workspace_id, parent_id, kind, name, depth, created_by) VALUES
      ('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-000000000001', 'department', 'Design', 1, '90000000-0000-0000-0000-0000000000f1');
    RAISE EXCEPTION 'expected a duplicate sibling name to be rejected';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- NULL parents never compare equal, so the composite key alone leaves the
  -- root unguarded; a partial index closes it.
  BEGIN
    INSERT INTO org_units(organization_id, workspace_id, kind, name, depth, created_by) VALUES
      ('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'company', 'Root', 0, '90000000-0000-0000-0000-0000000000f1');
    RAISE EXCEPTION 'expected a duplicate top-level name to be rejected';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- A unit that is its own parent is not a tree.
  BEGIN
    UPDATE org_units SET parent_id = id WHERE id = 'f0000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'expected a self-parented unit to be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Depth is bounded so a runaway move cannot build an unreadable chart.
  BEGIN
    INSERT INTO org_units(organization_id, workspace_id, parent_id, kind, name, depth, created_by) VALUES
      ('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-000000000002', 'team', 'Too deep', 7, '90000000-0000-0000-0000-0000000000f1');
    RAISE EXCEPTION 'expected a unit deeper than six levels to be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A planned headcount of zero or less is not a plan.
  BEGIN
    INSERT INTO org_units(organization_id, workspace_id, parent_id, kind, name, seat_limit, depth, created_by) VALUES
      ('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-000000000001', 'team', 'Zero seats', 0, 1, '90000000-0000-0000-0000-0000000000f1');
    RAISE EXCEPTION 'expected a non-positive seat limit to be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO org_unit_members(organization_id, workspace_id, unit_id, user_id, role, assigned_by) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-0000000000f1', 'head', '90000000-0000-0000-0000-0000000000f1');

DO $$
BEGIN
  -- Exactly one accountable person per unit, enforced by the database.
  BEGIN
    INSERT INTO org_unit_members(organization_id, workspace_id, unit_id, user_id, role, assigned_by) VALUES
      ('00000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-0000000000f2', 'head', '90000000-0000-0000-0000-0000000000f1');
    RAISE EXCEPTION 'expected a second head of the same unit to be rejected';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- A unit still holding sub-units cannot be dropped silently.
  BEGIN
    DELETE FROM org_units WHERE id = 'f0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'expected deleting a parent unit to be restricted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;
