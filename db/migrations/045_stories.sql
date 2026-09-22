-- Сторис.
--
-- Работа на объекте выглядит: привезли, залили, смонтировали. Показать
-- это было негде — фотография уходила в беседу и через день тонула под
-- перепиской. Сторис живут сутки и заменяют десяток «смотрите, как
-- получилось» в общем канале, а снятое остаётся в личном архиве.
--
-- Своя таблица, а не сообщение особого вида: у сторис свой срок жизни,
-- свои отметки о просмотре и своя видимость — всей компании, помимо
-- бесед.

CREATE TABLE stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  author_id uuid NOT NULL,
  file_id uuid NOT NULL,
  caption text CHECK (caption IS NULL OR length(caption) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Срок хранится, а не считается: «сутки» однажды станут другими, и
  -- прежние сторис не должны от этого воскреснуть или пропасть.
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz,
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, author_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE,
  -- Снимок остаётся вложением: одно хранилище, одни проверки. Удалили
  -- файл — сторис уходит вместе с ним, а не висит пустой рамкой.
  FOREIGN KEY (workspace_id, file_id) REFERENCES files(workspace_id, id) ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE INDEX stories_live ON stories (workspace_id, expires_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX stories_mine ON stories (workspace_id, author_id, created_at DESC);

CREATE TABLE story_views (
  workspace_id uuid NOT NULL,
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);
