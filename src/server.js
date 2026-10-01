import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { log, errorFields, routeOf } from './obs/log.js';
import { createMetrics } from './obs/metrics.js';
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
import { clientAddress, cookies, errorJson, json, allowedPresence, securityHeaders, readBuffer, MAX_JSON, normalizeError } from './http/helpers.js';
import { createAuthThrottle, createApiThrottle } from './rate-limit.js';
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
import { createExportHandler } from './http/export.js';
import { createStoryHandler } from './http/stories.js';
import { createStories } from './stories/story-repository.js';
import { createMeetingNotes } from './meeting/meeting-notes.js';
import { createAuditHandler } from './http/audit.js';
import { createRetentionSweeper } from './maintenance/retention.js';
import { createWorkspaceSettingsHandler } from './http/workspace-settings.js';
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
import { createKnowledgeRepository } from './knowledge/knowledge-repository.js';
import { createKnowledgeHandler } from './http/knowledge.js';
import { createTelegramBridgeRepository } from './integrations/telegram-bridge-repository.js';
import { createTelegramHandler } from './http/telegram.js';
import { createIcsFeedRepository } from './calendar/ics-feed-repository.js';
import { createIcsFeedHandler } from './http/ics-feed.js';
import { createApiKeyRepository } from './api-keys/api-key-repository.js';
import { createApiKeysHandler } from './http/api-keys.js';
import { createCalendarRepository } from './calendar/calendar-repository.js';
import { createPeopleRepository } from './people/people-repository.js';
import { createOrgRepository } from './org/org-repository.js';
import { createWorkspaceExport } from './export/workspace-export.js';
import { createTwoFactor } from './security/two-factor.js';
import { createDigestMailer } from './digest/digest-mailer.js';
import { createWebhookRepository } from './integrations/webhook-repository.js';
import { createDeliveryWorker } from './integrations/delivery-worker.js';
import { createMailRepository } from './mail/mail-repository.js';
import { createMailWorker } from './mail/mail-worker.js';
import { createTaskReport } from './task/task-report.js';
import { createMissedDigest } from './digest/missed-digest.js';
import { createOnboarding } from './onboarding/onboarding.js';
import { createNotificationPreferences } from './notifications/preferences.js';
import { createCallRepository } from './media/call-repository.js';
import { createMediaProvider } from './media/livekit-provider.js';
import { createLiveKitWebhookReceiver } from './media/livekit-webhook.js';
import { createMeetingRepository } from './meeting/meeting-repository.js';
import { createProcessingAwareMeetingRepository } from './meeting/processing-repository.js';
import { createMeetingOperationsRepository } from './meeting/operations-repository.js';
import { createMeetingProcessor } from './meeting/processor.js';
import { createConfiguredMeetingProviders } from './meeting/openai-providers.js';
import { createConfiguredChatAssistant } from './chat-assistant/chat-assistant-provider.js';
import { createChatAssistantHandler } from './http/chat-assistant.js';
import { createWikiRepository } from './wiki/wiki-repository.js';
import { createWikiHandler } from './http/wiki.js';
import { createTimeEntryRepository } from './time-tracking/time-entry-repository.js';
import { createTimeTrackingHandler } from './http/time-tracking.js';
import { createDashboardHandler } from './http/dashboard.js';
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
const mime=new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.webmanifest','application/manifest+json; charset=utf-8'],['.json','application/json; charset=utf-8'],['.svg','image/svg+xml'],
  // Растровые значки отдавались как `application/octet-stream`: браузер
  // такой ответ не считает картинкой, и установка приложения на телефон
  // получала иконку, которую нечем нарисовать.
  ['.png','image/png'],['.ico','image/x-icon'],['.webp','image/webp'],['.txt','text/plain; charset=utf-8']]);
const cookieName='chat_session';
const sessionCookie=(token)=>`${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30*86400}${process.env.NODE_ENV==='production'?'; Secure':''}`;
const clearSession=()=>`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`;
const cookieToken=(req)=>cookies(req)[cookieName]||null;

/**
 * Хранилище по умолчанию.
 *
 * `databaseUrl` в параметрах тихо игнорировался: его передают все
 * postgres-тесты, а сервер читал только переменную окружения и молча
 * поднимался на памяти. Тесты падали на 503 из-за отсутствия напоминаний
 * и пометок, и понять причину было нельзя — тихая подмена хранилища
 * опаснее отказа.
 */
function defaultStore(databaseUrl=process.env.DATABASE_URL){if(!databaseUrl){
  if(process.env.NODE_ENV==='production')throw new Error('DATABASE_URL не задан. В production память как хранилище не годится: данные исчезнут при первом же перезапуске.');
  return{store:new MemoryStore(),pool:null,mode:'memory'};
}const pool=new Pool({connectionString:databaseUrl,max:Number(process.env.PG_POOL_MAX??10),
  // Без этих сроков зависший запрос молча держал соединение из десяти:
  // десять таких — и приложение стоит, а /healthz по-прежнему зелёный.
  connectionTimeoutMillis:Number(process.env.PG_CONNECT_TIMEOUT_MS??3000),
  options:`-c statement_timeout=${Number(process.env.PG_STATEMENT_TIMEOUT_MS??15000)} -c lock_timeout=${Number(process.env.PG_LOCK_TIMEOUT_MS??5000)}`,ssl:process.env.PGSSL==='require'?{rejectUnauthorized:false}:undefined});
// Простаивающее соединение может оборваться само: перезапуск базы, таймаут
// на стороне сети. Без этого слушателя такой обрыв всплывает как
// необработанное исключение и уносит весь процесс, хотя пул сам поднимет
// новое соединение на следующем запросе.
pool.on('error',(error)=>console.error('Соединение с PostgreSQL оборвалось в простое:',error.message));
return{store:new PostgresStore(pool),pool,mode:'postgres'}}
function pushConfig(){const publicKey=process.env.VAPID_PUBLIC_KEY??null,privateKey=process.env.VAPID_PRIVATE_KEY??null;if(publicKey&&privateKey)webpush.setVapidDetails(process.env.VAPID_SUBJECT??'mailto:admin@example.com',publicKey,privateKey);return{enabled:Boolean(publicKey&&privateKey),publicKey}}

export async function createChatServer(options={}){
  await mkdir(uploadsRoot,{recursive:true});
  const defaults=options.store?{store:options.store,pool:options.pool??null,mode:'custom'}:defaultStore(options.databaseUrl??process.env.DATABASE_URL);
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
  // Демо-режим открывает вход владельцем без пароля: в боевой среде его включают только осознанно.
  const demoAllowed=()=>{
    if(process.env.DEMO_MODE!=='true')return false;
    if(process.env.NODE_ENV==='production'&&process.env.ALLOW_DEMO_IN_PRODUCTION!=='true'){
      log('error','demo.blocked',{reason:'DEMO_MODE=true при NODE_ENV=production без ALLOW_DEMO_IN_PRODUCTION=true: демо выключено'});
      return false;
    }
    return true;
  };
  const demo=await preparePreviewDemo({store,objectStore,mode,enabled:options.demoEnabled??demoAllowed()});
  // maxPayload: без предела `ws` принимает кадр до ста мегабайт, и любой
  // вошедший может заставить сервер выделить их на каждое соединение.
  // Служебные пакеты — «печатает» и присутствие — весят десятки байт.
  const metrics=options.metrics??createMetrics();
  const WS_PACKETS_PER_SECOND=Number(process.env.WS_PACKETS_PER_SECOND??20);
  // Отправку push можно подменить — как у работника доставок и почты.
  // Без этого шва проверить, что выключенный переключатель действительно
  // останавливает уведомление, нельзя ничем, кроме веры.
  const hub=new RealtimeHub(),push=options.push??pushConfig(),wss=new WebSocketServer({noServer:true,maxPayload:16*1024});
  const sendPush=options.sendPush??((subscription,payload)=>webpush.sendNotification(subscription,JSON.stringify(payload),{TTL:60}));
  const authThrottle=options.authThrottle??createAuthThrottle(process.env);
  // `apiThrottle:false` выключает ограничение целиком. Нужно проверкам,
  // которые намеренно обходят сотни маршрутов от имени одного человека:
  // это законный прогон, а не злоупотребление, и упираться в предел там
  // значит проверять ограничитель вместо того, что проверяют.
  const apiThrottle=options.apiThrottle===false?null:(options.apiThrottle??createApiThrottle(process.env));
  const idempotency=options.idempotency??createIdempotencyGuard(pool);
  const webhooks=options.webhooks??createWebhookRepository(pool);
  const org=options.org??createOrgRepository(pool);
  const people=options.people??createPeopleRepository(pool,org);
  const games=options.games??createGameRepository(pool,store);
  const reminders=options.reminders??createReminderRepository(pool);
  const vault=options.vault??createVaultRepository(pool);
  const marks=options.marks??createMarkRepository(pool);
  // Работник напоминаний собирается ниже — ему нужен `calls`.
  const calendar=options.calendar??createCalendarRepository(pool,store);
  // Протокол наследует видимость встречи, а не заводит свою: иначе
  // появляется второй ответ на вопрос «кому это видно».
  const meetingNotes=options.meetingNotes??createMeetingNotes(pool,{calendar,store});
  const labels=options.labels??createLabelRepository(pool,store);
  const knowledge=options.knowledge??createKnowledgeRepository(pool);
  const telegram=options.telegram??createTelegramBridgeRepository(pool,store);
  const icsFeed=options.icsFeed??createIcsFeedRepository(pool);
  const apiKeys=options.apiKeys??createApiKeyRepository(pool);
  const wiki=options.wiki??createWikiRepository(pool);
  const timeEntries=options.timeEntries??createTimeEntryRepository(pool);
  const personal=options.personal??createPersonalRepository(pool,store,labels);
  // Без базы работникам нечего делать, поэтому 'custom' глушит их жёстко.
  // В остальных случаях решение остаётся за переменными окружения: иначе
  // WEBHOOK_WORKER_ENABLED=false и MEETING_WORKER_ENABLED=false ничего не
  // выключали — сервер перебивал их своим «включено».
  const forceWorkersOff=mode==='custom'?false:undefined;
  const deliveryWorker=options.deliveryWorker??createDeliveryWorker(webhooks,process.env,{enabled:options.deliveryWorkerEnabled??forceWorkersOff});
  // Почта — отдельный канал и отдельный работник: медленный почтовый
  // сервер не должен задерживать интеграции заказчика, и наоборот.
  const mail=options.mail??createMailRepository(pool);
  const taskReport=options.taskReport??createTaskReport(pool);
  const workspaceExport=options.workspaceExport??createWorkspaceExport(pool,objectStore);
  const twoFactor=options.twoFactor??createTwoFactor(pool);
  const stories=options.stories??createStories(pool,store);
  const digest=options.digest??createMissedDigest(pool);
  const onboarding=options.onboarding??createOnboarding(pool);
  const notificationPreferences=options.notificationPreferences??createNotificationPreferences(pool);
  const mailWorker=options.mailWorker??createMailWorker(mail,process.env,{enabled:options.mailWorkerEnabled??forceWorkersOff});
  // Рассылка сводок идёт рядом с почтовым рабочим: без настроенной
  // почты слать некуда, и заводить для неё таймер незачем.
  const digestMailer=options.digestMailer??(mail&&digest?createDigestMailer({pool,digest,mail}):null);
  const mediaProvider=options.mediaProvider??createMediaProvider();
  const calls=options.calls??createCallRepository(pool);
  // Тот же обход времени закрывает звонки, которых никто не взял, и
  // извещает звонившего: раньше такой звонок оставался «звонящим»
  // навсегда, а тот, кому звонили, не узнавал об этом никогда.
  const reminderWorker=options.reminderWorker??createReminderWorker(reminders,{calls,
    onMissedCalls:async(missed)=>{
      for(const row of missed){
        if(!row.missed?.length)continue;
        await store.projectCallNotification?.(
          {organizationId:row.organizationId,workspaceId:row.workspaceId,userId:row.createdBy,displayName:''},
          {id:row.id,conversationId:row.conversationId,title:row.title??null,mode:row.mode??null},
          {recipients:row.missed,type:'call.missed',title:'Пропущенный звонок',body:row.title??'Вам звонили'}).catch(()=>{});
      }
    }});
  const meeting=options.meeting??createProcessingAwareMeetingRepository(createMeetingRepository(pool),pool);
  const meetingOps=options.meetingOps??createMeetingOperationsRepository(meeting,pool);
  const liveKitWebhook=options.liveKitWebhook??createLiveKitWebhookReceiver();
  const configuredMeetingProviders=createConfiguredMeetingProviders(process.env);
  const transcriptionProvider=options.transcriptionProvider??configuredMeetingProviders.transcriptionProvider;
  const summaryProvider=options.summaryProvider??configuredMeetingProviders.summaryProvider;
  const chatAssistant=options.chatAssistant??createConfiguredChatAssistant(process.env).assistant;
  // Сессия запоминается на запросе: строке журнала нужны пространство и
  // человек, иначе шумного арендатора в аварии не назвать.
  /**
   * Опознание один раз за запрос.
   *
   * Сессию спрашивают дважды: ограничитель частоты в начале и сам
   * обработчик потом. Без памяти на запросе это второй поход в базу на
   * каждое обращение — то есть удвоение самой частой операции ради
   * проверки, которая должна быть дешёвой.
   */
  const bearerToken=(req)=>{const header=req.headers['authorization'];if(!header)return null;const match=/^Bearer\s+(.+)$/i.exec(String(header).trim());return match?match[1]:null};
  const authenticate=async(req)=>{
    if(req.sessionResolved)return req.session??null;
    const token=cookieToken(req);
    let session=token?await store.getSession(hashToken(token)):null;
    // Ключ проверяется только когда нет cookie: у вошедшего в браузере
    // человека уже есть сессия, и лишний поход в таблицу ключей на
    // каждый запрос — это работа впустую.
    if(!session){
      const bearer=bearerToken(req);
      if(bearer)session=await apiKeys.resolve(bearer).catch(()=>null);
    }
    req.sessionResolved=true;
    if(session)req.session=session;
    return session;
  };
  const requireSession=async(req)=>{
    const s=await authenticate(req);
    if(!s)throw Object.assign(new Error('Authentication required'),{code:'UNAUTHENTICATED',statusCode:401});
    // Ключ «только чтение» не должен доходить до маршрута, который
    // собирается что-то менять: отказ на входе честнее, чем маршрут,
    // который сам решает, уважать ли чужой флаг.
    if(s.readOnly&&!['GET','HEAD'].includes(req.method))throw Object.assign(new Error('Этот ключ доступен только для чтения'),{code:'API_KEY_READ_ONLY',statusCode:403,expose:true});
    return s;
  };
  const openSession=async(res,req,userId,workspaceId,status=200)=>{const token=createOpaqueToken(),tokenHash=hashToken(token),expiresAt=createSessionExpiry();await store.createSession({userId,workspaceId,tokenHash,expiresAt,userAgent:req.headers['user-agent']??null,ipAddress:clientAddress(req)});const s=await store.getSession(tokenHash);if(!s)throw Object.assign(new Error('Доступ к рабочему пространству закрыт. Если это ошибка, обратитесь к администратору компании.'),{code:'WORKSPACE_ACCESS_CLOSED',statusCode:401,expose:true});json(res,status,{session:{...s,permissions:visiblePermissions(s.role)},storageMode:mode,push,media:mediaProvider.status(),objectStorage:objectStore.status()},{'set-cookie':sessionCookie(token)})};
  /**
   * Единственная воронка push-уведомлений.
   *
   * Здесь же применяются настройки человека: что присылать и в какие
   * часы молчать. Фильтровать в каждом вызывающем — значит однажды
   * забыть, и тогда выключенный переключатель окажется враньём.
   *
   * `payload.kind` — тип события. Без него уведомление проходит: новый
   * вызов, забывший про тип, лучше пусть шумит, чем молчит.
   */
  const notifyUsers=async(workspaceId,userIds,payload)=>{
    if(!push.enabled||!userIds.length)return;
    let recipients=userIds;
    if(payload?.kind&&notificationPreferences){
      try{recipients=await notificationPreferences.recipients(workspaceId,userIds,payload.kind)}
      catch(error){log('warn','notify.preferences.failed',{err:String(error?.message??error)})}
    }
    if(!recipients.length)return;
    const subs=await store.listPushSubscriptions(workspaceId,recipients);await Promise.allSettled(subs.map(s=>sendPush({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},payload)))};
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
  const retention=options.retention??createRetentionSweeper(pool,process.env);
  const startMeetingWorker=options.startMeetingWorker??mode!=='custom';
  // Датчики задаются функцией, а не числом: иначе кто-то обязан не
  // забывать их обновлять, и однажды забудет.
  metrics.gauge('chat_websocket_connections',()=>hub.size?.()??0);
  metrics.gauge('chat_db_pool_total',()=>pool?.totalCount??0);
  metrics.gauge('chat_db_pool_idle',()=>pool?.idleCount??0);
  metrics.gauge('chat_db_pool_waiting',()=>pool?.waitingCount??0);
  for(const [name,worker] of [['webhooks',deliveryWorker],['mail',mailWorker]]){
    metrics.gauge('chat_queue_pending',()=>worker.status?.().queue?.pending??0,{queue:name});
    metrics.gauge('chat_queue_failed',()=>worker.status?.().queue?.failed??0,{queue:name});
    metrics.gauge('chat_queue_oldest_seconds',()=>worker.status?.().queue?.oldestAgeSec??0,{queue:name});
  }

  if(startMeetingWorker){meetingWorker.start?.();deliveryWorker.start?.();mailWorker.start?.();digestMailer?.start?.();reminderWorker.start?.();retention.start?.()}

  const ctx={store,mode,hub,metrics,authThrottle,apiThrottle,workspaceExport,twoFactor,digestMailer,stories,meetingNotes,webhooks,deliveryWorker,mail,mailWorker,taskReport,digest,onboarding,notificationPreferences,org,people,games,reminders,reminderWorker,vault,marks,calendar,labels,knowledge,telegram,icsFeed,apiKeys,chatAssistant,wiki,timeEntries,personal,calls,meeting,meetingOps,meetingProcessor,meetingWorker,retention,liveKitWebhook,mediaProvider,objectStore,push:{enabled:push.enabled,publicKey:push.publicKey},demo,requireSession,openSession,clearSession,cookieToken,permissions:visiblePermissions,notifyUsers};
  const handleMedia=createMediaHandler(objectStore),handleCalls=createCallHandler(),handleIntegrations=createIntegrationsHandler(),handleOrg=createOrgHandler(),handleExport=createExportHandler(),handleStories=createStoryHandler(),handleAudit=createAuditHandler(),handleWorkspaceSettings=createWorkspaceSettingsHandler(),handleGames=createGamesHandler(),handleReminders=createRemindersHandler(),handleVault=createVaultHandler(),handleMarks=createMarksHandler(),handlePeople=createPeopleHandler(),handleCalendar=createCalendarHandler(),handleLabels=createLabelHandler(),handleKnowledge=createKnowledgeHandler(),handleTelegram=createTelegramHandler(),handleIcsFeed=createIcsFeedHandler(),handleApiKeys=createApiKeysHandler(),handleChatAssistant=createChatAssistantHandler(),handleWiki=createWikiHandler(),handleTimeTracking=createTimeTrackingHandler(),handleDashboard=createDashboardHandler(),handlePersonal=createPersonalHandler(),handleMeetingIntelligence=createMeetingIntelligenceHandler(),handleMeetingOperations=createMeetingOperationsHandler();
  const baseHeaders=securityHeaders({production:process.env.NODE_ENV==='production',frameAncestors:process.env.CSP_FRAME_ANCESTORS});
  const server=createServer(async(req,res)=>{
    // Запись о запросе — то, чего в журнале не было вовсе: двадцать
    // успешных обращений подряд давали ноль строк. Без неё в аварии
    // нельзя ответить ни «когда началось», ни «какие маршруты», ни
    // «кто шумит»: признака пространства не было ни в одной строке.
    const startedAt=process.hrtime.bigint();
    req.reqId=randomUUID().slice(0,12);
    res.setHeader('x-request-id',req.reqId);
    res.on('finish',()=>{
      const ms=Number(process.hrtime.bigint()-startedAt)/1e6;
      const status=res.statusCode;
      const level=status>=500?'error':status>=400||ms>2000?'warn':'info';
      const route=routeOf(req.url);
      log(level,'http',{
        reqId:req.reqId,method:req.method,route,status,
        ms:Math.round(ms),wsId:req.session?.workspaceId,userId:req.session?.userId,
        ip:req.socket?.remoteAddress,
      });
      // Метрики намеренно без человека и пространства: то, что уходит в
      // мониторинг, живёт там годами и видно всей эксплуатации.
      metrics.count('chat_http_requests_total',{method:req.method,route,status});
      metrics.observe('chat_http_request_seconds',{method:req.method,route},ms/1000);
    });
    try{
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
    /**
     * Жив и готов — разные вопросы.
     *
     * `/healthz` отвечает «процесс жив и обслуживает» и к базе не ходит —
     * этого довольно, чтобы понять, что узел не завис. Но при мёртвой базе
     * он честно отвечал `ok:true`, и монитор держал в строю узел, который
     * не мог обслужить ни одного запроса. Поэтому проверка живости
     * отделена от готовности: `/readyz` спрашивает базу и хранилище на
     * деле и отвечает 503, когда спрашивать бесполезно.
     */
    /**
     * Метрики для системы мониторинга.
     *
     * Закрывается токеном, если он задан: маршрут рассказывает о
     * нагрузке и глубине очередей, и выставлять это наружу без нужды
     * незачем. Без токена — открыт, потому что в закрытом контуре
     * требовать секрет ради секрета только мешает.
     */
    if(path==='/metrics'&&method==='GET'){
      const expected=process.env.METRICS_TOKEN;
      if(expected&&req.headers.authorization!==`Bearer ${expected}`){
        res.writeHead(401,{'content-type':'text/plain; charset=utf-8'});
        res.end('нужен токен\n');
        return;
      }
      res.writeHead(200,{'content-type':'text/plain; version=0.0.4; charset=utf-8','cache-control':'no-store'});
      res.end(metrics.render());
      return;
    }
    if(path==='/healthz')return json(res,200,{ok:true,storageMode:mode,persistence:persistenceStatus(),realtime:true,push:push.enabled,media:mediaProvider.status(),meetingIntelligence:{webhook:liveKitWebhook.status(),processor:meetingProcessor.status(),worker:meetingWorker.status?.()??{configured:false,running:false}},integrations:{outbound:deliveryWorker.status?.()??{configured:false}},mail:mailWorker.status?.()??{configured:false},retention:retention.status?.()??{configured:false},objectStorage:objectStore.status(),demo:{enabled:demo.enabled,label:demo.label??null,persistent:Boolean(demo.persistent),meeting:Boolean(demo.meeting)}});
    if(path==='/readyz'){
      const started=Date.now();
      const checks={};
      if(pool){
        try{
          await pool.query('SELECT 1');
          checks.database={ok:true,latencyMs:Date.now()-started};
        }catch(error){
          checks.database={ok:false,latencyMs:Date.now()-started,error:String(error.code??error.message)};
        }
      }else checks.database={ok:true,latencyMs:0,provider:'memory'};
      try{
        const probe=await objectStore.probe?.();
        checks.objects=probe??{ok:true,provider:objectStore.status?.()?.provider??'unknown'};
      }catch(error){checks.objects={ok:false,error:String(error.code??error.message)}}
      const ready=Object.values(checks).every((check)=>check.ok!==false);
      return json(res,ready?200:503,{
        ready,
        checks,
        // Исчерпанный пул — вторая по частоте причина «всё висит», и
        // числа для неё уже есть, их просто никто не спрашивал.
        pool:pool?{total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount}:null,
        process:{
          uptimeSec:Math.round(process.uptime()),
          rssMb:Math.round(process.memoryUsage().rss/1048576),
          heapUsedMb:Math.round(process.memoryUsage().heapUsed/1048576),
        },
        realtime:{sockets:hub.size?.()??null},
      });
    }
    /**
     * Ограничение частоты для вошедшего человека.
     *
     * Стоит после проверок готовности и до всех маршрутов: считать
     * нужно всё, что стоит работы, и не считать healthz, который
     * опрашивает мониторинг.
     *
     * Считаем по человеку, а не по адресу: за одним адресом сидит целый
     * офис. Неопознанный запрос сюда не попадает — им занимается
     * ограничитель входа, у которого свои, куда более строгие правила.
     */
    if(path.startsWith('/api/')){
      const who=apiThrottle?(await authenticate(req).catch(()=>null))?.userId??null:null;
      if(who){
        const verdict=apiThrottle.check(who,method,path);
        if(!verdict.allowed){
          metrics.count('chat_rate_limited_total',{bucket:verdict.bucket});
          res.writeHead(429,{'content-type':'application/json; charset=utf-8','retry-after':String(verdict.retryAfterSeconds)});
          res.end(JSON.stringify({error:{code:'RATE_LIMITED',message:'Слишком много запросов. Подождите немного.'}}));
          return;
        }
      }
    }
    if(path==='/openapi.json'||path==='/api/v1/openapi')return json(res,200,openapi);
    if(path==='/vendor/livekit-client.js'&&method==='GET'){const body=await readFile(livekitClientPath);res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'public, max-age=86400'});res.end(body);return}
    if(await handleMeetingOperations(req,res,ctx,url,path,method))return;
    if(await handleMeetingIntelligence(req,res,ctx,path,method))return;
    if(await handlePreviewDemo(req,res,ctx,path,method))return;
    if(await handleAuth(req,res,ctx,path,method,url))return;
    if(await handleDailyWork(req,res,ctx,url,path,method))return;
    if(await handleWorkspace(req,res,ctx,url,path,method))return;
    if(await handleMessaging(req,res,ctx,url,path,method))return;
    if(await handleCalls(req,res,ctx,path,method))return;
    if(await handleTelegram(req,res,ctx,url,path,method))return;
    if(await handleIcsFeed(req,res,ctx,path,method))return;
    if(await handleApiKeys(req,res,ctx,path,method))return;
    if(await handleChatAssistant(req,res,ctx,path,method))return;
    if(await handleWiki(req,res,ctx,url,path,method))return;
    if(await handleTimeTracking(req,res,ctx,url,path,method))return;
    if(await handleDashboard(req,res,ctx,url,path,method))return;
    if(await handleIntegrations(req,res,ctx,url,path,method))return;
    if(await handleOrg(req,res,ctx,url,path,method))return;
    if(await handleExport(req,res,ctx,url,path,method))return;
    if(await handleStories(req,res,ctx,url,path,method))return;
    if(await handleAudit(req,res,ctx,url,path,method))return;
    if(await handleWorkspaceSettings(req,res,ctx,url,path,method))return;
    if(await handleGames(req,res,ctx,url,path,method))return;
    if(await handleReminders(req,res,ctx,url,path,method))return;
    if(await handleVault(req,res,ctx,url,path,method))return;
    if(await handleMarks(req,res,ctx,url,path,method))return;
    if(await handlePeople(req,res,ctx,url,path,method))return;
    if(await handleCalendar(req,res,ctx,url,path,method))return;
    if(await handleLabels(req,res,ctx,url,path,method))return;
    if(await handleKnowledge(req,res,ctx,url,path,method))return;
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
  }catch(rawError){
    // Уровень записи считается по коду, который реально уйдёт клиенту.
    // Раньше он брался из error.statusCode, которого у половины отказов
    // нет — и слабый пароль при регистрации ложился в журнал полным
    // стеком как пятисотка, а настоящая авария в этом шуме терялась.
    const error=normalizeError(rawError);
    const status=Number(error?.statusCode)||(error?.code==='FORBIDDEN'?403:400);
    log(status>=500?'error':'warn',status>=500?'request.failed':'request.refused',{
      reqId:req.reqId,method:req.method,route:routeOf(req.url),status,
      wsId:req.session?.workspaceId,userId:req.session?.userId,
      ...errorFields(rawError,{stack:status>=500}),
    });
    errorJson(res,rawError);
  }});
  server.on('upgrade',async(req,socket,head)=>{try{const url=new URL(req.url??'/',`http://${req.headers.host??'localhost'}`);if(url.pathname!=='/ws')return socket.destroy();const s=await authenticate(req);if(!s){socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');return socket.destroy()}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req,s))}catch{socket.destroy()}});
  wss.on('connection',async(ws,req,s)=>{const remove=hub.add(s.workspaceId,s.userId,ws);
    // Выход, отзыв входа и истёкший срок не закрывали сокет: старая вкладка
    // продолжала получать чужие сообщения. Сеанс перепроверяем раз в 20 секунд.
    const watchdog=setInterval(async()=>{try{req.sessionResolved=false;req.session=undefined;if(!await authenticate(req)){ws.close(4401,'session ended')}}catch{}},20000);
    ws.on('close',()=>clearInterval(watchdog));
hub.send(ws,'session.ready',{userId:s.userId,workspaceId:s.workspaceId});
  // Ошибка самого протокола — слишком длинный кадр, битый UTF-8, чужой
  // опкод — приходит событием `error`. Без слушателя она становится
  // необработанным исключением всего процесса: один клиент с испорченным
  // кадром ронял сервер для всей компании.
  ws.on('error',(error)=>{
    log('warn','ws.error',{wsId:s.workspaceId,userId:s.userId,err:String(error?.message??error),code:error?.code??null});
    // terminate, а не close: разговаривать уже не с кем. Кадр, который
    // не разобрался, оставляет поток в неизвестном состоянии, и вежливое
    // прощание в нём не имеет смысла — сторона всё равно не разберёт и
    // его тоже.
    try{ws.terminate()}catch{}
  });
  // Слушатель вешается до любых ожиданий: обработчик асинхронный, и пока он
  // ходил в базу за присутствием, пакеты, отправленные сразу после
  // подключения, падали в пустоту — «печатает…» в первые полсекунды после
  // открытия вкладки не доходило ни до кого.
  // Каждое «печатает» стоит двух запросов к базе и рассылки. Без счётчика
  // клиент — свой же, забуксовавший на повторной отправке, — кладёт базу
  // на десятках пакетов в секунду. Считаем в памяти сокета: ограничение
  // касается одного соединения, и переживать перезапуск ему незачем.
  let packets=0,windowAt=Date.now();
  ws.on('message',async raw=>{
    const now=Date.now();
    if(now-windowAt>1000){packets=0;windowAt=now}
    if(++packets>WS_PACKETS_PER_SECOND){
      // Молча отбрасываем: отвечать на каждый лишний пакет ошибкой значит
      // удваивать трафик ровно тогда, когда его и так слишком много.
      if(packets===WS_PACKETS_PER_SECOND+1)log('warn','ws.flood',{wsId:s.workspaceId,userId:s.userId});
      return;
    }
    try{const packet=JSON.parse(String(raw));if(packet.event==='typing.start'||packet.event==='typing.stop'){const id=packet.data?.conversationId;if(id&&await store.canAccessConversation(s,id)){const audience=await store.conversationAudience(s,id);hub.broadcastUsers(s.workspaceId,audience.filter(x=>x!==s.userId),packet.event,{conversationId:id,userId:s.userId})}}else if(packet.event==='presence.set'&&allowedPresence.has(packet.data?.state)){const p=await store.setPresence(s,packet.data);hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence:p},ws)}}catch(error){hub.send(ws,'error',{code:error.code??'INVALID_EVENT',message:error.message})}
  });
  // Присутствие ставится последним: это поход в базу, и он не должен
  // задерживать готовность сокета принимать пакеты.
  try{
    // Подключение не должно затирать выбранный вручную статус («занят», «не беспокоить»):
    // «в сети» ставим, только если человек был не в сети.
    let state='online';
    try{const cur=await store.pool?.query('SELECT state FROM user_presence WHERE workspace_id=$1 AND user_id=$2',[s.workspaceId,s.userId]);const was=cur?.rows?.[0]?.state;if(was&&was!=='offline')state=was}catch{}
    const p=await store.setPresence(s,{state});hub.broadcastWorkspace(s.workspaceId,'presence.updated',{userId:s.userId,presence:p},ws)}catch{}
});
  return{server,store,calls,webhooks,deliveryWorker,mail,mailWorker,digestMailer,reminders,reminderWorker,vault,marks,org,meeting,meetingOps,meetingProcessor,meetingWorker,retention,liveKitWebhook,mediaProvider,objectStore,mode,demo,close:async()=>{reminderWorker.stop?.();digestMailer?.stop?.();retention.stop?.();await meetingWorker.stop?.().catch((error)=>console.error('meeting worker shutdown failed',error));await deliveryWorker.stop?.().catch((error)=>console.error('delivery worker shutdown failed',error));await mailWorker.stop?.().catch((error)=>console.error('mail worker shutdown failed',error));for(const client of wss.clients)try{client.close(1001,'Server shutdown')}catch{}await new Promise(resolve=>server.close(resolve));wss.close();if(pool)await pool.end()}};
}

// An unhandled rejection or a stray exception must not silently kill a server
// that several people are connected to. Log it and keep serving; a request
// that already failed is one request, not the whole workspace.
process.on('unhandledRejection',(reason)=>console.error('unhandled rejection',reason));
process.on('uncaughtException',(error)=>console.error('uncaught exception',error));

const isMain=process.argv[1]&&fileURLToPath(import.meta.url)===normalize(process.argv[1]);
if(isMain){
  const app=await createChatServer(),port=Number(process.env.PORT??3000);
  app.server.listen(port,'0.0.0.0',()=>console.log(`ChatX workspace: http://localhost:${port} [${app.mode}]${app.demo.enabled?' [demo]':''}`));
  let closing=false;
  const shutdown=async(signal)=>{
    if(closing)return;
    closing=true;
    console.log(`ChatX shutdown requested by ${signal}`);
    const hardStop=setTimeout(()=>{console.error('ChatX graceful shutdown timed out');process.exit(1)},15000);
    hardStop.unref?.();
    try{await app.close();clearTimeout(hardStop);process.exit(0)}catch(error){clearTimeout(hardStop);console.error('ChatX shutdown failed',error);process.exit(1)}
  };
  process.once('SIGTERM',()=>void shutdown('SIGTERM'));
  process.once('SIGINT',()=>void shutdown('SIGINT'));
}
