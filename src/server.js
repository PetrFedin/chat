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
import { handleDailyWork } from './http/daily-work.js';
import { createMeetingIntelligenceHandler } from './http/meeting-intelligence.js';
import { createMediaHandler } from './http/media.js';
import { createCallHandler } from './http/calls.js';
import { createCallRepository } from './media/call-repository.js';
import { createMediaProvider } from './media/livekit-provider.js';
import { createLiveKitWebhookReceiver } from './media/livekit-webhook.js';
import { createMeetingRepository } from './meeting/meeting-repository.js';
import { createProcessingAwareMeetingRepository } from './meeting/processing-repository.js';
import { createMeetingProcessor } from './meeting/processor.js';
import { createConfiguredMeetingProviders } from './meeting/openai-providers.js';
import { createMeetingReviewProjector } from './meeting/review-projection.js';
import { createMeetingWorker } from './meeting/worker.js';
import { createObjectStore } from './storage/object-store.js';
import { preparePreviewDemo, handlePreviewDemo } from './demo/preview-demo.js';
import { seedDemoMeetingIntelligence } from './demo/seed-meeting-intelligence.js';

const { Pool }=pg;
const publicRoot=fileURLToPath(new URL('../public/',import.meta.url));
const uploadsRoot=process.env.UPLOAD_DIR??fileURLToPath(new URL('../data/uploads/',import.meta.url));
const livekitClientPath=fileURLToPath(new URL('../node_modules/livekit-client/dist/livekit-client.umd.js',import.meta.url));
const mime=new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.webmanifest','application/manifest+json; charset=utf-8'],['.json','application/json; charset=utf-8'],['.svg','image/svg+xml']]);
const cookieName='chat_session';
const sessionCookie=(token)=>`${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30*86400}${process.env.NODE_ENV==='production'?'; Secure':''}`;
const clearSession=()=>`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`;
const cookieToken=(req)=>cookies(req)[cookieName]||null;

function defaultStore(){if(!process.env.DATABASE_URL)return{store:new MemoryStore(),pool:null,mode:'memory'};const pool=new Pool({connectionString:process.env.DATABASE_URL,max:Number(process.env.PG_POOL_MAX??10),ssl:process.env.PGSSL==='require'?{rejectUnauthorized:false}:undefined});return{store:new PostgresStore(pool),pool,mode:'postgres'}}
function pushConfig(){const publicKey=process.env.VAPID_PUBLIC_KEY??null,privateKey=process.env.VAPID_PRIVATE_KEY??null;if(publicKey&&privateKey)webpush.setVapidDetails(process.env.VAPID_SUBJECT??'mailto:admin@example.com',publicKey,privateKey);return{enabled:Boolean(publicKey&&privateKey),publicKey}}

export async function createChatServer(options={}){
  await mkdir(uploadsRoot,{recursive:true});
  const defaults=options.store?{store:options.store,pool:options.pool??null,mode:'custom'}:defaultStore();
  const {store,pool,mode}=defaults;
  const objectStore=options.objectStore??createObjectStore({uploadsRoot});
  const demo=await preparePreviewDemo({store,objectStore,mode,enabled:options.demoEnabled??process.env.DEMO_MODE==='true'});
  const hub=new RealtimeHub(),push=pushConfig(),wss=new WebSocketServer({noServer:true});
  const mediaProvider=options.mediaProvider??createMediaProvider();
  const calls=options.calls??createCallRepository(pool);
  const meeting=options.meeting??createProcessingAwareMeetingRepository(createMeetingRepository(pool),pool);
  const liveKitWebhook=options.liveKitWebhook??createLiveKitWebhookReceiver();
  const configuredMeetingProviders=createConfiguredMeetingProviders(process.env);
  const transcriptionProvider=options.transcriptionProvider??configuredMeetingProviders.transcriptionProvider;
  const summaryProvider=options.summaryProvider??configuredMeetingProviders.summaryProvider;
  const authenticate=async(req)=>{const token=cookieToken(req);return token?store.getSession(hashToken(token)):null};
  const requireSession=async(req)=>{const s=await authenticate(req);if(!s)throw Object.assign(new Error('Authentication required'),{code:'UNAUTHENTICATED',statusCode:401});return s};
  const openSession=async(res,req,userId,workspaceId,status=200)=>{const token=createOpaqueToken(),tokenHash=hashToken(token),expiresAt=createSessionExpiry();await store.createSession({userId,workspaceId,tokenHash,expiresAt,userAgent:req.headers['user-agent']??null,ipAddress:String(req.headers['x-forwarded-for']??req.socket.remoteAddress??'').split(',')[0].trim()||null});const s=await store.getSession(tokenHash);json(res,status,{session:{...s,permissions:visiblePermissions(s.role)},storageMode:mode,push,media:mediaProvider.status(),objectStorage:objectStore.status()},{'set-cookie':sessionCookie(token)})};
  const notifyUsers=async(workspaceId,userIds,payload)=>{if(!push.enabled||!userIds.length)return;const subs=await store.listPushSubscriptions(workspaceId,userIds);await Promise.allSettled(subs.map(s=>webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify(payload),{TTL:60})))};
  const projectMeetingReviewReady=createMeetingReviewProjector({store,calls,hub,notifyUsers});

  const meetingProcessor=options.meetingProcessor??createMeetingProcessor({
    repository:meeting,
    objectStore,
    transcriptionProvider,
    summaryProvider,
    onReviewReady:projectMeetingReviewReady,
    maxInMemoryBytes:Number(process.env.MEETING_PROCESSING_MAX_IN_MEMORY_BYTES||64*1024*1024),
  });

  if(demo.enabled){
    try{demo.meeting=await seedDemoMeetingIntelligence({store,calls,meeting})}catch(error){console.error('meeting demo seed failed',error)}
  }

  const meetingWorker=options.meetingWorker??createMeetingWorker(meetingProcessor,process.env,{
    enabled:options.meetingWorkerEnabled??mode!=='custom',
  });
  const startMeetingWorker=options.startMeetingWorker??mode!=='custom';
  if(startMeetingWorker)meetingWorker.start?.();

  const ctx={store,mode,hub,calls,meeting,meetingProcessor,meetingWorker,liveKitWebhook,mediaProvider,objectStore,push:{enabled:push.enabled,publicKey:push.publicKey},demo,requireSession,openSession,clearSession,cookieToken,permissions:visiblePermissions,notifyUsers};
  const handleMedia=createMediaHandler(objectStore),handleCalls=createCallHandler(),handleMeetingIntelligence=createMeetingIntelligenceHandler();
  const server=createServer(async(req,res)=>{try{
    const url=new URL(req.url??'/',`http://${req.headers.host??'localhost'}`),path=url.pathname,method=req.method??'GET';
    if(path==='/healthz')return json(res,200,{ok:true,storageMode:mode,realtime:true,push:push.enabled,media:mediaProvider.status(),meetingIntelligence:{webhook:liveKitWebhook.status(),processor:meetingProcessor.status(),worker:meetingWorker.status?.()??{configured:false,running:false}},objectStorage:objectStore.status(),demo:{enabled:demo.enabled,label:demo.label??null,meeting:Boolean(demo.meeting)}});
    if(path==='/openapi.json'||path==='/api/v1/openapi')return json(res,200,openapi);
    if(path==='/vendor/livekit-client.js'&&method==='GET'){const body=await readFile(livekitClientPath);res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'public, max-age=86400'});res.end(body);return}
    if(await handleMeetingIntelligence(req,res,ctx,path,method))return;
    if(await handlePreviewDemo(req,res,ctx,path,method))return;
    if(await handleAuth(req,res,ctx,path,method))return;
    if(await handleDailyWork(req,res,ctx,url,path,method))return;
    if(await handleWorkspace(req,res,ctx,url,path,method))return;
    if(await handleMessaging(req,res,ctx,path,method))return;
    if(await handleCalls(req,res,ctx,path,method))return;
    if(await handleMedia(req,res,ctx,url,path,method))return;
    if(path.startsWith('/api/'))throw Object.assign(new Error('API route not found'),{code:'NOT_FOUND',statusCode:404});
    const relative=path==='/'?'index.html':path.replace(/^\/+/,''),candidate=normalize(join(publicRoot,relative));if(!candidate.startsWith(normalize(publicRoot)))throw Object.assign(new Error('Bad request'),{code:'BAD_PATH',statusCode:400});
    try{const info=await stat(candidate),file=info.isDirectory()?join(candidate,'index.html'):candidate,body=await readFile(file);res.writeHead(200,{'content-type':mime.get(extname(file))??'application/octet-stream','cache-control':file.endsWith('index.html')?'no-store':'public, max-age=300'});res.end(body)}catch{const body=await readFile(join(publicRoot,'index.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(body)}
  }catch(error){console.error(error);errorJson(res,error)}});
  server.on('upgrade',async(req,socket,head)=>{try{const url=new URL(req.url??'/',`http://${req.headers.host??'localhost'}`);if(url.pathname!=='/ws')return socket.destroy();const s=await authenticate(req);if(!s){socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');return socket.destroy()}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req,s))}catch{socket.destroy()}});
  wss.on('connection',async(ws,req,s)=>{const remove=hub.add(s.workspaceId,s.userId,ws);hub.send(ws,'session.ready',{userId:s.userId,workspaceId:s.workspaceId});try{const p=await store.setPresence(s,{state:'online'});hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence:p},ws)}catch{}ws.on('message',async raw=>{try{const packet=JSON.parse(String(raw));if(packet.event==='typing.start'||packet.event==='typing.stop'){const id=packet.data?.conversationId;if(id&&await store.canAccessConversation(s,id)){const audience=await store.conversationAudience(s,id);hub.broadcastUsers(s.workspaceId,audience.filter(x=>x!==s.userId),packet.event,{conversationId:id,userId:s.userId})}}else if(packet.event==='presence.set'&&allowedPresence.has(packet.data?.state)){const p=await store.setPresence(s,packet.data);hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence:p})}}catch(error){hub.send(ws,'error',{code:error.code??'INVALID_EVENT',message:error.message})}});ws.on('close',async()=>{remove();try{const p=await store.setPresence(s,{state:'away'});hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence:p})}catch{}})});
  return{server,store,calls,meeting,meetingProcessor,meetingWorker,liveKitWebhook,mediaProvider,objectStore,mode,demo,close:async()=>{await meetingWorker.stop?.().catch((error)=>console.error('meeting worker shutdown failed',error));for(const client of wss.clients)try{client.close(1001,'Server shutdown')}catch{}await new Promise(resolve=>server.close(resolve));wss.close();if(pool)await pool.end()}};
}

const isMain=process.argv[1]&&fileURLToPath(import.meta.url)===normalize(process.argv[1]);
if(isMain){
  const app=await createChatServer(),port=Number(process.env.PORT??3000);
  app.server.listen(port,'0.0.0.0',()=>console.log(`Chat workspace: http://localhost:${port} [${app.mode}]${app.demo.enabled?' [demo]':''}`));
  let closing=false;
  const shutdown=async(signal)=>{
    if(closing)return;
    closing=true;
    console.log(`Chat shutdown requested by ${signal}`);
    const hardStop=setTimeout(()=>{console.error('Chat graceful shutdown timed out');process.exit(1)},15000);
    hardStop.unref?.();
    try{await app.close();clearTimeout(hardStop);process.exit(0)}catch(error){clearTimeout(hardStop);console.error('Chat shutdown failed',error);process.exit(1)}
  };
  process.once('SIGTERM',()=>void shutdown('SIGTERM'));
  process.once('SIGINT',()=>void shutdown('SIGINT'));
}
