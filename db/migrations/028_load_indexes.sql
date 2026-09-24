-- Опоры под запросы, которые становятся неподъёмными на объёмах года.
--
-- Каждая строка ниже — измеренная разница на стенде с данными года работы
-- компании на 200 человек: 150 000 сообщений, 20 000 задач, 300 000
-- уведомлений и столько же записей журнала.

-- Счётчик подтверждений пересчитывался перебором всей таблицы evidence на
-- каждую задачу: внешний ключ (workspace_id, commitment_id) не был ничем
-- прикрыт. Список задач: 5 706 мс → 43 мс.
CREATE INDEX IF NOT EXISTS evidence_commitment_idx
  ON evidence (workspace_id, commitment_id);

-- Лента уведомлений читала все уведомления человека и досортировывала: в
-- существующем индексе между получателем и временем стоял статус, который
-- в запросе по умолчанию не задан. 66 мс → 0,3 мс.
CREATE INDEX IF NOT EXISTS notifications_recipient_recent_idx
  ON notifications (workspace_id, recipient_user_id, created_at DESC, id DESC)
  WHERE archived_at IS NULL;

-- Журнал шёл назад по первичному ключу и отбрасывал чужие строки фильтром:
-- в одноарендной установке это незаметно, а рядом со вторым клиентом
-- первая страница стоила 71 мс и росла от чужой активности. → 0,1 мс.
CREATE INDEX IF NOT EXISTS audit_workspace_sequence_idx
  ON audit_events (workspace_id, sequence DESC);

-- Страница задач сортировалась без опоры, а отбор шёл по трём колонкам
-- через OR, из которых индекс был только на одной.
CREATE INDEX IF NOT EXISTS commitments_workspace_due_idx
  ON commitments (workspace_id, promised_at NULLS LAST, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS commitments_requester_idx
  ON commitments (workspace_id, requester_id);
CREATE INDEX IF NOT EXISTS commitments_acceptor_idx
  ON commitments (workspace_id, acceptor_id);

-- Внешние ключи без опоры: на чтении они не мешают, но каждое удаление
-- родителя превращают в полный проход по таблице.
CREATE INDEX IF NOT EXISTS commitments_parent_idx
  ON commitments (workspace_id, parent_commitment_id) WHERE parent_commitment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commitments_source_message_idx
  ON commitments (workspace_id, source_message_id) WHERE source_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_reply_to_idx
  ON messages (workspace_id, reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_thread_root_idx
  ON messages (workspace_id, thread_root_id) WHERE thread_root_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calendar_events_commitment_idx
  ON calendar_events (workspace_id, commitment_id) WHERE commitment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calendar_events_conversation_idx
  ON calendar_events (workspace_id, conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS files_uploaded_by_idx
  ON files (workspace_id, uploaded_by);
