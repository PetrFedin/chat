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
      // Слои календаря — решение пространства, а не каждого человека:
      // нерабочий день одинаков для всех, кто в нём работает.
      const layers = {};
      if (body.showBirthdays !== undefined) layers.showBirthdays = Boolean(body.showBirthdays);
      if (body.showHolidays !== undefined) layers.showHolidays = Boolean(body.showHolidays);
      // Реквизиты компании: юридическое лицо, ИНН, адрес, сайт, телефон
      // и почтовый домен. Все необязательные — заполнить можно и потом.
      const details = {};
      for (const [field, limit] of [['legalName', 200], ['taxId', 40], ['address', 300], ['website', 200], ['phone', 40], ['emailDomain', 120]]) {
        if (body[field] !== undefined) details[field] = body[field] ? cleanText(body[field], limit) : null;
      }
      // Число мест и самостоятельный вход по домену.
      if (body.seatLimit !== undefined) {
        const seats = body.seatLimit === null || body.seatLimit === '' ? null : Number(body.seatLimit);
        if (seats !== null && (!Number.isInteger(seats) || seats < 1)) {
          throw Object.assign(new Error('Мест должно быть целое число больше нуля'), { code: 'INVALID_SEAT_LIMIT', statusCode: 400, expose: true });
        }
        details.seatLimit = seats;
      }
      if (body.domainJoin !== undefined) details.domainJoin = Boolean(body.domainJoin);
      // Пускать по домену, не объявив домена, нельзя: пускать будет некуда.
      if (details.domainJoin && details.emailDomain === null) {
        throw Object.assign(new Error('Сначала укажите почтовый домен компании'), { code: 'DOMAIN_REQUIRED', statusCode: 400, expose: true });
      }
      if (!companyName && !workspaceName && !Object.keys(layers).length && !Object.keys(details).length) {
        throw Object.assign(new Error('Нечего менять'), { code: 'EMPTY_WORKSPACE_PATCH', statusCode: 400, expose: true });
      }
      json(res, 200, { workspace: await ctx.store.renameWorkspace(session, { companyName, workspaceName, ...layers, details }) });
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
