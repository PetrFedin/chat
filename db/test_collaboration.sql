\set ON_ERROR_STOP on

INSERT INTO memberships(organization_id, workspace_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'manager'),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'member'),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003', 'member'),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000004', 'member');

INSERT INTO conversation_members(organization_id, workspace_id, conversation_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'member');

DO $$
BEGIN
  BEGIN
    INSERT INTO conversation_members(organization_id, workspace_id, conversation_id, user_id) VALUES (
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      '90000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'cross-workspace conversation membership unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END $$;

INSERT INTO calendar_events(
  id, organization_id, workspace_id, kind, title, owner_id, start_at, end_at, timezone, visibility, commitment_id, conversation_id
) VALUES (
  '50000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'meeting', 'Weekly planning',
  '90000000-0000-0000-0000-000000000001',
  '2026-09-20T10:00:00Z', '2026-09-20T10:30:00Z', 'Europe/Stockholm', 'participants',
  '40000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO calendar_events(
      organization_id, workspace_id, kind, title, owner_id, start_at, end_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'meeting', 'Invalid meeting',
      '90000000-0000-0000-0000-000000000001',
      '2026-09-20T12:00:00Z', '2026-09-20T11:00:00Z'
    );
    RAISE EXCEPTION 'invalid calendar event range unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

INSERT INTO calendar_event_participants(organization_id, workspace_id, calendar_event_id, user_id, response_status) VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'accepted');

DO $$
BEGIN
  BEGIN
    INSERT INTO calendar_event_participants(organization_id, workspace_id, calendar_event_id, user_id) VALUES (
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000001',
      '90000000-0000-0000-0000-000000000004'
    );
    RAISE EXCEPTION 'cross-workspace calendar participant unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END $$;

INSERT INTO notifications(
  id, organization_id, workspace_id, recipient_user_id, source_event_id, dedupe_key, type, title, body
) VALUES (
  '60000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000002',
  '70000000-0000-0000-0000-000000000001',
  'event-1:user-2:message.mentioned', 'message.mentioned', 'Mention', 'You were mentioned'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO notifications(
      organization_id, workspace_id, recipient_user_id, source_event_id, dedupe_key, type, title, body
    ) VALUES (
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '90000000-0000-0000-0000-000000000002',
      '70000000-0000-0000-0000-000000000001',
      'event-1:user-2:message.mentioned', 'message.mentioned', 'Duplicate', 'Must fail'
    );
    RAISE EXCEPTION 'duplicate notification dedupe key unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

SELECT 'collaboration database constraints passed' AS result;
