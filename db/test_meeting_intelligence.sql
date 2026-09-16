BEGIN;

DO $$
DECLARE
  org uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  conv uuid := gen_random_uuid();
  call_id uuid := gen_random_uuid();
  recording_id uuid := gen_random_uuid();
  run_id uuid := gen_random_uuid();
  segment_id uuid := gen_random_uuid();
  proposal_uuid uuid := gen_random_uuid();
BEGIN
  INSERT INTO organizations(id,name) VALUES(org,'Meeting Intelligence Test');
  INSERT INTO workspaces(id,organization_id,name) VALUES(ws,org,'Main');
  INSERT INTO users(id,email) VALUES(owner_id,'mi-owner@example.com'),(member_id,'mi-member@example.com');
  INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES(org,ws,owner_id,'owner'),(org,ws,member_id,'member');
  INSERT INTO workspace_profiles(organization_id,workspace_id,user_id,display_name,email) VALUES
    (org,ws,owner_id,'MI Owner','mi-owner@example.com'),(org,ws,member_id,'MI Member','mi-member@example.com');
  INSERT INTO conversations(id,organization_id,workspace_id,kind,title,created_by,visibility)
    VALUES(conv,org,ws,'group','MI Meeting',owner_id,'private');
  INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role) VALUES
    (org,ws,conv,owner_id,'owner'),(org,ws,conv,member_id,'member');
  INSERT INTO call_sessions(id,organization_id,workspace_id,conversation_id,created_by,title,mode,state,provider,provider_room_name)
    VALUES(call_id,org,ws,conv,owner_id,'MI Call','video','ended','livekit','mi-room');
  INSERT INTO call_recordings(id,organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,started_by,stopped_at,ready_at,transcript_status)
    VALUES(recording_id,org,ws,call_id,'livekit','EG_MI_1','recordings/mi.mp4','ready',owner_id,now(),now(),'queued');

  INSERT INTO meeting_intelligence_runs(id,organization_id,workspace_id,call_id,recording_id,status)
    VALUES(run_id,org,ws,call_id,recording_id,'transcribing');
  INSERT INTO meeting_transcript_segments(id,organization_id,workspace_id,run_id,segment_index,start_ms,end_ms,speaker_user_id,speaker_label,text,confidence)
    VALUES(segment_id,org,ws,run_id,0,1200,6800,member_id,'MI Member','We will ship the release after QA.',0.991);
  INSERT INTO meeting_proposals(id,organization_id,workspace_id,run_id,proposal_type,title,body,proposed_owner_id,status)
    VALUES(proposal_uuid,org,ws,run_id,'action','Complete final QA','Verify mobile release before shipment',member_id,'proposed');
  INSERT INTO meeting_proposal_sources(organization_id,workspace_id,proposal_id,segment_id)
    VALUES(org,ws,proposal_uuid,segment_id);

  IF NOT EXISTS(
    SELECT 1 FROM meeting_proposals p
    JOIN meeting_proposal_sources ps ON ps.workspace_id=p.workspace_id AND ps.proposal_id=p.id
    JOIN meeting_transcript_segments s ON s.workspace_id=ps.workspace_id AND s.id=ps.segment_id
    WHERE p.id=proposal_uuid AND s.start_ms=1200 AND s.end_ms=6800
  ) THEN RAISE EXCEPTION 'proposal did not retain transcript evidence source'; END IF;

  BEGIN
    INSERT INTO meeting_transcript_segments(organization_id,workspace_id,run_id,segment_index,start_ms,end_ms,text)
      VALUES(org,ws,run_id,1,9000,8000,'Impossible time range');
    RAISE EXCEPTION 'invalid transcript time range unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE meeting_proposals SET status='accepted',accepted_at=now() WHERE id=proposal_uuid;
    RAISE EXCEPTION 'accepted proposal without human actor unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO meeting_proposals(organization_id,workspace_id,run_id,proposal_type,title,status,created_commitment_id)
      VALUES(org,ws,run_id,'decision','Decision cannot create task','proposed',gen_random_uuid());
    RAISE EXCEPTION 'non-action proposal unexpectedly linked a commitment';
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO meeting_intelligence_jobs(organization_id,workspace_id,run_id,kind,status)
      VALUES(org,ws,run_id,'transcribe','processing');
    RAISE EXCEPTION 'processing job without lock unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO media_webhook_events(provider,provider_event_id,event_type,payload)
    VALUES('livekit','WH_MI_1','egress_ended','{}'::jsonb);
  BEGIN
    INSERT INTO media_webhook_events(provider,provider_event_id,event_type,payload)
      VALUES('livekit','WH_MI_1','egress_ended','{}'::jsonb);
    RAISE EXCEPTION 'duplicate webhook event unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

ROLLBACK;
