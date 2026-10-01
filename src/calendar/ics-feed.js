/**
 * Сборка .ics из событий ChatX.
 *
 * Не пересчитываем повторения сами (см. calendar-repository.js
 * expandSeries — то другая задача, окно вперёд-назад для экрана):
 * подписка отдаёт саму серию с её RRULE и EXDATE, а раскрывать её на
 * годы вперёд — работа календарного приложения, не сервера. Отдельным
 * VEVENT с RECURRENCE-ID идёт перенесённое или переименованное
 * вхождение — тем же способом, которым это делает сам стандарт
 * (RFC 5545), а не выдумкой поверх него.
 */

const escapeText = (value) => String(value ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** UTC-штамп в формате iCalendar: 20260101T120000Z. */
const stampUtc = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Дата без времени для событий на весь день: 20260101. */
const stampDate = (value, timeZone) => {
  // Из базы приходит Date, а не строка: String(Date) давал «Tue Nov 10» вместо 20261110, и
  // календарные клиенты отбрасывали такие события. День берём в поясе самой встречи.
  const at = new Date(value);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    return parts.replace(/-/g, '');
  } catch {
    return at.toISOString().slice(0, 10).replace(/-/g, '');
  }
};

/** Строки длиннее 75 октетов складываются продолжением с одним пробелом впереди — правило самого стандарта. */
function foldLine(line) {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let cut = 75;
    while (cut > 0 && Buffer.byteLength(rest.slice(0, cut), 'utf8') > 74) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ' ' + rest.slice(cut);
  }
  out.push(rest);
  return out.join('\r\n');
}

function eventLines(event) {
  const lines = [];
  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${event.id}@chatx`);
  lines.push(`DTSTAMP:${stampUtc(event.updatedAt ?? event.createdAt)}`);
  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${stampDate(event.startAt, event.timezone)}`);
    // DTEND у события на весь день исключающий: конец 23:59:59 последнего дня — это начало следующего.
    if (event.endAt) lines.push(`DTEND;VALUE=DATE:${stampDate(new Date(new Date(event.endAt).getTime() + 1000), event.timezone)}`);
  } else {
    lines.push(`DTSTART:${stampUtc(event.startAt)}`);
    if (event.endAt) lines.push(`DTEND:${stampUtc(event.endAt)}`);
  }
  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.recurrenceRule) lines.push(`RRULE:${event.recurrenceRule}`);
  for (const exception of event.exceptions ?? []) {
    if (exception.cancelled) lines.push(`EXDATE:${event.allDay ? stampDate(exception.at, event.timezone) : stampUtc(exception.at)}`);
  }
  lines.push(`LAST-MODIFIED:${stampUtc(event.updatedAt ?? event.createdAt)}`);
  lines.push('END:VEVENT');

  for (const exception of event.exceptions ?? []) {
    if (exception.cancelled) continue;
    const startAt = exception.startAt ?? exception.at;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.id}@chatx`);
    lines.push(`RECURRENCE-ID:${event.allDay ? stampDate(exception.at, event.timezone) : stampUtc(exception.at)}`);
    lines.push(`DTSTAMP:${stampUtc(event.updatedAt ?? event.createdAt)}`);
    lines.push(event.allDay ? `DTSTART;VALUE=DATE:${stampDate(startAt, event.timezone)}` : `DTSTART:${stampUtc(startAt)}`);
    if (exception.endAt) lines.push(event.allDay ? `DTEND;VALUE=DATE:${stampDate(new Date(new Date(exception.endAt).getTime() + 1000), event.timezone)}` : `DTEND:${stampUtc(exception.endAt)}`);
    lines.push(`SUMMARY:${escapeText(exception.title ?? event.title)}`);
    lines.push('END:VEVENT');
  }
  return lines;
}

export function buildIcsFeed(events, { calendarName = 'ChatX' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ChatX//Calendar Feed//RU',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  for (const event of events) lines.push(...eventLines(event));
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
