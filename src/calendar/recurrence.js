/**
 * Повторяющиеся встречи.
 *
 * Колонка `recurrence_rule` лежала в схеме с самого начала, и за ней не
 * было ни строки кода: еженедельную планёрку — самую частую встречу
 * вообще — заводили руками каждую неделю.
 *
 * Правило хранится подмножеством RFC 5545, потому что это формат, на
 * котором говорят все календари: строку можно отдать наружу и принять
 * извне, не выдумывая своего. Поддержано то, чем пользуются:
 * `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`, `INTERVAL`, `BYDAY` для недельного,
 * `COUNT` и `UNTIL`.
 *
 * Вхождения не материализуются строками. Серия «каждый понедельник, без
 * конца» — это бесконечное число строк, и любая правка потребовала бы
 * переписать их все; поэтому в базе лежит одно событие с правилом, а
 * вхождения раскрываются на чтение внутри запрошенного окна.
 */

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const FREQUENCIES = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
/** Потолок на окно: без него «покажи год вперёд» у ежедневной серии — 365 строк на одну встречу. */
const MAX_OCCURRENCES = 400;

const fail = (message, code = 'INVALID_RECURRENCE') =>
  Object.assign(new Error(message), { code, statusCode: 400, expose: true });

/**
 * Разбор правила.
 *
 * Возвращает null для события без повторения — это не ошибка, а обычный
 * случай. Всё, что не пусто и не разбирается, — ошибка: молча сохранить
 * непонятное правило значит пообещать повторение, которого не будет.
 */
export function parseRecurrence(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim().toUpperCase().replace(/^RRULE:/, '');
  const parts = new Map();
  for (const chunk of text.split(';')) {
    if (!chunk) continue;
    const at = chunk.indexOf('=');
    if (at < 1) throw fail(`Не разбирается часть правила: ${chunk}`);
    parts.set(chunk.slice(0, at), chunk.slice(at + 1));
  }

  const freq = parts.get('FREQ');
  if (!FREQUENCIES.has(freq)) throw fail('Правило повторения должно задавать FREQ: DAILY, WEEKLY, MONTHLY или YEARLY');

  const interval = parts.has('INTERVAL') ? Number(parts.get('INTERVAL')) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) throw fail('INTERVAL — целое от 1 до 365');

  let byDay = null;
  if (parts.has('BYDAY')) {
    if (freq !== 'WEEKLY') throw fail('BYDAY поддержан только для еженедельного повторения');
    byDay = parts.get('BYDAY').split(',').map((day) => day.trim()).filter(Boolean);
    if (!byDay.length || byDay.some((day) => !WEEKDAYS.includes(day))) throw fail('BYDAY перечисляет дни: MO,TU,WE,TH,FR,SA,SU');
    byDay = [...new Set(byDay)];
  }

  // COUNT и UNTIL вместе — противоречие: неизвестно, что из них главнее.
  if (parts.has('COUNT') && parts.has('UNTIL')) throw fail('COUNT и UNTIL вместе не имеют смысла — оставьте что-то одно');

  let count = null;
  if (parts.has('COUNT')) {
    count = Number(parts.get('COUNT'));
    if (!Number.isInteger(count) || count < 1 || count > MAX_OCCURRENCES) {
      throw fail(`COUNT — целое от 1 до ${MAX_OCCURRENCES}`);
    }
  }

  let until = null;
  if (parts.has('UNTIL')) {
    until = parseUntil(parts.get('UNTIL'));
    if (!until) throw fail('UNTIL — дата в виде 20261231T235959Z или 2026-12-31');
  }

  for (const key of parts.keys()) {
    if (!['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL'].includes(key)) {
      // Молчать про непонятую часть нельзя: человек задал ограничение, а
      // встречи пришли бы не туда, куда он просил.
      throw fail(`Часть правила ${key} не поддержана`);
    }
  }
  return { freq, interval, byDay, count, until };
}

function parseUntil(value) {
  const basic = String(value).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (basic) {
    const [, y, m, d, hh = '23', mm = '59', ss = '59'] = basic;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)));
  }
  const extended = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (extended) {
    const [, y, m, d] = extended;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 23, 59, 59));
  }
  return null;
}

/** Обратно в строку — для ответа наружу и для хранения в одном виде. */
export function formatRecurrence(rule) {
  if (!rule) return null;
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval && rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.join(',')}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  if (rule.until) parts.push(`UNTIL=${rule.until.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
  return parts.join(';');
}

/**
 * Настенное время мгновения в заданном поясе.
 *
 * Без этого повторение съезжает на переводе часов: «каждый вторник в
 * 10:00» должно оставаться десятью часами утра и в марте, и в ноябре, а
 * не превращаться в девять или одиннадцать.
 */
export function wallClock(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(instant);
  const take = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: take('year'), month: take('month'), day: take('day'), hour: take('hour') % 24, minute: take('minute'), second: take('second') };
}

/**
 * Мгновение по настенному времени в поясе.
 *
 * Решается в два прохода: берём догадку как если бы пояс был UTC, узнаём
 * настоящий сдвиг в этот момент и поправляем. Второй проход нужен на
 * границе перевода часов, где сдвиг до и после отличается.
 */
export function instantOf({ year, month, day, hour, minute, second = 0 }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = new Date(guess);
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = wallClock(instant, timeZone);
    const diff = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second) - guess;
    if (!diff) break;
    instant = new Date(instant.getTime() - diff);
  }
  return instant;
}

const addDays = ({ year, month, day }, days) => {
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
};

const weekdayOf = ({ year, month, day }) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();

/**
 * Вхождения серии внутри окна.
 *
 * `from`/`to` — границы окна; `startAt` — первая встреча серии. Возвращает
 * мгновения начала. Порядок — по возрастанию.
 */
export function expandOccurrences({ startAt, durationMs = 0, rule, timeZone = 'UTC', from, to, limit = MAX_OCCURRENCES }) {
  const first = new Date(startAt);
  if (Number.isNaN(first.getTime())) throw fail('У серии нет начала');
  if (!rule) {
    // Событие без повторения — одно вхождение, и оно попадает в окно,
    // если пересекается с ним, а не только если начинается внутри.
    return first.getTime() + durationMs >= new Date(from).getTime() && first <= new Date(to) ? [first] : [];
  }

  const windowFrom = new Date(from).getTime();
  const windowTo = new Date(to).getTime();
  const base = wallClock(first, timeZone);
  const time = { hour: base.hour, minute: base.minute, second: base.second };
  const out = [];
  let produced = 0;

  // Курсор идёт по календарным датам в поясе встречи, а не по миллисекундам:
  // «через неделю» — это семь календарных дней, сколько бы часов в них
  // ни оказалось после перевода.
  let cursor = { year: base.year, month: base.month, day: base.day };
  const wanted = rule.byDay?.length ? new Set(rule.byDay.map((day) => WEEKDAYS.indexOf(day))) : null;
  // Понедельник — первый день недели: так считает и RFC по умолчанию, и
  // рабочая неделя, ради которой всё это.
  const weekStart = (date) => addDays(date, -((weekdayOf(date) + 6) % 7));
  let weekCursor = weekStart(cursor);

  // Потолок проходов защищает от правила, которое не даёт вхождений
  // вовсе (29 февраля при FREQ=YEARLY): цикл обязан закончиться.
  for (let step = 0; step < 4000; step += 1) {
    let dates;
    if (rule.freq === 'WEEKLY' && wanted) {
      dates = [...wanted].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((weekday) => addDays(weekCursor, (weekday + 6) % 7));
    } else {
      dates = [cursor];
    }

    for (const date of dates) {
      // Месячное и годовое: дня может не быть в этом месяце (31-е в
      // феврале). RFC такие вхождения пропускает, а не сдвигает на
      // ближайший — сдвинутая встреча оказывается не там, где её ждут.
      if (new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDate() !== date.day) continue;
      const instant = instantOf({ ...date, ...time }, timeZone);
      if (instant < first) continue;
      if (rule.until && instant > rule.until) return out;
      produced += 1;
      if (rule.count && produced > rule.count) return out;
      if (instant.getTime() + durationMs >= windowFrom && instant.getTime() <= windowTo) {
        out.push(instant);
        if (out.length >= limit) return out;
      }
      if (instant.getTime() > windowTo) return out;
    }

    if (rule.freq === 'DAILY') cursor = addDays(cursor, rule.interval);
    else if (rule.freq === 'WEEKLY') {
      weekCursor = addDays(weekCursor, 7 * rule.interval);
      cursor = addDays(cursor, 7 * rule.interval);
    } else if (rule.freq === 'MONTHLY') cursor = { ...cursor, year: cursor.year + Math.floor((cursor.month - 1 + rule.interval) / 12), month: ((cursor.month - 1 + rule.interval) % 12) + 1 };
    else cursor = { ...cursor, year: cursor.year + rule.interval };

    // Ушли за окно и уже ничего не добавим.
    const probe = instantOf({ ...cursor, ...time }, timeZone);
    if (probe.getTime() > windowTo && out.length) return out;
    if (probe.getTime() > windowTo && !rule.count) return out;
  }
  return out;
}

/** Человеческое описание правила — для карточки события. */
/**
 * Русское числительное при числе.
 *
 * Формы подставлялись как константы, годные только для двух и трёх:
 * «каждые 5 года», «каждые 5 месяца», «2 раз». Это первое, что человек
 * читает на карточке планёрки, и по нему судит об остальном.
 */
const plural = (n, one, few, many) => {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
};

export function describeRecurrence(rule) {
  if (!rule) return null;
  const names = { MO: 'пн', TU: 'вт', WE: 'ср', TH: 'чт', FR: 'пт', SA: 'сб', SU: 'вс' };
  const n = rule.interval;
  let text;
  if (rule.freq === 'DAILY') text = n > 1 ? `каждые ${n} ${plural(n, 'день', 'дня', 'дней')}` : 'каждый день';
  else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay?.length ? ` по ${rule.byDay.map((day) => names[day]).join(', ')}` : '';
    text = (n > 1 ? `каждые ${n} ${plural(n, 'неделю', 'недели', 'недель')}` : 'каждую неделю') + days;
  } else if (rule.freq === 'MONTHLY') text = n > 1 ? `каждые ${n} ${plural(n, 'месяц', 'месяца', 'месяцев')}` : 'каждый месяц';
  else text = n > 1 ? `каждые ${n} ${plural(n, 'год', 'года', 'лет')}` : 'каждый год';
  if (rule.count) text += `, ${rule.count} ${plural(rule.count, 'раз', 'раза', 'раз')}`;
  if (rule.until) {
    text += `, до ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(rule.until)}`;
  }
  return text;
}

export { MAX_OCCURRENCES };
