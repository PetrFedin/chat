/**
 * Имя файла из заголовка.
 *
 * Клиент кодирует его процентами, потому что в заголовке HTTP нельзя
 * ничего, кроме латиницы. Раньше здесь стоял голый `decodeURIComponent`,
 * и на нём спотыкались два обычных случая.
 *
 * Первый: процент в самом имени. «Скидка -50%.pdf» — не ошибка
 * клиента, а нормальное имя отчёта, и раскодировать его нечем:
 * `decodeURIComponent` бросает «URI malformed», и файл не загружался
 * вовсе. Не раскодировалось — значит, имя и было таким.
 *
 * Второй: клиент, который ничего не кодирует, — чужой скрипт, curl.
 * Тогда в заголовке лежат байты UTF-8, а прочитаны они как latin-1, и
 * «акт.txt» превращается в «Ð°ÐºÑ.txt». Если строка целиком помещается
 * в байты и складывается в осмысленный UTF-8 — складываем.
 */
export function fileNameFromHeader(raw){
  const header=String(raw??'file');
  let name=header;
  try{name=decodeURIComponent(header)}catch{name=header}
  if(/^[\u0000-\u00ff]*$/.test(name)&&/[\u0080-\u00ff]/.test(name)){
    try{
      const repaired=Buffer.from(name,'latin1').toString('utf8');
      if(!repaired.includes('\ufffd'))name=repaired;
    }catch{/* оставляем как есть */}
  }
  return name;
}

import { extractText, indexable } from '../search/file-text.js';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Permission, hasPermission, requirePermission } from '../rbac.js';
import { MAX_FILE, cleanText, json, readBuffer, readJson, sha256 } from './helpers.js';

const PREVIEWABLE = /^(image\/(?!svg\+xml)|application\/pdf$|text\/plain|audio\/|video\/)/;

export function createMediaHandler(objectStore){
  return async function handleMedia(req,res,ctx,url,path,method){
    const {store,requireSession,hub,notifyUsers}=ctx;
    if(path==='/api/v1/files'&&method==='POST'){
      const s=await requireSession(req);requirePermission(s.role,Permission.FILE_UPLOAD);const buffer=await readBuffer(req,MAX_FILE);if(!buffer.length)throw Object.assign(new Error('File is empty'),{code:'EMPTY_FILE'});
      const id=randomUUID(),name=cleanText(fileNameFromHeader(req.headers['x-file-name']),255),mimeType=String(req.headers['content-type']??'application/octet-stream').split(';')[0],storageKey=`${s.workspaceId}/${id}${extname(name).slice(0,12)}`;
      await objectStore.put(storageKey,buffer,mimeType);
      try{const file=await store.saveFile(s,{id,name,mimeType,sizeBytes:buffer.length,storageKey,sha256:sha256(buffer)});
      // Текст вложения — чтобы его можно было найти. Разбираем здесь, пока
      // файл в руках: читать его второй раз с диска ради индексации
      // незачем. Неразобранный файл — это файл без текста в поиске, а не
      // отказ его загрузить, поэтому ошибка сюда не поднимается.
      if(store.saveFileText){
        const text=extractText(buffer,{mimeType,name});
        if(text)await store.saveFileText(s,id,{body:text,kind:indexable(mimeType,name)}).catch(()=>{});
      }
      hub.broadcastWorkspace(s.workspaceId,'file.created',file);json(res,201,{file:{...(({storageKey,...rest})=>rest)(file),contentUrl:`/api/v1/files/${id}/content`,previewUrl:PREVIEWABLE.test(mimeType)?`/api/v1/files/${id}/preview`:null}})}catch(e){await objectStore.delete(storageKey).catch(()=>{});throw e}return true;
    }
    let m=path.match(/^\/api\/v1\/files\/([0-9a-f-]+)\/(content|preview)$/i);
    if(m&&method==='GET'){
      const s=await requireSession(req),file=await store.getFile(s,m[1]);if(!file)throw Object.assign(new Error('File not found'),{code:'NOT_FOUND',statusCode:404});
      if(m[2]==='preview'&&!PREVIEWABLE.test(file.mimeType??''))throw Object.assign(new Error('Preview is not available for this file type'),{code:'PREVIEW_UNAVAILABLE',statusCode:415});
      const body=await objectStore.get(file.storageKey);res.writeHead(200,{'content-type':file.mimeType??'application/octet-stream','content-length':body.length,'content-disposition':`${m[2]==='preview'?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,'cache-control':'private, max-age=60'});res.end(body);return true;
    }
    m=path.match(/^\/api\/v1\/conversations\/([0-9a-f-]+)\/voice$/i);
    if(m&&method==='POST'){
      const s=await requireSession(req);requirePermission(s.role,Permission.FILE_UPLOAD);requirePermission(s.role,Permission.MESSAGE_SEND);const policy=await store.conversationPolicy(s,m[1]);if(!policy)throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});if(policy.conversation.announcementOnly&&!hasPermission(s.role,Permission.CHANNEL_MANAGE)&&!['owner','moderator'].includes(policy.memberRole))throw Object.assign(new Error('Only channel managers may publish in this announcement channel'),{code:'ANNOUNCEMENT_ONLY',statusCode:403});const buffer=await readBuffer(req,MAX_FILE),durationMs=Number(url.searchParams.get('durationMs')??0);if(durationMs<250||durationMs>3600000)throw Object.assign(new Error('Invalid voice duration'),{code:'INVALID_VOICE_DURATION'});const id=randomUUID(),storageKey=`${s.workspaceId}/${id}.webm`,mimeType=String(req.headers['content-type']??'audio/webm').split(';')[0];
      await objectStore.put(storageKey,buffer,mimeType);
      try{const file=await store.saveFile(s,{id,name:`voice-${id}.webm`,mimeType,sizeBytes:buffer.length,storageKey,sha256:sha256(buffer)}),result=await store.saveVoiceMessage(s,m[1],{file,durationMs,waveform:[]}),audience=await store.conversationAudience(s,m[1]),notificationAudience=store.conversationNotificationAudience?await store.conversationNotificationAudience(s,m[1]):audience;hub.broadcastUsers(s.workspaceId,audience,'message.created',{conversationId:m[1],message:result.message});await notifyUsers(s.workspaceId,notificationAudience.filter(id=>id!==s.userId),{title:`Голосовое сообщение · ${s.displayName}`,body:'Новое голосовое сообщение',url:`/#/chats/${m[1]}`,kind:'message.created'});json(res,201,result)}catch(e){await objectStore.delete(storageKey).catch(()=>{});throw e}return true;
    }
    if(path==='/api/v1/push-subscriptions'&&method==='POST'){const s=await requireSession(req);requirePermission(s.role,Permission.PUSH_SUBSCRIBE);const b=await readJson(req);if(!b.endpoint||!b.keys?.p256dh||!b.keys?.auth)throw Object.assign(new Error('Invalid push subscription'),{code:'INVALID_PUSH_SUBSCRIPTION'});const subscription=await store.savePushSubscription(s,{endpoint:b.endpoint,p256dh:b.keys.p256dh,auth:b.keys.auth,userAgent:req.headers['user-agent']??null});json(res,201,{subscription:{id:subscription.id,endpoint:subscription.endpoint}});return true}
    return false;
  }
}
