import test from 'node:test';
import assert from 'node:assert/strict';
import { allows, inQuietHours, SWITCHES } from '../src/notifications/preferences.js';

const at = (iso) => new Date(iso);

/**
 * Тихие часы.
 *
 * «С 22 до 8» встречается чаще, чем «с 9 до 18», и наивное `from <= h < to`
 * даёт на таком интервале пустой промежуток — то есть тишины не будет
 * никогда, и человек об этом не узнает.
 */
test('тихий час считается по местному времени и переходит через полночь', () => {
  const night = { quietFrom: 22, quietTo: 8, timezone: 'Europe/Moscow' };
  assert.equal(inQuietHours(night, at('2026-09-21T20:30:00Z')), true, '23:30 в Москве — тишина');
  assert.equal(inQuietHours(night, at('2026-09-21T02:00:00Z')), true, '05:00 в Москве — тишина');
  assert.equal(inQuietHours(night, at('2026-09-21T09:00:00Z')), false, '12:00 в Москве — рабочее время');

  // Тот же момент в другом поясе — другой ответ: тишина у человека, а не
  // у сервера.
  assert.equal(inQuietHours({ ...night, timezone: 'America/New_York' }, at('2026-09-21T20:30:00Z')), false);

  const day = { quietFrom: 9, quietTo: 18, timezone: 'UTC' };
  assert.equal(inQuietHours(day, at('2026-09-21T12:00:00Z')), true);
  assert.equal(inQuietHours(day, at('2026-09-21T20:00:00Z')), false);

  // Не заданы — значит, тишины нет.
  assert.equal(inQuietHours({ timezone: 'UTC' }), false);
  assert.equal(inQuietHours({ quietFrom: 7, quietTo: 7, timezone: 'UTC' }), false, 'нулевой интервал — не тишина');
  // Мусор в поясе не должен глушить уведомления.
  assert.equal(inQuietHours({ quietFrom: 22, quietTo: 8, timezone: 'Марс/Олимп' }, at('2026-09-21T23:00:00Z')), false);
});

test('переключатели глушат свой класс событий и только его', () => {
  const noChannels = { channels: false };
  assert.equal(allows(noChannels, 'message.created'), false);
  assert.equal(allows(noChannels, 'message.mentioned'), true, 'упоминание — не «сообщение в канале»');
  assert.equal(allows(noChannels, 'task.assigned'), true);

  const noTasks = { tasks: false };
  for (const type of ['task.assigned', 'task.updated', 'task.rescheduled', 'review.requested']) {
    assert.equal(allows(noTasks, type), false, `${type} должен глушиться переключателем задач`);
  }

  // Человек, который ничего не настраивал, получает всё.
  assert.equal(allows(null, 'message.created'), true);
  assert.equal(allows({}, 'calendar.invited'), true);

  // Неизвестный тип пропускаем: забытый переключатель не должен молча
  // глушить целый класс уведомлений.
  assert.equal(allows({ channels: false }, 'что.то.новое'), true);
});

/**
 * Из тишины обязан быть выход.
 *
 * Тихие часы означают «не дёргайте по пустякам», а не «я недоступен».
 * Без исключения для личного обращения человек, которого позвали на
 * аварию, узнает об этом утром.
 */
test('в тихие часы личное обращение проходит, остальное — нет', () => {
  const night = { quietFrom: 22, quietTo: 8, timezone: 'UTC', quietAllowMentions: true };
  const asleep = at('2026-09-21T23:30:00Z');
  assert.equal(allows(night, 'message.mentioned', asleep), true);
  assert.equal(allows(night, 'message.created', asleep), false);
  assert.equal(allows(night, 'task.assigned', asleep), false);
  // Днём проходит всё.
  assert.equal(allows(night, 'message.created', at('2026-09-21T12:00:00Z')), true);

  // И этот выход можно закрыть — тогда тишина полная.
  const strict = { ...night, quietAllowMentions: false };
  assert.equal(allows(strict, 'message.mentioned', asleep), false);

  // Выключенные упоминания глушат и в тихий час, и днём: переключатель
  // сильнее исключения.
  assert.equal(allows({ ...night, mentions: false }, 'message.mentioned', asleep), false);
  assert.equal(allows({ ...night, mentions: false }, 'message.mentioned', at('2026-09-21T12:00:00Z')), false);
});

test('переключателей ровно столько, сколько объявлено', () => {
  assert.deepEqual(SWITCHES, ['mentions', 'direct', 'channels', 'tasks', 'calendar', 'meetings']);
});
