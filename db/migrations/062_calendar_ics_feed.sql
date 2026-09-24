-- Личная подписка на календарь ChatX.
--
-- Google/Outlook/Apple Calendar умеют читать чужой календарь по одной
-- ссылке .ics и сами перечитывают её по расписанию — им не нужен OAuth,
-- если ссылка сама по себе секрет. Токен — тот самый секрет: длинная
-- случайная строка вместо пароля, потому что календарное приложение не
-- умеет вводить пароль само, а ссылку хранит у себя.
--
-- Один токен на человека в пространстве, а не на компанию целиком:
-- подписка отдаёт ровно то, что этому человеку и так видно (видимость
-- события уже проверяется тем же правилом, что и в самом ChatX), и
-- утечка чужой ссылки не должна открывать календарь всей компании.

CREATE TABLE calendar_feed_tokens (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE,
  UNIQUE (token)
);
