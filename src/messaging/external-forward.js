/**
 * Перенос переписки из WhatsApp и Telegram.
 *
 * Половина работы приходит оттуда: подрядчик пишет в WhatsApp,
 * заказчик присылает туда фотографию акта. Дальше это копируют сюда
 * руками, и вся привязка теряется — в беседе остаётся «прислали
 * смету», а через месяц не сказать ни кто прислал, ни когда.
 *
 * Разбираем то, что кладёт в буфер сам мессенджер. Форматов немного и
 * они устойчивы; всё, что не разобралось, переносится как есть —
 * потерять текст из-за неузнанной строки хуже, чем не угадать автора.
 */

/**
 * Начало сообщения в выгрузке.
 *
 * Три формы покрывают то, что кладут в буфер обмена WhatsApp (обе
 * платформы) и Telegram:
 *   [21.09.2026, 19:40:12] Олег Прораб: текст
 *   21.09.2026, 19:40 - Олег Прораб: текст
 *   Олег Прораб, [21.09.2026 19:40]
 */
const HEADS = [
  /^\[(?<date>\d{1,2}[./]\d{1,2}[./]\d{2,4}),?\s+(?<time>\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?<author>[^:]{1,80}):\s*(?<body>[\s\S]*)$/,
  /^(?<date>\d{1,2}[./]\d{1,2}[./]\d{2,4}),?\s+(?<time>\d{1,2}:\d{2}(?::\d{2})?)\s+[-–—]\s*(?<author>[^:]{1,80}):\s*(?<body>[\s\S]*)$/,
  /^(?<author>[^,\[\]]{1,80}),\s*\[(?<date>\d{1,2}[./]\d{1,2}[./]\d{2,4})[,\s]+(?<time>\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?<body>[\s\S]*)$/,
];

/**
 * Дата из выгрузки.
 *
 * День первым: и WhatsApp, и Telegram кладут в буфер местный формат, а
 * в русской раскладке это ДД.ММ.ГГГГ. Двузначный год — двухтысячные:
 * переписки из девяностых в рабочем пространстве не бывает.
 *
 * Часовой пояс неизвестен — в выгрузке его нет. Считаем временем того,
 * кто переносит: это единственный пояс, который мы действительно
 * знаем, и врать точностью тут не нужно.
 */
function parseStamp(date, time, offsetMinutes = 0) {
  const [d, m, y] = date.split(/[./]/).map(Number);
  const [hh, mm, ss = 0] = time.split(':').map(Number);
  const year = y < 100 ? 2000 + y : y;
  if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && hh <= 23 && mm <= 59 && ss <= 59)) return null;
  const at = new Date(Date.UTC(year, m - 1, d, hh, mm, ss) + offsetMinutes * 60000);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Разбирает вставленный кусок переписки.
 *
 * Возвращает строки с автором и временем там, где они нашлись, и
 * продолжения — там, где сообщение было многострочным.
 */
export function parseForwarded(text, { offsetMinutes = 0 } = {}) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    let matched = null;
    for (const head of HEADS) {
      const found = head.exec(trimmed);
      if (found) { matched = found.groups; break; }
    }
    if (matched) {
      entries.push({
        authorName: matched.author.trim() || null,
        sentAt: parseStamp(matched.date, matched.time, offsetMinutes),
        // Время сохраняем и строкой: в тексте надо показать те часы,
        // которые человек видел у себя, а не пересчитанные в UTC.
        timeText: matched.time.slice(0, 5),
        body: matched.body.trim(),
      });
      continue;
    }
    if (!entries.length) {
      // До первой узнанной шапки — просто текст: человек мог скопировать
      // одно сообщение без служебной строки.
      if (!trimmed) continue;
      entries.push({ authorName: null, sentAt: null, timeText: null, body: trimmed });
      continue;
    }
    // Продолжение многострочного сообщения.
    const last = entries[entries.length - 1];
    last.body = last.body ? `${last.body}\n${trimmed}` : trimmed;
  }
  return entries.filter((entry) => entry.body);
}

const SOURCE_NAME = {
  whatsapp: 'WhatsApp', telegram: 'Telegram', sms: 'СМС', email: 'почты', other: 'другого мессенджера',
};

export const SOURCES = new Set(Object.keys(SOURCE_NAME));
export const sourceName = (source) => SOURCE_NAME[source] ?? SOURCE_NAME.other;

/**
 * Готовит перенос: один текст беседы и одна отметка о происхождении.
 *
 * Одно сообщение, а не по одному на строку: человек переносит кусок
 * разговора, чтобы показать его целиком, и рассыпать этот кусок по
 * ленте значит утопить в нём саму беседу. Авторы и время остаются
 * внутри текста, у каждой строки своя.
 */
export function prepareForward({ text, source, authorName = null, sentAt = null, offsetMinutes = 0 }) {
  const entries = parseForwarded(text, { offsetMinutes });
  if (!entries.length) {
    throw Object.assign(new Error('Нечего переносить: текст пустой'),
      { code: 'EMPTY_FORWARD', statusCode: 400, expose: true });
  }
  const named = entries.filter((entry) => entry.authorName);
  const stamped = entries.filter((entry) => entry.sentAt);
  const body = entries
    .map((entry) => {
      if (!entry.authorName) return entry.body;
      const when = entry.timeText ? ` (${entry.timeText})` : '';
      return `${entry.authorName}${when}: ${entry.body}`;
    })
    .join('\n');

  const explicit = sentAt ? new Date(sentAt) : null;
  return {
    body,
    origin: {
      source: SOURCES.has(source) ? source : 'other',
      // Имя из выгрузки, если оно там было; иначе то, что назвал человек.
      authorName: named[0]?.authorName ?? (authorName ? String(authorName).slice(0, 120) : null),
      sentAt: stamped[0]?.sentAt ?? (explicit && !Number.isNaN(explicit.getTime()) ? explicit : null),
      lineCount: entries.length,
    },
  };
}
