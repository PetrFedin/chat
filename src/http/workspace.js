import { Permission, requirePermission } from '../rbac.js';
import { cleanText, json, readJson, allowedPresence, toDateOrNull, INVALID_DATE } from './helpers.js';

/** Объявленная доступность — короткий набор понятных слов. */
const AVAILABILITY=new Set(['available','meeting','lunch','focus','away','sick','vacation','trip']);

const TASK_ID='([0-9a-f-]+)';
const TASK_EVIDENCE_TYPES=new Set(['url','file','message','metric','note']);

const invalidEvidence=(message)=>Object.assign(new Error(message),{code:'INVALID_EVIDENCE_VALUE',statusCode:400});

// The type was checked but the value never was, so a «url» could hold prose, a
// «metric» could hold anything, and a «file» or «message» could point at an id
// that does not exist — or at one in a conversation the actor cannot see.
// Evidence is what an acceptor reads before accepting a result, so a reference
// that resolves to nothing is worse than no evidence at all.
async function assertEvidenceValue(store, session, type, value) {
  if (type === 'url') {
    let parsed;
    try { parsed = new URL(value); } catch { throw invalidEvidence('Evidence URL is not a valid address'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw invalidEvidence('Evidence URL must be http or https');
    return;
  }
  if (type === 'metric') {
    // A measurement starts with its number; a unit or a comment may follow.
    if (!/^[+-]?\d+(\.\d+)?/.test(value.trim())) throw invalidEvidence('Evidence metric must start with a number');
    return;
  }
  if (type === 'message') {
    const message = await store.getMessage(session, value.trim()).catch(() => null);
    if (!message || message.deletedAt) throw invalidEvidence('Evidence message is not available');
    return;
  }
  if (type === 'file') {
    // A malformed id reaches Postgres as a cast error, not a miss.
    const file = await store.getFile(session, value.trim()).catch(() => null);
    if (!file) throw invalidEvidence('Evidence file is not available');
  }
}
/**
 * Важность задачи проверяется здесь, а не в базе.
 *
 * Значение уходило в `INSERT` как есть, и ловил его CHECK: человек,
 * написавший «критично» вместо «urgent», читал в ответ «A value failed a
 * validation rule» — ни поля, ни допустимых значений, ни русского языка.
 * Для встреч это уже починили; для задач — нет.
 */
const TASK_PRIORITIES=new Set(['low','normal','high','urgent']);
const taskPriority=(value)=>{
  if(value===undefined||value===null||value==='')return 'normal';
  const priority=String(value);
  if(!TASK_PRIORITIES.has(priority))throw Object.assign(
    new Error('Важность бывает low, normal, high или urgent'),
    {code:'INVALID_TASK_PRIORITY',statusCode:400,expose:true});
  return priority;
};

const taskAudience=(task)=>[...new Set([task?.ownerId,task?.requesterId,task?.acceptorId].filter(Boolean))];
const taskRealtime=(task)=>{const {allowedTransitions,...state}=task??{};return state};
const taskLabel=(status)=>({
  accepted:'Ответственность принята',
  in_progress:'Задача в работе',
  blocked:'Задача заблокирована',
  in_review:'Результат отправлен на проверку',
  accepted_result:'Результат принят',
  closed:'Задача закрыта',
  rejected:'Задача отклонена',
  cancelled:'Задача отменена',
  deferred:'Задача отложена',
  scheduled:'Задача запланирована',
  clarify:'Нужно уточнение',
})[status]||'Задача обновлена';

/**
 * Заголовок извещения о ходе задачи.
 *
 * Подписывалось состояние, в которое пришли, — и возврат работы с
 * проверки приходил исполнителю тем же «Задача в работе», что и его
 * собственное «беру в работу». Событие и состояние — разные вещи: в
 * `in_progress` приходят двумя разными путями, и человеку важен путь.
 *
 * Причина перехода — единственное содержание возврата, блокировки и
 * запроса уточнения — не доходила вовсе: в извещение клали только
 * заголовок, а текстом подставлялось название задачи, и так человек
 * узнавал, что его работу вернули, но не узнавал зачем.
 */
const taskEventNotice=(task,reason)=>{
  const text=typeof reason==='string'&&reason.trim()?reason.trim():null;
  // В `in_progress` с причиной приходят только сверху — с проверки или
  // из принятого результата: своё «беру в работу» причины не требует.
  if(task.status==='in_progress'&&text)return{title:'Работу вернули на доработку',body:text};
  return{title:taskLabel(task.status),body:text||task.title};
};

// Only undefined means "leave unchanged" and only null means "clear": a
// falsy-but-present value like 0 is a date the caller meant, and treating it
// as "delete the promise" destroyed commitment dates behind a 200.
// Разбор дат общий на весь продукт — см. helpers.js.

export async function handleWorkspace(req,res,ctx,url,path,method){
  const {store,requireSession,hub,notifyUsers}=ctx;
  if(path==='/api/v1/tasks'&&method==='GET'){
    const s=await requireSession(req);
    // The list used to return a workspace's whole backlog in one answer.
    // Отбор по состоянию делается в SQL с самого начала — его просто
    // некому было передать: экран задач оставался плоским списком.
    const page=await store.listTasksPage(s,{
      limit:url.searchParams.get('limit')??50,
      cursor:url.searchParams.get('cursor'),
      status:url.searchParams.get('status'),
      scope:url.searchParams.get('scope')==='all'?'all':'mine',
    });
    if(url.searchParams.get('counts')==='1'&&store.taskCounts){
      page.counts=await store.taskCounts(s,{scope:url.searchParams.get('scope')==='all'?'all':'mine'});
    }
    json(res,200,{items:page.items,nextCursor:page.nextCursor,...(page.counts?{counts:page.counts}:{})});return true
  }
  /**
   * Отчёт по обязательствам и людям.
   *
   * Стоит до маршрута задачи по идентификатору намеренно: иначе
   * `/api/v1/tasks/report` разобралось бы как задача с именем «report».
   */
  if(path==='/api/v1/tasks/report'&&method==='GET'){
    const s=await requireSession(req);
    if(!ctx.taskReport)throw Object.assign(new Error('Отчётность доступна в режиме с базой данных'),{code:'REPORT_UNAVAILABLE',statusCode:503,expose:true});
    json(res,200,await ctx.taskReport.build(s,{
      from:url.searchParams.get('from'),
      to:url.searchParams.get('to'),
      scope:url.searchParams.get('scope')==='mine'?'mine':'team',
    }));
    return true;
  }
  if(path==='/api/v1/tasks'&&method==='POST'){
    const s=await requireSession(req);requirePermission(s.role,Permission.TASK_CREATE);const b=await readJson(req),task=await store.createTask(s,{title:cleanText(b.title,240),outcome:b.outcome?cleanText(b.outcome,1000):undefined,ownerId:b.ownerId??s.userId,acceptorId:b.acceptorId??s.userId,sourceMessageId:b.sourceMessageId??null,priority:taskPriority(b.priority),promisedAt:toDateOrNull(b.promisedAt)??null,forecastAt:toDateOrNull(b.forecastAt)??null});
    const audience=taskAudience(task);hub.broadcastUsers(s.workspaceId,audience,'task.created',taskRealtime(task));json(res,201,{task});return true
  }
  let m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}$`,'i'));
  if(m&&method==='GET'){const s=await requireSession(req),task=await store.getTaskDetail(s,m[1]);if(!task)throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});json(res,200,{task});return true}
  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/transitions$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req),b=await readJson(req),task=await store.transitionTask(s,m[1],{to:String(b.to??''),reason:b.reason??null,expectedVersion:b.expectedVersion});
    const audience=taskAudience(task),{title,body}=taskEventNotice(task,b.reason);hub.broadcastUsers(s.workspaceId,audience,'task.updated',taskRealtime(task));
    await store.projectTaskLifecycleNotification?.(s,task,{type:task.status==='in_review'?'review.requested':'task.updated',title,body});
    const recipients=audience.filter(id=>id!==s.userId);
    await notifyUsers(s.workspaceId,recipients,{title,body,url:`/#/tasks/${task.id}`,kind:'task.updated'});
    json(res,200,{task});return true
  }
  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/evidence$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req),b=await readJson(req),type=String(b.type??'note');if(!TASK_EVIDENCE_TYPES.has(type))throw Object.assign(new Error('Unsupported evidence type'),{code:'INVALID_EVIDENCE_TYPE',statusCode:400});const value=cleanText(b.value,4000);await assertEvidenceValue(store,s,type,value);const result=await store.addTaskEvidence(s,m[1],{type,value,expectedVersion:b.expectedVersion});
    const audience=taskAudience(result.task);hub.broadcastUsers(s.workspaceId,audience,'task.updated',taskRealtime(result.task));json(res,201,result);return true
  }
  /**
   * Внутренности обязательства: шаги, соисполнители, связи.
   *
   * Три таблицы под это лежали в схеме с самого начала, и кода за ними
   * не было ни строки — схема обещала то, чего в продукте нет.
   */
  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/checklist$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req),b=await readJson(req);
    if(!store.addChecklistItem)throw Object.assign(new Error('Шаги задачи доступны в режиме с базой данных'),{code:'CHECKLIST_UNAVAILABLE',statusCode:503,expose:true});
    const title=cleanText(b.title,240);
    if(!title)throw Object.assign(new Error('У шага должно быть название'),{code:'INVALID_CHECKLIST_ITEM',statusCode:400,expose:true});
    json(res,201,{item:await store.addChecklistItem(s,m[1],title)});return true;
  }
  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/checklist/${TASK_ID}$`,'i'));
  if(m&&method==='PATCH'){
    const s=await requireSession(req),b=await readJson(req);
    json(res,200,{item:await store.setChecklistItem(s,m[1],m[2],Boolean(b.done))});return true;
  }
  if(m&&method==='DELETE'){
    const s=await requireSession(req);
    json(res,200,await store.removeChecklistItem(s,m[1],m[2]));return true;
  }

  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/collaborators$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req),b=await readJson(req);
    if(!store.addCollaborator)throw Object.assign(new Error('Соисполнители доступны в режиме с базой данных'),{code:'COLLABORATORS_UNAVAILABLE',statusCode:503,expose:true});
    json(res,201,await store.addCollaborator(s,m[1],String(b.userId??'')));return true;
  }
  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/collaborators/${TASK_ID}$`,'i'));
  if(m&&method==='DELETE'){
    const s=await requireSession(req);
    json(res,200,await store.removeCollaborator(s,m[1],m[2]));return true;
  }

  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/dependencies$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req),b=await readJson(req);
    if(!store.addDependency)throw Object.assign(new Error('Связи задач доступны в режиме с базой данных'),{code:'DEPENDENCIES_UNAVAILABLE',statusCode:503,expose:true});
    json(res,201,await store.addDependency(s,m[1],String(b.dependsOn??''),String(b.kind??'blocks')));return true;
  }
  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/dependencies/${TASK_ID}$`,'i'));
  if(m&&method==='DELETE'){
    const s=await requireSession(req);
    json(res,200,await store.removeDependency(s,m[1],m[2]));return true;
  }

  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/assignment$`,'i'));
  if(m&&method==='PATCH'){
    const s=await requireSession(req),b=await readJson(req);
    const task=await store.reassignTask(s,m[1],{
      ownerId:b.ownerId??null,acceptorId:b.acceptorId??null,
      reason:typeof b.reason==='string'?cleanText(b.reason,1000):b.reason,
      expectedVersion:b.expectedVersion,
    });
    const audience=taskAudience(task);
    hub.broadcastUsers(s.workspaceId,audience,'task.updated',taskRealtime(task));
    // Извещение писалось только в push, а push — вещь необязательная и
    // выключаемая. Получалось, что обязательство переезжало на другого
    // человека молча: у нового оно просто появлялось в списке, а прежний
    // не узнавал, что с него сняли слово. Передача — ровно тот случай,
    // ради которого всё это и сделано, и уж она должна быть слышна.
    const handoverReason=typeof b.reason==='string'&&b.reason.trim()?b.reason.trim():null;
    await store.projectTaskLifecycleNotification?.(s,task,{type:'task.assigned',title:'Задачу передали вам',
      body:handoverReason?`${task.title} — ${handoverReason}`:task.title});
    // Круг получателей собирается из обновлённой задачи — прежнего
    // владельца там уже нет, и он один оставался в неведении: в его
    // колокольчике по-прежнему висело «вам поручили задачу» про задачу,
    // которая давно не его, а сам он считал себя ответственным.
    if(task.previousOwnerId&&task.previousOwnerId!==s.userId&&task.previousOwnerId!==task.ownerId){
      await store.projectTaskLifecycleNotification?.(s,{...task,ownerId:task.previousOwnerId,requesterId:null,acceptorId:null},
        {type:'task.updated',title:'Задачу передали другому',
          body:handoverReason?`${task.title} — ${handoverReason}`:`${task.title}: теперь её ведёт кто-то другой`});
    }
    await notifyUsers(s.workspaceId,audience.filter(id=>id!==s.userId),{title:'Задача передана',body:task.title,url:`/#/tasks/${task.id}`,kind:'task.assigned'});
    json(res,200,{task});return true
  }
  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/schedule$`,'i'));
  if(m&&method==='PATCH'){
    const s=await requireSession(req),b=await readJson(req),task=await store.rescheduleTask(s,m[1],{promisedAt:toDateOrNull(b.promisedAt),forecastAt:toDateOrNull(b.forecastAt),reason:b.reason,expectedVersion:b.expectedVersion});
    const audience=taskAudience(task);hub.broadcastUsers(s.workspaceId,audience,'task.updated',task);
    // Срок — это и есть обещание. Он уезжал тихо, в один push, которого
    // может не быть вовсе: человек узнавал о переносе, открыв задачу.
    const when=task.promisedAt?new Date(task.promisedAt).toLocaleDateString('ru-RU',{day:'numeric',month:'long'}):'без срока';
    const why=typeof b.reason==='string'&&b.reason.trim()?` — ${b.reason.trim()}`:'';
    await store.projectTaskLifecycleNotification?.(s,task,{type:'task.rescheduled',title:'Срок задачи изменён',
      body:`${task.title}: ${when}${why}`});
    await notifyUsers(s.workspaceId,audience.filter(id=>id!==s.userId),{kind:'task.rescheduled',title:'Срок задачи изменён',body:task.title,url:`/#/tasks/${task.id}`});json(res,200,{task});return true
  }
  if(path==='/api/v1/calendar-events'&&method==='GET'){const s=await requireSession(req),from=toDateOrNull(url.searchParams.get('from')),to=toDateOrNull(url.searchParams.get('to'));json(res,200,{items:ctx.calendar?await ctx.calendar.listRange(s,{from,to}):await store.listCalendar(s,from,to)});return true}
  if(path==='/api/v1/calendar-events'&&method==='POST'){const s=await requireSession(req);requirePermission(s.role,Permission.CALENDAR_CREATE);const b=await readJson(req);
    // Раньше здесь стоял голый new Date: `null` давал первое января
    // 1970-го, а несуществующий день молча съезжал на следующий.
    const startAt=toDateOrNull(b.startAt??null),endAt=toDateOrNull(b.endAt??null);
    if(!startAt)throw Object.assign(new Error('Invalid date'),{code:'INVALID_DATE',statusCode:400});
    // Встрече и фокус-времени окончание обязательно — это правило схемы, и
    // раньше человек узнавал о нём фразой «A value failed a validation
    // rule» из базы, хотя в форме поле не помечено обязательным.
    const needsEnd=['meeting','focus','task_block'].includes(b.kind??'meeting');
    if(needsEnd&&!endAt)throw Object.assign(new Error('У встречи должно быть время окончания'),{code:'CALENDAR_END_REQUIRED',statusCode:400,expose:true});if(endAt&&Date.parse(endAt)<=Date.parse(startAt))throw Object.assign(new Error('Встреча должна закончиться после начала'),{code:'INVALID_CALENDAR_RANGE',statusCode:400,expose:true});const draft={kind:b.kind??'meeting',title:cleanText(b.title,240),description:b.description?cleanText(b.description,2000):null,startAt,endAt,timezone:b.timezone??'UTC',allDay:Boolean(b.allDay),visibility:b.visibility??'participants',commitmentId:b.commitmentId??null,conversationId:b.conversationId??null,recurrenceRule:b.recurrenceRule??null};
    const wanted=Array.isArray(b.participantIds)?b.participantIds.filter(Boolean):[];
    // Встреча и приглашения — одно решение, поэтому и одна транзакция: иначе
    // в календаре оставалась встреча, на которую никого не позвали.
    if(wanted.length){
      if(!ctx.calendar?.createWithParticipants)throw Object.assign(new Error('Участники встреч доступны в режиме с базой данных'),{code:'CALENDAR_UNAVAILABLE',statusCode:503,expose:true});
      const created=await ctx.calendar.createWithParticipants(s,draft,wanted);
      hub.broadcastWorkspace(s.workspaceId,'calendar.created',created.event);
      json(res,201,created);return true;
    }
    // Повторение живёт в репозитории календаря: базовое хранилище про
    // правило не знает и молча потеряло бы его — встреча завелась бы
    // одиночной, и человек узнал бы об этом через неделю.
    if(draft.recurrenceRule){
      if(!ctx.calendar?.createWithParticipants)throw Object.assign(new Error('Повторяющиеся встречи доступны в режиме с базой данных'),{code:'CALENDAR_UNAVAILABLE',statusCode:503,expose:true});
      const created=await ctx.calendar.createWithParticipants(s,draft,[]);
      hub.broadcastWorkspace(s.workspaceId,'calendar.created',created.event);
      json(res,201,created);return true;
    }
    const event=await store.createCalendarEvent(s,draft);hub.broadcastWorkspace(s.workspaceId,'calendar.created',event);
    json(res,201,{event,invited:0});return true}
  /**
   * Присутствие и объявленная доступность одним маршрутом.
   *
   * «Буду завтра в десять» и «вернусь пятого с двух» — это одно и то же
   * поле `backAt`, просто разный момент; выдумывать под них отдельные
   * виды статуса незачем.
   */
  if(path==='/api/v1/presence'&&method==='POST'){
    const s=await requireSession(req),b=await readJson(req);
    if(!allowedPresence.has(b.state))throw Object.assign(new Error('Такого статуса присутствия нет'),{code:'INVALID_PRESENCE',statusCode:400,expose:true});
    if(b.availability!==undefined&&!AVAILABILITY.has(String(b.availability)))
      throw Object.assign(new Error('Такой доступности нет'),{code:'INVALID_AVAILABILITY',statusCode:400,expose:true});
    if(b.backAt!==undefined&&b.backAt!==null){
      const at=toDateOrNull(b.backAt);
      if(!at)throw Object.assign(new Error('Invalid date'),{code:'INVALID_DATE',statusCode:400,expose:true});
      // Возвращение в прошлом — не возвращение: такой статус погас бы в
      // ту же секунду, и человек не понял бы, почему его не видно.
      if(Date.parse(at)<=Date.now())
        throw Object.assign(new Error('Момент возвращения должен быть в будущем'),{code:'BACK_AT_IN_PAST',statusCode:400,expose:true});
      b.backAt=at;
    }
    if(b.statusText!==undefined&&b.statusText)b.statusText=cleanText(b.statusText,140);
    const presence=await store.setPresence(s,b);hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence});json(res,200,{presence});return true}
  return false;
}
