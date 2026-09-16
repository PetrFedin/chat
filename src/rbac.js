export const Permission = Object.freeze({
  ORGANIZATION_MANAGE: 'organization.manage',
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
  AI_USE: 'ai.use'
});

const all = new Set(Object.values(Permission));
const without = (...permissions) => new Set([...all].filter((permission) => !permissions.includes(permission)));

export const ROLE_PERMISSIONS = Object.freeze({
  owner: all,
  admin: without(Permission.ORGANIZATION_MANAGE),
  manager: new Set([
    Permission.MEMBER_INVITE,
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
    Permission.AI_USE
  ]),
  member: new Set([
    Permission.MESSAGE_SEND,
    Permission.MESSAGE_DELETE_OWN,
    Permission.TASK_CREATE,
    Permission.CALENDAR_CREATE,
    Permission.CALL_START,
    Permission.FILE_UPLOAD,
    Permission.PUSH_SUBSCRIBE,
    Permission.AI_USE
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
  if (!hasPermission(role, permission)) {
    const error = new Error(`Role ${role ?? 'unknown'} does not have ${permission}`);
    error.code = 'FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }
}

export function visiblePermissions(role) {
  return [...(ROLE_PERMISSIONS[role] ?? [])].sort();
}
