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
  pf_other_ws uuid := gen_random_uuid();
  pf_foreign_file uuid := gen_random_uuid();
  pd_project uuid := gen_random_uuid();
  pd_conversation uuid := gen_random_uuid();
  pd_other_ws uuid := gen_random_uuid();
  pd_foreign_conversation uuid := gen_random_uuid();
  pdec_project uuid := gen_random_uuid();
  pdec_decision uuid := gen_random_uuid();
  pdec_other_ws uuid := gen_random_uuid();
  pdec_foreign_decision uuid := gen_random_uuid();
  wp_project uuid := gen_random_uuid();
  wp_page uuid := gen_random_uuid();
  wp_foreign_project uuid := gen_random_uuid();
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
  INSERT INTO workspaces(id,organization_id,name)
    VALUES(pf_other_ws,org,'Other workspace');
  INSERT INTO memberships(organization_id,workspace_id,user_id,role)
    VALUES(org,pf_other_ws,u1,'member');
  INSERT INTO files(id,organization_id,workspace_id,uploaded_by,name,mime_type,size_bytes,storage_key,status)
    VALUES(pf_foreign_file,org,pf_other_ws,u1,'foreign.txt','text/plain',1,'foreign-project-file','ready');
  BEGIN
    INSERT INTO project_files(project_id,workspace_id,file_id,linked_by)
      VALUES(pf_project,ws,pf_foreign_file,u1);
    RAISE EXCEPTION 'cross-workspace project file relation unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  DELETE FROM projects WHERE id=pf_project;
  IF EXISTS(SELECT 1 FROM project_files WHERE file_id=pf_file) THEN
    RAISE EXCEPTION 'project file relation did not cascade with project deletion';
  END IF;

  INSERT INTO projects(id,organization_id,workspace_id,name,owner_id,created_by)
    VALUES(pd_project,org,ws,'Project discussion invariant',u1,u1);
  INSERT INTO conversations(id,organization_id,workspace_id,kind,title,created_by,visibility)
    VALUES(pd_conversation,org,ws,'group','Project discussion',u1,'private');
  INSERT INTO project_discussions(project_id,workspace_id,conversation_id,linked_by)
    VALUES(pd_project,ws,pd_conversation,u1);
  IF NOT EXISTS(
    SELECT 1 FROM project_discussions
     WHERE project_id=pd_project AND conversation_id=pd_conversation
  ) THEN
    RAISE EXCEPTION 'project discussion relation did not persist';
  END IF;

  INSERT INTO workspaces(id,organization_id,name)
    VALUES(pd_other_ws,org,'Discussion other workspace');
  INSERT INTO conversations(id,organization_id,workspace_id,kind,title,created_by,visibility)
    VALUES(pd_foreign_conversation,org,pd_other_ws,'group','Foreign discussion',u1,'private');
  BEGIN
    INSERT INTO project_discussions(project_id,workspace_id,conversation_id,linked_by)
      VALUES(pd_project,ws,pd_foreign_conversation,u1);
    RAISE EXCEPTION 'cross-workspace project discussion relation unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  DELETE FROM conversations WHERE id=pd_conversation;
  IF EXISTS(
    SELECT 1 FROM project_discussions
     WHERE project_id=pd_project AND conversation_id=pd_conversation
  ) THEN
    RAISE EXCEPTION 'project discussion relation did not cascade with conversation deletion';
  END IF;

  -- Project <-> Decision must be a workspace-bounded relation, just like
  -- Project <-> File and Project <-> Discussion. The database itself must
  -- reject a foreign decision even if an application path regresses.
  INSERT INTO projects(id,organization_id,workspace_id,name,owner_id,created_by)
    VALUES(pdec_project,org,ws,'Project decision invariant',u1,u1);
  INSERT INTO decisions(
    id,organization_id,workspace_id,source_kind,source_id,source_position,title,
    accepted_by,accepted_at,status)
    VALUES(pdec_decision,org,ws,'meeting_note',gen_random_uuid(),0,
           'Canonical project decision',u1,now(),'active');
  INSERT INTO project_decisions(project_id,workspace_id,decision_id,linked_by)
    VALUES(pdec_project,ws,pdec_decision,u1);
  IF NOT EXISTS(
    SELECT 1 FROM project_decisions
     WHERE project_id=pdec_project AND decision_id=pdec_decision
  ) THEN
    RAISE EXCEPTION 'project decision relation did not persist';
  END IF;

  INSERT INTO workspaces(id,organization_id,name)
    VALUES(pdec_other_ws,org,'Decision other workspace');
  INSERT INTO memberships(organization_id,workspace_id,user_id,role)
    VALUES(org,pdec_other_ws,u1,'member');
  INSERT INTO decisions(
    id,organization_id,workspace_id,source_kind,source_id,source_position,title,
    accepted_by,accepted_at,status)
    VALUES(pdec_foreign_decision,org,pdec_other_ws,'meeting_note',gen_random_uuid(),0,
           'Foreign project decision',u1,now(),'active');
  BEGIN
    INSERT INTO project_decisions(project_id,workspace_id,decision_id,linked_by)
      VALUES(pdec_project,ws,pdec_foreign_decision,u1);
    RAISE EXCEPTION 'cross-workspace project decision relation unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  DELETE FROM decisions WHERE id=pdec_decision;
  IF EXISTS(
    SELECT 1 FROM project_decisions
     WHERE project_id=pdec_project AND decision_id=pdec_decision
  ) THEN
    RAISE EXCEPTION 'project decision relation did not cascade with canonical decision deletion';
  END IF;

  INSERT INTO projects(id,organization_id,workspace_id,name,owner_id,created_by)
    VALUES(wp_project,org,ws,'Wiki page relation project',u1,u1);
  INSERT INTO wiki_pages(id,organization_id,workspace_id,title,content,created_by,updated_by)
    VALUES(wp_page,org,ws,'Wiki project relation','',u1,u1);
  INSERT INTO wiki_page_projects(organization_id,workspace_id,page_id,project_id,linked_by)
    VALUES(org,ws,wp_page,wp_project,u1);
  IF NOT EXISTS(
    SELECT 1 FROM wiki_page_projects
     WHERE page_id=wp_page AND project_id=wp_project
  ) THEN
    RAISE EXCEPTION 'wiki page project relation did not persist';
  END IF;

  INSERT INTO projects(id,organization_id,workspace_id,name,owner_id,created_by)
    VALUES(wp_foreign_project,org,pdec_other_ws,'Foreign wiki relation project',u1,u1);
  BEGIN
    INSERT INTO wiki_page_projects(organization_id,workspace_id,page_id,project_id,linked_by)
      VALUES(org,ws,wp_page,wp_foreign_project,u1);
    RAISE EXCEPTION 'cross-workspace wiki page project relation unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  DELETE FROM projects WHERE id=wp_project;
  IF EXISTS(
    SELECT 1 FROM wiki_page_projects
     WHERE page_id=wp_page AND project_id=wp_project
  ) THEN
    RAISE EXCEPTION 'wiki page project relation did not cascade with project deletion';
  END IF;
END $;

ROLLBACK;
