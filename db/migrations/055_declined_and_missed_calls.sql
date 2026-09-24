-- Отказ от звонка и звонок, которого никто не взял.
--
-- Отклонить входящий было нечем: кнопка «Не сейчас» просто убирала
-- плашку у того, кто отказался, и звонящий продолжал смотреть на гудки.
-- Единственным способом «уйти» был обычный выход, после которого человек
-- неотличим от того, у кого оборвалась связь.
--
-- Звонок, который никто не взял, оставался «звонящим» навсегда: срока у
-- этого состояния не было, в назначенных он не показывался, а завершить
-- его мог только тот, кто звонил. Человека, отошедшего от стола, никто
-- не извещал — понятия «пропущенный» в продукте не существовало.
ALTER TABLE call_participants DROP CONSTRAINT IF EXISTS call_participants_connection_state_check;
ALTER TABLE call_participants
  ADD CONSTRAINT call_participants_connection_state_check
  CHECK (connection_state IN ('invited','connecting','connected','reconnecting','disconnected','declined'));

ALTER TABLE call_sessions DROP CONSTRAINT IF EXISTS call_sessions_state_check;
ALTER TABLE call_sessions
  ADD CONSTRAINT call_sessions_state_check
  CHECK (state IN ('scheduled','ringing','active','ended','cancelled','missed'));

-- Звонки, зависшие в «звонит» с прошлых запусков, закрываем один раз:
-- иначе они останутся в списках навсегда и будут звонить мёртвым звоном.
--
-- Времени окончания у пропущенного нет и быть не может: таблица прямо
-- требует, чтобы законченное когда-то начиналось, а этот не начинался.
-- Когда звонили — помнит `created_at`.
UPDATE call_sessions
   SET state = 'missed', last_activity_at = COALESCE(last_activity_at, created_at)
 WHERE state = 'ringing' AND created_at < now() - interval '1 hour';
