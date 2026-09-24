import { json, noContent, readJson } from './helpers.js';

const ID = '([0-9a-f-]{36})';
const REMINDER = new RegExp(`^/api/v1/reminders/${ID}$`, 'i');

export function createRemindersHandler() {
  return async function handleReminders(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/reminders')) return false;
    const session = await ctx.requireSession(req);
    const reminders = ctx.reminders;
    if (!reminders?.enabled) {
      throw Object.assign(new Error('Reminders require a database deployment'),
        { code: 'REMINDERS_UNAVAILABLE', statusCode: 503, expose: true });
    }

    // Напоминание личное: гостю оно так же нужно, как сотруднику, и
    // ничего о компании не раскрывает — своё он видит, чужого нет.
    if (path === '/api/v1/reminders' && method === 'GET') {
      json(res, 200, {
        items: await reminders.list(session, {
          status: url.searchParams.get('status') ?? 'open',
          limit: url.searchParams.get('limit'),
        }),
      });
      return true;
    }

    if (path === '/api/v1/reminders' && method === 'POST') {
      json(res, 201, { reminder: await reminders.create(session, await readJson(req)) });
      return true;
    }

    const m = path.match(REMINDER);
    if (m && method === 'PATCH') {
      json(res, 200, { reminder: await reminders.update(session, m[1], await readJson(req)) });
      return true;
    }
    if (m && method === 'DELETE') {
      await reminders.remove(session, m[1]);
      noContent(res);
      return true;
    }

    throw Object.assign(new Error('Reminder route not found'), { code: 'NOT_FOUND', statusCode: 404 });
  };
}
