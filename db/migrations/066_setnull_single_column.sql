-- Составной внешний ключ с ON DELETE SET NULL обнулял и workspace_id (NOT NULL):
-- отмена встречи с протоколом, удаление подразделения и т. п. падали с 500.
-- Обнуляем только ссылочный столбец (PostgreSQL 15+).
ALTER TABLE call_sessions DROP CONSTRAINT call_sessions_workspace_id_calendar_event_id_fkey;
ALTER TABLE call_sessions ADD CONSTRAINT call_sessions_workspace_id_calendar_event_id_fkey FOREIGN KEY (workspace_id, calendar_event_id) REFERENCES calendar_events(workspace_id, id) ON DELETE SET NULL (calendar_event_id);
ALTER TABLE meeting_notes DROP CONSTRAINT meeting_notes_workspace_id_calendar_event_id_fkey;
ALTER TABLE meeting_notes ADD CONSTRAINT meeting_notes_workspace_id_calendar_event_id_fkey FOREIGN KEY (workspace_id, calendar_event_id) REFERENCES calendar_events(workspace_id, id) ON DELETE SET NULL (calendar_event_id);
ALTER TABLE meeting_notes DROP CONSTRAINT meeting_notes_workspace_id_call_id_fkey;
ALTER TABLE meeting_notes ADD CONSTRAINT meeting_notes_workspace_id_call_id_fkey FOREIGN KEY (workspace_id, call_id) REFERENCES call_sessions(workspace_id, id) ON DELETE SET NULL (call_id);
ALTER TABLE org_units DROP CONSTRAINT org_units_workspace_id_head_user_id_fkey;
ALTER TABLE org_units ADD CONSTRAINT org_units_workspace_id_head_user_id_fkey FOREIGN KEY (workspace_id, head_user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE SET NULL (head_user_id);
ALTER TABLE workspace_invitations DROP CONSTRAINT workspace_invitations_unit_fk;
ALTER TABLE workspace_invitations ADD CONSTRAINT workspace_invitations_unit_fk FOREIGN KEY (workspace_id, org_unit_id) REFERENCES org_units(workspace_id, id) ON DELETE SET NULL (org_unit_id);
ALTER TABLE calendar_event_participants DROP CONSTRAINT calendar_event_participants_invited_by_fk;
ALTER TABLE calendar_event_participants ADD CONSTRAINT calendar_event_participants_invited_by_fk FOREIGN KEY (workspace_id, invited_by) REFERENCES memberships(workspace_id, user_id) ON DELETE SET NULL (invited_by);
ALTER TABLE workspace_profiles DROP CONSTRAINT workspace_profiles_avatar_fkey;
ALTER TABLE workspace_profiles ADD CONSTRAINT workspace_profiles_avatar_fkey FOREIGN KEY (workspace_id, avatar_file_id) REFERENCES files(workspace_id, id) ON DELETE SET NULL (avatar_file_id);
ALTER TABLE conversations DROP CONSTRAINT conversations_avatar_fkey;
ALTER TABLE conversations ADD CONSTRAINT conversations_avatar_fkey FOREIGN KEY (workspace_id, avatar_file_id) REFERENCES files(workspace_id, id) ON DELETE SET NULL (avatar_file_id);

-- Протокол переживает встречу (решения остаются в журнале решений), поэтому
-- «есть встреча или звонок» не может быть обязательным: после отмены обе
-- ссылки пусты.
ALTER TABLE meeting_notes DROP CONSTRAINT IF EXISTS meeting_notes_check;
