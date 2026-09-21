import { Permission, requirePermission } from '../rbac.js';
import { json } from './helpers.js';

/**
 * Журнал рабочего пространства.
 *
 * Записи велись с первого дня — кого пригласили, кому сменили роль, кому
 * выдали ссылку на восстановление пароля, кто раскрыл пароль из сейфа, —
 * но прочитать их было нельзя ниоткуда: право `audit.read` объявлено, а
 * маршрута нет. Журнал, в который нельзя заглянуть, не сдерживает никого.
 *
 * Читают те, кто отвечает за порядок: владелец, администратор, руководитель.
 * Рядовой сотрудник и тем более гость сюда не ходят — журнал показывает, кто
 * чем занимался, и это не общедоступное знание.
 */
export function createAuditHandler() {
  return async function handleAudit(req, res, ctx, url, path, method) {
    if (path !== '/api/v1/audit') return false;
    const session = await ctx.requireSession(req);
    requirePermission(session.role, Permission.AUDIT_READ);
    if (method !== 'GET') throw Object.assign(new Error('Method not allowed'), { code: 'METHOD_NOT_ALLOWED', statusCode: 405 });

    const page = await ctx.store.listAuditEvents(session, {
      limit: url.searchParams.get('limit') ?? 50,
      cursor: url.searchParams.get('cursor'),
      aggregateType: url.searchParams.get('type'),
      actorId: url.searchParams.get('actor'),
    });
    json(res, 200, page);
    return true;
  };
}
