-- Поиск по сообщениям читал всю таблицу на каждый запрос.
--
-- Две причины, обе измерены на стенде со 150 000 сообщений. Первая:
-- `to_tsvector` вычислялся заново для каждой строки-кандидата — только
-- ради того, чтобы отдать тридцать. Вторая: рядом с полнотекстовым
-- условием стояло `OR body ILIKE '%…%'`, которое не индексируется ничем,
-- и планировщик отбрасывал GIN-индекс целиком, переходя на полный проход.
--
-- Отсюда странное свойство: поиск стоил одинаково и когда нашлось три
-- сообщения, и когда сто тысяч. 496 мс на слове, встречающемся в трети
-- переписки, и 183 мс на слове из четырёхсот сообщений.

-- Разобранный текст хранится вместе со строкой и обновляется базой сам.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS body_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce(body, ''))) STORED;

CREATE INDEX IF NOT EXISTS messages_body_tsv_idx
  ON messages USING gin (body_tsv) WHERE deleted_at IS NULL;

-- Подстрочный поиск («смет» внутри «сметы») получает собственную опору,
-- вместо того чтобы обнулять план соседнего условия.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS messages_body_trgm_idx
  ON messages USING gin (body gin_trgm_ops) WHERE deleted_at IS NULL;
