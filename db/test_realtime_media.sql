\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  org uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  conv uuid := gen_random_uuid();
  call_id uuid := gen_random_uuid();
  recording_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO users(id,email) VALUES
    (u1, 'media-owner@example.com'),
    (u2, 'media-member@example.com');
  INSERT INTO organizations(id,name) VALUES(org,'Media Test');
  INSERT INTO workspaces(id,organization_id,name) VALUES(ws,org,'Media Workspace');
  INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES
    (org,ws,u1,'owner'),(org,ws,u2,'member');
  INSERT INTO conversations(id,organization_id,workspace_id,kind,title,visibility,created_by)
    VALUES(conv,org,ws,'direct','Owner / Member','private',u1);
  INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role) VALUES
    (org,ws,conv,u1,'owner'),(org,ws,conv,u2,'member');

  INSERT INTO call_sessions(
    id,organization_id,workspace_id,conversation_id,created_by,title,mode,state,provider,provider_room_name
  ) VALUES(
    call_id,org,ws,conv,u1,'Test video','video','active','livekit','chat-test-room'
  );

  INSERT INTO call_participants(
    organization_id,workspace_id,call_id,user_id,joined_at,audio_enabled,video_enabled,connection_state,recording_consented_at
  ) VALUES
    (org,ws,call_id,u1,now(),true,true,'connected',now()),
    (org,ws,call_id,u2,now(),true,true,'connected',now());

  INSERT INTO call_recordings(
    id,organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,started_by
  ) VALUES(
    recording_id,org,ws,call_id,'livekit','EG_test_media_1','recordings/test.mp4','recording',u1
  );

  BEGIN
    INSERT INTO call_recordings(
      organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,started_by
    ) VALUES(org,ws,call_id,'livekit','EG_test_media_1','recordings/duplicate.mp4','recording',u1);
    RAISE EXCEPTION 'duplicate provider recording id unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    UPDATE call_participants SET connection_state='teleported'
      WHERE workspace_id=ws AND call_id=call_id AND user_id=u1;
    RAISE EXCEPTION 'invalid connection state unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  UPDATE call_recordings
    SET status='processing',stopped_at=now(),transcript_status='queued',summary_status='not_requested'
    WHERE id=recording_id;

  IF NOT EXISTS(
    SELECT 1 FROM call_recordings
    WHERE id=recording_id AND status='processing' AND transcript_status='queued'
  ) THEN
    RAISE EXCEPTION 'recording processing transition was not persisted';
  END IF;
END $$;

ROLLBACK;
