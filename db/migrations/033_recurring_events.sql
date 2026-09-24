-- Повторяющиеся встречи.
--
-- Колонка `recurrence_rule` лежала в схеме с самого начала, и кода за ней
-- не было ни строки: еженедельную планёрку — самую частую встречу
-- вообще — заводили руками каждую неделю.
--
-- Вхождения намеренно не материализуются строками. Серия «каждый
-- понедельник, без конца» — это бесконечное число строк, и любая правка
-- заголовка потребовала бы переписать их все. В базе лежит одно событие
-- с правилом, вхождения раскрываются на чтение.
--
-- Отсюда эта таблица: всё, чем отдельная встреча отличается от серии.
-- Отменили одну планёрку на праздники — строка «это вхождение
-- отменено»; перенесли одну на час — строка с новым временем. Правило
-- при этом не трогается, и остальная серия остаётся на месте.
CREATE TABLE IF NOT EXISTS calendar_event_exceptions (
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  calendar_event_id uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  -- Момент, на который вхождение приходилось по правилу. Это его
  -- опознавательный знак: перенесённое вхождение помнит, откуда оно.
  occurrence_at     timestamptz NOT NULL,
  cancelled         boolean NOT NULL DEFAULT false,
  start_at          timestamptz,
  end_at            timestamptz,
  title             text,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, calendar_event_id, occurrence_at),
  -- Перенос без нового времени — не перенос; отмена с новым временем —
  -- противоречие. Пусть база не даст записать ни того, ни другого.
  CONSTRAINT calendar_event_exceptions_shape CHECK (
    (cancelled AND start_at IS NULL AND end_at IS NULL) OR (NOT cancelled AND start_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS calendar_event_exceptions_event_idx
  ON calendar_event_exceptions (workspace_id, calendar_event_id, occurrence_at);
