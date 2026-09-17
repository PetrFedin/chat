BEGIN;

DO $$
DECLARE
  org uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  conv uuid := gen_random_uuid();
  call_uuid uuid := gen_random_uuid();
  recording_uuid uuid := gen_random_uuid();
  run_uuid uuid := gen_random_uuid();
  job_uuid uuid := gen_random_uuid();
  provider_call_uuid uuid := gen_random_uuid();
BEGIN
  INSERT INTO organizations(id,name) VALUES(org,'Meeting Processing Observability Test');
  INSERT INTO workspaces(id,organization_id,name) VALUES(ws,org,'Main');
  INSERT INTO users(id,email) VALUES(owner_id,'meeting-observability-owner@example.com');
  INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES(org,ws,owner_id,'owner');
  INSERT INTO workspace_profiles(organization_id,workspace_id,user_id,display_name,email)
    VALUES(org,ws,owner_id,'Observability Owner','meeting-observability-owner@example.com');
  INSERT INTO conversations(id,organization_id,workspace_id,kind,title,created_by,visibility)
    VALUES(conv,org,ws,'group','Observability Meeting',owner_id,'private');
  INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role)
    VALUES(org,ws,conv,owner_id,'owner');
  INSERT INTO call_sessions(id,organization_id,workspace_id,conversation_id,created_by,title,mode,state,provider,provider_room_name)
    VALUES(call_uuid,org,ws,conv,owner_id,'Observability Call','video','ended','livekit','observability-room');
  INSERT INTO call_recordings(
    id,organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,started_by,
    transcription_provider_recording_id,transcription_storage_key,transcription_source_status)
    VALUES(recording_uuid,org,ws,call_uuid,'livekit','EG_ARCHIVE_OBS','recordings/obs/archive.mp4','processing',owner_id,
      'EG_AUDIO_OBS','recordings/obs/transcription.ogg','processing');
  INSERT INTO meeting_intelligence_runs(id,organization_id,workspace_id,call_id,recording_id,status)
    VALUES(run_uuid,org,ws,call_uuid,recording_uuid,'transcribing');
  INSERT INTO meeting_intelligence_jobs(id,organization_id,workspace_id,run_id,kind,status,attempts,locked_at,lock_token)
    VALUES(job_uuid,org,ws,run_uuid,'transcribe','processing',1,now(),gen_random_uuid());

  INSERT INTO meeting_provider_calls(
    id,organization_id,workspace_id,run_id,job_id,kind,attempt_number,provider,model,status,input_metadata)
    VALUES(provider_call_uuid,org,ws,run_uuid,job_uuid,'transcribe',1,'openai','gpt-4o-transcribe-diarize','started',
      jsonb_build_object('sourceSizeBytes',12345,'sourceKind','audio_sidecar'));

  UPDATE meeting_provider_calls
    SET status='succeeded',provider_request_id='req_observability',usage='{"type":"duration","seconds":42}'::jsonb,
        finished_at=started_at+interval '1200 milliseconds',latency_ms=1200
    WHERE id=provider_call_uuid;

  IF NOT EXISTS(
    SELECT 1 FROM meeting_provider_calls
    WHERE id=provider_call_uuid AND status='succeeded' AND latency_ms=1200
      AND usage->>'type'='duration' AND input_metadata->>'sourceKind'='audio_sidecar'
  ) THEN RAISE EXCEPTION 'provider usage/latency telemetry was not retained'; END IF;

  BEGIN
    INSERT INTO call_recordings(
      organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,started_by,
      transcription_provider_recording_id,transcription_source_status)
      VALUES(org,ws,call_uuid,'livekit','EG_BAD_SOURCE','recordings/obs/bad.mp4','recording',owner_id,
        'EG_BAD_AUDIO','recording');
    RAISE EXCEPTION 'transcription provider id without storage key unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO call_recordings(
      organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,started_by,
      transcription_provider_recording_id,transcription_storage_key,transcription_source_status)
      VALUES(org,ws,call_uuid,'livekit','EG_DUP_AUDIO_ARCHIVE','recordings/obs/dup.mp4','recording',owner_id,
        'EG_AUDIO_OBS','recordings/obs/dup.ogg','recording');
    RAISE EXCEPTION 'duplicate transcription provider egress id unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO meeting_provider_calls(
      organization_id,workspace_id,run_id,job_id,kind,attempt_number,provider,model,status)
      VALUES(org,ws,run_uuid,job_uuid,'summarize',2,'openai','fixture','started');
    RAISE EXCEPTION 'provider call with kind different from durable job unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO meeting_provider_calls(
      organization_id,workspace_id,run_id,job_id,kind,attempt_number,provider,model,status,finished_at,latency_ms)
      VALUES(org,ws,run_uuid,job_uuid,'transcribe',2,'openai','fixture','started',now(),1);
    RAISE EXCEPTION 'started provider call with finished timestamp unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO meeting_provider_calls(
      organization_id,workspace_id,run_id,job_id,kind,attempt_number,provider,model,status)
      VALUES(org,ws,run_uuid,job_uuid,'transcribe',3,'openai','fixture','succeeded');
    RAISE EXCEPTION 'succeeded provider call without latency unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;
