BEGIN;

DO $$
DECLARE
  org uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  source_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO organizations(id,name) VALUES(org,'Meeting Product Surface Test');
  INSERT INTO workspaces(id,organization_id,name) VALUES(ws,org,'Main');
  INSERT INTO users(id,email) VALUES(owner_id,'meeting-surface@example.com');
  INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES(org,ws,owner_id,'owner');

  INSERT INTO notifications(
    organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body
  ) VALUES(
    org,ws,owner_id,source_id,'meeting.review_ready:test','meeting.review_ready','Итоги встречи готовы','Проверьте решения и действия'
  );

  IF NOT EXISTS(
    SELECT 1 FROM notifications
    WHERE workspace_id=ws AND recipient_user_id=owner_id AND type='meeting.review_ready'
  ) THEN RAISE EXCEPTION 'meeting review notification was not persisted'; END IF;

  BEGIN
    INSERT INTO notifications(
      organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body
    ) VALUES(
      org,ws,owner_id,gen_random_uuid(),'unsupported:test','meeting.synthetic_truth','Bad','Bad'
    );
    RAISE EXCEPTION 'unsupported notification type unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;
