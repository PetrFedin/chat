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
      // Записи о сейфе, входах и паролях — тем, кто отвечает за
      // безопасность компании, и самому человеку про себя.
      //
      // Право было взято хозяйское, и администратор — тот, кто в этом
      // продукте и ведёт порядок, — открывал «Журнал» и не находил ни
      // одного входа, хотя плитка обещает ему дословно «кто вошёл, кто
      // раскрыл пароль». Комментарий у самого отбора говорит то же:
      // «владельцу и администратору видно всё». Руководителю по-прежнему
      // незачем: его дело — работа отдела, а не чужие замки.
      personal: (ctx.permissions(session.role) ?? []).includes(Permission.ORGANIZATION_SETTINGS),
    });
    // Замок на закрытом подразделении есть в схеме, а в журнале его не
    // было: строки «завели отдел», «приняли человека», «вывели человека»
    // лежали там с полной начинкой — названием отдела и опознавателями
    // людей. Любой руководитель с правом на журнал собирал по ним состав
    // отдела, куда его не пускают. Внутренности остаются тем, кто внутри;
    // сам факт, что отдел есть и в нём что-то происходит, скрывать
    // незачем — за места платит компания.
    if (ctx.org?.visibleUnitIds) {
      const mine = await ctx.org.visibleUnitIds(session);
      for (const row of page.items ?? []) {
        if (row.aggregateType !== 'org_unit') continue;
        if (mine.has(row.aggregateId)) continue;
        row.payload = { closed: true };
      }
    }
    json(res, 200, page);
    return true;
  };
}
