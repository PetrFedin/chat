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
import { clientAddress, cookies, errorJson, json, allowedPresence, securityHeaders, readBuffer, MAX_JSON } from './http/helpers.js';
import { createAuthThrottle } from './rate-limit.js';
import { createIdempotencyGuard, IDEMPOTENCY_HEADER } from './http/idempotency.js';
import { handleAuth } from './http/auth.js';
import { handleWorkspace } from './http/workspace.js';
import { handleMessaging } from './http/messaging.js';
import { handleDailyWork } from './http/daily-work.js';
import { createMeetingIntelligenceHandler } from './http/meeting-intelligence.js';
import { createMeetingOperationsHandler } from './http/meeting-operations.js';
import { createMediaHandler } from './http/media.js';
import { createCallHandler } from './http/calls.js';
import { createIntegrationsHandler } from './http/integrations.js';
import { createOrgHandler } from './http/org.js';
import { createAuditHandler } from './http/audit.js';
import { createGamesHandler } from './http/games.js';
import { createRemindersHandler } from './http/reminders.js';
import { createVaultHandler } from './http/vault.js';
import { createMarksHandler } from './http/marks.js';
import { createMarkRepository } from './marks/mark-repository.js';
import { createVaultRepository } from './vault/vault-repository.js';
import { createReminderRepository, createReminderWorker } from './reminders/reminder-repository.js';
import { createGameRepository } from './games/game-repository.js';
import { createPeopleHandler } from './http/people.js';
import { createCalendarHandler } from './http/calendar.js';
import { createLabelHandler } from './http/labels.js';
import { createPersonalHandler } from './http/personal.js';
import { createPersonalRepository } from './personal/personal-repository.js';
import { createLabelRepository } from './labels/label-repository.js';
import { createCalendarRepository } from './calendar/calendar-repository.js';
import { createPeopleRepository } from './people/people-repository.js';
import { createOrgRepository } from './org/org-repository.js';
import { createWebhookRepository } from './integrations/webhook-repository.js';
import { createDeliveryWorker } from './integrations/delivery-worker.js';
import { createCallRepository } from './media/call-repository.js';
import { createMediaProvider } from './media/livekit-provider.js';
import { createLiveKitWebhookReceiver } from './media/livekit-webhook.js';
import { createMeetingRepository } from './meeting/meeting-repository.js';
import { createProcessingAwareMeetingRepository } from './meeting/processing-repository.js';
import { createMeetingOperationsRepository } from './meeting/operations-repository.js';
import { createMeetingProcessor } from './meeting/processor.js';
import { createConfiguredMeetingProviders } from './meeting/openai-providers.js';
import { createMeetingReviewProjector } from './meeting/review-projection.js';
import { createMeetingWorker } from './meeting/worker.js';
import { createObjectStore } from './storage/object-store.js';
import { preparePreviewDemo, handlePreviewDemo } from './demo/preview-demo.js';
import { seedDemoMeetingIntelligence } from './demo/seed-meeting-intelligence.js';
import { seedDemoOrgStructure } from './demo/seed-org-structure.js';
import { seedDemoCalendarParticipation } from './demo/seed-calendar-participation.js';

const { Pool }=pg;
// node-pg hands bigint back as a string so no precision is lost. Nothing in
// this schema comes close to 2^53 — file sizes, counters, sequences — and a
// string silently breaks arithmetic on the client, so parse them as numbers.
pg.types.setTypeParser(20,(value)=>value===null?null:Number(value));
const publicRoot=fileURLToPath(new URL('../public/',import.meta.url));
const uploadsRoot=process.env.UPLOAD_DIR??fileURLToPath(new URL('../data/uploads/',import.meta.url));
const livekitClientPath=fileURLToPath(new URL('../node_modules/livekit-client/dist/livekit-client.umd.js',import.meta.url));
const mime=new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.webmanifest','application/manifest+json; charset=utf-8'],['.json','application/json; charset=utf-8'],['.svg','image/svg+xml']]);
const cookieName='chat_session';
const sessionCookie=(token)=>`${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30*86400}${process.env.NODE_ENV==='production'?'; Secure':''}`;
const clearSession=()=>`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`;
const cookieToken=(req)=>cookies(req)[cookieName]||null;

function defaultStore(){if(!process.env.DATABASE_URL){
  if(process.env.NODE_ENV==='production')throw new Error('DATABASE_URL не задан. В production память как хранилище не годится: данные исчезнут при первом же перезапуске.');
  return{store:new MemoryStore(),pool:null,mode:'memory'};
}const pool=new Pool({connectionString:process.env.DATABASE_URL,max:Number(process.env.PG_POOL_MAX??10),ssl:process.env.PGSSL==='require'?{rejectUnauthorized:false}:undefined});
// Простаивающее соединение может оборваться само: перезапуск базы, таймаут
// на стороне сети. Без этого слушателя такой обрыв всплывает как
// необработанное исключение и уносит весь процесс, хотя пул сам поднимет
// новое соединение на следующем запросе.
pool.on('error',(error)=>console.error('Соединение с PostgreSQL оборвалось в простое:',error.message));
return{store:new PostgresStore(pool),pool,mode:'postgres'}}
function pushConfig(){const publicKey=process.env.VAPID_PUBLIC_KEY??null,privateKey=process.env.VAPID_PRIVATE_KEY??null;if(publicKey&&privateKey)webpush.setVapidDetails(process.env.VAPID_SUBJECT??'mailto:admin@example.com',publicKey,privateKey);return{enabled:Boolean(publicKey&&privateKey),publicKey}}

export async function createChatServer(options={}){
  await mkdir(uploadsRoot,{recursive:true});
  const defaults=options.store?{store:options.store,pool:options.pool??null,mode:'custom'}:defaultStore();
  const {store,pool,mode}=defaults;
  const objectStore=options.objectStore??createObjectStore({uploadsRoot});
  const persistenceStatus=()=>{
    const objects=objectStore.status?.()??{provider:'unknown',enabled:false,durable:false};
    return{
      database:{provider:mode==='postgres'?'postgres':mode,durable:mode==='postgres'},
      objects:{...objects,durable:Boolean(objects.durable)},
      durabilityConfigured:mode==='postgres'&&Boolean(objects.durable),
    };
  };
  const demo=await preparePreviewDemo({store,objectStore,mode,enabled:options.demoEnabled??process.env.DEMO_MODE==='true'});
  const hub=new RealtimeHub(),push=pushConfig(),wss=new WebSocketServer({noServer:true});
  const authThrottle=options.authThrottle??createAuthThrottle(process.env);
  const idempotency=options.idempotency??createIdempotencyGuard(pool);
  const webhooks=options.webhooks??createWebhookRepository(pool);
  const org=options.org??createOrgRepository(pool);
  const people=options.people??createPeopleRepository(pool,org);
  const games=options.games??createGameRepository(pool,store);
  const reminders=options.reminders??createReminderRepository(pool);
  const vault=options.vault??createVaultRepository(pool);
  const marks=options.marks??createMarkRepository(pool);
  const reminderWorker=options.reminderWorker??createReminderWorker(reminders);
  const calendar=options.calendar??createCalendarRepository(pool,store);
  const labels=options.labels??createLabelRepository(pool,store);
  const personal=options.personal??createPersonalRepository(pool,store,labels);
  // Без базы работникам нечего делать, поэтому 'custom' глушит их жёстко.
  // В остальных случаях решение остаётся за переменными окружения: иначе
  // WEBHOOK_WORKER_ENABLED=false и MEETING_WORKER_ENABLED=false ничего не
  // выключали — сервер перебивал их своим «включено».
  const forceWorkersOff=mode==='custom'?false:undefined;
  const deliveryWorker=options.deliveryWorker??createDeliveryWorker(webhooks,process.env,{enabled:options.deliveryWorkerEnabled??forceWorkersOff});
  const mediaProvider=options.mediaProvider??createMediaProvider();
  const calls=options.calls??createCallRepository(pool);
  const meeting=options.meeting??createProcessingAwareMeetingRepository(createMeetingRepository(pool),pool);
  const meetingOps=options.meetingOps??createMeetingOperationsRepository(meeting,pool);
  const liveKitWebhook=options.liveKitWebhook??createLiveKitWebhookReceiver();
  const configuredMeetingProviders=createConfiguredMeetingProviders(process.env);
  const transcriptionProvider=options.transcriptionProvider??configuredMeetingProviders.transcriptionProvider;
  const summaryProvider=options.summaryProvider??configuredMeetingProviders.summaryProvider;
  const authenticate=async(req)=>{const token=cookieToken(req);return token?store.getSession(hashToken(token)):null};
  const requireSession=async(req)=>{const s=await authenticate(req);if(!s)throw Object.assign(new Error('Authentication required'),{code:'UNAUTHENTICATED',statusCode:401});return s};
  const openSession=async(res,req,userId,workspaceId,status=200)=>{const token=createOpaqueToken(),tokenHash=hashToken(token),expiresAt=createSessionExpiry();await store.createSession({userId,workspaceId,tokenHash,expiresAt,userAgent:req.headers['user-agent']??null,ipAddress:clientAddress(req)});const s=await store.getSession(tokenHash);if(!s)throw Object.assign(new Error('Session could not be established'),{code:'SESSION_NOT_ESTABLISHED',statusCode:401});json(res,status,{session:{...s,permissions:visiblePermissions(s.role)},storageMode:mode,push,media:mediaProvider.status(),objectStorage:objectStore.status()},{'set-cookie':sessionCookie(token)})};
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
    try{demo.org=await seedDemoOrgStructure(pool,org)}catch(error){console.error('org demo seed failed',error)}
    try{demo.calendar=await seedDemoCalendarParticipation(pool,calendar)}catch(error){console.error('calendar demo seed failed',error)}
  }

  const meetingWorker=options.meetingWorker??createMeetingWorker(meetingProcessor,process.env,{
    enabled:options.meetingWorkerEnabled??forceWorkersOff,
  });
  const startMeetingWorker=options.startMeetingWorker??mode!=='custom';
  if(startMeetingWorker){meetingWorker.start?.();deliveryWorker.start?.();reminderWorker.start?.()}

  const ctx={store,mode,hub,authThrottle,webhooks,deliveryWorker,org,people,games,reminders,reminderWorker,vault,marks,calendar,labels,personal,calls,meeting,meetingOps,meetingProcessor,meetingWorker,liveKitWebhook,mediaProvider,objectStore,push:{enabled:push.enabled,publicKey:push.publicKey},demo,requireSession,openSession,clearSession,cookieToken,permissions:visiblePermissions,notifyUsers};
  const handleMedia=createMediaHandler(objectStore),handleCalls=createCallHandler(),handleIntegrations=createIntegrationsHandler(),handleOrg=createOrgHandler(),handleAudit=createAuditHandler(),handleGames=createGamesHandler(),handleReminders=createRemindersHandler(),handleVault=createVaultHandler(),handleMarks=createMarksHandler(),handlePeople=createPeopleHandler(),handleCalendar=createCalendarHandler(),handleLabels=createLabelHandler(),handlePersonal=createPersonalHandler(),handleMeetingIntelligence=createMeetingIntelligenceHandler(),handleMeetingOperations=createMeetingOperationsHandler();
  const baseHeaders=securityHeaders({production:process.env.NODE_ENV==='production',frameAncestors:process.env.CSP_FRAME_ANCESTORS});
  const server=createServer(async(req,res)=>{try{
    for(const [name,value] of Object.entries(baseHeaders))res.setHeader(name,value);
    const url=new URL(req.url??'/',`http://${req.headers.host??'localhost'}`),path=url.pathname,method=req.method??'GET';
        // Idempotency-Key: a retried command must not do the work twice. Applied
    // before routing so every mutating handler inherits it, and only when the
    // caller asks for it by sending the header.
    const idemKey=String(req.headers[IDEMPOTENCY_HEADER]??'').trim();
    let idemFinish=null;
    if(idemKey&&idempotency&&path.startsWith('/api/')&&['POST','PATCH','PUT','DELETE'].includes(method)){
      if(idemKey.length>200)throw Object.assign(new Error('Idempotency-Key is too long'),{code:'INVALID_IDEMPOTENCY_KEY',statusCode:400});
      const session=await authenticate(req);
      if(session){
        req.rawBody=await readBuffer(req,MAX_JSON);
        const claim=await idempotency.begin(session,idemKey,{method,path,rawBody:req.rawBody.toString('utf8')});
        if(claim.replay){res.setHeader('idempotent-replay','true');return json(res,claim.replay.status,claim.replay.body)}
        idemFinish=claim.finish;
        const originalEnd=res.end.bind(res);
        res.end=(chunk,...rest)=>{
          if(idemFinish){
            let body=null;
            try{body=chunk?JSON.parse(Buffer.from(chunk).toString('utf8')):null}catch{body=null}
            void idemFinish(res.statusCode,body);
            idemFinish=null;
          }
          return originalEnd(chunk,...rest);
        };
      }
    }
    if(path==='/healthz')return json(res,200,{ok:true,storageMode:mode,persistence:persistenceStatus(),realtime:true,push:push.enabled,media:mediaProvider.status(),meetingIntelligence:{webhook:liveKitWebhook.status(),processor:meetingProcessor.status(),worker:meetingWorker.status?.()??{configured:false,running:false}},integrations:{outbound:deliveryWorker.status?.()??{configured:false}},objectStorage:objectStore.status(),demo:{enabled:demo.enabled,label:demo.label??null,persistent:Boolean(demo.persistent),meeting:Boolean(demo.meeting)}});
    if(path==='/openapi.json'||path==='/api/v1/openapi')return json(res,200,openapi);
    if(path==='/vendor/livekit-client.js'&&method==='GET'){const body=await readFile(livekitClientPath);res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'public, max-age=86400'});res.end(body);return}
    if(await handleMeetingOperations(req,res,ctx,url,path,method))return;
    if(await handleMeetingIntelligence(req,res,ctx,path,method))return;
    if(await handlePreviewDemo(req,res,ctx,path,method))return;
    if(await handleAuth(req,res,ctx,path,method))return;
    if(await handleDailyWork(req,res,ctx,url,path,method))return;
    if(await handleWorkspace(req,res,ctx,url,path,method))return;
    if(await handleMessaging(req,res,ctx,url,path,method))return;
    if(await handleCalls(req,res,ctx,path,method))return;
    if(await handleIntegrations(req,res,ctx,url,path,method))return;
    if(await handleOrg(req,res,ctx,url,path,method))return;
    if(await handleAudit(req,res,ctx,url,path,method))return;
    if(await handleGames(req,res,ctx,url,path,method))return;
    if(await handleReminders(req,res,ctx,url,path,method))return;
    if(await handleVault(req,res,ctx,url,path,method))return;
    if(await handleMarks(req,res,ctx,url,path,method))return;
    if(await handlePeople(req,res,ctx,url,path,method))return;
    if(await handleCalendar(req,res,ctx,url,path,method))return;
    if(await handleLabels(req,res,ctx,url,path,method))return;
    if(await handlePersonal(req,res,ctx,url,path,method))return;
    if(await handleMedia(req,res,ctx,url,path,method))return;
    if(path.startsWith('/api/'))throw Object.assign(new Error('API route not found'),{code:'NOT_FOUND',statusCode:404});
    const relative=path==='/'?'index.html':path.replace(/^\/+/,''),candidate=normalize(join(publicRoot,relative));if(!candidate.startsWith(normalize(publicRoot)))throw Object.assign(new Error('Bad request'),{code:'BAD_PATH',statusCode:400});
    try{
      const info=await stat(candidate),file=info.isDirectory()?join(candidate,'index.html'):candidate,stats=info.isDirectory()?await stat(file):info;
      // Asset URLs carry no content hash, so a max-age served stale JS and CSS
      // to every user for its whole window after a deploy. Revalidate instead:
      // an unchanged file costs a 304, a changed one is picked up immediately.
      const etag=`W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
      if(req.headers['if-none-match']===etag){res.writeHead(304,{etag,'cache-control':'no-cache'});res.end();return}
      const body=await readFile(file);
      res.writeHead(200,{'content-type':mime.get(extname(file))??'application/octet-stream','cache-control':file.endsWith('index.html')?'no-store':'no-cache',etag});
      res.end(body);
    }catch{const body=await readFile(join(publicRoot,'index.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(body)}
  }catch(error){
    const status=Number(error?.statusCode)||500;
    if(status>=500)console.error(error);
    else console.warn(`${req.method??'?'} ${(req.url??'?').split('?')[0]} → ${status} ${error?.code??''}`.trim());
    errorJson(res,error);
  }});
  server.on('upgrade',async(req,socket,head)=>{try{const url=new URL(req.url??'/',`http://${req.headers.host??'localhost'}`);if(url.pathname!=='/ws')return socket.destroy();const s=await authenticate(req);if(!s){socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');return socket.destroy()}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req,s))}catch{socket.destroy()}});
  wss.on('connection',async(ws,req,s)=>{const remove=hub.add(s.workspaceId,s.userId,ws);hub.send(ws,'session.ready',{userId:s.userId,workspaceId:s.workspaceId});try{const p=await store.setPresence(s,{state:'online'});hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence:p},ws)}catch{}ws.on('message',async raw=>{try{const packet=JSON.parse(String(raw));if(packet.event==='typing.start'||packet.event==='typing.stop'){const id=packet.data?.conversationId;if(id&&await store.canAccessConversation(s,id)){const audience=await store.conversationAudience(s,id);hub.broadcastUsers(s.workspaceId,audience.filter(x=>x!==s.userId),packet.event,{conversationId:id,userId:s.userId})}}else if(packet.event==='presence.set'&&allowedPresence.has(packet.data?.state)){const p=await store.setPresence(s,packet.data);hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence:p},ws)}}catch(error){hub.send(ws,'error',{code:error.code??'INVALID_EVENT',message:error.message})}});ws.on('close',async()=>{remove();try{const p=await store.setPresence(s,{state:'away'});hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence:p})}catch{}})});
  return{server,store,calls,webhooks,deliveryWorker,reminders,reminderWorker,vault,marks,org,meeting,meetingOps,meetingProcessor,meetingWorker,liveKitWebhook,mediaProvider,objectStore,mode,demo,close:async()=>{reminderWorker.stop?.();await meetingWorker.stop?.().catch((error)=>console.error('meeting worker shutdown failed',error));await deliveryWorker.stop?.().catch((error)=>console.error('delivery worker shutdown failed',error));for(const client of wss.clients)try{client.close(1001,'Server shutdown')}catch{}await new Promise(resolve=>server.close(resolve));wss.close();if(pool)await pool.end()}};
}

// An unhandled rejection or a stray exception must not silently kill a server
// that several people are connected to. Log it and keep serving; a request
// that already failed is one request, not the whole workspace.
process.on('unhandledRejection',(reason)=>console.error('unhandled rejection',reason));
process.on('uncaughtException',(error)=>console.error('uncaught exception',error));

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
