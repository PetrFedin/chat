import { json, readJson, publicOrigin } from './helpers.js';
import { Permission, requirePermission } from '../rbac.js';

const ID = '([0-9a-f-]{36})';
const ENTRY = new RegExp(`^/api/v1/integrations/telegram/${ID}$`, 'i');
const WEBHOOK = /^\/api\/v1\/integrations\/telegram\/webhook\/([0-9a-zA-Z-]+)$/;

/** Тот же приём, что и в src/http/auth.js: адрес этого стенда глазами вызывающего. */
const originOf = (req) => publicOrigin(req);

function unavailable(telegram) {
  throw Object.assign(new Error('Мост с Telegram работает только с базой данных PostgreSQL'), { code: 'TELEGRAM_UNAVAILABLE', statusCode: 503, expose: true });
}

export function createTelegramHandler() {
  return async function handleTelegram(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/integrations/telegram')) return false;
    const telegram = ctx.telegram;

    // Вебхук — единственный маршрут этого модуля без сессии: его вызывает
    // Telegram, а не браузер человека. Подлинность проверяет секретный
    // заголовок, а не cookie.
    const hook = path.match(WEBHOOK);
    if (hook && method === 'POST') {
      if (!telegram?.enabled) unavailable(telegram);
      const update = await readJson(req);
      const result = await telegram.receiveUpdate(hook[1], req.headers['x-telegram-bot-api-secret-token'], update);
      json(res, 200, result);
      return true;
    }

    const session = await ctx.requireSession(req);
    requirePermission(session.role, Permission.INTEGRATION_MANAGE);
    if (!telegram?.enabled) unavailable(telegram);

    if (path === '/api/v1/integrations/telegram' && method === 'GET') {
      json(res, 200, { items: await telegram.list(session) });
      return true;
    }
    if (path === '/api/v1/integrations/telegram' && method === 'POST') {
      const body = await readJson(req);
      const bridge = await telegram.create(session, {
        conversationId: body.conversationId,
        botToken: body.botToken,
        chatId: body.chatId,
        publicBaseUrl: originOf(req),
      });
      json(res, 201, { bridge });
      return true;
    }
    const m = path.match(ENTRY);
    if (m && method === 'DELETE') {
      await telegram.remove(session, m[1]);
      json(res, 200, { ok: true });
      return true;
    }

    throw Object.assign(new Error('Маршрут моста с Telegram не найден'), { code: 'NOT_FOUND', statusCode: 404 });
  };
}
