/**
 * Сборка письма.
 *
 * Русский текст в теме и в имени отправителя нельзя положить в заголовок
 * как есть: заголовки — семибитные, и почтовый сервер либо обрежет
 * старшие биты, либо откажется. Поэтому кодированное слово RFC 2047 для
 * заголовков и base64 для тела.
 */

const CRLF = '\r\n';
const ASCII_ONLY = /^[\x20-\x7e]*$/;

/** RFC 2047: «=?utf-8?B?…?=». Длинные значения режутся на части, иначе
 *  строка заголовка вылезает за 78 символов и её переносят где попало. */
export function encodeHeader(value) {
  const text = String(value ?? '');
  if (ASCII_ONLY.test(text)) return text;
  const chunks = [];
  let current = '';
  // Режем по символам, а не по байтам: разорванная посередине кириллица
  // превращается в вопросительные знаки.
  for (const character of text) {
    if (Buffer.byteLength(current + character) > 36) { chunks.push(current); current = ''; }
    current += character;
  }
  if (current) chunks.push(current);
  return chunks.map((chunk) => `=?utf-8?B?${Buffer.from(chunk).toString('base64')}?=`).join(`${CRLF} `);
}

/** Адрес с именем: имя кодируется, сам адрес остаётся как есть. */
export const formatAddress = (email, name) => (name ? `${encodeHeader(name)} <${email}>` : `<${email}>`);

const base64Body = (text) => (Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join(CRLF);

/**
 * Заголовки не принимают перевод строки: строка, попавшая в тему письма
 * из пользовательских данных (название компании, имя приглашающего),
 * иначе дописала бы в письмо свои заголовки — вплоть до второго
 * получателя.
 */
const singleLine = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

export function composeMail({ to, from, fromName, subject, text, html, messageId, date = new Date() }) {
  const headers = [
    `From: ${formatAddress(from, singleLine(fromName))}`,
    `To: <${singleLine(to)}>`,
    `Subject: ${encodeHeader(singleLine(subject))}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    // Письмо машинное: автоответчик «меня нет в офисе» на него отвечать
    // не должен, и в список рассылки оно не попадает.
    'Auto-Submitted: auto-generated',
    'X-Auto-Response-Suppress: All',
  ];

  if (!html) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    return `${headers.join(CRLF)}${CRLF}${CRLF}${base64Body(text)}`;
  }

  const boundary = `chat-${messageId.split('@')[0]}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const part = (type, body) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset=utf-8`,
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(body),
    '',
  ].join(CRLF);
  return [
    headers.join(CRLF),
    '',
    // Почтовик, не понимающий multipart, покажет эту строку — но таких
    // давно нет, и текстовая часть идёт первой именно для них.
    'Это письмо в формате MIME.',
    '',
    part('text/plain', text),
    part('text/html', html),
    `--${boundary}--`,
    '',
  ].join(CRLF);
}
