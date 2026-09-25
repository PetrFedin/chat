-- Персональные API-ключи.
--
-- Весь REST API аутентифицировался только cookie-сессией браузера, а
-- значит сторонний сервис не мог постучаться в ChatX никак — только
-- живой человек с открытой вкладкой. Ключ работает как раз за того, кто
-- его выпустил: те же права, что у человека в интерфейсе, не шире.
-- Отдельной ролевой модели для интеграций нет и не должно быть —
-- источник прав один (rbac.js), ключ лишь другой способ доказать, кто
-- спрашивает.
--
-- Хранится хеш, не сам ключ — тем же приёмом и той же функцией
-- (`hashToken` из security.js), что и токен браузерной сессии. Показать
-- секрет второй раз после создания нельзя: потерялся — выпускайте
-- новый и отзывайте старый.
--
-- `key_prefix` — первые символы ключа в открытом виде, только для
-- того, чтобы в списке отличить один ключ от другого, не раскрывая
-- секрет целиком.
--
-- `read_only` — узкий, но честный первый шаг вместо полноценных
-- OAuth-скоупов: ключ либо может всё, что может его владелец, либо
-- только читать. Уже отсекает самый частый случай (аналитика читает
-- данные, но менять ничего не должна) без модели скоупов, которую
-- некому проектировать без реального внешнего потребителя API.

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  key_hash text NOT NULL,
  key_prefix text NOT NULL CHECK (length(key_prefix) BETWEEN 4 AND 24),
  read_only boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE,
  UNIQUE (key_hash)
);

CREATE INDEX api_keys_workspace_user_idx ON api_keys (workspace_id, user_id) WHERE revoked_at IS NULL;
