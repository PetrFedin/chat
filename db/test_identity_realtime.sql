BEGIN;

DO $$
DECLARE
  org uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  u uuid := gen_random_uuid();
  conv uuid := gen_random_uuid();
  msg uuid := gen_random_uuid();
BEGIN
  INSERT INTO organizations(id,name) VALUES (org,'Identity Test');
  INSERT INTO workspaces(id,organization_id,name) VALUES (ws,org,'Main');
  INSERT INTO users(id,email) VALUES (u,'identity@example.com');
  INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES (org,ws,u,'owner');
  INSERT INTO auth_credentials(user_id,password_hash,password_salt) VALUES (u,repeat('a',128),repeat('b',32));
  INSERT INTO user_sessions(user_id,workspace_id,token_hash,expires_at) VALUES (u,ws,repeat('c',64),now()+interval '30 days');
  INSERT INTO conversations(id,organization_id,workspace_id,kind,title,created_by,visibility) VALUES (conv,org,ws,'channel','General',u,'workspace');
  INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role) VALUES (org,ws,conv,u,'owner');
  INSERT INTO messages(id,organization_id,workspace_id,conversation_id,author_id,body,kind) VALUES (msg,org,ws,conv,u,'hello','text');
  UPDATE conversation_members SET last_read_message_id=msg,last_read_at=now() WHERE workspace_id=ws AND conversation_id=conv AND user_id=u;
  INSERT INTO push_subscriptions(organization_id,workspace_id,user_id,endpoint,p256dh,auth) VALUES (org,ws,u,'https://push.example/sub','p256dh','auth');

  BEGIN
    INSERT INTO users(email) VALUES ('IDENTITY@example.com');
    RAISE EXCEPTION 'case-insensitive duplicate email unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO user_sessions(user_id,workspace_id,token_hash,expires_at) VALUES (u,ws,repeat('d',64),now()-interval '1 day');
    RAISE EXCEPTION 'expired-at-creation session unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;
