\set ON_ERROR_STOP on

INSERT INTO organizations(id, name) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'Integration Org');

INSERT INTO workspaces(id, organization_id, name) VALUES
  ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'Integration WS A'),
  ('10000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1', 'Integration WS B');

INSERT INTO users(id, email) VALUES
  ('90000000-0000-0000-0000-0000000000d1', 'integration-admin@example.com');

INSERT INTO memberships(organization_id, workspace_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', '90000000-0000-0000-0000-0000000000d1', 'owner');

INSERT INTO webhook_endpoints(id, organization_id, workspace_id, label, url, secret, topics, created_by) VALUES
  ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1',
   'Portal', 'https://example.test/hook', 'whsec_0123456789abcdef0123456789abcdef', ARRAY['meeting.*'],
   '90000000-0000-0000-0000-0000000000d1');

DO $$
BEGIN
  -- An endpoint must belong to a workspace its creator is actually a member of.
  BEGIN
    INSERT INTO webhook_endpoints(organization_id, workspace_id, label, url, secret, created_by) VALUES
      ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d2',
       'Foreign', 'https://example.test/foreign', 'whsec_0123456789abcdef0123456789abcdef',
       '90000000-0000-0000-0000-0000000000d1');
    RAISE EXCEPTION 'expected an endpoint created by a non-member to be rejected';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- A plain http(s) URL is required: anything else is a misconfiguration that
  -- would only surface as a failed delivery hours later.
  BEGIN
    INSERT INTO webhook_endpoints(organization_id, workspace_id, label, url, secret, created_by) VALUES
      ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1',
       'Bad scheme', 'ftp://example.test/hook', 'whsec_0123456789abcdef0123456789abcdef',
       '90000000-0000-0000-0000-0000000000d1');
    RAISE EXCEPTION 'expected a non-http endpoint URL to be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A short secret cannot carry a meaningful HMAC.
  BEGIN
    INSERT INTO webhook_endpoints(organization_id, workspace_id, label, url, secret, created_by) VALUES
      ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1',
       'Weak', 'https://example.test/hook', 'short', '90000000-0000-0000-0000-0000000000d1');
    RAISE EXCEPTION 'expected a short signing secret to be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- An empty label leaves an operator unable to tell endpoints apart.
  BEGIN
    INSERT INTO webhook_endpoints(organization_id, workspace_id, label, url, secret, created_by) VALUES
      ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1',
       '   ', 'https://example.test/hook', 'whsec_0123456789abcdef0123456789abcdef',
       '90000000-0000-0000-0000-0000000000d1');
    RAISE EXCEPTION 'expected a blank endpoint label to be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO outbox_events(id, organization_id, workspace_id, topic, aggregate_id, payload) VALUES
  ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1',
   'meeting.transcript.ready', '10000000-0000-0000-0000-0000000000d1', '{}'::jsonb);

INSERT INTO webhook_deliveries(organization_id, workspace_id, endpoint_id, event_id, topic, payload) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1',
   'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'meeting.transcript.ready', '{}'::jsonb);

DO $$
BEGIN
  -- One event reaches one endpoint once: this is what makes re-running a
  -- crashed publisher harmless instead of a duplicate storm.
  BEGIN
    INSERT INTO webhook_deliveries(organization_id, workspace_id, endpoint_id, event_id, topic, payload) VALUES
      ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1',
       'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
       'meeting.transcript.ready', '{}'::jsonb);
    RAISE EXCEPTION 'expected a duplicate delivery for the same endpoint and event to be rejected';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Only the documented lifecycle states are storable.
  BEGIN
    UPDATE webhook_deliveries SET status = 'whatever'
     WHERE endpoint_id = 'd0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'expected an unknown delivery status to be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Deleting an endpoint must take its delivery history with it.
DELETE FROM webhook_endpoints WHERE id = 'd0000000-0000-0000-0000-000000000001';

DO $$
DECLARE remaining integer;
BEGIN
  SELECT count(*) INTO remaining FROM webhook_deliveries
   WHERE endpoint_id = 'd0000000-0000-0000-0000-000000000001';
  IF remaining <> 0 THEN
    RAISE EXCEPTION 'expected deliveries to be removed with their endpoint, % left', remaining;
  END IF;
END $$;
