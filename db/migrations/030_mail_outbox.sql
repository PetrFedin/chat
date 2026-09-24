-- Почтового канала в продукте не было вообще.
--
-- Приглашение в компанию и ссылка на смену пароля создавались в базе, а
-- дальше их передавали руками: администратор копировал ссылку из ответа
-- API и отправлял её в мессенджере. В коде это было записано прямым
-- текстом — «Recovery has no mail channel, so an administrator issues the
-- link and hands it over», — и следствие ровно одно: человек, забывший
-- пароль, не мог ничего сделать сам, а новая компания не могла принять
-- ни одного сотрудника без участия того, кто уже внутри.
--
-- Очередь устроена как очередь доставок вебхуков и по тем же причинам:
-- аренда с токеном, повторы с отступом, мёртвая буква вместо вечного
-- перезапуска. Почта отказывает иначе, чем HTTP, но ведёт себя так же:
-- временный отказ сервера получателя нужно повторить, отказ «такого
-- ящика нет» — нет.
CREATE TABLE IF NOT EXISTS mail_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id     uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Зачем письмо: приглашение, сброс пароля. Нужен и для отчётности, и
  -- для того, чтобы не слать два одинаковых письма на одно событие.
  kind             text NOT NULL,
  -- Кто вызвал письмо: пригласивший, выдавший ссылку, либо сам человек,
  -- попросивший сброс. Нужен, чтобы недошедшее письмо попало в журнал
  -- аудита: там у каждой записи есть действующее лицо, и «система» —
  -- не ответ на вопрос, кого спрашивать, почему коллега не пришёл.
  actor_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  to_email         text NOT NULL,
  subject          text NOT NULL,
  text_body        text NOT NULL,
  html_body        text,
  -- Событие, породившее письмо: приглашение или запрос на сброс. Пара
  -- «вид + источник» уникальна, поэтому повторный вызов маршрута не
  -- ставит в очередь второе письмо.
  source_id        uuid,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','sending','sent','failed','dead')),
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 6,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  lock_token       uuid,
  locked_until     timestamptz,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);

-- Тот же частичный индекс, что у доставок: работник спрашивает только
-- про готовые к отправке, и читать ради этого всю таблицу незачем.
CREATE INDEX IF NOT EXISTS mail_messages_due_idx
  ON mail_messages (next_attempt_at)
  WHERE status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS mail_messages_workspace_idx
  ON mail_messages (workspace_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_source_idx
  ON mail_messages (kind, source_id) WHERE source_id IS NOT NULL;

-- Просьба о сбросе пароля приходит от неизвестного: до проверки почты мы
-- не знаем, наш это человек или тот, кто перебирает адреса. Считать
-- попытки по адресу — единственный способ не превратить маршрут в
-- рассылку по чужим ящикам от нашего имени.
CREATE TABLE IF NOT EXISTS password_reset_requests (
  email        text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_requests_idx
  ON password_reset_requests (email, requested_at DESC);
