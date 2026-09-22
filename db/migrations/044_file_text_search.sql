-- Поиск внутри вложений.
--
-- Поиск видел только имена файлов: «акт.docx» находился, слово
-- «щебень» из него — нет. В компании, где договоры и акты и есть
-- работа, это значит искать памятью: кто прислал и примерно когда.
--
-- Текст лежит отдельной таблицей, а не столбцом в `files`: он бывает
-- в сотни раз больше самой карточки файла, а читают карточку на
-- каждом экране со списком вложений.

CREATE TABLE file_texts (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  file_id uuid NOT NULL,
  -- Извлечённое содержимое; для поиска — свой tsvector, потому что
  -- считать его на каждый запрос по мегабайтам текста нельзя.
  body text NOT NULL,
  body_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED,
  -- Чем разобрали: docx, xlsx, text. По нему видно, что именно
  -- индексируется, и что PDF среди этого нет.
  kind text NOT NULL,
  extracted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, file_id),
  FOREIGN KEY (workspace_id, file_id) REFERENCES files(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX file_texts_search ON file_texts USING gin (body_tsv);
