-- The employee card.
--
-- workspace_profiles has carried `title` and `department` since 004 and no
-- endpoint ever wrote them, so every person in the directory showed a name, an
-- email and nothing else. This migration adds the fields a colleague actually
-- looks for and the index that makes a personal activity feed cheap.

ALTER TABLE workspace_profiles ADD COLUMN phone text;
ALTER TABLE workspace_profiles ADD COLUMN about text;
ALTER TABLE workspace_profiles ADD COLUMN started_on date;
-- Where to find them when the chat answer is not enough.
ALTER TABLE workspace_profiles ADD COLUMN location text;

-- "What has this person been doing" scans by actor, which until now meant a
-- full table scan of every audit event in the workspace.
CREATE INDEX audit_actor_sequence_idx ON audit_events(workspace_id, actor_id, sequence DESC);
