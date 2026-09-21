import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveryWorker } from '../src/integrations/delivery-worker.js';
import { createReminderWorker } from '../src/reminders/reminder-repository.js';
import { MeetingProcessor } from '../src/meeting/processor.js';

// Выключатель, который не выключает, хуже отсутствующего: в аварии на него
// рассчитывают. Сервер передавал работникам своё «включено» поверх
// переменной окружения, и WEBHOOK_WORKER_ENABLED=false ничего не значил.
test('переменные окружения действительно выключают работников', () => {
  const repository = { publishPending: async () => ({ events: 0, deliveries: 0 }), claimDue: async () => [] };

  const off = createDeliveryWorker(repository, { WEBHOOK_WORKER_ENABLED: 'false' });
  assert.equal(off.start(), false);
  assert.equal(off.status().configured, false);

  const on = createDeliveryWorker(repository, {});
  assert.equal(on.status().configured, true);
  on.stop();

  const reminders = { enabled: true, due: async () => ({ fired: 0 }) };
  const remindersOff = createReminderWorker(reminders, { env: { REMINDER_WORKER_ENABLED: 'false' } });
  remindersOff.start();
  remindersOff.stop();
});

// Аренда задачи — обещание вернуть её, если работник упадёт. Часовая
// расшифровка в зашитые пять минут не укладывалась, и задача уходила
// второму работнику, пока первый ещё работал.
test('срок аренды задачи встречи задаётся окружением', () => {
  const processor = new MeetingProcessor({ env: { MEETING_JOB_LEASE_MS: '1800000' } });
  assert.equal(processor.status().jobLeaseMs, 1_800_000);
  assert.equal(new MeetingProcessor({}).status().jobLeaseMs, 5 * 60 * 1000);
});
