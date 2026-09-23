export const Permission = Object.freeze({
  ORGANIZATION_MANAGE: 'organization.manage',
  // Настройки компании — не то же, что владение ею.
  //
  // Под `organization.manage` лежали вперемешку передача владения,
  // выгрузка всего пространства и число оплаченных мест. Из-за этого
  // администратор, который вправе звать людей, упирался в «мест нет» и
  // получал отказ на том самом экране, куда его отправляло сообщение об
  // ошибке. Реквизиты, места и слои календаря — работа администратора;
  // отдать компанию другому человеку по-прежнему может только владелец.
  ORGANIZATION_SETTINGS: 'organization.settings',
  MEMBER_INVITE: 'member.invite',
  MEMBER_MANAGE: 'member.manage',
  CHANNEL_CREATE: 'channel.create',
  CHANNEL_MANAGE: 'channel.manage',
  MESSAGE_SEND: 'message.send',
  MESSAGE_DELETE_OWN: 'message.delete.own',
  MESSAGE_DELETE_ANY: 'message.delete.any',
  TASK_CREATE: 'task.create',
  TASK_MANAGE_TEAM: 'task.manage.team',
  CALENDAR_CREATE: 'calendar.create',
  CALENDAR_MANAGE_TEAM: 'calendar.manage.team',
  CALL_START: 'call.start',
  CALL_MANAGE: 'call.manage',
  CALL_RECORD: 'call.record',
  FILE_UPLOAD: 'file.upload',
  PUSH_SUBSCRIBE: 'push.subscribe',
  AUDIT_READ: 'audit.read',
  AI_USE: 'ai.use',
  VAULT_USE: 'vault.use',
  MEETING_OPS_MANAGE: 'meeting.ops.manage',
  MEETING_COST_READ: 'meeting.cost.read',
  MEETING_COST_MANAGE: 'meeting.cost.manage',
  INTEGRATION_MANAGE: 'integration.manage',
  ORG_STRUCTURE_MANAGE: 'org.structure.manage',
  /**
   * Завести закрытое подразделение.
   *
   * Открытые отделы задают форму компании — это дело владельца и
   * администратора. Закрытая же группа заводится ровно против них: если
   * бы её мог создать только владелец, закрывать было бы не от кого.
   * Поэтому право идёт и руководителю — тому, кто и так ведёт людей.
   */
  ORG_UNIT_PRIVATE_CREATE: 'org.unit.private.create'
});

const all = new Set(Object.values(Permission));
const without = (...permissions) => new Set([...all].filter((permission) => !permissions.includes(permission)));

export const ROLE_PERMISSIONS = Object.freeze({
  owner: all,
  admin: without(Permission.ORGANIZATION_MANAGE),
  manager: new Set([
    Permission.MEMBER_INVITE,
    Permission.ORG_UNIT_PRIVATE_CREATE,
    Permission.CHANNEL_CREATE,
    Permission.CHANNEL_MANAGE,
    Permission.MESSAGE_SEND,
    Permission.MESSAGE_DELETE_OWN,
    Permission.TASK_CREATE,
    Permission.TASK_MANAGE_TEAM,
    Permission.CALENDAR_CREATE,
    Permission.CALENDAR_MANAGE_TEAM,
    Permission.CALL_START,
    Permission.CALL_MANAGE,
    Permission.CALL_RECORD,
    Permission.FILE_UPLOAD,
    Permission.PUSH_SUBSCRIBE,
    Permission.AUDIT_READ,
    Permission.AI_USE,
    Permission.VAULT_USE
  ]),
  member: new Set([
    Permission.MESSAGE_SEND,
    Permission.MESSAGE_DELETE_OWN,
    Permission.TASK_CREATE,
    Permission.CALENDAR_CREATE,
    Permission.CALL_START,
    Permission.FILE_UPLOAD,
    Permission.PUSH_SUBSCRIBE,
    Permission.AI_USE,
    Permission.VAULT_USE
  ]),
  guest: new Set([
    Permission.MESSAGE_SEND,
    Permission.MESSAGE_DELETE_OWN,
    Permission.CALL_START,
    Permission.FILE_UPLOAD,
    Permission.PUSH_SUBSCRIBE
  ])
});

export function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[role]?.has(permission));
}

export function requirePermission(role, permission) {
  if (hasPermission(role, permission)) return;
  // Гостю — «не найдено», а не «запрещено».
  //
  // Гость — чужой сотрудник, пришедший на одну работу. Отказ вида «роль
  // guest не имеет права audit.read» сам по себе отвечает на вопрос,
  // который ему задавать не положено: есть ли здесь журнал действий,
  // сейф паролей, очередь приглашений, счёт денег за встречи. Модуль
  // оргструктуры так и сделан с самого начала; остальные отвечали 403 и
  // называли право вслух.
  if (role === 'guest') {
    const hidden = new Error('Not found');
    hidden.code = 'NOT_FOUND';
    hidden.statusCode = 404;
    throw hidden;
  }
  const error = new Error(`Role ${role ?? 'unknown'} does not have ${permission}`);
  error.code = 'FORBIDDEN';
  error.statusCode = 403;
  throw error;
}

export function visiblePermissions(role) {
  return [...(ROLE_PERMISSIONS[role] ?? [])].sort();
}
