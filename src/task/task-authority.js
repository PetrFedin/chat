import { Permission, hasPermission } from '../rbac.js';

const TRANSITIONS = new Map([
  ['inbox', new Set(['clarify','proposed','cancelled'])],
  ['clarify', new Set(['proposed','cancelled'])],
  ['proposed', new Set(['accepted','rejected','clarify','cancelled'])],
  ['accepted', new Set(['scheduled','in_progress','deferred','cancelled'])],
  ['scheduled', new Set(['in_progress','blocked','deferred','cancelled'])],
  ['in_progress', new Set(['blocked','in_review','deferred','cancelled'])],
  ['blocked', new Set(['in_progress','deferred','cancelled'])],
  ['in_review', new Set(['accepted_result','in_progress','cancelled'])],
  ['accepted_result', new Set(['closed','in_progress','cancelled'])],
  ['deferred', new Set(['accepted','scheduled','cancelled'])],
  ['closed', new Set()],
  ['rejected', new Set()],
  ['cancelled', new Set()],
]);

const TERMINAL = new Set(['closed','rejected','cancelled']);

/**
 * Задачи, которые ещё в работе.
 *
 * Список жил копией в хранилище рабочего дня, хотя это свойство самого
 * автомата состояний: добавили состояние — и копия молча отстала.
 */
export const ACTIVE_TASK_STATUSES = new Set(
  [...TRANSITIONS.keys()].filter((status) => !TERMINAL.has(status) && status !== 'accepted_result'));
/**
 * «Ведёт чужие задачи» — это право, а не список ролей.
 *
 * Список ролей жил здесь отдельно от таблицы прав, и добавить роли право
 * `task.manage.team` было мало: задачи о ней не знали. Теперь источник
 * один — таблица в rbac.js.
 */
export const managesTeamTasks = (session) => hasPermission(session?.role, Permission.TASK_MANAGE_TEAM);
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
  // A guest is somebody else's employee. They may be talked to in the room
  // they were invited into; they are not part of the company's accountability
  // chain, and a commitment they can see is one they can act on.
  if(session.role==='guest')return false;
  return Boolean(task && task.workspaceId===session.workspaceId && (
    task.ownerId===session.userId ||
    task.requesterId===session.userId ||
    task.acceptorId===session.userId ||
    // Соисполнитель — четвёртый участник обязательства. Без него помощь
    // была бы формальной: человека вписали в задачу, а открыть её он не
    // может.
    (Array.isArray(task.collaboratorIds)&&task.collaboratorIds.includes(session.userId)) ||
    managesTeamTasks(session)
  ));
}

export function assertTaskVisible(task,session){
  if(!canViewTask(task,session)) throw new TaskAuthorityError('TASK_NOT_FOUND','Task not found',404);
}

export function isTaskTeamManager(session){
  return managesTeamTasks(session);
}

function assertExpectedVersion(task,expectedVersion){
  const expected=Number(expectedVersion);
  if(!Number.isInteger(expected)||expected<1) throw new TaskAuthorityError('TASK_VERSION_REQUIRED','expectedVersion is required',400);
  if(expected!==Number(task.version)) throw new TaskAuthorityError('STALE_TASK_ACTION','Task changed since this screen was loaded. Refresh and retry.',409);
}

function mayCancel(task,session){
  return task.ownerId===session.userId || task.requesterId===session.userId || managesTeamTasks(session);
}

function actorTransitions(task,session,evidenceCount=0){
  const result=new Set();
  const actor=session.userId;
  switch(task.status){
    case 'inbox':
      if(task.requesterId===actor||managesTeamTasks(session)) result.add('cancelled');
      break;
    case 'clarify':
      if(task.requesterId===actor) result.add('proposed');
      if(mayCancel(task,session)) result.add('cancelled');
      break;
    case 'proposed':
      if(task.ownerId===actor){ result.add('accepted'); result.add('rejected'); result.add('clarify'); }
      if(task.requesterId===actor||managesTeamTasks(session)) result.add('cancelled');
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
      if(mayCancel(task,session)) result.add('cancelled');
      break;
    case 'accepted_result':
      if(task.requesterId===actor||task.acceptorId===actor) result.add('closed');
      if(task.acceptorId===actor) result.add('in_progress');
      if(mayCancel(task,session)) result.add('cancelled');
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
  if(![task.ownerId,task.requesterId,task.acceptorId].includes(session.userId)&&!managesTeamTasks(session)) throw new TaskAuthorityError('TASK_ACTION_FORBIDDEN','You cannot add evidence to this task',403);
}

/**
 * Кто может трогать внутренности обязательства.
 *
 * Шаги, соисполнители и связи — это как обязательство устроено внутри, и
 * распоряжается этим тот, кто его несёт, тот, кто просил, и тот, кто
 * принимает результат. Посторонний сотрудник задачу видит, но
 * перекраивать её не должен: чужое обещание — не его дело.
 *
 * У закрытого обязательства внутренности не правятся: запись о
 * сделанном перестаёт быть правдой, если её можно дописать задним
 * числом.
 */
export function assertTaskStructureAuthority(task,session){
  assertTaskVisible(task,session);
  if(TERMINAL.has(task.status)) throw new TaskAuthorityError('TASK_TERMINAL','Закрытое обязательство не перекраивают',409);
  if(![task.ownerId,task.requesterId,task.acceptorId].includes(session.userId)&&!managesTeamTasks(session)){
    throw new TaskAuthorityError('TASK_ACTION_FORBIDDEN','Это чужое обязательство',403);
  }
}

/**
 * Отметить шаг сделанным может и соисполнитель.
 *
 * Иначе помощь превращается в переписку: «я сделал, отметь за меня».
 * Список соисполнителей передаётся сюда, потому что он живёт в базе, а
 * не в строке обязательства.
 */
export function assertChecklistAuthority(task,session,collaboratorIds=[]){
  assertTaskVisible(task,session);
  if(TERMINAL.has(task.status)) throw new TaskAuthorityError('TASK_TERMINAL','Закрытое обязательство не перекраивают',409);
  const allowed=[task.ownerId,task.requesterId,task.acceptorId,...collaboratorIds];
  if(!allowed.includes(session.userId)&&!managesTeamTasks(session)){
    throw new TaskAuthorityError('TASK_ACTION_FORBIDDEN','Это чужое обязательство',403);
  }
}

/**
 * Handing a commitment to somebody else.
 *
 * There was no way to do this: owner, requester and acceptor were fixed at
 * creation, so the cure for «Нина ушла в отпуск» was to cancel the task and
 * make a new one, losing the evidence and the audit chain that made the old
 * one worth having.
 *
 * Who may: the person who asked for the work, and a team manager. Not the
 * owner — handing your own obligation to a colleague is not yours to decide.
 * A new owner has not accepted anything yet, so the task goes back to
 * «proposed» and they get the same choice the first owner had.
 */
export function assertTaskReassignAuthority(task,session,{expectedVersion,reason,ownerId,acceptorId}){
  assertTaskVisible(task,session);
  assertExpectedVersion(task,expectedVersion);
  if(TERMINAL.has(task.status)) throw new TaskAuthorityError('TASK_TERMINAL','A terminal task cannot be reassigned',409);
  if(task.requesterId!==session.userId&&!managesTeamTasks(session)) {
    throw new TaskAuthorityError('TASK_ACTION_FORBIDDEN','Only the requester or a team manager can reassign this task',403);
  }
  if(!ownerId&&!acceptorId) throw new TaskAuthorityError('TASK_NOTHING_TO_CHANGE','Name a new owner or a new acceptor',400);
  if(ownerId===task.ownerId&&(!acceptorId||acceptorId===task.acceptorId)) {
    throw new TaskAuthorityError('TASK_NOTHING_TO_CHANGE','This is already the assignment',400);
  }
  if(typeof reason!=='string'||!reason.trim()) throw new TaskAuthorityError('TASK_REASON_REQUIRED','Reassigning requires a reason',400);
  return {
    ownerId:ownerId??task.ownerId,
    acceptorId:acceptorId??task.acceptorId,
    reason:reason.trim(),
    // Only a new owner resets the state; changing who signs the result off
    // leaves the work where it stands.
    resetToProposed:Boolean(ownerId&&ownerId!==task.ownerId),
  };
}

export function assertTaskScheduleAuthority(task,session,{expectedVersion,reason}){
  assertTaskVisible(task,session);
  assertExpectedVersion(task,expectedVersion);
  if(TERMINAL.has(task.status)) throw new TaskAuthorityError('TASK_TERMINAL','A terminal task cannot be rescheduled',409);
  if(![task.ownerId,task.requesterId].includes(session.userId)&&!managesTeamTasks(session)) throw new TaskAuthorityError('TASK_ACTION_FORBIDDEN','You cannot reschedule this task',403);
  if(typeof reason!=='string'||!reason.trim()) throw new TaskAuthorityError('TASK_REASON_REQUIRED','Rescheduling requires a reason',400);
  return reason.trim();
}
