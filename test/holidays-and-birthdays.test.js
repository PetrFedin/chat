import test from 'node:test';
import assert from 'node:assert/strict';
import { holidaysOfYear, holidaysBetween, upcomingBirthdays } from '../src/calendar/holidays.js';

test('производственный календарь знает постоянные даты и переносы', () => {
  const year = holidaysOfYear(2026);
  assert.equal(year.known, true);
  const dates = year.days.map((d) => d.date);
  for (const date of ['2026-01-01', '2026-02-23', '2026-03-08', '2026-05-09', '2026-06-12', '2026-11-04']) {
    assert.ok(dates.includes(date), `в календаре нет ${date}`);
  }

  // Сокращённым считается только тот день, который не стал выходным.
  const shortened = year.days.find((d) => d.date === '2026-12-31');
  assert.equal(shortened.dayOff, true, '31 декабря 2026-го объявлен выходным переносом');
  const before = year.days.find((d) => d.date === '2026-02-22');
  assert.equal(before.dayOff, false);
  assert.equal(before.title, 'Сокращённый рабочий день');

  // Год, о котором данных нет, отдаёт постоянные даты и честно
  // признаётся: лучше неполный календарь, чем выдуманный.
  const unknown = holidaysOfYear(2035);
  assert.equal(unknown.known, false);
  assert.ok(unknown.days.some((d) => d.date === '2035-01-01'));
  assert.equal(unknown.days.some((d) => d.title.includes('перенос')), false, 'переносы для неизвестного года выдуманы');
});

test('отрезок дат отдаёт праздники, попавшие в него, и только их', () => {
  const may = holidaysBetween('2026-05-01T00:00:00Z', '2026-05-12T00:00:00Z').map((d) => d.date);
  assert.deepEqual(may, ['2026-05-01', '2026-05-08', '2026-05-09', '2026-05-11']);
  // Отрезок через новый год не теряет январь.
  const newYear = holidaysBetween('2026-12-28T00:00:00Z', '2027-01-09T00:00:00Z').map((d) => d.date);
  assert.ok(newYear.includes('2026-12-31'));
  assert.ok(newYear.includes('2027-01-07'));
  assert.equal(holidaysBetween('чепуха', '2026-01-01').length, 0);
});

/**
 * День рождения хранится без года: поздравить нужно в правильный день,
 * а возраст — не то, что человек обязан сообщать работодателю.
 */
test('ближайшие дни рождения считаются с переходом через новый год', () => {
  const people = [
    { userId: 'a', displayName: 'Нина', birthDay: 3, birthMonth: 1 },
    { userId: 'b', displayName: 'Олег', birthDay: 30, birthMonth: 12 },
    { userId: 'c', displayName: 'Анна', birthDay: 15, birthMonth: 6 },
    { userId: 'd', displayName: 'Без даты' },
  ];
  const soon = upcomingBirthdays(people, { from: new Date('2026-12-28T00:00:00Z'), days: 30 });
  assert.deepEqual(soon.map((p) => p.displayName), ['Олег', 'Нина'], 'январь должен быть ближе июня');
  assert.equal(soon[0].date, '2026-12-30');
  assert.equal(soon[1].date, '2027-01-03', 'после нового года берётся следующий год');
  assert.equal(soon[0].inDays, 2);

  // Человек без даты просто не попадает в список — это не ошибка.
  assert.equal(soon.some((p) => p.displayName === 'Без даты'), false);

  // 29 февраля в невисокосный год: такой даты нет, и придумывать её
  // значит поздравлять не в тот день.
  const leap = upcomingBirthdays([{ userId: 'e', displayName: 'Високосный', birthDay: 29, birthMonth: 2 }],
    { from: new Date('2026-02-01T00:00:00Z'), days: 60 });
  assert.equal(leap.length, 0);
  const real = upcomingBirthdays([{ userId: 'e', displayName: 'Високосный', birthDay: 29, birthMonth: 2 }],
    { from: new Date('2028-02-01T00:00:00Z'), days: 60 });
  assert.deepEqual(real.map((p) => p.date), ['2028-02-29']);
});

/**
 * Слои в календаре — не события.
 *
 * Их никто не заводил, открыть у них нечего, редактировать поштучно
 * нельзя. Поэтому они не лежат в `calendar_events` и в интерфейсе
 * рисуются строкой, а не кнопкой.
 */
test('праздники и дни рождения показаны как слои, а не как встречи', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /e\.readOnly\?`<div class="calendar-event layer/, 'слой снова рисуется кнопкой');
  assert.match(app, /e\.kind==='birthday'\?'поздравить'/);
  // Событие на весь день не показывает времени: «03:00» у дня рождения
  // — это не время, а пояс.
  assert.match(app, /agenda-time">\$\{e\.allDay\?'весь день':time\(e\.startAt\)\}/);
  // Слои включаются на всю компанию, а не каждым человеком.
  assert.match(app, /id="company-layers"/);
  assert.match(app, /showHolidays:data\.get\('showHolidays'\)==='on'/);
});
