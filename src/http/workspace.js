import { Permission, requirePermission } from '../rbac.js';
import { cleanText, json, readJson, allowedPresence } from './helpers.js';

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

// Only undefined means "leave unchanged" and only null means "clear": a
// falsy-but-present value like 0 is a date the caller meant, and treating it
// as "delete the promise" destroyed commitment dates behind a 200.
const INVALID_DATE=()=>Object.assign(new Error('Invalid date'),{code:'INVALID_DATE',statusCode:400});

/**
 * Разбор даты, который не додумывает за человека.
 *
 * `new Date` переполняет поля вместо отказа: 29 февраля невисокосного
 * года молча становится 1 марта, 31 ноября — 1 декабря, а `null` —
 * первым января 1970-го. Сервер отвечал «создано» и ставил встречу не на
 * тот день. Здесь дата принимается только если она и есть та, что
 * написана, и попадает в разумный горизонт: столетие в обе стороны
 * PostgreSQL хранит, а +275760 год роняет запрос в пятисотку.
 */
const toDateOrNull=(value)=>{
  if(value===undefined)return undefined;
  if(value===null||value==='')return null;
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))throw INVALID_DATE();
  const iso=date.toISOString();
  // Календарная часть должна совпасть с написанной: так ловится
  // несуществующий день, который Date досчитал до следующего месяца.
  if(typeof value==='string'){
    const written=value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(written&&!iso.startsWith(`${written[1]}-${written[2]}-${written[3]}`)){
      // Смещение пояса может законно сдвинуть дату на сутки — сверяем и
      // местную календарную часть тоже.
      const local=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      if(local!==`${written[1]}-${written[2]}-${written[3]}`)throw INVALID_DATE();
    }
  }
  const year=date.getUTCFullYear();
  if(year<1970||year>2200)throw INVALID_DATE();
  return iso;
};

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
  if(path==='/api/v1/tasks'&&method==='POST'){
    const s=await requireSession(req);requirePermission(s.role,Permission.TASK_CREATE);const b=await readJson(req),task=await store.createTask(s,{title:cleanText(b.title,240),outcome:b.outcome?cleanText(b.outcome,1000):undefined,ownerId:b.ownerId??s.userId,acceptorId:b.acceptorId??s.userId,sourceMessageId:b.sourceMessageId??null,priority:b.priority??'normal',promisedAt:toDateOrNull(b.promisedAt)??null,forecastAt:toDateOrNull(b.forecastAt)??null});
    const audience=taskAudience(task);hub.broadcastUsers(s.workspaceId,audience,'task.created',taskRealtime(task));json(res,201,{task});return true
  }
  let m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}$`,'i'));
  if(m&&method==='GET'){const s=await requireSession(req),task=await store.getTaskDetail(s,m[1]);if(!task)throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});json(res,200,{task});return true}
  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/transitions$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req),b=await readJson(req),task=await store.transitionTask(s,m[1],{to:String(b.to??''),reason:b.reason??null,expectedVersion:b.expectedVersion});
    const audience=taskAudience(task),title=taskLabel(task.status);hub.broadcastUsers(s.workspaceId,audience,'task.updated',taskRealtime(task));
    await store.projectTaskLifecycleNotification?.(s,task,{type:task.status==='in_review'?'review.requested':'task.updated',title});
    const recipients=audience.filter(id=>id!==s.userId);
    await notifyUsers(s.workspaceId,recipients,{title,body:task.title,url:`/#/tasks/${task.id}`});
    json(res,200,{task});return true
  }
  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/evidence$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req),b=await readJson(req),type=String(b.type??'note');if(!TASK_EVIDENCE_TYPES.has(type))throw Object.assign(new Error('Unsupported evidence type'),{code:'INVALID_EVIDENCE_TYPE',statusCode:400});const value=cleanText(b.value,4000);await assertEvidenceValue(store,s,type,value);const result=await store.addTaskEvidence(s,m[1],{type,value,expectedVersion:b.expectedVersion});
    const audience=taskAudience(result.task);hub.broadcastUsers(s.workspaceId,audience,'task.updated',taskRealtime(result.task));json(res,201,result);return true
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
    await notifyUsers(s.workspaceId,audience.filter(id=>id!==s.userId),{title:'Задача передана',body:task.title,url:`/#/tasks/${task.id}`});
    json(res,200,{task});return true
  }
  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/schedule$`,'i'));
  if(m&&method==='PATCH'){
    const s=await requireSession(req),b=await readJson(req),task=await store.rescheduleTask(s,m[1],{promisedAt:toDateOrNull(b.promisedAt),forecastAt:toDateOrNull(b.forecastAt),reason:b.reason,expectedVersion:b.expectedVersion});
    const audience=taskAudience(task);hub.broadcastUsers(s.workspaceId,audience,'task.updated',task);await notifyUsers(s.workspaceId,audience.filter(id=>id!==s.userId),{title:'Срок задачи изменён',body:task.title,url:`/#/tasks/${task.id}`});json(res,200,{task});return true
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
    if(needsEnd&&!endAt)throw Object.assign(new Error('У встречи должно быть время окончания'),{code:'CALENDAR_END_REQUIRED',statusCode:400,expose:true});if(endAt&&Date.parse(endAt)<=Date.parse(startAt))throw Object.assign(new Error('Calendar end must be after start'),{code:'INVALID_CALENDAR_RANGE'});const draft={kind:b.kind??'meeting',title:cleanText(b.title,240),description:b.description?cleanText(b.description,2000):null,startAt,endAt,timezone:b.timezone??'UTC',allDay:Boolean(b.allDay),visibility:b.visibility??'participants',commitmentId:b.commitmentId??null,conversationId:b.conversationId??null};
    const wanted=Array.isArray(b.participantIds)?b.participantIds.filter(Boolean):[];
    // Встреча и приглашения — одно решение, поэтому и одна транзакция: иначе
    // в календаре оставалась встреча, на которую никого не позвали.
    if(wanted.length){
      if(!ctx.calendar?.createWithParticipants)throw Object.assign(new Error('Участники встреч доступны в режиме с базой данных'),{code:'CALENDAR_UNAVAILABLE',statusCode:503,expose:true});
      const created=await ctx.calendar.createWithParticipants(s,draft,wanted);
      hub.broadcastWorkspace(s.workspaceId,'calendar.created',created.event);
      json(res,201,created);return true;
    }
    const event=await store.createCalendarEvent(s,draft);hub.broadcastWorkspace(s.workspaceId,'calendar.created',event);
    json(res,201,{event,invited:0});return true}
  if(path==='/api/v1/presence'&&method==='POST'){const s=await requireSession(req),b=await readJson(req);if(!allowedPresence.has(b.state))throw Object.assign(new Error('Invalid presence state'),{code:'INVALID_PRESENCE'});const presence=await store.setPresence(s,b);hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence});json(res,200,{presence});return true}
  return false;
}
