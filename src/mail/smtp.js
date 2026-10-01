import net from 'node:net';
import tls from 'node:tls';

/**
 * Небольшой SMTP-клиент.
 *
 * Своей реализацией, а не библиотекой, по той же причине, по которой во
 * всём проекте шесть зависимостей: протокол отправки письма — это
 * десяток строковых команд и разбор трёхзначных кодов, и держать ради
 * него дерево из сорока пакетов в рабочем пространстве компании ни к
 * чему.
 *
 * Поддержано ровно то, что нужно, чтобы письмо ушло через обычный
 * почтовый сервис: STARTTLS или TLS сразу, AUTH LOGIN и AUTH PLAIN,
 * одно письмо за соединение.
 */

const CRLF = '\r\n';
const NUL = String.fromCharCode(0);

/** Отказ, про который сразу видно, повторять его или нет. */
export class SmtpError extends Error {
  constructor(message, { code = null, permanent = false } = {}) {
    super(message);
    this.name = 'SmtpError';
    this.smtpCode = code;
    // 5xx — «больше не присылайте»: такого ящика нет, письмо отвергнуто
    // навсегда. 4xx — «не сейчас»: переполнен, занят, попробуйте позже.
    this.permanent = permanent;
  }
}

const isPermanent = (code) => Number(code) >= 500 && Number(code) < 600;

/**
 * Разговор с сервером.
 *
 * SMTP отвечает строками «250-РАСШИРЕНИЕ» и завершает ответ строкой с
 * пробелом после кода: «250 OK». Ответ может прийти несколькими
 * пакетами, поэтому копим буфер и отдаём только целый ответ.
 */
function conversation(socket, { timeoutMs }) {
  let buffer = '';
  let waiting = null;

  const settle = () => {
    if (!waiting) return;
    const lines = buffer.split(CRLF).filter(Boolean);
    const last = lines[lines.length - 1];
    if (!last || !/^\d{3} /.test(last)) return;
    const code = Number(last.slice(0, 3));
    const text = lines.join('\n');
    buffer = '';
    const { resolve, reject, expected } = waiting;
    waiting = null;
    if (expected && !expected.includes(code)) {
      reject(new SmtpError(`сервер ответил ${code}: ${text}`, { code, permanent: isPermanent(code) }));
      return;
    }
    resolve({ code, text });
  };

  const fail = (error) => {
    if (!waiting) return;
    const { reject } = waiting;
    waiting = null;
    reject(error instanceof Error ? error : new SmtpError(String(error)));
  };

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => { buffer += chunk; settle(); });
  socket.on('error', fail);
  socket.on('close', () => fail(new SmtpError('соединение закрыто раньше ответа')));

  const read = (expected) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new SmtpError(`сервер молчит дольше ${timeoutMs} мс`)), timeoutMs);
    waiting = {
      expected,
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    };
    settle();
  });

  return {
    read,
    async send(line, expected) {
      socket.write(line + CRLF);
      return expected ? read(expected) : null;
    },
    // Данные письма заканчиваются одинокой точкой, поэтому строку,
    // которая сама начинается с точки, полагается удвоить.
    async sendData(body, expected) {
      const escaped = body.split(/\r?\n/).map((line) => (line.startsWith('.') ? `.${line}` : line)).join(CRLF);
      socket.write(`${escaped}${CRLF}.${CRLF}`);
      return read(expected);
    },
  };
}

const connect = ({ host, port, secure, timeoutMs, servername, trust = {} }) => new Promise((resolve, reject) => {
  const socket = secure
    ? tls.connect({ host, port, servername: servername ?? host, ...trust })
    : net.connect({ host, port });
  const onError = (error) => { socket.destroy(); reject(error); };
  socket.setTimeout(timeoutMs, () => onError(new SmtpError(`нет соединения с ${host}:${port} за ${timeoutMs} мс`)));
  socket.once('error', onError);
  socket.once(secure ? 'secureConnect' : 'connect', () => {
    socket.setTimeout(0);
    socket.removeListener('error', onError);
    resolve(socket);
  });
});

/**
 * Один разговор — одно письмо.
 *
 * Пул соединений здесь был бы преждевременным: писем в очереди единицы
 * в час, а живое соединение с почтовым сервером надо сторожить.
 */
export async function sendSmtpMail(message, options) {
  const {
    host, port = 587, secure = false, user = null, pass = null,
    timeoutMs = 20_000, servername = null, helo = 'localhost', ca = null,
  } = options;
  if (!host) throw new SmtpError('не задан адрес почтового сервера');
  // Свой удостоверяющий центр: у собственного почтового сервера в
  // компании сертификат обычно подписан её же центром, и без него
  // проверка подлинности не проходит. Отключаемой проверки здесь нет
  // намеренно: пароль уходит по этому соединению.
  const trust = ca ? { ca } : {};
  const socket = await connect({ host, port, secure, timeoutMs, servername, trust });

  const deliver = async (talk, raw, capabilities) => {
    if (user && pass) {
      if (/AUTH[^\n]*PLAIN/i.test(capabilities)) {
        await talk.send(`AUTH PLAIN ${Buffer.from(`${NUL}${user}${NUL}${pass}`).toString('base64')}`, [235]);
      } else {
        await talk.send('AUTH LOGIN', [334]);
        await talk.send(Buffer.from(user).toString('base64'), [334]);
        await talk.send(Buffer.from(pass).toString('base64'), [235]);
      }
    }
    await talk.send(`MAIL FROM:<${message.envelopeFrom}>`, [250]);
    await talk.send(`RCPT TO:<${message.to}>`, [250, 251]);
    await talk.send('DATA', [354]);
    await talk.sendData(message.raw, [250]);
    // Прощание дожидаемся: письмо уже принято на 250 после DATA, но
    // оборванное соединение почтовые серверы пишут себе в неудачи, а
    // отправителя с неудачами начинают придерживать.
    await talk.send('QUIT', [221]).catch(() => {});
    raw.end();
    return { accepted: true };
  };

  try {
    const talk = conversation(socket, { timeoutMs });
    await talk.read([220]);
    const capabilities = (await talk.send(`EHLO ${helo}`, [250])).text;

    // Открытым текстом пароль не уходит: если сервер умеет STARTTLS, мы
    // им пользуемся, и только потом здороваемся заново.
    if (!secure && /STARTTLS/i.test(capabilities)) {
      await talk.send('STARTTLS', [220]);
      const upgraded = await new Promise((resolve, reject) => {
        const wrapped = tls.connect({ socket, servername: servername ?? host, ...trust }, () => resolve(wrapped));
        wrapped.once('error', reject);
      });
      const secureTalk = conversation(upgraded, { timeoutMs });
      const secureCapabilities = (await secureTalk.send(`EHLO ${helo}`, [250])).text;
      return await deliver(secureTalk, upgraded, secureCapabilities);
    }
    // Сервер не умеет STARTTLS, а у нас есть пароль: отдавать его открытым текстом по сети нельзя
    // (раньше молча отдавали). Явное разрешение — MAIL_ALLOW_PLAINTEXT=true, для локальных стендов.
    const local = /^(localhost|127\.|::1$)/i.test(String(host));
    if (!secure && user && !local && process.env.MAIL_ALLOW_PLAINTEXT !== 'true') {
      throw new SmtpError('почтовый сервер не поддерживает шифрование STARTTLS: пароль открытым текстом не отправляем');
    }
    return await deliver(talk, socket, capabilities);
  } catch (error) {
    socket.destroy();
    throw error instanceof SmtpError ? error : new SmtpError(String(error?.message ?? error));
  }
}
