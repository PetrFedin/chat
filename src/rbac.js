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
  ORG_UNIT_PRIVATE_CREATE: 'org.unit.private.create',
  /**
   * База знаний и HR-бот над ней.
   *
   * Читает любой сотрудник компании — вопрос про отпуск задаёт и
   * рядовой участник, не только руководитель. Пишет и правит тот, кому
   * доверено говорить от лица компании: неверный ответ про больничный
   * стоит дороже, чем неверный тег на файле.
   */
  KNOWLEDGE_READ: 'knowledge.read',
  KNOWLEDGE_MANAGE: 'knowledge.manage',
  /**
   * Вики — наоборот базе знаний: не один куратор, а любой сотрудник.
   *
   * Регламент, план онбординга, заметки по проекту обычно пишет тот,
   * кто ближе к делу, а не тот, кому доверено говорить от лица
   * компании. Читать и писать здесь — одно и то же право: разделять их
   * означало бы завести вторую базу знаний под другим именем.
   */
  WIKI_USE: 'wiki.use'
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
    Permission.VAULT_USE,
    Permission.KNOWLEDGE_READ,
    Permission.KNOWLEDGE_MANAGE,
    Permission.WIKI_USE
  ]),
  member: new Set([
    Permission.MESSAGE_SEND,
    Permission.MESSAGE_DELETE_OWN,
    Permission.TASK_CREATE,
    Permission.CALENDAR_CREATE,
    Permission.CALL_START,
    Permission.FILE_UPLOAD,
    Permission.PUSH_SUBSCRIBE,
    Permission.KNOWLEDGE_READ,
    Permission.AI_USE,
    Permission.VAULT_USE,
    Permission.WIKI_USE
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

/**
 * О чём отказ — человеческими словами.
 *
 * Ключ — право, значение — дело, ради которого оно нужно. Пары хватает,
 * чтобы отказ объяснял и что не вышло, и к кому идти.
 */
const WHAT_FOR = {
  'organization.manage': 'Переименовать компанию, передать её и выгрузить архив',
  'organization.settings': 'Вести реквизиты компании, места и слои календаря',
  'member.invite': 'Звать людей в компанию',
  'member.manage': 'Вести людей: роли, увольнение и возвращение',
  'channel.create': 'Заводить каналы',
  'channel.manage': 'Распоряжаться беседой: состав, роли, закрепления',
  'message.delete.any': 'Удалять чужие сообщения',
  'task.manage.team': 'Вести чужие задачи',
  'calendar.manage.team': 'Вести чужие встречи',
  'call.record': 'Записывать звонки',
  'audit.read': 'Читать журнал действий',
  'vault.use': 'Пользоваться хранилищем паролей',
  'ai.use': 'Пользоваться разбором встреч',
  'meeting.ops.manage': 'Вести очередь обработки встреч',
  'meeting.cost.read': 'Смотреть расходы на встречи',
  'meeting.cost.manage': 'Менять тарифы на обработку встреч',
  'integration.manage': 'Вести интеграции и подписки на события',
  'org.structure.manage': 'Менять оргструктуру компании',
  'org.unit.private.create': 'Заводить закрытые подразделения',
  'knowledge.manage': 'Писать и править статьи базы знаний',
  'wiki.use': 'Читать и писать страницы вики',
};
const WHO_CAN = {
  'member.invite': 'владелец, администратор или руководитель',
  'vault.use': 'сотрудник компании, но не внешний участник',
  'ai.use': 'сотрудник компании, но не внешний участник',
  'integration.manage': 'владелец или администратор',
  'meeting.ops.manage': 'владелец или администратор',
  'meeting.cost.read': 'владелец или администратор',
  'meeting.cost.manage': 'владелец или администратор',
  'org.unit.private.create': 'владелец, администратор или руководитель',
  'organization.manage': 'только владелец',
  'organization.settings': 'владелец или администратор',
  'member.manage': 'владелец или администратор',
  'audit.read': 'владелец, администратор или руководитель',
  'message.delete.any': 'владелец или администратор',
  'task.manage.team': 'владелец, администратор или руководитель',
  'calendar.manage.team': 'владелец, администратор или руководитель',
  'call.record': 'владелец, администратор или руководитель',
  'channel.create': 'владелец, администратор или руководитель (группу вдвоём и больше может завести любой сотрудник)',
  'org.structure.manage': 'владелец или администратор',
  'knowledge.manage': 'владелец, администратор или руководитель',
  'wiki.use': 'сотрудник компании, но не внешний участник',
};

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
  // Отказ называл внутреннее имя права: «Role member does not have
  // audit.read». Эта строка доходит до экрана как есть — человек читает
  // фразу, которой нет ни в его языке, ни в его словаре, и не узнаёт из
  // неё, что делать. Говорим о деле, а не об устройстве.
  const error = new Error(WHAT_FOR[permission]
    ? `${WHAT_FOR[permission]} — это может ${WHO_CAN[permission] ?? 'тот, кому доверены такие дела в компании'}.`
    : 'Это действие вам не доступно. Если оно нужно для работы, попросите администратора компании.');
  error.code = 'FORBIDDEN';
  error.statusCode = 403;
  throw error;
}

export function visiblePermissions(role) {
  return [...(ROLE_PERMISSIONS[role] ?? [])].sort();
}
