import { json, readJson } from './helpers.js';
import { Permission, requirePermission } from '../rbac.js';

const PAGE_ID = '([0-9a-f-]{36})';
const ONE = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}$`, 'i');
const HISTORY = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/history$`, 'i');

function unavailable() {
  throw Object.assign(new Error('Вики работает только с базой данных PostgreSQL'), { code: 'WIKI_UNAVAILABLE', statusCode: 503, expose: true });
}

export function createWikiHandler() {
  return async function handleWiki(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/wiki/')) return false;
    const session = await ctx.requireSession(req);
    requirePermission(session.role, Permission.WIKI_USE);
    if (!ctx.wiki?.enabled) unavailable();

    if (path === '/api/v1/wiki/pages' && method === 'GET') {
      const parentId = url.searchParams.get('parentId') || null;
      json(res, 200, { items: await ctx.wiki.list(session, { parentId }) });
      return true;
    }
    if (path === '/api/v1/wiki/pages' && method === 'POST') {
      const body = await readJson(req);
      json(res, 201, await ctx.wiki.create(session, body));
      return true;
    }
    if (path === '/api/v1/wiki/search' && method === 'GET') {
      json(res, 200, { items: await ctx.wiki.search(session, { query: url.searchParams.get('q'), limit: url.searchParams.get('limit') }) });
      return true;
    }
    const history = path.match(HISTORY);
    if (history && method === 'GET') {
      json(res, 200, { items: await ctx.wiki.history(session, history[1]) });
      return true;
    }
    const one = path.match(ONE);
    if (one && method === 'GET') {
      json(res, 200, await ctx.wiki.get(session, one[1]));
      return true;
    }
    if (one && method === 'PATCH') {
      const body = await readJson(req);
      json(res, 200, await ctx.wiki.update(session, one[1], body));
      return true;
    }
    if (one && method === 'DELETE') {
      await ctx.wiki.archive(session, one[1]);
      json(res, 200, { ok: true });
      return true;
    }
    return false;
  };
}
