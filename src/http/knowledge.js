import { json, readJson } from './helpers.js';
import { Permission, requirePermission } from '../rbac.js';

const ID = '([0-9a-f-]{36})';
const ENTRY = new RegExp(`^/api/v1/knowledge/${ID}$`, 'i');

function unavailable(knowledge) {
  throw Object.assign(new Error('База знаний работает только с базой данных PostgreSQL'), { code: 'KNOWLEDGE_UNAVAILABLE', statusCode: 503, expose: true });
}

export function createKnowledgeHandler() {
  return async function handleKnowledge(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/knowledge')) return false;
    const session = await ctx.requireSession(req);
    const knowledge = ctx.knowledge;

    if (path === '/api/v1/knowledge' && method === 'GET') {
      requirePermission(session.role, Permission.KNOWLEDGE_READ);
      if (!knowledge?.enabled) unavailable(knowledge);
      const items = await knowledge.list(session, {
        query: url.searchParams.get('query'),
        category: url.searchParams.get('category'),
        limit: url.searchParams.get('limit') ?? 100,
      });
      json(res, 200, { items });
      return true;
    }
    if (path === '/api/v1/knowledge' && method === 'POST') {
      requirePermission(session.role, Permission.KNOWLEDGE_MANAGE);
      if (!knowledge?.enabled) unavailable(knowledge);
      const article = await knowledge.create(session, await readJson(req));
      json(res, 201, { article });
      return true;
    }
    if (path === '/api/v1/knowledge/ask' && method === 'POST') {
      requirePermission(session.role, Permission.KNOWLEDGE_READ);
      if (!knowledge?.enabled) unavailable(knowledge);
      const body = await readJson(req);
      const answer = await knowledge.ask(session, body.question);
      json(res, 200, answer);
      return true;
    }

    const m = path.match(ENTRY);
    if (m && method === 'GET') {
      requirePermission(session.role, Permission.KNOWLEDGE_READ);
      if (!knowledge?.enabled) unavailable(knowledge);
      json(res, 200, { article: await knowledge.get(session, m[1]) });
      return true;
    }
    if (m && method === 'PATCH') {
      requirePermission(session.role, Permission.KNOWLEDGE_MANAGE);
      if (!knowledge?.enabled) unavailable(knowledge);
      json(res, 200, { article: await knowledge.update(session, m[1], await readJson(req)) });
      return true;
    }
    if (m && method === 'DELETE') {
      requirePermission(session.role, Permission.KNOWLEDGE_MANAGE);
      if (!knowledge?.enabled) unavailable(knowledge);
      await knowledge.remove(session, m[1]);
      json(res, 200, { ok: true });
      return true;
    }

    throw Object.assign(new Error('Маршрут базы знаний не найден'), { code: 'NOT_FOUND', statusCode: 404 });
  };
}
