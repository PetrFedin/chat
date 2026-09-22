/**
 * Производственный календарь.
 *
 * Праздники и переносы — не события, которые кто-то заводит: это
 * календарь страны, один на всех в рабочем пространстве. Поэтому они
 * приходят готовым списком, а не через форму создания встречи.
 *
 * Список встроенный и по России, потому что продукт русский и другого
 * пока никто не просил. Годы перечислены явно, а не выведены правилом:
 * переносы выходных объявляются постановлением каждый год, и вывести их
 * формулой нельзя — попытка угадать даёт неверный календарь, который
 * хуже отсутствующего.
 */

/** Постоянные праздничные дни: те, что не двигаются. */
const FIXED = [
  ['01-01', 'Новый год'],
  ['01-02', 'Новогодние каникулы'],
  ['01-03', 'Новогодние каникулы'],
  ['01-04', 'Новогодние каникулы'],
  ['01-05', 'Новогодние каникулы'],
  ['01-06', 'Новогодние каникулы'],
  ['01-07', 'Рождество Христово'],
  ['01-08', 'Новогодние каникулы'],
  ['02-23', 'День защитника Отечества'],
  ['03-08', 'Международный женский день'],
  ['05-01', 'Праздник Весны и Труда'],
  ['05-09', 'День Победы'],
  ['06-12', 'День России'],
  ['11-04', 'День народного единства'],
];

/**
 * Переносы по годам.
 *
 * Здесь только то, что объявлено постановлением правительства. Год, о
 * котором мы не знаем, отдаёт одни постоянные даты — и это честно: лучше
 * неполный календарь, чем выдуманный.
 */
const MOVED = {
  2026: [
    ['01-09', 'Новогодние каникулы (перенос)'],
    ['02-09', 'Перенос выходного'],
    ['03-09', 'Перенос выходного'],
    ['05-11', 'Перенос выходного'],
    ['06-15', 'Перенос выходного'],
    ['12-31', 'Перенос выходного'],
  ],
  2027: [
    ['01-11', 'Новогодние каникулы (перенос)'],
    ['05-03', 'Перенос выходного'],
    ['05-10', 'Перенос выходного'],
    ['06-14', 'Перенос выходного'],
    ['11-05', 'Перенос выходного'],
  ],
};

/** Сокращённые предпраздничные дни — рабочие, но короче. */
const SHORTENED = ['02-22', '03-07', '04-30', '05-08', '06-11', '11-03', '12-31'];

const pad = (value) => String(value).padStart(2, '0');

/**
 * Праздники года. `known` говорит, есть ли у нас данные о переносах:
 * без этого календарь 2035 года выглядел бы полным, хотя не знает ни
 * одного переноса.
 */
export function holidaysOfYear(year) {
  const known = Object.hasOwn(MOVED, year);
  const days = new Map();
  for (const [date, title] of FIXED) days.set(`${year}-${date}`, { title, dayOff: true });
  for (const [date, title] of MOVED[year] ?? []) days.set(`${year}-${date}`, { title, dayOff: true });
  for (const date of SHORTENED) {
    const key = `${year}-${date}`;
    // Сокращённым считается только тот день, который не стал выходным:
    // 31 декабря в год переноса — выходной, а не короткий рабочий.
    if (!days.has(key)) days.set(key, { title: 'Сокращённый рабочий день', dayOff: false });
  }
  return { known, days: [...days].map(([date, value]) => ({ date, ...value })).sort((a, b) => a.date.localeCompare(b.date)) };
}

/** Все праздники в отрезке дат, включая границы. */
export function holidaysBetween(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const out = [];
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
    for (const day of holidaysOfYear(year).days) {
      if (day.date >= from.slice(0, 10) && day.date <= to.slice(0, 10)) out.push(day);
    }
  }
  return out;
}

/**
 * Ближайшие дни рождения.
 *
 * Год не хранится, поэтому «ближайший» считается по дню и месяцу с
 * переходом через новый год: в декабре январские дни рождения ближе
 * февральских.
 */
export function upcomingBirthdays(people, { from = new Date(), days = 30 } = {}) {
  const out = [];
  for (const person of people) {
    if (!person.birthDay || !person.birthMonth) continue;
    for (let year = from.getUTCFullYear(); year <= from.getUTCFullYear() + 1; year += 1) {
      const date = `${year}-${pad(person.birthMonth)}-${pad(person.birthDay)}`;
      // 29 февраля в невисокосный год — такой даты нет, и придумывать её
      // (28-е или 1 марта) значит поздравлять не в тот день.
      const at = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(at.getTime()) || at.getUTCDate() !== person.birthDay) continue;
      const ahead = Math.floor((at.getTime() - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / 86400000);
      if (ahead < 0 || ahead > days) continue;
      out.push({ ...person, date, inDays: ahead });
      break;
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}

export { FIXED, MOVED, SHORTENED };
