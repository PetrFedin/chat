-- Откуда это пришло.
--
-- Половина работы приходит из WhatsApp и Telegram: подрядчик пишет туда,
-- заказчик присылает туда же фотографию акта. Дальше это копируют в
-- рабочее пространство — и вся привязка теряется. В переписке остаётся
-- «прислали смету», и через месяц никто не скажет ни кто прислал, ни
-- когда, ни где лежит подлинник.
--
-- Отдельная таблица, а не поле в `metadata`: по источнику нужно
-- фильтровать архив беседы, а искать по jsonb там, где будет обычный
-- перечень из пяти значений, — это выбор в пользу того, чтобы потом
-- было медленно.

CREATE TABLE message_external_origins (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  message_id uuid NOT NULL,
  -- Перечень закрытый: «откуда угодно» в фильтре бесполезно.
  source text NOT NULL CHECK (source IN ('whatsapp','telegram','sms','email','other')),
  -- Имя автора в том виде, в каком оно было там: сопоставлять его с
  -- сотрудниками нельзя — у подрядчика здесь учётной записи нет.
  author_name text,
  -- Когда это было сказано там, а не когда перенесли сюда.
  sent_at timestamptz,
  -- Сколько исходных сообщений уместилось в этот перенос.
  line_count integer NOT NULL DEFAULT 1 CHECK (line_count > 0),
  forwarded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, message_id),
  FOREIGN KEY (workspace_id, message_id) REFERENCES messages(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, forwarded_by) REFERENCES memberships(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX message_external_origins_source ON message_external_origins (workspace_id, source, created_at DESC);
