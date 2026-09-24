-- «В отпуске», «на обеде», «буду завтра в десять».
--
-- Присутствие в продукте было техническим: в сети, отошёл, не
-- беспокоить — то, что вычисляет само приложение по сокету. Но человеку
-- на работе нужно другое: не «онлайн ли Нина», а «когда она вернётся».
-- Свободная строка статуса это отчасти закрывала, но её нельзя ни
-- показать значком, ни отсортировать, ни погасить автоматически — и
-- «на обеде до 14:00» висело до вечера.
--
-- Поэтому рядом с техническим состоянием появляется объявленная
-- доступность: короткий набор понятных слов и момент возвращения.
ALTER TABLE user_presence
  ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'available',
  -- Когда человек снова будет на месте. Отсюда и «буду завтра в 10», и
  -- «вернусь 5-го с 14:00»: это одно и то же поле, просто разный момент.
  ADD COLUMN IF NOT EXISTS back_at timestamptz;

ALTER TABLE user_presence
  DROP CONSTRAINT IF EXISTS user_presence_availability_check;
ALTER TABLE user_presence
  ADD CONSTRAINT user_presence_availability_check
  CHECK (availability IN ('available','meeting','lunch','focus','away','sick','vacation','trip'));

-- Список людей спрашивает доступность на каждом экране, где видно имена.
CREATE INDEX IF NOT EXISTS user_presence_availability_idx
  ON user_presence (workspace_id, availability) WHERE availability <> 'available';
