-- Извещения о звонках.
--
-- Звонок был слышен только тому, кто сидел у экрана: извещение уходило
-- в браузерный push и никуда больше, а push — вещь необязательная и
-- выключаемая. Человек, отошедший от стола, не узнавал ни что ему
-- звонили, ни что звонок не состоялся; в списке уведомлений звонков не
-- было как класса.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
      'message.created',
      'message.mentioned',
      'task.assigned',
      'task.due',
      'task.updated',
      'task.rescheduled',
      'calendar.invited',
      'calendar.reminder',
      'calendar.updated',
      'calendar.cancelled',
      'calendar.responded',
      'review.requested',
      'meeting.review_ready',
      'call.started',
      'call.declined',
      'call.missed'
    )
  );
