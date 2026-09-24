-- Напоминания.
--
-- Задача — это обязательство перед кем-то: у неё есть ответственный,
-- принимающий, доказательство и проверка. Напоминание — другое: это
-- разговор человека с самим собой. «Позвонить подрядчику в 15:00»,
-- «вернуться к этому письму завтра». Заводить ради этого обязательство
-- с доказательством — значит заставлять человека притворяться.
--
-- Поэтому отдельная сущность, и у неё одно обещание: в назначенный час
-- она сама придёт в центр внимания. Срабатывание идёт через ту же
-- durable-очередь, что и остальное в этом продукте: строка забирается
-- FOR UPDATE SKIP LOCKED, помечается и только потом порождает
-- уведомление — два работника не разбудят человека дважды.

CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  -- Кому напомнить. Напоминание личное: чужие его не видят и не правят.
  user_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  remind_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fired','done','cancelled')),
  -- Откуда оно взялось: из сообщения, задачи, встречи. Нажатие на
  -- напоминание должно возвращать человека туда, где он его поставил.
  source_type text CHECK (source_type IS NULL OR source_type IN ('message','task','event','conversation')),
  source_id uuid,
  conversation_id uuid,
  fired_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);

-- Очередь: работник берёт только просроченные и только ожидающие.
CREATE INDEX reminders_due ON reminders (remind_at) WHERE status = 'pending';
-- Список человека: его собственные, свежие сверху.
CREATE INDEX reminders_mine ON reminders (workspace_id, user_id, status, remind_at);
