import { randomUUID } from 'node:crypto';
import { composeMail } from './compose.js';
import { sendSmtpMail, SmtpError } from './smtp.js';
import { log } from '../obs/log.js';

/** Отступ между попытками: минута, две, четыре… но не дольше получаса. */
const backoffMs = (attempt) => Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));

/**
 * Настройки почты одним местом.
 *
 * Без MAIL_HOST канал выключен, и это нормальный режим для стенда: письма
 * тогда не копятся молча, а маршруты честно говорят, что почта не
 * настроена. Пустая строка считается «не задано» — иначе забытая
 * переменная в docker-compose выглядит как настроенный сервер.
 */
export function mailSettings(env = process.env) {
  const value = (name) => { const raw = env[name]; return raw === undefined || raw === '' ? null : raw; };
  const host = value('MAIL_HOST');
  const from = value('MAIL_FROM');
  return {
    host,
    port: Number(value('MAIL_PORT') ?? 587),
    secure: value('MAIL_SECURE') === 'true',
    user: value('MAIL_USER'),
    pass: value('MAIL_PASSWORD'),
    from,
    fromName: value('MAIL_FROM_NAME') ?? 'ChatX',
    helo: value('MAIL_HELO') ?? 'localhost',
    // Сертификат своего удостоверяющего центра, если почтовый сервер
    // стоит внутри компании: строкой в PEM.
    ca: value('MAIL_CA'),
    // Адрес возврата: сюда почтовый сервер получателя шлёт «ящик
    // переполнен». По умолчанию совпадает с отправителем.
    envelopeFrom: value('MAIL_RETURN_PATH') ?? from,
    // Домен в Message-ID: должен быть нашим, иначе письмо выглядит
    // подделкой под чужой домен.
    messageIdDomain: value('MAIL_MESSAGE_ID_DOMAIN') ?? (from ? String(from).split('@')[1] : 'localhost'),
    configured: Boolean(host && from),
    reason: host ? (from ? null : 'no-from') : 'no-host',
  };
}

/**
 * Работник почтовой очереди.
 *
 * Отдельный от доставок вебхуков: медленный почтовый сервер не должен
 * задерживать интеграции заказчика, и наоборот.
 */
export function createMailWorker(repository, env = process.env, options = {}) {
  const settings = options.settings ?? mailSettings(env);
  const enabled = options.enabled ?? (env.MAIL_WORKER_ENABLED !== 'false');
  const pollMs = Number(env.MAIL_WORKER_POLL_MS ?? 5000);
  const batchSize = Number(env.MAIL_WORKER_BATCH ?? 5);
  const leaseMs = Number(env.MAIL_LEASE_MS ?? 60_000);
  const workspaceIds = options.workspaceIds ?? null;
  // Подменяется в тестах: настоящий SMTP в тестах не поднимаем.
  const send = options.send ?? sendSmtpMail;

  const state = { running: false, stopping: false, sent: 0, failed: 0, dead: 0, lostLease: 0, queue: null, lastError: null, lastRunAt: null };
  let timer = null;

  async function deliver(message) {
    const messageId = `${randomUUID()}@${settings.messageIdDomain}`;
    const raw = composeMail({
      to: message.to,
      from: settings.from,
      fromName: settings.fromName,
      subject: message.subject,
      text: message.text,
      html: message.html,
      messageId,
    });
    try {
      await send({ to: message.to, envelopeFrom: settings.envelopeFrom, raw }, settings);
      const written = await repository.recordSent(message);
      if (written?.applied === false) {
        // Аренду перехватил другой работник: письмо уйдёт ещё раз.
        // Приглашение продублируется — знать об этом надо.
        state.lostLease += 1;
        log('warn', 'mail.lease.lost', { mailId: message.id, kind: message.kind });
        return;
      }
      state.sent += 1;
    } catch (error) {
      const permanent = error instanceof SmtpError && error.permanent;
      const result = await repository.recordFailure(message, {
        error: String(error?.message ?? error),
        retryInMs: permanent ? 0 : backoffMs(message.attempts),
        permanent,
      });
      state[result.dead ? 'dead' : 'failed'] += 1;
      if (result.dead) {
        // Приглашение, которое не дошло, для компании выглядит как
        // «человек не отвечает». Это обязано попадать в журнал.
        log('error', 'mail.undelivered', { mailId: message.id, kind: message.kind, reason: String(error?.message ?? error) });
      }
    }
  }

  async function pump() {
    const due = await repository.claimDue({ limit: batchSize, leaseMs, workspaceIds });
    await Promise.allSettled(due.map(deliver));
    return due.length;
  }

  const sleep = (ms) => new Promise((resolve) => { timer = setTimeout(resolve, ms); timer.unref?.(); });

  /** Один полный проход — для тестов и ручного прогона. */
  async function tick() {
    state.lastRunAt = new Date().toISOString();
    return { sent: await pump() };
  }

  async function loop() {
    while (!state.stopping) {
      try {
        state.lastRunAt = new Date().toISOString();
        const claimed = await pump();
        state.queue = await repository.backlog?.().catch(() => null) ?? state.queue ?? null;
        if (!claimed) await sleep(pollMs);
      } catch (error) {
        state.lastError = String(error.message ?? error);
        await sleep(pollMs);
      }
    }
    state.running = false;
  }

  return {
    tick,
    settings,
    start() {
      // Без настроенного сервера работник не запускается, но письма
      // продолжают копиться в очереди: настроят — уйдут все разом.
      if (!enabled || !repository || !settings.configured || state.running) return false;
      state.running = true;
      state.stopping = false;
      void loop();
      return true;
    },
    async stop() {
      state.stopping = true;
      if (timer) clearTimeout(timer);
    },
    status: () => ({ configured: Boolean(repository) && settings.configured && enabled, reason: settings.reason, ...state }),
  };
}
