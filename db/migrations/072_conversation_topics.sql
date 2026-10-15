-- Ветки внутри беседы: именованные разговоры по темам («Договоры», «Закупки») рядом с общей лентой.
-- Сообщение либо без ветки (общая лента), либо в одной из веток той же беседы. Доступ к ветке — доступ к беседе.
CREATE TABLE IF NOT EXISTS conversation_topics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id    uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  title           text NOT NULL CHECK (length(btrim(title)) > 0 AND length(title) <= 80),
  pinned          boolean NOT NULL DEFAULT false,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS conversation_topics_conversation_idx ON conversation_topics (conversation_id, archived_at);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_topics_title_idx ON conversation_topics (conversation_id, lower(title)) WHERE archived_at IS NULL;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES conversation_topics(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS messages_topic_idx ON messages (topic_id, created_at) WHERE topic_id IS NOT NULL;
