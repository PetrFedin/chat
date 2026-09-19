import { Permission, requirePermission } from '../rbac.js';
import { cleanText, json, readJson, allowedPresence } from './helpers.js';

const TASK_ID='([0-9a-f-]+)';
const TASK_EVIDENCE_TYPES=new Set(['url','file','message','metric','note']);
const taskAudience=(task)=>[...new Set([task?.ownerId,task?.requesterId,task?.acceptorId].filter(Boolean))];
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

export async function handleWorkspace(req,res,ctx,url,path,method){
  const {store,requireSession,hub,notifyUsers}=ctx;
  if(path==='/api/v1/tasks'&&method==='GET'){const s=await requireSession(req);json(res,200,{items:await store.listTasks(s)});return true}
  if(path==='/api/v1/tasks'&&method==='POST'){
    const s=await requireSession(req);requirePermission(s.role,Permission.TASK_CREATE);const b=await readJson(req),task=await store.createTask(s,{title:cleanText(b.title,240),outcome:b.outcome?cleanText(b.outcome,1000):undefined,ownerId:b.ownerId??s.userId,acceptorId:b.acceptorId??s.userId,sourceMessageId:b.sourceMessageId??null,priority:b.priority??'normal',promisedAt:b.promisedAt??null,forecastAt:b.forecastAt??null});
    const audience=taskAudience(task);hub.broadcastUsers(s.workspaceId,audience,'task.created',task);json(res,201,{task});return true
  }
  let m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}$`,'i'));
  if(m&&method==='GET'){const s=await requireSession(req),task=await store.getTaskDetail(s,m[1]);if(!task)throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND',statusCode:404});json(res,200,{task});return true}
  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/transitions$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req),b=await readJson(req),task=await store.transitionTask(s,m[1],{to:String(b.to??''),reason:b.reason??null,expectedVersion:b.expectedVersion});
    const audience=taskAudience(task);hub.broadcastUsers(s.workspaceId,audience,'task.updated',task);
    const recipients=audience.filter(id=>id!==s.userId);
    await notifyUsers(s.workspaceId,recipients,{title:taskLabel(task.status),body:task.title,url:`/#/tasks/${task.id}`});
    json(res,200,{task});return true
  }
  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/evidence$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req),b=await readJson(req),type=String(b.type??'note');if(!TASK_EVIDENCE_TYPES.has(type))throw Object.assign(new Error('Unsupported evidence type'),{code:'INVALID_EVIDENCE_TYPE',statusCode:400});const value=cleanText(b.value,4000),result=await store.addTaskEvidence(s,m[1],{type,value,expectedVersion:b.expectedVersion});
    const audience=taskAudience(result.task);hub.broadcastUsers(s.workspaceId,audience,'task.updated',result.task);json(res,201,result);return true
  }
  m=path.match(new RegExp(`^/api/v1/tasks/${TASK_ID}/schedule$`,'i'));
  if(m&&method==='PATCH'){
    const s=await requireSession(req),b=await readJson(req),task=await store.rescheduleTask(s,m[1],{promisedAt:b.promisedAt===undefined?undefined:(b.promisedAt?new Date(b.promisedAt).toISOString():null),forecastAt:b.forecastAt===undefined?undefined:(b.forecastAt?new Date(b.forecastAt).toISOString():null),reason:b.reason,expectedVersion:b.expectedVersion});
    const audience=taskAudience(task);hub.broadcastUsers(s.workspaceId,audience,'task.updated',task);await notifyUsers(s.workspaceId,audience.filter(id=>id!==s.userId),{title:'Срок задачи изменён',body:task.title,url:`/#/tasks/${task.id}`});json(res,200,{task});return true
  }
  if(path==='/api/v1/calendar-events'&&method==='GET'){const s=await requireSession(req);json(res,200,{items:await store.listCalendar(s,url.searchParams.get('from'),url.searchParams.get('to'))});return true}
  if(path==='/api/v1/calendar-events'&&method==='POST'){const s=await requireSession(req);requirePermission(s.role,Permission.CALENDAR_CREATE);const b=await readJson(req),startAt=new Date(b.startAt).toISOString(),endAt=b.endAt?new Date(b.endAt).toISOString():null;if(endAt&&Date.parse(endAt)<=Date.parse(startAt))throw Object.assign(new Error('Calendar end must be after start'),{code:'INVALID_CALENDAR_RANGE'});const event=await store.createCalendarEvent(s,{kind:b.kind??'meeting',title:cleanText(b.title,240),description:b.description?cleanText(b.description,2000):null,startAt,endAt,timezone:b.timezone??'UTC',allDay:Boolean(b.allDay),visibility:b.visibility??'participants',commitmentId:b.commitmentId??null,conversationId:b.conversationId??null});hub.broadcastWorkspace(s.workspaceId,'calendar.created',event);json(res,201,{event});return true}
  if(path==='/api/v1/presence'&&method==='POST'){const s=await requireSession(req),b=await readJson(req);if(!allowedPresence.has(b.state))throw Object.assign(new Error('Invalid presence state'),{code:'INVALID_PRESENCE'});const presence=await store.setPresence(s,b);hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence});json(res,200,{presence});return true}
  return false;
}
