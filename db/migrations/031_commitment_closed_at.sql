-- Когда обязательство закрыли — и закрыли ли в обещанный срок.
--
-- Весь продукт стоит на одной мысли: задача — это обещание одного
-- человека другому. Ответить на вопрос «держим ли мы слово» он при этом
-- не мог: в строке обязательства есть обещанный срок и текущее
-- состояние, но нет момента закрытия. `updated_at` не годится — он
-- сдвигается от любой правки, в том числе через месяц после закрытия.
--
-- Момент закрытия всё это время лежал в журнале аудита, в событии
-- перехода. Оттуда и берём: backfill точный, а не приблизительный.
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS closed_at timestamptz;

UPDATE commitments c
   SET closed_at = t.at
  FROM (
    SELECT a.aggregate_id, min(a.created_at) at
      FROM audit_events a
     WHERE a.aggregate_type = 'commitment'
       AND a.event_type = 'commitment.transitioned'
       AND a.payload->>'to' IN ('closed','accepted_result','cancelled','rejected')
     GROUP BY a.aggregate_id
  ) t
 WHERE c.id = t.aggregate_id
   AND c.closed_at IS NULL
   AND c.status IN ('closed','accepted_result','cancelled','rejected');

-- Задачи, закрытые до того, как журнал начали вести (или созданные сразу
-- закрытыми), получают время последней правки: лучше близкое значение,
-- чем дыра, из-за которой строка выпадает из любого отчёта.
UPDATE commitments
   SET closed_at = updated_at
 WHERE closed_at IS NULL
   AND status IN ('closed','accepted_result','cancelled','rejected');

-- Отчёт спрашивает «что закрыли за период» по всему пространству.
CREATE INDEX IF NOT EXISTS commitments_closed_idx
  ON commitments (workspace_id, closed_at DESC)
  WHERE closed_at IS NOT NULL;
