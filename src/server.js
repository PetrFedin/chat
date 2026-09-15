import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { WebSocketServer } from 'ws';
import webpush from 'web-push';
import { hashToken, createOpaqueToken, createSessionExpiry } from './security.js';
import { visiblePermissions } from './rbac.js';
import { openapi } from './openapi.js';
import { MemoryStore, PostgresStore } from './persistence/store.js';
import { RealtimeHub } from './realtime.js';
import { cookies, errorJson, json, allowedPresence } from './http/helpers.js';
import { handleAuth } from './http/auth.js';
import { handleWorkspace } from './http/workspace.js';
import { handleMessaging } from './http/messaging.js';
import { createMediaHandler } from './http/media.js';

const { Pool }=pg;
const publicRoot=fileURLToPath(new URL('../public/',import.meta.url));
const uploadsRoot=process.env.UPLOAD_DIR??fileURLToPath(new URL('../data/uploads/',import.meta.url));
const mime=new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.webmanifest','application/manifest+json; charset=utf-8'],['.json','application/json; charset=utf-8'],['.svg','image/svg+xml']]);
const cookieName='chat_session';
const sessionCookie=(token)=>`${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30*86400}${process.env.NODE_ENV==='production'?'; Secure':''}`;
const clearSession=()=>`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`;
const cookieToken=(req)=>cookies(req)[cookieName]||null;

function defaultStore(){if(!process.env.DATABASE_URL)return{store:new MemoryStore(),pool:null,mode:'memory'};const pool=new Pool({connectionString:process.env.DATABASE_URL,max:Number(process.env.PG_POOL_MAX??10),ssl:process.env.PGSSL==='require'?{rejectUnauthorized:false}:undefined});return{store:new PostgresStore(pool),pool,mode:'postgres'}}
function pushConfig(){const publicKey=process.env.VAPID_PUBLIC_KEY??null,privateKey=process.env.VAPID_PRIVATE_KEY??null;if(publicKey&&privateKey)webpush.setVapidDetails(process.env.VAPID_SUBJECT??'mailto:admin@example.com',publicKey,privateKey);return{enabled:Boolean(publicKey&&privateKey),publicKey}}

export async function createChatServer(options={}){
  await mkdir(uploadsRoot,{recursive:true});const defaults=options.store?{store:options.store,pool:null,mode:'custom'}:defaultStore(),{store,pool,mode}=defaults,hub=new RealtimeHub(),push=pushConfig(),wss=new WebSocketServer({noServer:true});
  const authenticate=async(req)=>{const token=cookieToken(req);return token?store.getSession(hashToken(token)):null};
  const requireSession=async(req)=>{const s=await authenticate(req);if(!s)throw Object.assign(new Error('Authentication required'),{code:'UNAUTHENTICATED',statusCode:401});return s};
  const openSession=async(res,req,userId,workspaceId,status=200)=>{const token=createOpaqueToken(),tokenHash=hashToken(token),expiresAt=createSessionExpiry();await store.createSession({userId,workspaceId,tokenHash,expiresAt,userAgent:req.headers['user-agent']??null,ipAddress:String(req.headers['x-forwarded-for']??req.socket.remoteAddress??'').split(',')[0].trim()||null});const s=await store.getSession(tokenHash);json(res,status,{session:{...s,permissions:visiblePermissions(s.role)},storageMode:mode,push},{'set-cookie':sessionCookie(token)})};
  const notifyUsers=async(workspaceId,userIds,payload)=>{if(!push.enabled||!userIds.length)return;const subs=await store.listPushSubscriptions(workspaceId,userIds);await Promise.allSettled(subs.map(s=>webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify(payload),{TTL:60})))};
  const ctx={store,mode,hub,push:{enabled:push.enabled,publicKey:push.publicKey},requireSession,openSession,clearSession,cookieToken,permissions:visiblePermissions,notifyUsers};
  const handleMedia=createMediaHandler(uploadsRoot);
  const server=createServer(async(req,res)=>{try{const url=new URL(req.url??'/',`http://${req.headers.host??'localhost'}`),path=url.pathname,method=req.method??'GET';if(path==='/healthz')return json(res,200,{ok:true,storageMode:mode,realtime:true,push:push.enabled});if(path==='/openapi.json'||path==='/api/v1/openapi')return json(res,200,openapi);if(await handleAuth(req,res,ctx,path,method))return;if(await handleWorkspace(req,res,ctx,url,path,method))return;if(await handleMessaging(req,res,ctx,path,method))return;if(await handleMedia(req,res,ctx,url,path,method))return;if(path.startsWith('/api/'))throw Object.assign(new Error('API route not found'),{code:'NOT_FOUND',statusCode:404});const relative=path==='/'?'index.html':path.replace(/^\/+/,''),candidate=normalize(join(publicRoot,relative));if(!candidate.startsWith(normalize(publicRoot)))throw Object.assign(new Error('Bad request'),{code:'BAD_PATH',statusCode:400});try{const info=await stat(candidate),file=info.isDirectory()?join(candidate,'index.html'):candidate,body=await readFile(file);res.writeHead(200,{'content-type':mime.get(extname(file))??'application/octet-stream','cache-control':file.endsWith('index.html')?'no-store':'public, max-age=300'});res.end(body)}catch{const body=await readFile(join(publicRoot,'index.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(body)}}catch(error){console.error(error);errorJson(res,error)}});
  server.on('upgrade',async(req,socket,head)=>{try{const url=new URL(req.url??'/',`http://${req.headers.host??'localhost'}`);if(url.pathname!=='/ws')return socket.destroy();const s=await authenticate(req);if(!s){socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');return socket.destroy()}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req,s))}catch{socket.destroy()}});
  wss.on('connection',async(ws,req,s)=>{const remove=hub.add(s.workspaceId,s.userId,ws);hub.send(ws,'session.ready',{userId:s.userId,workspaceId:s.workspaceId});try{const p=await store.setPresence(s,{state:'online'});hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence:p},ws)}catch{}ws.on('message',async raw=>{try{const packet=JSON.parse(String(raw));if(packet.event==='typing.start'||packet.event==='typing.stop'){const id=packet.data?.conversationId;if(id&&await store.canAccessConversation(s,id)){const audience=await store.conversationAudience(s,id);hub.broadcastUsers(s.workspaceId,audience.filter(x=>x!==s.userId),packet.event,{conversationId:id,userId:s.userId})}}else if(packet.event==='presence.set'&&allowedPresence.has(packet.data?.state)){const p=await store.setPresence(s,packet.data);hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence:p},ws)}}catch(error){hub.send(ws,'error',{code:error.code??'INVALID_EVENT',message:error.message})}});ws.on('close',async()=>{remove();try{const p=await store.setPresence(s,{state:'away'});hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence:p})}catch{}})});
  return{server,store,mode,close:async()=>{await new Promise(resolve=>server.close(resolve));wss.close();if(pool)await pool.end()}};
}

const isMain=process.argv[1]&&fileURLToPath(import.meta.url)===normalize(process.argv[1]);
if(isMain){const app=await createChatServer(),port=Number(process.env.PORT??3000);app.server.listen(port,'0.0.0.0',()=>console.log(`Chat workspace: http://localhost:${port} [${app.mode}]`))}
