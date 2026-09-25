-- Тайм-трекинг поверх задач-обязательств.
--
-- Отдельного "проекта" или "клиента" в модели нет — час привязывается
-- к тому, что и так уже есть: к обязательству (commitment). Кто видит
-- задачу (владелец, постановщик, принимающий, соисполнитель или
-- руководитель команды — то же правило, что и во всём остальном модуле
-- задач, task-authority.js/canViewTask), тот и может отмерять на ней
-- время; отдельного права заводить не пришлось.
--
-- Таймер — не запись с длительностью, а интервал: `ended_at IS NULL`
-- значит «идёт прямо сейчас». Один человек — один запущенный таймер на
-- всё пространство сразу, а не на задачу: нельзя честно быть «в работе»
-- сразу над двумя вещами одновременно, и разрешать это значило бы
-- считать часы, которых не было.

CREATE TABLE time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, task_id) REFERENCES commitments(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

-- Партиционированный по условию уникальный индекс: строк с ended_at
-- NULL для одного человека может быть максимум одна. Это и есть
-- «один таймер за раз», принудительно на уровне базы, а не только в
-- коде репозитория, который могут вызвать из двух вкладок разом.
CREATE UNIQUE INDEX time_entries_one_running_idx ON time_entries (workspace_id, user_id) WHERE ended_at IS NULL;

CREATE INDEX time_entries_task_idx ON time_entries (workspace_id, task_id, started_at DESC);
CREATE INDEX time_entries_user_idx ON time_entries (workspace_id, user_id, started_at DESC);
