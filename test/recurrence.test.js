import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecurrence, formatRecurrence, expandOccurrences, describeRecurrence, wallClock, instantOf } from '../src/calendar/recurrence.js';

const at = (iso) => new Date(iso);
const local = (instant, timeZone) => {
  const w = wallClock(instant, timeZone);
  return `${w.year}-${String(w.month).padStart(2,'0')}-${String(w.day).padStart(2,'0')} ${String(w.hour).padStart(2,'0')}:${String(w.minute).padStart(2,'0')}`;
};

test('правило разбирается и собирается обратно', () => {
  assert.equal(parseRecurrence(''), null);
  assert.equal(parseRecurrence(null), null);
  const weekly = parseRecurrence('FREQ=WEEKLY;BYDAY=MO,WE');
  assert.equal(weekly.freq, 'WEEKLY');
  assert.deepEqual(weekly.byDay, ['MO', 'WE']);
  assert.equal(formatRecurrence(weekly), 'FREQ=WEEKLY;BYDAY=MO,WE');
  assert.equal(formatRecurrence(parseRecurrence('RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5')), 'FREQ=DAILY;INTERVAL=2;COUNT=5');

  // Непонятое правило нельзя молча сохранить: это обещание повторения,
  // которого не будет.
  for (const bad of ['FREQ=HOURLY', 'INTERVAL=2', 'FREQ=WEEKLY;BYDAY=ПН', 'FREQ=DAILY;COUNT=0',
                     'FREQ=DAILY;COUNT=2;UNTIL=20261231', 'FREQ=MONTHLY;BYDAY=MO', 'FREQ=DAILY;BYSETPOS=1']) {
    assert.throws(() => parseRecurrence(bad), (error) => error.code === 'INVALID_RECURRENCE', `принято негодное правило: ${bad}`);
  }
});

test('еженедельная планёрка раскрывается по дням недели', () => {
  const rule = parseRecurrence('FREQ=WEEKLY;BYDAY=MO,WE,FR');
  const occurrences = expandOccurrences({
    startAt: at('2026-09-21T07:00:00Z'), // понедельник, 10:00 в Москве
    rule, timeZone: 'Europe/Moscow',
    from: '2026-09-21T00:00:00Z', to: '2026-10-05T00:00:00Z',
  });
  const days = occurrences.map((x) => local(x, 'Europe/Moscow'));
  assert.deepEqual(days, [
    '2026-09-21 10:00', '2026-09-23 10:00', '2026-09-25 10:00',
    '2026-09-28 10:00', '2026-09-30 10:00', '2026-10-02 10:00', '2026-10-04 10:00',
  ].slice(0, days.length));
  assert.equal(days[0], '2026-09-21 10:00');
  assert.ok(days.length >= 6, `ожидалось не меньше шести встреч, вышло ${days.length}`);
});

// Перевод часов — то место, где наивное «плюс семь суток в миллисекундах»
// сдвигает планёрку на час и делает это молча.
test('перевод часов не двигает время встречи', () => {
  const rule = parseRecurrence('FREQ=WEEKLY');
  const occurrences = expandOccurrences({
    startAt: at('2026-03-24T09:00:00Z'), // вторник, 10:00 в Берлине (зимнее время)
    rule, timeZone: 'Europe/Berlin',
    from: '2026-03-24T00:00:00Z', to: '2026-04-15T00:00:00Z',
  });
  const days = occurrences.map((x) => local(x, 'Europe/Berlin'));
  assert.ok(days.every((day) => day.endsWith('10:00')), `время съехало: ${days.join(', ')}`);
  // И мгновения при этом разные: после перевода тот же час — другой UTC.
  assert.equal(occurrences[0].toISOString(), '2026-03-24T09:00:00.000Z');
  assert.equal(occurrences[1].toISOString(), '2026-03-31T08:00:00.000Z');
});

test('ежемесячная встреча 31-го пропускает месяцы, в которых нет 31-го', () => {
  const rule = parseRecurrence('FREQ=MONTHLY');
  const occurrences = expandOccurrences({
    startAt: at('2026-01-31T12:00:00Z'), rule, timeZone: 'UTC',
    from: '2026-01-01T00:00:00Z', to: '2026-07-01T00:00:00Z',
  });
  const days = occurrences.map((x) => x.toISOString().slice(0, 10));
  // Февраля и апреля с 31-м числом не бывает: RFC такие вхождения
  // пропускает, а не сдвигает на 28-е — сдвинутая встреча оказывается не
  // там, где её ждут.
  assert.deepEqual(days, ['2026-01-31', '2026-03-31', '2026-05-31']);
});

test('COUNT и UNTIL обрывают серию', () => {
  const byCount = expandOccurrences({
    startAt: at('2026-09-21T09:00:00Z'), rule: parseRecurrence('FREQ=DAILY;COUNT=3'), timeZone: 'UTC',
    from: '2026-09-01T00:00:00Z', to: '2026-12-01T00:00:00Z',
  });
  assert.equal(byCount.length, 3);
  const byUntil = expandOccurrences({
    startAt: at('2026-09-21T09:00:00Z'), rule: parseRecurrence('FREQ=DAILY;UNTIL=20260924'), timeZone: 'UTC',
    from: '2026-09-01T00:00:00Z', to: '2026-12-01T00:00:00Z',
  });
  assert.deepEqual(byUntil.map((x) => x.toISOString().slice(0, 10)), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);
});

test('окно не выдаёт бесконечную серию целиком', () => {
  const many = expandOccurrences({
    startAt: at('2020-01-01T09:00:00Z'), rule: parseRecurrence('FREQ=DAILY'), timeZone: 'UTC',
    from: '2026-09-01T00:00:00Z', to: '2026-09-08T00:00:00Z',
  });
  // Окно кончается в полночь восьмого, а встреча в девять утра — значит
  // семь вхождений, а не восемь.
  assert.equal(many.length, 7);
  assert.equal(many[0].toISOString(), '2026-09-01T09:00:00.000Z');
  assert.equal(many.at(-1).toISOString(), '2026-09-07T09:00:00.000Z');

  const capped = expandOccurrences({
    startAt: at('2026-01-01T09:00:00Z'), rule: parseRecurrence('FREQ=DAILY'), timeZone: 'UTC',
    from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z', limit: 30,
  });
  assert.equal(capped.length, 30);
});

test('встреча без правила — это одно вхождение', () => {
  const one = expandOccurrences({
    startAt: at('2026-09-21T09:00:00Z'), durationMs: 3600000, rule: null, timeZone: 'UTC',
    from: '2026-09-21T00:00:00Z', to: '2026-09-22T00:00:00Z',
  });
  assert.equal(one.length, 1);
  // Встреча, начавшаяся до окна и идущая в него, тоже в окне: иначе
  // совещание, начатое в 23:50, пропадает из завтрашнего дня.
  const straddling = expandOccurrences({
    startAt: at('2026-09-20T23:50:00Z'), durationMs: 3600000, rule: null, timeZone: 'UTC',
    from: '2026-09-21T00:00:00Z', to: '2026-09-22T00:00:00Z',
  });
  assert.equal(straddling.length, 1);
});

test('настенное время и мгновение переводятся друг в друга', () => {
  const instant = instantOf({ year: 2026, month: 3, day: 29, hour: 10, minute: 0 }, 'Europe/Moscow');
  assert.equal(local(instant, 'Europe/Moscow'), '2026-03-29 10:00');
  assert.equal(local(instantOf({ year: 2026, month: 12, day: 31, hour: 23, minute: 30 }, 'America/New_York'), 'America/New_York'), '2026-12-31 23:30');
});

test('правило читается по-русски', () => {
  assert.equal(describeRecurrence(parseRecurrence('FREQ=WEEKLY;BYDAY=MO')), 'каждую неделю по пн');
  assert.equal(describeRecurrence(parseRecurrence('FREQ=DAILY')), 'каждый день');
  assert.equal(describeRecurrence(parseRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH')), 'каждые 2 недели по вт, чт');
  assert.match(describeRecurrence(parseRecurrence('FREQ=MONTHLY;COUNT=6')), /каждый месяц, 6 раз/);
});
