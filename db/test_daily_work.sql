BEGIN;

DO $$
DECLARE
  org uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  conv uuid := gen_random_uuid();
  msg uuid := gen_random_uuid();
  file_uuid uuid := gen_random_uuid();
  source_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO organizations(id,name) VALUES (org,'Daily Work Test');
  INSERT INTO workspaces(id,organization_id,name) VALUES (ws,org,'Main');
  INSERT INTO users(id,email) VALUES
    (owner_id,'dw-owner@example.com'),
    (member_id,'dw-member@example.com'),
    (outsider_id,'dw-outsider@example.com');
  INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES
    (org,ws,owner_id,'owner'),
    (org,ws,member_id,'member'),
    (org,ws,outsider_id,'member');
  INSERT INTO workspace_profiles(organization_id,workspace_id,user_id,display_name,email) VALUES
    (org,ws,owner_id,'Daily Owner','dw-owner@example.com'),
    (org,ws,member_id,'Daily Member','dw-member@example.com'),
    (org,ws,outsider_id,'Daily Outsider','dw-outsider@example.com');

  INSERT INTO conversations(id,organization_id,workspace_id,kind,title,created_by,visibility)
    VALUES (conv,org,ws,'group','Private Daily Work',owner_id,'private');
  INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role) VALUES
    (org,ws,conv,owner_id,'owner'),
    (org,ws,conv,member_id,'member');

  INSERT INTO messages(id,organization_id,workspace_id,conversation_id,author_id,body,kind)
    VALUES (msg,org,ws,conv,member_id,'@dw-owner decision needed','text');
  INSERT INTO message_mentions(organization_id,workspace_id,message_id,mentioned_user_id)
    VALUES (org,ws,msg,owner_id);

  INSERT INTO files(id,organization_id,workspace_id,uploaded_by,name,mime_type,size_bytes,storage_key,status)
    VALUES (file_uuid,org,ws,member_id,'daily-review.txt','text/plain',42,'daily/review.txt','ready');
  INSERT INTO file_links(organization_id,workspace_id,file_id,entity_type,entity_id,linked_by)
    VALUES (org,ws,file_uuid,'message',msg,member_id);

  INSERT INTO notifications(
    organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body,
    actor_user_id,conversation_id,message_id,url,priority)
  VALUES (
    org,ws,owner_id,source_id,'dw:mention:1','message.mentioned','Mention','Decision needed',
    member_id,conv,msg,'/#/chats/test','high');

  IF NOT EXISTS (
    SELECT 1 FROM notifications
    WHERE workspace_id=ws AND recipient_user_id=owner_id AND actor_user_id=member_id
      AND conversation_id=conv AND message_id=msg AND priority='high'
  ) THEN
    RAISE EXCEPTION 'daily notification projection columns did not persist';
  END IF;

  BEGIN
    INSERT INTO notifications(
      organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body,priority)
    VALUES (org,ws,owner_id,gen_random_uuid(),'dw:bad-priority','message.created','Bad','Bad','critical');
    RAISE EXCEPTION 'invalid notification priority unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO notifications(
      organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body)
    VALUES (org,ws,owner_id,gen_random_uuid(),'dw:mention:1','message.created','Duplicate','Duplicate');
    RAISE EXCEPTION 'duplicate notification dedupe key unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM messages
    WHERE workspace_id=ws AND id=msg
      AND to_tsvector('simple',coalesce(body,'')) @@ plainto_tsquery('simple','decision')
  ) THEN
    RAISE EXCEPTION 'message full text search query did not match expected content';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM files f JOIN file_links fl
      ON fl.workspace_id=f.workspace_id AND fl.file_id=f.id
    WHERE f.workspace_id=ws AND f.id=file_uuid AND fl.entity_type='message' AND fl.entity_id=msg
  ) THEN
    RAISE EXCEPTION 'file context link was not preserved';
  END IF;
END $$;

ROLLBACK;
