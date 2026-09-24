import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

/**
 * «Весь день» — это календарная дата, а не мгновение.
 *
 * Руководитель в Москве ставил отчётный день на 31 декабря; сервер хранил
 * мгновение 30 декабря 21:00 UTC и пояс события, а клиент раскладывал
 * события по клеткам в поясе браузера — и коллега в Нью-Йорке видел
 * отчётный день тридцатого. Поле `timezone` при этом лежало в базе с
 * самого начала и не использовалось в интерфейсе нигде.
 */
test('день события считается в его поясе, а не в поясе смотрящего', () => {
  // Функция берётся из живого кода, а не переписывается в тесте.
  const source = app.slice(app.indexOf('const eventDay='));
  const body = source.slice(0, source.indexOf('\n  const eventsOn='));
  const eventDay = new Function(`${body}; return eventDay;`)();

  const newYearInMoscow = {
    startAt: '2026-12-30T21:00:00.000Z', // 31 декабря 00:00 в Москве
    allDay: true,
    timezone: 'Europe/Moscow',
  };
  const day = eventDay(newYearInMoscow);
  assert.equal(day.getFullYear(), 2026);
  assert.equal(day.getMonth(), 11);
  assert.equal(day.getDate(), 31, 'отчётный день уехал на сутки');

  // Встреча — мгновение: её день считается по часам смотрящего, и пояс
  // события тут ни при чём.
  const meeting = { startAt: '2026-12-30T21:00:00.000Z', allDay: false, timezone: 'Europe/Moscow' };
  assert.equal(eventDay(meeting).getTime(), Date.parse(meeting.startAt));

  // Событие без пояса не должно ломать сетку.
  assert.equal(eventDay({ startAt: '2026-12-30T21:00:00.000Z', allDay: true }).getTime(),
    Date.parse('2026-12-30T21:00:00.000Z'));
  // И выдуманный пояс тоже.
  assert.ok(eventDay({ startAt: '2026-12-30T21:00:00.000Z', allDay: true, timezone: 'Не/Пояс' }) instanceof Date);
});

test('сетка календаря получает пояс события с сервера', () => {
  const repository = readFileSync(new URL('../src/calendar/calendar-repository.js', import.meta.url), 'utf8');
  const listRange = repository.slice(repository.indexOf('async listRange'), repository.indexOf('pendingInvitations'));
  assert.match(listRange, /e\.timezone/, 'сетка снова считает день в поясе браузера');
});
