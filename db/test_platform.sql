BEGIN;

DO $$
DECLARE
  org uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  conv uuid := gen_random_uuid();
  msg uuid := gen_random_uuid();
  pf_project uuid := gen_random_uuid();
  pf_file uuid := gen_random_uuid();
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

  INSERT INTO projects(id,organization_id,workspace_id,name,owner_id,created_by)
    VALUES(pf_project,org,ws,'Project files invariant',u1,u1);
  INSERT INTO files(id,organization_id,workspace_id,uploaded_by,name,mime_type,size_bytes,storage_key,status)
    VALUES(pf_file,org,ws,u1,'project.txt','text/plain',1,'project-file','ready');
  INSERT INTO project_files(project_id,workspace_id,file_id,linked_by)
    VALUES(pf_project,ws,pf_file,u1);
  IF NOT EXISTS(SELECT 1 FROM project_files WHERE project_id=pf_project AND file_id=pf_file) THEN
    RAISE EXCEPTION 'project file relation did not persist';
  END IF;
  DELETE FROM projects WHERE id=pf_project;
  IF EXISTS(SELECT 1 FROM project_files WHERE file_id=pf_file) THEN
    RAISE EXCEPTION 'project file relation did not cascade with project deletion';
  END IF;
END $$;

ROLLBACK;
