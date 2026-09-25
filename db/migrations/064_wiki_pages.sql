-- Вики: совместные страницы компании, не одна статья на вопрос, а
-- дерево документов, которое пишет и правит любой сотрудник, а не
-- только HR/руководство.
--
-- База знаний (060_knowledge_base.sql) остаётся отдельно и намеренно:
-- там куратор один, а неверный ответ про больничный стоит дороже
-- лишнего согласования. Здесь — обратная задача: черновик регламента,
-- заметки по проекту, план онбординга — то, что обычно живёт как
-- пять расходящихся версий одного файла в переписке, потому что писать
-- его могли все, а место для этого было только личное.
--
-- Правка не стирает прежний текст молча: `wiki_page_versions` хранит
-- снимок ДО каждой правки — тот же приём, что и у истории сообщений
-- (038_message_history_and_guest_expiry.sql), только для страниц.
-- `version` на самой странице — счётчик для optimistic concurrency:
-- та же защита от тихой перезаписи чужой правки, что у задач и бесед.

CREATE TABLE wiki_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  -- NULL — страница верхнего уровня. Родитель проверяется на
  -- совпадение workspace_id в коде, а не внешним ключом: составной
  -- внешний ключ на себя усложняет вставку первой страницы дерева ради
  -- защиты, которую и так даёт транзакция репозитория.
  parent_id uuid REFERENCES wiki_pages(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  content text NOT NULL DEFAULT '' CHECK (length(content) <= 100000),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Архивная страница остаётся читаемой по прямой ссылке и в истории,
  -- но пропадает из дерева и поиска: то же самое честное «не удаляем
  -- работу», что и у остального продукта.
  archived_at timestamptz,
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, created_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, updated_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, id)
);

CREATE INDEX wiki_pages_workspace_tree_idx ON wiki_pages (workspace_id, parent_id, title) WHERE archived_at IS NULL;
CREATE INDEX wiki_pages_search_fts_idx ON wiki_pages
  USING gin (to_tsvector('russian'::regconfig, coalesce(title, '') || ' ' || coalesce(content, '')))
  WHERE archived_at IS NULL;

CREATE TABLE wiki_page_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  page_id uuid NOT NULL,
  -- Версия, которой снимок БЫЛ до замены — тем же числом читатель
  -- истории сверяет, какая правка какую сменила.
  version integer NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  replaced_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, page_id) REFERENCES wiki_pages(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX wiki_page_versions_page_idx ON wiki_page_versions (workspace_id, page_id, replaced_at DESC);
