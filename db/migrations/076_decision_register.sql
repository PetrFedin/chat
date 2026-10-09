BEGIN;

-- Canonical Decision Authority.
--
-- Meeting Intelligence proposals remain proposal/evidence provenance; meeting
-- notes remain the editable meeting record. Once a human has accepted/recorded
-- a decision, this table gives that decision one stable address for search,
-- Project relations and later supersession/evidence features.
CREATE TABLE decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('meeting_proposal','meeting_note')),
  source_id uuid NOT NULL,
  source_position integer CHECK (source_position IS NULL OR source_position >= 0),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  body text,
  source_title text,
  accepted_by uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  call_id uuid,
  calendar_event_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retracted')),
  retracted_by uuid,
  retracted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  FOREIGN KEY (organization_id,workspace_id)
    REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,accepted_by)
    REFERENCES memberships(workspace_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,retracted_by)
    REFERENCES memberships(workspace_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,call_id)
    REFERENCES call_sessions(workspace_id,id) ON DELETE SET NULL (call_id),
  FOREIGN KEY (workspace_id,calendar_event_id)
    REFERENCES calendar_events(workspace_id,id) ON DELETE SET NULL (calendar_event_id),
  CHECK (
    (status='active' AND retracted_by IS NULL AND retracted_at IS NULL)
    OR
    (status='retracted' AND retracted_by IS NOT NULL AND retracted_at IS NOT NULL)
  ),
  CHECK (
    (source_kind='meeting_proposal' AND call_id IS NOT NULL AND source_position IS NULL)
    OR
    (source_kind='meeting_note' AND calendar_event_id IS NOT NULL AND source_position IS NOT NULL)
  )
);

CREATE UNIQUE INDEX decisions_proposal_source_uq
  ON decisions(workspace_id,source_id)
  WHERE source_kind='meeting_proposal';

CREATE INDEX decisions_visible_time_idx
  ON decisions(workspace_id,status,accepted_at DESC,id);

CREATE INDEX decisions_note_source_idx
  ON decisions(workspace_id,source_id,status,source_position)
  WHERE source_kind='meeting_note';

-- Existing accepted AI decisions acquire the proposal UUID itself as Decision
-- identity. This preserves a stable address across the migration.
INSERT INTO decisions(
  id,organization_id,workspace_id,source_kind,source_id,title,body,source_title,
  accepted_by,accepted_at,call_id,status,created_at,updated_at)
SELECT
  p.id,p.organization_id,p.workspace_id,'meeting_proposal',p.id,p.title,p.body,s.title,
  p.accepted_by,p.accepted_at,s.id,'active',p.accepted_at,p.updated_at
FROM meeting_proposals p
JOIN meeting_intelligence_runs r
  ON r.workspace_id=p.workspace_id AND r.id=p.run_id
JOIN call_sessions s
  ON s.workspace_id=r.workspace_id AND s.id=r.call_id
WHERE p.proposal_type='decision' AND p.status='accepted'
ON CONFLICT (id) DO NOTHING;

-- Existing manual-note decisions receive individual UUIDs. From this point on
-- application reconciliation preserves IDs for unchanged lines.
INSERT INTO decisions(
  organization_id,workspace_id,source_kind,source_id,source_position,title,
  source_title,accepted_by,accepted_at,calendar_event_id,status,created_at,updated_at)
SELECT
  n.organization_id,n.workspace_id,'meeting_note',n.id,(d.ordinality-1)::integer,
  d.value,n.title,n.created_by,n.updated_at,n.calendar_event_id,'active',n.updated_at,n.updated_at
FROM meeting_notes n
CROSS JOIN LATERAL jsonb_array_elements_text(n.decisions) WITH ORDINALITY AS d(value,ordinality)
WHERE length(btrim(d.value))>0;

-- Database-level admission for recorded decisions: even a future code path
-- that accepts a proposal directly cannot skip Decision Authority.
CREATE OR REPLACE FUNCTION sync_accepted_meeting_proposal_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_call_id uuid;
  v_call_title text;
BEGIN
  IF NEW.proposal_type<>'decision' OR NEW.status<>'accepted' THEN
    RETURN NEW;
  END IF;

  SELECT s.id,s.title
    INTO v_call_id,v_call_title
    FROM meeting_intelligence_runs r
    JOIN call_sessions s
      ON s.workspace_id=r.workspace_id AND s.id=r.call_id
   WHERE r.workspace_id=NEW.workspace_id AND r.id=NEW.run_id;

  IF v_call_id IS NULL THEN
    RAISE EXCEPTION 'accepted decision proposal has no canonical call';
  END IF;

  INSERT INTO decisions(
    id,organization_id,workspace_id,source_kind,source_id,title,body,source_title,
    accepted_by,accepted_at,call_id,status,created_at,updated_at)
  VALUES(
    NEW.id,NEW.organization_id,NEW.workspace_id,'meeting_proposal',NEW.id,
    NEW.title,NEW.body,v_call_title,NEW.accepted_by,NEW.accepted_at,v_call_id,
    'active',COALESCE(NEW.accepted_at,now()),now())
  ON CONFLICT (id) DO UPDATE
    SET title=EXCLUDED.title,
        body=EXCLUDED.body,
        source_title=EXCLUDED.source_title,
        accepted_by=EXCLUDED.accepted_by,
        accepted_at=EXCLUDED.accepted_at,
        call_id=EXCLUDED.call_id,
        updated_at=now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_proposal_decision_register_trg ON meeting_proposals;
CREATE TRIGGER meeting_proposal_decision_register_trg
AFTER INSERT OR UPDATE OF status,proposal_type,title,body,accepted_by,accepted_at
ON meeting_proposals
FOR EACH ROW
EXECUTE FUNCTION sync_accepted_meeting_proposal_decision();

COMMIT;
