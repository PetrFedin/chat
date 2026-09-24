BEGIN;

DO $$
DECLARE
  org uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO organizations(id,name) VALUES(org,'ICS Feed Test');
  INSERT INTO workspaces(id,organization_id,name) VALUES(ws,org,'Main');
  INSERT INTO users(id,email) VALUES(owner_id,'ics-owner@example.com'),(other_id,'ics-other@example.com');
  INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES(org,ws,owner_id,'owner'),(org,ws,other_id,'member');

  INSERT INTO calendar_feed_tokens(workspace_id,user_id,token) VALUES(ws,owner_id,'token-one');

  IF (SELECT count(*) FROM calendar_feed_tokens WHERE workspace_id=ws AND user_id=owner_id) <> 1 THEN
    RAISE EXCEPTION 'token was not retained';
  END IF;

  BEGIN
    INSERT INTO calendar_feed_tokens(workspace_id,user_id,token) VALUES(ws,other_id,'token-one');
    RAISE EXCEPTION 'reusing another person''s token unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO calendar_feed_tokens(workspace_id,user_id,token) VALUES(ws,owner_id,'token-two');
    RAISE EXCEPTION 'a second token for the same person unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  UPDATE calendar_feed_tokens SET token='token-regenerated' WHERE workspace_id=ws AND user_id=owner_id;
  IF (SELECT token FROM calendar_feed_tokens WHERE workspace_id=ws AND user_id=owner_id) <> 'token-regenerated' THEN
    RAISE EXCEPTION 'regeneration did not replace the token in place';
  END IF;

  DELETE FROM memberships WHERE workspace_id=ws AND user_id=owner_id;
  IF EXISTS (SELECT 1 FROM calendar_feed_tokens WHERE workspace_id=ws AND user_id=owner_id) THEN
    RAISE EXCEPTION 'the token survived its membership being removed';
  END IF;
END $$;

ROLLBACK;
