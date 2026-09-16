\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_ws uuid := gen_random_uuid();
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_conv uuid := gen_random_uuid();
  v_call uuid := gen_random_uuid();
  v_recording uuid := gen_random_uuid();
BEGIN
  INSERT INTO users(id,email) VALUES
    (v_u1, 'media-owner@example.com'),
    (v_u2, 'media-member@example.com');
  INSERT INTO organizations(id,name) VALUES(v_org,'Media Test');
  INSERT INTO workspaces(id,organization_id,name) VALUES(v_ws,v_org,'Media Workspace');
  INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES
    (v_org,v_ws,v_u1,'owner'),(v_org,v_ws,v_u2,'member');
  INSERT INTO conversations(id,organization_id,workspace_id,kind,title,visibility,created_by)
    VALUES(v_conv,v_org,v_ws,'direct','Owner / Member','private',v_u1);
  INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role) VALUES
    (v_org,v_ws,v_conv,v_u1,'owner'),(v_org,v_ws,v_conv,v_u2,'member');

  INSERT INTO call_sessions(
    id,organization_id,workspace_id,conversation_id,created_by,title,mode,state,provider,provider_room_name
  ) VALUES(
    v_call,v_org,v_ws,v_conv,v_u1,'Test video','video','active','livekit','chat-test-room'
  );

  INSERT INTO call_participants(
    organization_id,workspace_id,call_id,user_id,joined_at,audio_enabled,video_enabled,connection_state,recording_consented_at
  ) VALUES
    (v_org,v_ws,v_call,v_u1,now(),true,true,'connected',now()),
    (v_org,v_ws,v_call,v_u2,now(),true,true,'connected',now());

  INSERT INTO call_recordings(
    id,organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,started_by
  ) VALUES(
    v_recording,v_org,v_ws,v_call,'livekit','EG_test_media_1','recordings/test.mp4','recording',v_u1
  );

  BEGIN
    INSERT INTO call_recordings(
      organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,started_by
    ) VALUES(v_org,v_ws,v_call,'livekit','EG_test_media_1','recordings/duplicate.mp4','recording',v_u1);
    RAISE EXCEPTION 'duplicate provider recording id unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    UPDATE call_participants SET connection_state='teleported'
      WHERE workspace_id=v_ws AND call_id=v_call AND user_id=v_u1;
    RAISE EXCEPTION 'invalid connection state unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  UPDATE call_recordings
    SET status='processing',stopped_at=now(),transcript_status='queued',summary_status='not_requested'
    WHERE id=v_recording;

  IF NOT EXISTS(
    SELECT 1 FROM call_recordings
    WHERE id=v_recording AND status='processing' AND transcript_status='queued'
  ) THEN
    RAISE EXCEPTION 'recording processing transition was not persisted';
  END IF;
END $$;

ROLLBACK;
