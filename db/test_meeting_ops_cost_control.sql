BEGIN;

DO $$
DECLARE
  org uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid();
  version_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO organizations(id,name) VALUES(org,'Meeting Ops Cost Test');
  INSERT INTO workspaces(id,organization_id,name) VALUES(ws,org,'Main');
  INSERT INTO users(id,email) VALUES(owner_id,'meeting-ops-owner@example.com');
  INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES(org,ws,owner_id,'owner');
  INSERT INTO workspace_profiles(organization_id,workspace_id,user_id,display_name,email)
    VALUES(org,ws,owner_id,'Meeting Ops Owner','meeting-ops-owner@example.com');

  INSERT INTO meeting_price_versions(
    id,organization_id,workspace_id,provider,model,kind,currency,effective_from,source_ref,note,created_by)
    VALUES(version_id,org,ws,'openai','gpt-5.6','summarize','USD','2026-01-01T00:00:00Z',
      'vendor-pricing-2026-01','Initial test catalog',owner_id);
  INSERT INTO meeting_price_items(
    organization_id,workspace_id,price_version_id,metric_name,usage_path,unit_quantity,unit_price)
    VALUES
      (org,ws,version_id,'input_tokens','input_tokens',1000000,2.5),
      (org,ws,version_id,'output_tokens','output_tokens',1000000,12.5);

  IF (SELECT count(*) FROM meeting_price_items WHERE workspace_id=ws AND price_version_id=version_id) <> 2 THEN
    RAISE EXCEPTION 'price items were not retained';
  END IF;

  BEGIN
    INSERT INTO meeting_price_versions(
      organization_id,workspace_id,provider,model,kind,currency,effective_from,created_by)
      VALUES(org,ws,'openai','gpt-5.6','summarize','usd','2026-02-01T00:00:00Z',owner_id);
    RAISE EXCEPTION 'lowercase currency unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO meeting_price_items(
      organization_id,workspace_id,price_version_id,metric_name,usage_path,unit_quantity,unit_price)
      VALUES(org,ws,version_id,'bad metric','input tokens',1000,1);
    RAISE EXCEPTION 'invalid price metric/path unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO meeting_price_items(
      organization_id,workspace_id,price_version_id,metric_name,usage_path,unit_quantity,unit_price)
      VALUES(org,ws,version_id,'negative','negative',1000,-1);
    RAISE EXCEPTION 'negative price unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO meeting_price_versions(
      organization_id,workspace_id,provider,model,kind,currency,effective_from,created_by)
      VALUES(org,ws,'openai','gpt-5.6','summarize','USD','2026-01-01T00:00:00Z',owner_id);
    RAISE EXCEPTION 'duplicate effective price version unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

ROLLBACK;
