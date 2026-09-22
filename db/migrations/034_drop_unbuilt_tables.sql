-- Семь таблиц, за которыми не было ни строки кода.
--
-- `projects`, `project_members`, `teams`, `team_members`, `calendar_blocks`,
-- `device_registrations`, `message_receipts` — схема обещала проекты,
-- команды, блоки времени, реестр устройств и отметки о прочтении
-- каждого сообщения. Ни одного упоминания в `src/`, ни одной строки в
-- рабочей базе.
--
-- Пустая таблица — не безобидный задел. Она врёт следующему
-- разработчику («это уже есть, просто не доделали экран»), врёт тому,
-- кто читает базу, чтобы понять продукт, и мешает третьему: в ней уже
-- зафиксированы решения, которые придётся ломать, когда фичу
-- действительно начнут делать. Лучше пустое место, чем чужой чертёж.
--
-- Что из этого всё же нужно и почему сделано иначе:
--
--   * `teams`/`team_members` дублировали `org_units`/`org_unit_members` —
--     оргструктуру, которая работает и используется;
--   * `calendar_blocks` дублировали события календаря с kind='focus';
--   * `device_registrations` дублировали `push_subscriptions`;
--   * «кто прочитал сообщение» считается из отметок прочтения беседы
--     (`conversation_members.last_read_at`), а не строкой на каждое
--     сообщение на каждого участника: в канале на сорок человек это
--     сорок записей на реплику ради вопроса, который задают редко.
--
-- Проекты — отдельное продуктовое решение, и делать их тайком, оставив
-- в схеме след, нечестно. Понадобятся — заведём заново и с кодом.

ALTER TABLE commitments DROP COLUMN IF EXISTS project_id;

DROP TABLE IF EXISTS message_receipts;
DROP TABLE IF EXISTS device_registrations;
DROP TABLE IF EXISTS calendar_blocks;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS project_members;
DROP TABLE IF EXISTS projects;
