BEGIN;

DO $$
DECLARE
  org uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  room uuid := gen_random_uuid();
  room2 uuid := gen_random_uuid();
  bridge_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO organizations(id,name) VALUES(org,'Telegram Bridge Test');
  INSERT INTO workspaces(id,organization_id,name) VALUES(ws,org,'Main');
  INSERT INTO users(id,email) VALUES(owner_id,'tg-owner@example.com');
  INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES(org,ws,owner_id,'owner');
  INSERT INTO workspace_profiles(organization_id,workspace_id,user_id,display_name,email)
    VALUES(org,ws,owner_id,'TG Owner','tg-owner@example.com');
  INSERT INTO conversations(id,organization_id,workspace_id,kind,title,visibility,created_by)
    VALUES(room,org,ws,'channel','Partners','private',owner_id);
  INSERT INTO conversations(id,organization_id,workspace_id,kind,title,visibility,created_by)
    VALUES(room2,org,ws,'channel','Partners 2','private',owner_id);

  INSERT INTO telegram_bridges(id,organization_id,workspace_id,conversation_id,bot_token_sealed,bot_username,telegram_chat_id,webhook_secret,created_by)
    VALUES(bridge_id,org,ws,room,'\x00'::bytea,'partner_bot','-100123','secret-one',owner_id);

  IF (SELECT count(*) FROM telegram_bridges WHERE workspace_id=ws AND id=bridge_id) <> 1 THEN
    RAISE EXCEPTION 'bridge was not retained';
  END IF;

  BEGIN
    INSERT INTO telegram_bridges(organization_id,workspace_id,conversation_id,bot_token_sealed,bot_username,telegram_chat_id,webhook_secret,created_by)
      VALUES(org,ws,room,'\x00'::bytea,'other_bot','-100999','secret-two',owner_id);
    RAISE EXCEPTION 'a second bridge on the same conversation unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO telegram_bridges(organization_id,workspace_id,conversation_id,bot_token_sealed,bot_username,telegram_chat_id,webhook_secret,created_by)
      VALUES(org,ws,room2,'\x00'::bytea,'other_bot','-100999','secret-one',owner_id);
    RAISE EXCEPTION 'reusing another bridge webhook_secret unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO telegram_bridges(organization_id,workspace_id,conversation_id,bot_token_sealed,bot_username,telegram_chat_id,webhook_secret,created_by)
      VALUES(org,ws,room2,'\x00'::bytea,'other_bot','-100999','secret-three','not-a-member');
    RAISE EXCEPTION 'created_by outside workspace membership unexpectedly accepted';
  EXCEPTION WHEN invalid_text_representation OR foreign_key_violation THEN NULL;
  END;

  DELETE FROM conversations WHERE id=room;
  IF EXISTS (SELECT 1 FROM telegram_bridges WHERE id=bridge_id) THEN
    RAISE EXCEPTION 'the bridge survived its conversation being deleted';
  END IF;
END $$;

ROLLBACK;
