import { json, readJson } from './helpers.js';

const TASK_ID = '([0-9a-f-]{36})';
const ENTRY_ID = '([0-9a-f-]{36})';
const START = new RegExp(`^/api/v1/tasks/${TASK_ID}/time-entries/start$`, 'i');
const LIST_FOR_TASK = new RegExp(`^/api/v1/tasks/${TASK_ID}/time-entries$`, 'i');
const STOP = new RegExp(`^/api/v1/time-entries/${ENTRY_ID}/stop$`, 'i');

function unavailable() {
  throw Object.assign(new Error('Тайм-трекинг работает только с базой данных PostgreSQL'), { code: 'TIME_TRACKING_UNAVAILABLE', statusCode: 503, expose: true });
}

export function createTimeTrackingHandler() {
  return async function handleTimeTracking(req, res, ctx, url, path, method) {
    const start = path.match(START);
    if (start && method === 'POST') {
      const session = await ctx.requireSession(req);
      if (!ctx.timeEntries?.enabled) unavailable();
      const body = await readJson(req);
      json(res, 201, await ctx.timeEntries.start(session, start[1], { note: body.note }));
      return true;
    }
    const stop = path.match(STOP);
    if (stop && method === 'POST') {
      const session = await ctx.requireSession(req);
      if (!ctx.timeEntries?.enabled) unavailable();
      json(res, 200, await ctx.timeEntries.stop(session, stop[1]));
      return true;
    }
    const list = path.match(LIST_FOR_TASK);
    if (list && method === 'GET') {
      const session = await ctx.requireSession(req);
      if (!ctx.timeEntries?.enabled) unavailable();
      json(res, 200, await ctx.timeEntries.listForTask(session, list[1]));
      return true;
    }
    if (path === '/api/v1/time-entries/current' && method === 'GET') {
      const session = await ctx.requireSession(req);
      if (!ctx.timeEntries?.enabled) unavailable();
      json(res, 200, { entry: await ctx.timeEntries.current(session) });
      return true;
    }
    if (path === '/api/v1/time-entries/report' && method === 'GET') {
      const session = await ctx.requireSession(req);
      if (!ctx.timeEntries?.enabled) unavailable();
      json(res, 200, await ctx.timeEntries.report(session, {
        from: url.searchParams.get('from'), to: url.searchParams.get('to'), scope: url.searchParams.get('scope') || 'mine',
      }));
      return true;
    }
    return false;
  };
}
