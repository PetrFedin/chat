\set ON_ERROR_STOP on

INSERT INTO organizations(id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Org A');

INSERT INTO workspaces(id, organization_id, name) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Workspace A'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Workspace B');

INSERT INTO conversations(id, organization_id, workspace_id, kind, title, created_by) VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'team', 'A', '90000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'team', 'B', '90000000-0000-0000-0000-000000000001');

INSERT INTO messages(id, organization_id, workspace_id, conversation_id, author_id, body, client_request_id) VALUES
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'Source message', 'req-1');

DO $$
BEGIN
  BEGIN
    INSERT INTO commitments(
      id, organization_id, workspace_id, title, outcome, owner_id, requester_id, acceptor_id, source_message_id, status
    ) VALUES (
      '40000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      'Cross tenant reference', 'Must fail',
      '90000000-0000-0000-0000-000000000002',
      '90000000-0000-0000-0000-000000000001',
      '90000000-0000-0000-0000-000000000003',
      '30000000-0000-0000-0000-000000000001', 'proposed'
    );
    RAISE EXCEPTION 'cross-workspace source reference unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END $$;

INSERT INTO commitments(
  id, organization_id, workspace_id, title, outcome, owner_id, requester_id, acceptor_id, source_message_id, status
) VALUES (
  '40000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Valid task', 'Produce accepted result',
  '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000003',
  '30000000-0000-0000-0000-000000000001', 'proposed'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO calendar_blocks(
      organization_id, workspace_id, commitment_id, owner_id, start_at, end_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000002',
      '90000000-0000-0000-0000-000000000002',
      '2026-09-18T11:00:00Z', '2026-09-18T10:00:00Z'
    );
    RAISE EXCEPTION 'invalid calendar range unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

INSERT INTO idempotency_keys(
  organization_id, workspace_id, actor_id, key, request_hash, expires_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001',
  'command-1', 'hash-1', now() + interval '1 day'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO idempotency_keys(
      organization_id, workspace_id, actor_id, key, request_hash, expires_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '90000000-0000-0000-0000-000000000001',
      'command-1', 'hash-1', now() + interval '1 day'
    );
    RAISE EXCEPTION 'duplicate idempotency key unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

SELECT 'core database constraints passed' AS result;
