BEGIN;

-- Notifications already exist as a collaboration primitive. This migration turns
-- them into a navigable, queryable attention stream without creating a second
-- competing inbox model.
ALTER TABLE notifications
  ADD COLUMN actor_user_id uuid,
  ADD COLUMN conversation_id uuid,
  ADD COLUMN message_id uuid,
  ADD COLUMN commitment_id uuid,
  ADD COLUMN calendar_event_id uuid,
  ADD COLUMN url text,
  ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN archived_at timestamptz,
  ADD CONSTRAINT notifications_actor_fkey
    FOREIGN KEY (workspace_id, actor_user_id)
    REFERENCES memberships(workspace_id, user_id)
    ON DELETE SET NULL (actor_user_id),
  ADD CONSTRAINT notifications_conversation_fkey
    FOREIGN KEY (workspace_id, conversation_id)
    REFERENCES conversations(workspace_id, id)
    ON DELETE CASCADE,
  ADD CONSTRAINT notifications_message_fkey
    FOREIGN KEY (workspace_id, message_id)
    REFERENCES messages(workspace_id, id)
    ON DELETE CASCADE,
  ADD CONSTRAINT notifications_commitment_fkey
    FOREIGN KEY (workspace_id, commitment_id)
    REFERENCES commitments(workspace_id, id)
    ON DELETE CASCADE,
  ADD CONSTRAINT notifications_calendar_event_fkey
    FOREIGN KEY (workspace_id, calendar_event_id)
    REFERENCES calendar_events(workspace_id, id)
    ON DELETE CASCADE;

CREATE INDEX notifications_attention_idx
  ON notifications(workspace_id, recipient_user_id, status, archived_at, created_at DESC, id DESC);
CREATE INDEX notifications_source_idx
  ON notifications(workspace_id, source_event_id, recipient_user_id);
CREATE INDEX notifications_conversation_idx
  ON notifications(workspace_id, conversation_id, recipient_user_id, created_at DESC)
  WHERE conversation_id IS NOT NULL AND archived_at IS NULL;

-- Search is intentionally PostgreSQL-native for the first production slice.
-- The 'simple' configuration works consistently across RU/EN content and avoids
-- introducing a separate search service before the product actually needs one.
CREATE INDEX messages_search_fts_idx
  ON messages USING gin (to_tsvector('simple'::regconfig, coalesce(body, '')))
  WHERE deleted_at IS NULL;
CREATE INDEX conversations_search_fts_idx
  ON conversations USING gin (to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(purpose, '')))
  WHERE archived_at IS NULL;
CREATE INDEX commitments_search_fts_idx
  ON commitments USING gin (to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(outcome, '')));
CREATE INDEX files_search_fts_idx
  ON files USING gin (to_tsvector('simple'::regconfig, coalesce(name, '')))
  WHERE deleted_at IS NULL;
CREATE INDEX workspace_profiles_search_fts_idx
  ON workspace_profiles USING gin (
    to_tsvector('simple'::regconfig,
      coalesce(display_name, '') || ' ' ||
      coalesce(email, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(department, ''))
  );
CREATE INDEX calendar_events_search_fts_idx
  ON calendar_events USING gin (to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(description, '')));

CREATE INDEX file_links_entity_lookup_idx
  ON file_links(workspace_id, entity_type, entity_id, created_at DESC);

COMMIT;
