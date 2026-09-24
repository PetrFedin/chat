-- База знаний компании.
--
-- HR-вопросы («сколько дней отпуска», «как оформить больничный», «куда
-- нести чек на возмещение») повторяются между сотрудниками, а ответ на
-- них раньше жил только в переписке конкретного человека с конкретным
-- HR — новый сотрудник не мог найти то, что вчера уже кому-то
-- объяснили. Статья — это написанный человеком ответ на один вопрос
-- или группу вопросов; правит её HR/руководство, читает вся компания.
--
-- Гость (внешний участник) не видит раздел вовсе: это внутренний
-- документ компании, не то, что показывают представителю заказчика.

CREATE TABLE knowledge_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  category text CHECK (category IS NULL OR length(category) <= 100),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, created_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, updated_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX knowledge_articles_workspace_idx ON knowledge_articles (workspace_id, updated_at DESC);

-- То же выражение, что и у остального полнотекстового поиска в продукте
-- (см. 047_russian_search.sql): словарь `russian` знает словоформы, и
-- «отпуска»/«отпуску»/«отпуском» сходятся к одному корню.
CREATE INDEX knowledge_articles_search_fts_idx ON knowledge_articles
  USING gin (to_tsvector('russian'::regconfig, coalesce(title, '') || ' ' || coalesce(body, '')));
