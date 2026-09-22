-- Уведомления были устроены по принципу «всё или ничего».
--
-- Ни тихих часов, ни выбора, о чём присылать: в пространстве с сорока
-- каналами это первая причина выключить уведомления совсем — а вместе с
-- рекламой чужого канала человек перестаёт получать и упоминания, и
-- просроченные сроки, то есть ровно то, ради чего уведомления и нужны.
--
-- Набор переключателей намеренно короткий и по смыслу, а не по типам
-- событий: человек думает «меня позвали» и «сроки», а не
-- «message.mentioned» и «task.rescheduled». Сопоставление типов с
-- переключателями живёт в коде — там ему и место, потому что типы
-- меняются чаще, чем то, чего люди хотят.
CREATE TABLE IF NOT EXISTS notification_preferences (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Что присылать. Умолчание — всё: человек, который ничего не
  -- настраивал, должен получать уведомления, а не тишину.
  mentions        boolean NOT NULL DEFAULT true,
  direct          boolean NOT NULL DEFAULT true,
  channels        boolean NOT NULL DEFAULT true,
  tasks           boolean NOT NULL DEFAULT true,
  calendar        boolean NOT NULL DEFAULT true,
  meetings        boolean NOT NULL DEFAULT true,
  -- Тихие часы задаются местным временем человека — «не беспокоить с 22
  -- до 8», а не «с 19:00 UTC». Пояс берётся из его же профиля.
  quiet_from      smallint CHECK (quiet_from BETWEEN 0 AND 23),
  quiet_to        smallint CHECK (quiet_to BETWEEN 0 AND 23),
  -- Из тишины есть один выход, и он обязан быть: человека позвали лично.
  -- Без него тихие часы означают «я недоступен», а это другое обещание.
  quiet_allow_mentions boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  -- Одна граница без второй — не интервал.
  CONSTRAINT notification_preferences_quiet CHECK (
    (quiet_from IS NULL AND quiet_to IS NULL) OR (quiet_from IS NOT NULL AND quiet_to IS NOT NULL)
  )
);
