-- Сводка письмом.
--
-- «Что я пропустил» живёт только внутри продукта: чтобы её увидеть,
-- надо туда зайти. Человек, который был два дня на объекте, туда как
-- раз и не заходил — и узнаёт о просроченном сроке тогда же, когда о
-- нём узнаёт заказчик.
--
-- Час хранится числом по местному поясу человека: письмо в семь утра
-- по Москве и в семь утра по Красноярску — это разное время, и общий
-- для всех час означает, что кому-то оно приходит ночью.

ALTER TABLE notification_preferences
  ADD COLUMN daily_digest boolean NOT NULL DEFAULT false,
  ADD COLUMN digest_hour integer NOT NULL DEFAULT 8 CHECK (digest_hour BETWEEN 0 AND 23),
  -- Дата последней отправки, а не отметка времени: письмо в день, и
  -- сравнивать надо именно дни. Так повторный запуск рассылки в тот же
  -- день не пришлёт второе письмо.
  ADD COLUMN digest_sent_on date;

CREATE INDEX notification_preferences_digest
  ON notification_preferences (workspace_id) WHERE daily_digest;
