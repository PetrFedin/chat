-- Поиск по-русски.
--
-- Всё искалось словарём `simple`, который не знает словоформ: «выручку»
-- находилось, «выручка» — нет; «возвраты» находилось, «возвратов» —
-- нет. В русскоязычном продукте это значит, что человек должен угадать
-- ту самую форму, в которой написал коллега, — то есть поиском не
-- пользуются, а листают.
--
-- Словарь `russian` встроен в PostgreSQL и приводит слово к основе:
-- «возвраты», «возвратов», «возврату» → «возврат». Латиницу он
-- пропускает через английскую основу, так что «dashboard» и
-- «dashboards» тоже сходятся, а «Q3» остаётся собой.

-- Выражения в индексах: их семь, и каждый перестраивается на месте.
DROP INDEX IF EXISTS messages_search_fts_idx;
CREATE INDEX messages_search_fts_idx ON messages
  USING gin (to_tsvector('russian'::regconfig, coalesce(body, ''))) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS conversations_search_fts_idx;
CREATE INDEX conversations_search_fts_idx ON conversations
  USING gin (to_tsvector('russian'::regconfig, coalesce(title, '') || ' ' || coalesce(purpose, '')));

DROP INDEX IF EXISTS commitments_search_fts_idx;
CREATE INDEX commitments_search_fts_idx ON commitments
  USING gin (to_tsvector('russian'::regconfig, coalesce(title, '') || ' ' || coalesce(outcome, '')));

DROP INDEX IF EXISTS files_search_fts_idx;
CREATE INDEX files_search_fts_idx ON files
  USING gin (to_tsvector('russian'::regconfig, coalesce(name, ''))) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS workspace_profiles_search_fts_idx;
CREATE INDEX workspace_profiles_search_fts_idx ON workspace_profiles
  USING gin (to_tsvector('russian'::regconfig,
    coalesce(display_name, '') || ' ' || coalesce(email, '') || ' ' ||
    coalesce(title, '') || ' ' || coalesce(department, '')));

DROP INDEX IF EXISTS calendar_events_search_fts_idx;
CREATE INDEX calendar_events_search_fts_idx ON calendar_events
  USING gin (to_tsvector('russian'::regconfig, coalesce(title, '') || ' ' || coalesce(description, '')));

DROP INDEX IF EXISTS meeting_transcript_segments_fts_idx;
CREATE INDEX meeting_transcript_segments_fts_idx ON meeting_transcript_segments
  USING gin (to_tsvector('russian'::regconfig, coalesce(text, '')));

-- Вычисляемые столбцы: выражение меняется на месте, PostgreSQL 17 это
-- умеет и пересчитывает значения сам.
ALTER TABLE messages
  ALTER COLUMN body_tsv SET EXPRESSION AS (to_tsvector('russian'::regconfig, coalesce(body, '')));

ALTER TABLE file_texts
  ALTER COLUMN body_tsv SET EXPRESSION AS (to_tsvector('russian'::regconfig, body));
