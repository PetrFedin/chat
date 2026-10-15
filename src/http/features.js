import { Permission, requirePermission } from '../rbac.js';
import { json, readJson } from './helpers.js';
import { isGuest } from '../persistence/visibility.js';

const ONE = /^\/api\/v1\/features\/([a-z_]+)$/;

/**
 * Включение и отключение функций. Смотреть список может любой сотрудник (он объясняет, почему раздела нет),
 * менять — владелец и администраторы. Ответ на изменение называет всё, что выключилось или включилось вместе с выбранной функцией.
 */
export function createFeaturesHandler() {
  return async function handleFeatures(req, res, ctx, url, path, method) {
    if (path !== '/api/v1/features' && !ONE.test(path)) return false;
    const session = await ctx.requireSession(req);
    if (isGuest(session)) throw Object.assign(new Error('Not found'), { code: 'NOT_FOUND', statusCode: 404 });
    const features = ctx.features;

    if (path === '/api/v1/features' && method === 'GET') {
      json(res, 200, { items: await features.list(session.workspaceId), canManage: ['owner', 'admin'].includes(session.role) });
      return true;
    }
    const m = path.match(ONE);
    if (m && (method === 'PUT' || method === 'POST')) {
      requirePermission(session.role, Permission.ORGANIZATION_SETTINGS);
      const body = await readJson(req);
      if (typeof body.enabled !== 'boolean') throw Object.assign(new Error('Укажите enabled: true или false'), { code: 'INVALID_FEATURE_STATE', statusCode: 400, expose: true });
      const changes = body.dryRun === true ? await features.preview(session.workspaceId, m[1], body.enabled) : await features.set(session, m[1], body.enabled);
      if (body.dryRun !== true && changes.length) ctx.hub?.broadcastWorkspace?.(session.workspaceId, 'features.updated', { changes });
      json(res, 200, { changes, dryRun: body.dryRun === true, items: await features.list(session.workspaceId) });
      return true;
    }
    return false;
  };
}
