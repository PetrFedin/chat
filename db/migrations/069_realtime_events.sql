-- Шина событий реального времени между копиями приложения (включается REALTIME_BUS=true).
--
-- Сокеты и подписки живут в памяти одного процесса: вторая копия приложения не знала бы, что человек
-- подключён к первой, и события до него не доходили. Событие кладётся сюда, NOTIFY будит остальные
-- копии, и каждая доставляет его своим сокетам. NOTIFY ограничен восемью килобайтами, поэтому по
-- каналу идёт только номер строки, а само событие читается из таблицы.
CREATE TABLE IF NOT EXISTS realtime_events (
  id          bigserial PRIMARY KEY,
  origin      text        NOT NULL,
  workspace_id uuid       NOT NULL,
  user_ids    uuid[],                       -- NULL = всё пространство
  event       text        NOT NULL,
  data        jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS realtime_events_created_idx ON realtime_events (created_at);
