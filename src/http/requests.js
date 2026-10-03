import { Permission, requirePermission } from '../rbac.js';
import { json, readJson } from './helpers.js';
import { isGuest } from '../persistence/visibility.js';

const ID = '([0-9a-f-]{36})';
const TEMPLATE = new RegExp(`^/api/v1/request-templates/${ID}$`, 'i');
const TEMPLATE_ARCHIVE = new RegExp(`^/api/v1/request-templates/${ID}/(archive|restore)$`, 'i');
const REQUEST = new RegExp(`^/api/v1/requests/${ID}$`, 'i');
const REQUEST_ACTION = new RegExp(`^/api/v1/requests/${ID}/(decision|respond|cancel|complete)$`, 'i');

/**
 * Заявки и согласования. Шаблоны ведут владелец и администраторы, подавать и отвечать — любой сотрудник;
 * гость модуля не видит вовсе (404), как аудит и сейф.
 */
export function createRequestsHandler() {
  return async function handleRequests(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/requests') && !path.startsWith('/api/v1/request-templates')) return false;
    const session = await ctx.requireSession(req);
    if (isGuest(session)) throw Object.assign(new Error('Not found'), { code: 'NOT_FOUND', statusCode: 404 });
    const requests = ctx.requests;
    if (!requests) throw Object.assign(new Error('Заявки работают только с базой данных'), { code: 'REQUESTS_UNAVAILABLE', statusCode: 503, expose: true });
    const manageTemplates = () => requirePermission(session.role, Permission.MEMBER_MANAGE);

    if (path === '/api/v1/request-templates') {
      if (method === 'GET') {
        json(res, 200, { items: await requests.listTemplates(session, { includeArchived: url.searchParams.get('archived') === '1' && session.role !== 'member' }),
          canManage: ['owner', 'admin'].includes(session.role) });
        return true;
      }
      if (method === 'POST') {
        manageTemplates();
        json(res, 201, { template: await requests.createTemplate(session, await readJson(req)) });
        return true;
      }
    }
    let m = path.match(TEMPLATE);
    if (m && method === 'PATCH') {
      manageTemplates();
      json(res, 200, { template: await requests.updateTemplate(session, m[1], await readJson(req)) });
      return true;
    }
    m = path.match(TEMPLATE_ARCHIVE);
    if (m && method === 'POST') {
      manageTemplates();
      json(res, 200, await requests.archiveTemplate(session, m[1], m[2].toLowerCase() === 'archive'));
      return true;
    }

    if (path === '/api/v1/requests/queue' && method === 'GET') {
      json(res, 200, { queue: await requests.queue(session) });
      return true;
    }
    if (path === '/api/v1/requests') {
      if (method === 'GET') {
        json(res, 200, { items: await requests.list(session, {
          scope: url.searchParams.get('scope') ?? 'mine', status: url.searchParams.get('status'), limit: url.searchParams.get('limit') }) });
        return true;
      }
      if (method === 'POST') {
        const body = await readJson(req);
        json(res, 201, { request: await requests.submit(session, { templateId: String(body.templateId ?? ''), values: body.values, title: body.title }) });
        return true;
      }
    }
    m = path.match(REQUEST);
    if (m && method === 'GET') {
      json(res, 200, { request: await requests.get(session, m[1]) });
      return true;
    }
    m = path.match(REQUEST_ACTION);
    if (m && method === 'POST') {
      const body = await readJson(req);
      const action = m[2].toLowerCase();
      const result = action === 'decision' ? await requests.decide(session, m[1], { decision: String(body.decision ?? ''), comment: body.comment })
        : action === 'respond' ? await requests.respond(session, m[1], { values: body.values, comment: body.comment })
          : action === 'cancel' ? await requests.cancel(session, m[1], { comment: body.comment })
            : await requests.complete(session, m[1]);
      json(res, 200, { request: result });
      ctx.hub?.broadcastWorkspace?.(session.workspaceId, 'request.updated', { requestId: m[1] });
      return true;
    }
    return false;
  };
}
