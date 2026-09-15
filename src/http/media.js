import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { Permission, requirePermission } from '../rbac.js';
import { MAX_FILE, cleanText, json, readBuffer, readJson, sha256 } from './helpers.js';

export function createMediaHandler(uploadsRoot){
  return async function handleMedia(req,res,ctx,url,path,method){
    const {store,requireSession,hub,notifyUsers}=ctx;
    if(path==='/api/v1/files'&&method==='POST'){
      const s=await requireSession(req);requirePermission(s.role,Permission.FILE_UPLOAD);const buffer=await readBuffer(req,MAX_FILE);if(!buffer.length)throw Object.assign(new Error('File is empty'),{code:'EMPTY_FILE'});
      const id=randomUUID(),name=cleanText(decodeURIComponent(String(req.headers['x-file-name']??'file')),255),mimeType=String(req.headers['content-type']??'application/octet-stream').split(';')[0],storageKey=`${s.workspaceId}/${id}${extname(name).slice(0,12)}`,diskPath=normalize(join(uploadsRoot,storageKey));if(!diskPath.startsWith(normalize(uploadsRoot)))throw Object.assign(new Error('Invalid storage path'),{code:'INVALID_STORAGE_PATH'});await mkdir(join(uploadsRoot,s.workspaceId),{recursive:true});await writeFile(diskPath,buffer);
      try{const file=await store.saveFile(s,{id,name,mimeType,sizeBytes:buffer.length,storageKey,sha256:sha256(buffer)});hub.broadcastWorkspace(s.workspaceId,'file.created',file);json(res,201,{file:{...file,contentUrl:`/api/v1/files/${id}/content`}})}catch(e){await rm(diskPath,{force:true});throw e}return true;
    }
    let m=path.match(/^\/api\/v1\/files\/([0-9a-f-]+)\/content$/i);
    if(m&&method==='GET'){const s=await requireSession(req),file=await store.getFile(s,m[1]);if(!file)throw Object.assign(new Error('File not found'),{code:'NOT_FOUND',statusCode:404});const body=await readFile(join(uploadsRoot,file.storageKey));res.writeHead(200,{'content-type':file.mimeType??'application/octet-stream','content-length':body.length,'content-disposition':`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,'cache-control':'private, max-age=60'});res.end(body);return true}
    m=path.match(/^\/api\/v1\/conversations\/([0-9a-f-]+)\/voice$/i);
    if(m&&method==='POST'){
      const s=await requireSession(req);requirePermission(s.role,Permission.FILE_UPLOAD);if(!await store.canAccessConversation(s,m[1]))throw Object.assign(new Error('Conversation not found'),{code:'NOT_FOUND',statusCode:404});const buffer=await readBuffer(req,MAX_FILE),durationMs=Number(url.searchParams.get('durationMs')??0);if(durationMs<250||durationMs>3600000)throw Object.assign(new Error('Invalid voice duration'),{code:'INVALID_VOICE_DURATION'});const id=randomUUID(),storageKey=`${s.workspaceId}/${id}.webm`,diskPath=join(uploadsRoot,storageKey);await mkdir(join(uploadsRoot,s.workspaceId),{recursive:true});await writeFile(diskPath,buffer);
      try{const file=await store.saveFile(s,{id,name:`voice-${id}.webm`,mimeType:String(req.headers['content-type']??'audio/webm').split(';')[0],sizeBytes:buffer.length,storageKey,sha256:sha256(buffer)}),result=await store.saveVoiceMessage(s,m[1],{file,durationMs,waveform:[]}),audience=await store.conversationAudience(s,m[1]);hub.broadcastUsers(s.workspaceId,audience,'message.created',{conversationId:m[1],message:result.message});await notifyUsers(s.workspaceId,audience.filter(id=>id!==s.userId),{title:`Голосовое от ${s.displayName}`,body:'Новое голосовое сообщение',url:`/#/chats/${m[1]}`});json(res,201,result)}catch(e){await rm(diskPath,{force:true});throw e}return true;
    }
    if(path==='/api/v1/push-subscriptions'&&method==='POST'){const s=await requireSession(req);requirePermission(s.role,Permission.PUSH_SUBSCRIBE);const b=await readJson(req);if(!b.endpoint||!b.keys?.p256dh||!b.keys?.auth)throw Object.assign(new Error('Invalid push subscription'),{code:'INVALID_PUSH_SUBSCRIPTION'});const subscription=await store.savePushSubscription(s,{endpoint:b.endpoint,p256dh:b.keys.p256dh,auth:b.keys.auth,userAgent:req.headers['user-agent']??null});json(res,201,{subscription:{id:subscription.id,endpoint:subscription.endpoint}});return true}
    return false;
  }
}
