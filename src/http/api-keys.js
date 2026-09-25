import { json, readJson } from './helpers.js';

const ONE = /^\/api\/v1\/api-keys\/([0-9a-f-]{36})$/i;

function unavailable() {
  throw Object.assign(new Error('API-ключи работают только с базой данных PostgreSQL'), { code: 'API_KEYS_UNAVAILABLE', statusCode: 503, expose: true });
}

export function createApiKeysHandler() {
  return async function handleApiKeys(req, res, ctx, path, method) {
    if (path === '/api/v1/api-keys' && method === 'GET') {
      const session = await ctx.requireSession(req);
      if (!ctx.apiKeys?.enabled) unavailable();
      const items = await ctx.apiKeys.list(session);
      json(res, 200, { items });
      return true;
    }
    if (path === '/api/v1/api-keys' && method === 'POST') {
      const session = await ctx.requireSession(req);
      if (!ctx.apiKeys?.enabled) unavailable();
      const body = await readJson(req);
      const created = await ctx.apiKeys.create(session, { name: body.name, readOnly: Boolean(body.readOnly) });
      json(res, 201, created);
      return true;
    }
    const one = path.match(ONE);
    if (one && method === 'DELETE') {
      const session = await ctx.requireSession(req);
      if (!ctx.apiKeys?.enabled) unavailable();
      await ctx.apiKeys.revoke(session, one[1]);
      json(res, 200, { ok: true });
      return true;
    }
    return false;
  };
}
