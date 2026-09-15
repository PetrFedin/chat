BEGIN;

DO $$
DECLARE
  org uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  conv uuid := gen_random_uuid();
  msg uuid := gen_random_uuid();
BEGIN
  INSERT INTO organizations(id, name) VALUES (org, 'Platform Test');
  INSERT INTO workspaces(id, organization_id, name) VALUES (ws, org, 'Main');
  INSERT INTO users(id, email) VALUES (u1, 'platform-owner@example.com'), (u2, 'platform-member@example.com');
  INSERT INTO memberships(organization_id, workspace_id, user_id, role) VALUES
    (org, ws, u1, 'owner'), (org, ws, u2, 'member');
  INSERT INTO workspace_profiles(organization_id, workspace_id, user_id, display_name, email)
    VALUES (org, ws, u1, 'Owner', 'owner@example.com');

  INSERT INTO conversations(id, organization_id, workspace_id, kind, title, created_by, visibility)
    VALUES (conv, org, ws, 'channel', 'General', u1, 'workspace');
  INSERT INTO conversation_members(organization_id, workspace_id, conversation_id, user_id)
    VALUES (org, ws, conv, u1), (org, ws, conv, u2);

  INSERT INTO messages(id, organization_id, workspace_id, conversation_id, author_id, body, kind)
    VALUES (msg, org, ws, conv, u1, 'hello', 'text');
  INSERT INTO message_reactions(organization_id, workspace_id, message_id, user_id, reaction)
    VALUES (org, ws, msg, u2, '👍');

  BEGIN
    INSERT INTO files(organization_id, workspace_id, uploaded_by, name, mime_type, size_bytes, storage_key)
      VALUES (org, ws, u1, 'bad.bin', 'application/octet-stream', 0, 'bad');
    RAISE EXCEPTION 'zero byte file unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO messages(organization_id, workspace_id, conversation_id, author_id, body, kind)
      VALUES (org, ws, conv, u1, NULL, 'text');
    RAISE EXCEPTION 'blank text message unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;
