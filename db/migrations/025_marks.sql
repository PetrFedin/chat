-- Личные пометки: избранное, выделения маркером и заметки.
--
-- Общее у них одно: это то, что человек думает о чужом объекте, а не сам
-- объект. Беседу ведут все, сообщение написал кто-то, задачу поставил
-- третий — а звёздочка, жёлтый маркер и заметка «спросить у Нины»
-- принадлежат одному человеку и никому больше не видны. Поэтому они
-- лежат отдельно от помечаемого и всегда привязаны к user_id.
--
-- Метки (labels) — другое: там общий словарь компании, которым
-- пользуются вместе. Здесь общего словаря нет и не нужно.

-- Избранное поверх чего угодно: беседа, сообщение, задача, встреча, файл.
CREATE TABLE favourites (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('conversation','message','task','event','file')),
  target_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, target_type, target_id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);
CREATE INDEX favourites_recent ON favourites (workspace_id, user_id, created_at DESC);

-- Выделение маркером внутри сообщения.
--
-- Хранятся и смещения, и сам выделенный текст. Смещения нужны, чтобы
-- подсветить ровно то место; текст — чтобы пережить правку сообщения:
-- если по смещениям теперь стоит что-то другое, выделение показывается
-- как устаревшее, а не подсвечивает случайный кусок чужой фразы.
CREATE TABLE message_highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  quote text NOT NULL CHECK (length(quote) BETWEEN 1 AND 2000),
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset > start_offset),
  colour text NOT NULL DEFAULT 'yellow' CHECK (colour IN ('yellow','green','pink','blue')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);
CREATE INDEX message_highlights_mine ON message_highlights (workspace_id, user_id, created_at DESC);
CREATE INDEX message_highlights_message ON message_highlights (workspace_id, user_id, message_id);

-- Заметка на сообщение: «важно», «запомнить», «спросить» и просто текст.
CREATE TABLE message_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('important','remember','question','note')),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);
CREATE INDEX message_notes_mine ON message_notes (workspace_id, user_id, created_at DESC);
CREATE INDEX message_notes_message ON message_notes (workspace_id, user_id, message_id);
