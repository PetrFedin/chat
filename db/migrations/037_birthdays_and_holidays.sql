-- Дни рождения и нерабочие дни в календаре.
--
-- День рождения коллеги — единственная дата, которую в компании
-- узнают последними и жалеют об этом. Хранится намеренно без года:
-- поздравить нужно в правильный день, а возраст — не то, что человек
-- обязан сообщать работодателю, чтобы получить поздравление.
--
-- Праздники и переносы — не события, которые кто-то заводит: это
-- производственный календарь страны, один на всех в пространстве.
-- Поэтому отдельная таблица, а не строки в calendar_events: их никто не
-- создавал, их нельзя редактировать поштучно, и они не должны попадать
-- в отчёты о встречах.
ALTER TABLE workspace_profiles
  ADD COLUMN IF NOT EXISTS birth_day smallint CHECK (birth_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS birth_month smallint CHECK (birth_month BETWEEN 1 AND 12);

ALTER TABLE workspace_profiles
  DROP CONSTRAINT IF EXISTS workspace_profiles_birthday_check;
ALTER TABLE workspace_profiles
  ADD CONSTRAINT workspace_profiles_birthday_check
  -- Один день без месяца — не дата.
  CHECK ((birth_day IS NULL AND birth_month IS NULL) OR (birth_day IS NOT NULL AND birth_month IS NOT NULL));

CREATE TABLE IF NOT EXISTS workspace_holidays (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Календарная дата, а не момент: «первое января» — это день, и он
  -- одинаков во всех поясах, в отличие от полуночи.
  on_date         date NOT NULL,
  title           text NOT NULL,
  -- Выходной день или рабочий, объявленный праздничным (сокращённый
  -- предпраздничный — тоже рабочий).
  day_off         boolean NOT NULL DEFAULT true,
  source          text NOT NULL DEFAULT 'builtin',
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, on_date)
);

CREATE INDEX IF NOT EXISTS workspace_holidays_range_idx
  ON workspace_holidays (workspace_id, on_date);

-- Показывать ли слои в календаре — решение пространства, а не каждого
-- человека: нерабочий день одинаков для всех, кто в нём работает.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS show_birthdays boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_holidays boolean NOT NULL DEFAULT true;
