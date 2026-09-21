import { Permission, requirePermission } from '../rbac.js';
import { cleanText, json, readJson } from './helpers.js';

/**
 * Настройки самой компании.
 *
 * Право `organization.manage` было единственным, чем владелец отличался от
 * администратора, — и не проверялось нигде, то есть отличия не было вовсе.
 * Здесь оно получает работу: переименование компании и передача владения.
 * И то и другое — решения хозяина, а не управляющего.
 */
export function createWorkspaceSettingsHandler() {
  return async function handleWorkspaceSettings(req, res, ctx, url, path, method) {
    if (path !== '/api/v1/workspace' && path !== '/api/v1/workspace/owner') return false;
    const session = await ctx.requireSession(req);
    requirePermission(session.role, Permission.ORGANIZATION_MANAGE);

    if (path === '/api/v1/workspace' && method === 'PATCH') {
      const body = await readJson(req);
      const companyName = body.companyName === undefined ? null : cleanText(body.companyName, 120);
      const workspaceName = body.workspaceName === undefined ? null : cleanText(body.workspaceName, 120);
      if (!companyName && !workspaceName) {
        throw Object.assign(new Error('Нечего менять'), { code: 'EMPTY_WORKSPACE_PATCH', statusCode: 400, expose: true });
      }
      json(res, 200, { workspace: await ctx.store.renameWorkspace(session, { companyName, workspaceName }) });
      return true;
    }

    // Передача владения: компания перестаёт быть привязанной к одному
    // человеку навсегда.
    if (path === '/api/v1/workspace/owner' && method === 'POST') {
      const body = await readJson(req);
      if (!body.userId) throw Object.assign(new Error('Кому передаём?'), { code: 'INVALID_OWNER', statusCode: 400, expose: true });
      json(res, 200, await ctx.store.transferOwnership(session, body.userId));
      return true;
    }

    throw Object.assign(new Error('Method not allowed'), { code: 'METHOD_NOT_ALLOWED', statusCode: 405 });
  };
}
