-- Живой мост в Telegram.
--
-- Перенос текста руками (миграция 041) остаётся честным способом для
-- разового «вот смета, которую прислал заказчик». Мост — для другого:
-- канал ChatX и группа в Telegram становятся одной перепиской без
-- переключения приложений, пока сообщение реально идёт через Telegram
-- Bot API в обе стороны.
--
-- Токен бота хранится запечатанным тем же ключом и той же функцией
-- (`seal`/`open` из src/vault/vault-repository.js), что и личный сейф
-- паролей: это тот же примитив «секрет, который не должен лежать в
-- базе открытым текстом», а не повод заводить второй механизм шифрования
-- ради одной таблицы.
--
-- `webhook_secret` — то, что мост передаёт Telegram при регистрации
-- вебхука (`secret_token`) и проверяет на входящем запросе через
-- заголовок `X-Telegram-Bot-Api-Secret-Token`: без него любой, кто
-- узнает URL вебхука, мог бы присылать поддельные сообщения от имени
-- партнёра.

CREATE TABLE telegram_bridges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  bot_token_sealed bytea NOT NULL,
  bot_username text NOT NULL CHECK (length(bot_username) BETWEEN 1 AND 100),
  telegram_chat_id text NOT NULL CHECK (length(telegram_chat_id) BETWEEN 1 AND 40),
  webhook_secret text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_error text,
  last_activity_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, workspace_id) REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, created_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT,
  -- Одна беседа ChatX ходит ровно в один чат Telegram: две привязки на
  -- одну беседу означали бы, что сообщение приходит туда дважды.
  UNIQUE (workspace_id, conversation_id),
  UNIQUE (webhook_secret)
);

CREATE INDEX telegram_bridges_workspace_idx ON telegram_bridges (workspace_id);
