-- Запись звонка, которая «обрабатывается» часами (вебхук записи не пришёл или обработка не
-- началась), раньше висела так вечно и никого не уведомляла. Теперь такой звонок помечается
-- failed, а создателю приходит уведомление нового вида.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'message.created','message.mentioned','task.assigned','task.due','task.updated','task.rescheduled',
  'calendar.invited','calendar.reminder','calendar.updated','calendar.cancelled','calendar.responded',
  'review.requested','meeting.review_ready','meeting.failed','call.started','call.declined','call.missed'
]));
