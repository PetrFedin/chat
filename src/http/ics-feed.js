import { json } from './helpers.js';

const FEED = /^\/api\/v1\/calendar\/ics\/([0-9a-f]+)$/;

function unavailable() {
  throw Object.assign(new Error('Подписка на календарь работает только с базой данных PostgreSQL'), { code: 'ICS_FEED_UNAVAILABLE', statusCode: 503, expose: true });
}

export function createIcsFeedHandler() {
  return async function handleIcsFeed(req, res, ctx, path, method) {
    const icsFeed = ctx.icsFeed;

    // Сама подписка — публичный маршрут: её вызывает календарное
    // приложение по сохранённой ссылке, а не браузер с cookie сессии.
    const hook = path.match(FEED);
    if (hook && method === 'GET') {
      if (!icsFeed?.enabled) unavailable();
      const body = await icsFeed.renderFeed(hook[1]);
      res.setHeader('content-type', 'text/calendar; charset=utf-8');
      res.setHeader('content-disposition', 'inline; filename="chatx.ics"');
      res.statusCode = 200;
      res.end(body);
      return true;
    }

    if (path === '/api/v1/calendar/ics' && (method === 'GET' || method === 'POST')) {
      const session = await ctx.requireSession(req);
      if (!icsFeed?.enabled) unavailable();
      const token = method === 'POST' ? await icsFeed.regenerate(session) : await icsFeed.getOrCreateToken(session);
      json(res, 200, { token });
      return true;
    }
    if (path === '/api/v1/calendar/ics' && method === 'DELETE') {
      const session = await ctx.requireSession(req);
      if (!icsFeed?.enabled) unavailable();
      await icsFeed.revoke(session);
      json(res, 200, { ok: true });
      return true;
    }

    return false;
  };
}
