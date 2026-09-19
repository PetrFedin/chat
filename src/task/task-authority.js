const TRANSITIONS = new Map([
  ['inbox', new Set(['clarify','proposed','cancelled'])],
  ['clarify', new Set(['proposed','cancelled'])],
  ['proposed', new Set(['accepted','rejected','clarify','cancelled'])],
  ['accepted', new Set(['scheduled','in_progress','deferred','cancelled'])],
  ['scheduled', new Set(['in_progress','blocked','deferred','cancelled'])],
  ['in_progress', new Set(['blocked','in_review','deferred','cancelled'])],
  ['blocked', new Set(['in_progress','deferred','cancelled'])],
  ['in_review', new Set(['accepted_result','in_progress'])],
  ['accepted_result', new Set(['closed','in_progress'])],
  ['deferred', new Set(['accepted','scheduled','cancelled'])],
  ['closed', new Set()],
  ['rejected', new Set()],
  ['cancelled', new Set()],
]);

const TERMINAL = new Set(['closed','rejected','cancelled']);
const TEAM_MANAGERS = new Set(['owner','admin','manager']);
const REASON_REQUIRED = new Set(['blocked','deferred','cancelled']);

export class TaskAuthorityError extends Error {
  constructor(code,message,statusCode=409){
    super(message);
    this.name='TaskAuthorityError';
    this.code=code;
    this.statusCode=statusCode;
  }
}

export function canViewTask(task,session){
  return Boolean(task && task.workspaceId===session.workspaceId && (
    task.ownerId===session.userId ||
    task.requesterId===session.userId ||
    task.acceptorId===session.userId ||
    TEAM_MANAGERS.has(session.role)
  ));
}

export function assertTaskVisible(task,session){
  if(!canViewTask(task,session)) throw new TaskAuthorityError('TASK_NOT_FOUND','Task not found',404);
}

export function isTaskTeamManager(session){
  return TEAM_MANAGERS.has(session.role);
}

function assertExpectedVersion(task,expectedVersion){
  const expected=Number(expectedVersion);
  if(!Number.isInteger(expected)||expected<1) throw new TaskAuthorityError('TASK_VERSION_REQUIRED','expectedVersion is required',400);
  if(expected!==Number(task.version)) throw new TaskAuthorityError('STALE_TASK_ACTION','Task changed since this screen was loaded. Refresh and retry.',409);
}

function mayCancel(task,session){
  return task.ownerId===session.userId || task.requesterId===session.userId || TEAM_MANAGERS.has(session.role);
}

function actorTransitions(task,session,evidenceCount=0){
  const result=new Set();
  const actor=session.userId;
  switch(task.status){
    case 'inbox':
      if(task.requesterId===actor||TEAM_MANAGERS.has(session.role)) result.add('cancelled');
      break;
    case 'clarify':
      if(task.requesterId===actor) result.add('proposed');
      if(mayCancel(task,session)) result.add('cancelled');
      break;
    case 'proposed':
      if(task.ownerId===actor){ result.add('accepted'); result.add('rejected'); result.add('clarify'); }
      if(task.requesterId===actor||TEAM_MANAGERS.has(session.role)) result.add('cancelled');
      break;
    case 'accepted':
      if(task.ownerId===actor){ result.add('scheduled'); result.add('in_progress'); result.add('deferred'); }
      if(mayCancel(task,session)) result.add('cancelled');
      break;
    case 'scheduled':
      if(task.ownerId===actor){ result.add('in_progress'); result.add('blocked'); result.add('deferred'); }
      if(mayCancel(task,session)) result.add('cancelled');
      break;
    case 'in_progress':
      if(task.ownerId===actor){ result.add('blocked'); if(Number(evidenceCount)>0) result.add('in_review'); result.add('deferred'); }
      if(mayCancel(task,session)) result.add('cancelled');
      break;
    case 'blocked':
      if(task.ownerId===actor){ result.add('in_progress'); result.add('deferred'); }
      if(mayCancel(task,session)) result.add('cancelled');
      break;
    case 'in_review':
      if(task.acceptorId===actor){ result.add('accepted_result'); result.add('in_progress'); }
      break;
    case 'accepted_result':
      if(task.requesterId===actor||task.acceptorId===actor) result.add('closed');
      if(task.acceptorId===actor) result.add('in_progress');
      break;
    case 'deferred':
      if(task.ownerId===actor){ result.add('accepted'); result.add('scheduled'); }
      if(mayCancel(task,session)) result.add('cancelled');
      break;
  }
  return [...result].filter(to=>TRANSITIONS.get(task.status)?.has(to));
}

export function allowedTaskTransitions(task,session,evidenceCount=0){
  if(!canViewTask(task,session)) return [];
  return actorTransitions(task,session,evidenceCount);
}

export function assertTaskTransition(task,session,{to,reason=null,expectedVersion,evidenceCount=0}){
  assertTaskVisible(task,session);
  assertExpectedVersion(task,expectedVersion);
  if(!TRANSITIONS.get(task.status)?.has(to)) throw new TaskAuthorityError('INVALID_TASK_TRANSITION',`${task.status} -> ${to} is not allowed`);
  if(to==='in_review'&&task.ownerId===session.userId&&Number(evidenceCount)<1) throw new TaskAuthorityError('TASK_EVIDENCE_REQUIRED','Add execution evidence before requesting review',409);
  if(!actorTransitions(task,session,evidenceCount).includes(to)) throw new TaskAuthorityError('TASK_ACTION_FORBIDDEN','You cannot perform this task transition',403);
  const normalizedReason=typeof reason==='string'&&reason.trim()?reason.trim():null;
  if(REASON_REQUIRED.has(to)&&!normalizedReason) throw new TaskAuthorityError('TASK_REASON_REQUIRED',`Reason is required for ${to}`,400);
  if(task.status==='in_review'&&to==='in_progress'&&!normalizedReason) throw new TaskAuthorityError('TASK_REASON_REQUIRED','Return to work requires a review comment',400);
  if(task.status==='accepted_result'&&to==='in_progress'&&!normalizedReason) throw new TaskAuthorityError('TASK_REASON_REQUIRED','Reopening an accepted result requires a reason',400);
  if(to==='in_review'&&Number(evidenceCount)<1) throw new TaskAuthorityError('TASK_EVIDENCE_REQUIRED','Add execution evidence before requesting review',409);
  return {from:task.status,to,reason:normalizedReason};
}

export function assertTaskEvidenceAuthority(task,session,{expectedVersion}){
  assertTaskVisible(task,session);
  assertExpectedVersion(task,expectedVersion);
  if(TERMINAL.has(task.status)) throw new TaskAuthorityError('TASK_TERMINAL','Evidence cannot be added to a terminal task',409);
  if(![task.ownerId,task.requesterId,task.acceptorId].includes(session.userId)&&!TEAM_MANAGERS.has(session.role)) throw new TaskAuthorityError('TASK_ACTION_FORBIDDEN','You cannot add evidence to this task',403);
}

export function assertTaskScheduleAuthority(task,session,{expectedVersion,reason}){
  assertTaskVisible(task,session);
  assertExpectedVersion(task,expectedVersion);
  if(TERMINAL.has(task.status)) throw new TaskAuthorityError('TASK_TERMINAL','A terminal task cannot be rescheduled',409);
  if(![task.ownerId,task.requesterId].includes(session.userId)&&!TEAM_MANAGERS.has(session.role)) throw new TaskAuthorityError('TASK_ACTION_FORBIDDEN','You cannot reschedule this task',403);
  if(typeof reason!=='string'||!reason.trim()) throw new TaskAuthorityError('TASK_REASON_REQUIRED','Rescheduling requires a reason',400);
  return reason.trim();
}
