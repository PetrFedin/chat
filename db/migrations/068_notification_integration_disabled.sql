-- Приёмник вебхуков, отключённый после череды неудач, раньше отключался молча: о том, что
-- интеграция перестала работать, узнавали от получателя. Теперь тому, кто её завёл, приходит
-- уведомление.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'message.created','message.mentioned','task.assigned','task.due','task.updated','task.rescheduled',
  'calendar.invited','calendar.reminder','calendar.updated','calendar.cancelled','calendar.responded',
  'review.requested','meeting.review_ready','meeting.failed','integration.disabled','call.started','call.declined','call.missed'
]));
