-- Личное хранилище паролей.
--
-- Люди всё равно держат пароли: в заметках, в переписке с самим собой, в
-- файле на рабочем столе. Продукт, где есть рабочее место, обязан дать для
-- этого место получше — иначе пароль от подрядческого портала окажется в
-- канале «Общий», и вытащить его оттуда будет уже нельзя.
--
-- Три решения, которые здесь приняты.
--
-- Первое: секрет лежит зашифрованным (AES-256-GCM), ключ живёт в
-- окружении, а не в базе. Копия базы — дамп, реплика, украденный бэкап —
-- сама по себе паролей не выдаёт. От взломанного сервера это не спасает,
-- и честно так и сказано в интерфейсе.
--
-- Второе: запись личная. Не «пароль команды», а пароль человека: чужую
-- строку не видно ни в списке, ни поштучно. Общие доступы — отдельная
-- задача, и притворяться, что она решена, вредно.
--
-- Третье: раскрытие пишется в аудит. Пароль, который посмотрели, —
-- событие, и в корпоративном продукте оно должно оставлять след.

CREATE TABLE vault_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  login text CHECK (login IS NULL OR length(login) <= 200),
  url text CHECK (url IS NULL OR length(url) <= 500),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  -- nonce ‖ authTag ‖ ciphertext. Открытого текста здесь нет нигде.
  secret bytea NOT NULL,
  -- Чтобы смена ключа была возможна без гадания, чем зашифрована строка.
  key_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz,
  FOREIGN KEY (workspace_id, owner_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX vault_entries_mine ON vault_entries (workspace_id, owner_id, title);
