import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Одноразовые коды входа (RFC 6238).
 *
 * Пароль — единственное, что отделяло чужого человека от переписки
 * компании, паролей в сейфе и журнала действий. Подсмотренный через
 * плечо или совпавший с паролем от стороннего сайта, он открывал
 * рабочее пространство целиком, и заметить это было нечем.
 *
 * Своя реализация, а не библиотека: TOTP — это HMAC от номера
 * тридцатисекундного окна и шесть цифр из результата. Тянуть ради
 * этого зависимость в продукт с шестью зависимостями незачем, а
 * читается оно короче, чем её настройка.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
/**
 * Допуск в одно окно назад и вперёд.
 *
 * Часы на телефоне уходят на секунды, а человек набирает код не мгновенно.
 * Ноль допуска — это поток обращений «правильный код не подходит»;
 * большой допуск — это лишние тридцать секунд жизни у подсмотренного
 * кода. Одно окно в каждую сторону — обычный для этого выбор.
 */
const DRIFT = 1;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 без дополнения: в таком виде секрет читают приложения-аутентификаторы. */
export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of String(text ?? '').toUpperCase().replace(/[\s=-]/g, '')) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw Object.assign(new Error('Не похоже на секрет'), { code: 'INVALID_SECRET', statusCode: 400, expose: true });
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Новый секрет: двадцать случайных байт, как и советует стандарт. */
export const newSecret = () => base32Encode(randomBytes(20));

/** Код для заданного окна. */
export function codeAt(secret, counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Подходит ли код.
 *
 * Сравнение постоянного времени: посимвольное на шести цифрах — это
 * измеримая подсказка о том, сколько знаков угадано.
 */
export function verifyCode(secret, code, { now = Date.now() } = {}) {
  const given = String(code ?? '').replace(/\D/g, '');
  if (given.length !== DIGITS) return false;
  const counter = Math.floor(now / 1000 / STEP_SECONDS);
  for (let shift = -DRIFT; shift <= DRIFT; shift += 1) {
    const expected = Buffer.from(codeAt(secret, counter + shift));
    if (timingSafeEqual(expected, Buffer.from(given))) return true;
  }
  return false;
}

/**
 * Ссылка, которую приложение-аутентификатор читает с экрана.
 *
 * Имя издателя и учётной записи видит человек в списке своих кодов:
 * «ChatX» и адрес почты достаточно, чтобы через год понять, от чего этот
 * код.
 */
export function otpauthUrl({ secret, account, issuer = 'ChatX' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${query}`;
}

/**
 * Запасные коды.
 *
 * Телефон теряется и ломается, и без запасных кодов второй множитель
 * превращается в запертую дверь без ключа: единственным выходом
 * остаётся владелец компании, а если второй множитель был у него
 * самого — никакого выхода не остаётся.
 */
export function newRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => randomBytes(5).toString('hex').replace(/(.{5})/, '$1-'));
}
