-- Свой протокол у каждой встречи серии.
--
-- Протокол привязывался к серии целиком, а не к встрече: записали, что
-- решили в понедельник, а в среду записали среду — и понедельник исчез
-- без предупреждения, вместе с решениями. Это потеря данных: «что мы
-- решили» отвечало неправдой, а в общем списке решений компании решение
-- среды стояло датой понедельника.
--
-- Вхождение адресуется моментом, на который оно приходится по правилу —
-- тем же признаком, которым уже адресуются перенос и отмена одной
-- встречи. У одиночной встречи момента нет: там `occurrence_at` пуст.
ALTER TABLE meeting_notes
  ADD COLUMN IF NOT EXISTS occurrence_at timestamptz;

DROP INDEX IF EXISTS meeting_notes_one_per_event;

-- `coalesce` вместо NULL: в уникальном индексе NULL не равен NULL, и
-- одиночная встреча получила бы сколько угодно протоколов.
CREATE UNIQUE INDEX IF NOT EXISTS meeting_notes_event_occurrence_uq
  ON meeting_notes (workspace_id, calendar_event_id, COALESCE(occurrence_at, '-infinity'::timestamptz))
  WHERE calendar_event_id IS NOT NULL;
