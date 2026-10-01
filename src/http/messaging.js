import { SOURCES, prepareForward } from '../messaging/external-forward.js';
const MAX_FORWARD_TEXT=8000;
import { resolveAvatar } from '../media/avatar.js';
import { randomUUID } from 'node:crypto';
import { Permission, hasPermission, requirePermission } from '../rbac.js';
import { isGuest } from '../persistence/visibility.js';
import { allowedConversationKinds, allowedMessageKinds, serverOnlyMessageKinds, cleanText, json, noContent, readJson, messageKindLabel, stripControl, pageSize } from './helpers.js';

const CONVERSATION_ID='([0-9a-f-]+)';
const USER_ID='([0-9a-f-]+)';
const MESSAGE_ID='([0-9a-f-]+)';
const MEMBER_ROLES=new Set(['owner','moderator','member','guest']);

// expose:true всегда — сообщение здесь всякий раз пишет разработчик для
// человека на другом конце, а не случайная ошибка ниже по стеку; без этого
// errorJson прячет любой текст за общим «Internal server error», как только
// код статуса 5xx (ровно это случилось с CATALOGUE_UNAVAILABLE и другими
// «доступно в режиме с базой данных»).
function httpError(message,code,statusCode){return Object.assign(new Error(message),{code,statusCode,expose:true})}

async function policyOr404(store,session,conversationId){
  const policy=await store.conversationPolicy(session,conversationId);
  if(!policy)throw httpError('Conversation not found','NOT_FOUND',404);
  return policy;
}

function canManageConversation(session,policy){
  return hasPermission(session.role,Permission.CHANNEL_MANAGE)||['owner','moderator'].includes(policy.memberRole);
}

/**
 * Владение беседой передаёт только владелец беседы (или тот, кто управляет
 * каналами во всём пространстве). Модератор вправе добавлять людей и
 * назначать модераторов, но не делать кого-то владельцем и не снимать
 * владельца: иначе рядовой модератор отбирал беседу у её создателя.
 */
function ownsConversation(session,policy){
  return hasPermission(session.role,Permission.CHANNEL_MANAGE)||policy.memberRole==='owner';
}

function requireConversationManager(session,policy){
  if(!canManageConversation(session,policy))throw httpError('Conversation management permission required','FORBIDDEN',403);
}

/**
 * Личная переписка и канал — разные вещи для того, кто настраивает
 * уведомления: «пишут лично» хотят почти все, «новое в канале» — не
 * всегда. Беседу может не удаться прочитать; тогда считаем её каналом —
 * это более шумный класс, и человек сам его выключит, если мешает.
 */
const S_KIND=(conversation)=>conversation?.kind==='direct'?'message.direct':'message.created';

export async function handleMessaging(req,res,ctx,url,path,method){
  const {store,requireSession,hub,notifyUsers,telegram}=ctx;
  if(path==='/api/v1/conversations'&&method==='GET'){const s=await requireSession(req);json(res,200,{items:await store.listConversations(s)});return true}
  if(path==='/api/v1/conversations/archived'&&method==='GET'){const s=await requireSession(req);json(res,200,{items:await store.listConversations(s,{archived:true})});return true}
  /**
   * Каталог каналов.
   *
   * Стоит до маршрута беседы по идентификатору: иначе «catalogue»
   * разберётся как имя беседы.
   */
  if(path==='/api/v1/conversations/catalogue'&&method==='GET'){
    const s=await requireSession(req);
    if(!store.listChannelCatalogue)throw httpError('Каталог каналов доступен в режиме с базой данных','CATALOGUE_UNAVAILABLE',503);
    json(res,200,{items:await store.listChannelCatalogue(s,{query:url?.searchParams.get('q')??null})});
    return true;
  }
  if(path==='/api/v1/saved-messages'&&method==='GET'){const s=await requireSession(req);json(res,200,{items:await store.listSavedMessages(s)});return true}
  if(path==='/api/v1/conversations'&&method==='POST'){
    const s=await requireSession(req),b=(await readJson(req))??{},kind=String(b.kind??'group');
    if(!allowedConversationKinds.has(kind))throw httpError('Unsupported conversation kind','INVALID_CONVERSATION_KIND',400);
    if(b.title!==undefined&&b.title!==null&&typeof b.title!=='string')throw httpError('Название должно быть строкой','INVALID_VALUE',400);
    // Всё, что видно не только участникам (канал, команда, проект, инцидент…),
    // заводят те, кому разрешено заводить каналы: иначе рядовой сотрудник
    // обходил запрет, выбрав другой вид комнаты.
    const wide=!['direct','group'].includes(kind)||(b.visibility!==undefined&&b.visibility!=='private');
    requirePermission(s.role,wide?Permission.CHANNEL_CREATE:Permission.MESSAGE_SEND);
    // Гость беседы не заводит. Право на отправку сообщений у него есть —
    // он для того и позван, — но заводить комнаты это право не даёт:
    // гость не может никого в них позвать (состав ему менять нельзя), и
    // получались пустые комнаты без единого собеседника. Свою переписку
    // с ним заводит принимающая сторона.
    if(isGuest(s))throw httpError('Not found','NOT_FOUND',404);
    const ids=Array.isArray(b.participantIds)?[...new Set(b.participantIds.map(String).filter(Boolean))]:[];
    const participantCount=new Set([s.userId,...ids]).size;
    if(kind==='direct'&&participantCount!==2)throw httpError('Direct conversation requires exactly two users','DIRECT_REQUIRES_TWO_PARTICIPANTS',400);
    // Переписка вдвоём одна на двоих: если она уже есть, открываем её, а
    // не заводим вторую. Двойной клик по имени в справочнике давал два
    // одинаковых пункта в списке, и разговор делился пополам.
    if(kind==='direct'&&store.findDirectConversation){
      const existing=await store.findDirectConversation(s,ids[0]);
      if(existing){
        const already=await store.getConversation?.(s,existing);
        json(res,200,{conversation:already??{id:existing},existed:true});return true;
      }
    }
    const visibility=kind==='direct'||kind==='group'?'private':(b.visibility??'private');
    const conversation=await store.createConversation(s,{
      kind,
      title:kind==='direct'?(b.title===undefined||b.title===null?null:cleanText(b.title,120)):cleanText(b.title,120),
      slug:b.slug?cleanText(b.slug,80):null,
      visibility,
      participantIds:ids,
      purpose:b.purpose?cleanText(b.purpose,500):null,
      announcementOnly:kind==='channel'&&Boolean(b.announcementOnly),
    });
    const audience=await store.conversationAudience(s,conversation.id);
    hub.broadcastUsers(s.workspaceId,audience,'conversation.created',conversation);
    json(res,201,{conversation});return true;
  }

  let m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/preferences$`,'i'));
  if(m&&method==='PATCH'){
    const s=await requireSession(req);await policyOr404(store,s,m[1]);const b=await readJson(req),value={};
    if(typeof b.archived==='boolean')value.archived=b.archived;
    if(Object.prototype.hasOwnProperty.call(b,'mutedUntil')){
      if(b.mutedUntil===null||b.mutedUntil==='')value.mutedUntil=null;
      else{const at=new Date(b.mutedUntil);if(Number.isNaN(at.getTime()))throw httpError('Invalid mutedUntil','INVALID_MUTE_UNTIL',400);value.mutedUntil=at.toISOString()}
    }
    if(!Object.keys(value).length)throw httpError('No conversation preference supplied','INVALID_CONVERSATION_PREFERENCES',400);
    const preferences=await store.setConversationPreferences(s,m[1],value);json(res,200,{preferences});return true;
  }

  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/claim$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req);
    requirePermission(s.role,Permission.CHANNEL_MANAGE);
    json(res,200,await store.claimOrphanedConversation(s,m[1]));
    return true;
  }
  // Leaving a room was impossible: removing yourself needed management
  // rights, so a person invited into a channel stayed in it for good.
  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/join$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req);
    if(!store.joinChannel)throw httpError('Каталог каналов доступен в режиме с базой данных','CATALOGUE_UNAVAILABLE',503);
    json(res,200,await store.joinChannel(s,m[1]));
    return true;
  }
  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/leave$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req),policy=await policyOr404(store,s,m[1]);
    if(policy.conversation.kind==='direct')throw httpError('A direct conversation cannot be left; archive it instead','DIRECT_CANNOT_LEAVE',409);
    if(!policy.memberRole)throw httpError('You are here by channel visibility, not membership; archive it instead','NOT_A_MEMBER',409);
    const previous=await store.conversationAudience(s,m[1]);
    const items=await store.removeConversationMember(s,m[1],s.userId);
    hub.broadcastUsers(s.workspaceId,[...new Set([...previous,s.userId])],'conversation.members.updated',{conversationId:m[1],items});
    json(res,200,{items});return true;
  }

  // The title, the purpose and whether the channel is announcement-only were
  // fixed at creation for ever.
  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}$`,'i'));
  if(m&&method==='PATCH'){
    const s=await requireSession(req),policy=await policyOr404(store,s,m[1]);requireConversationManager(s,policy);
    if(policy.conversation.kind==='direct')throw httpError('A direct conversation has no settings to change','DIRECT_NOT_EDITABLE',409);
    const b=await readJson(req),patch={};
    if(b.title!==undefined)patch.title=cleanText(b.title,120);
    if(b.purpose!==undefined)patch.purpose=b.purpose?cleanText(b.purpose,500):null;
    if(b.announcementOnly!==undefined)patch.announcementOnly=Boolean(b.announcementOnly);
    // Обложка группы — ссылка на уже загруженный файл: снимок проходит
    // тот же путь, что и любое вложение, с проверкой типа и размера.
    if(Object.prototype.hasOwnProperty.call(b,'avatarFileId'))patch.avatarFileId=await resolveAvatar(store,s,b.avatarFileId);
    // Номер версии необязателен: старые клиенты его не шлют. Но если
    // прислан — правка не ляжет поверх чужой, сделанной в другом окне.
    if(b.expectedVersion!==undefined)patch.expectedVersion=b.expectedVersion;
    if(!Object.keys(patch).filter((key)=>key!=='expectedVersion').length)throw httpError('Nothing to change','EMPTY_PATCH',400);
    const conversation=await store.updateConversation(s,m[1],patch);
    const audience=await store.conversationAudience(s,m[1]);
    hub.broadcastUsers(s.workspaceId,audience,'conversation.updated',conversation);
    json(res,200,{conversation});return true;
  }

  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/pins$`,'i'));
  if(m&&method==='GET'){const s=await requireSession(req);await policyOr404(store,s,m[1]);json(res,200,{items:await store.listPinnedMessages(s,m[1])});return true}

  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/members$`,'i'));
  if(m&&method==='GET'){
    const s=await requireSession(req),policy=await policyOr404(store,s,m[1]);
    const items=await store.listConversationMembers(s,m[1]);
    json(res,200,{conversation:policy.conversation,items,canManage:canManageConversation(s,policy)});return true;
  }
  if(m&&method==='POST'){
    const s=await requireSession(req),policy=await policyOr404(store,s,m[1]);requireConversationManager(s,policy);
    if(policy.conversation.kind==='direct')throw httpError('Direct conversation membership is immutable','DIRECT_MEMBERSHIP_IMMUTABLE',409);
    const b=await readJson(req),userIds=Array.isArray(b.userIds)?[...new Set(b.userIds.map(String).filter(Boolean))]:[];
    if(!userIds.length)throw httpError('At least one userId is required','INVALID_CONVERSATION_MEMBERS',400);
    const role=String(b.role??'member');if(!MEMBER_ROLES.has(role))throw httpError('Invalid conversation role','INVALID_CONVERSATION_ROLE',400);
    if(s.role==='guest')throw httpError('A guest cannot change who is in a conversation','GUEST_CANNOT_MANAGE',403);
    if(role==='owner'&&!ownsConversation(s,policy))throw httpError('Передать владение беседой может только её владелец','OWNER_ONLY',403);
    const previous=await store.conversationAudience(s,m[1]);
    const items=await store.addConversationMembers(s,m[1],userIds,role);
    const audience=await store.conversationAudience(s,m[1]);
    hub.broadcastUsers(s.workspaceId,[...new Set([...previous,...audience,...userIds])],'conversation.members.updated',{conversationId:m[1],items});
    json(res,200,{items});return true;
  }

  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/members/${USER_ID}$`,'i'));
  if(m&&method==='PATCH'){
    const s=await requireSession(req),policy=await policyOr404(store,s,m[1]);requireConversationManager(s,policy);
    if(policy.conversation.kind==='direct')throw httpError('Direct conversation membership is immutable','DIRECT_MEMBERSHIP_IMMUTABLE',409);
    const b=await readJson(req),role=String(b.role??'');if(!MEMBER_ROLES.has(role))throw httpError('Invalid conversation role','INVALID_CONVERSATION_ROLE',400);
    if(s.role==='guest')throw httpError('A guest cannot change conversation roles','GUEST_CANNOT_MANAGE',403);
    if(!ownsConversation(s,policy)){
      const members=await store.listConversationMembers(s,m[1]);
      const target=members.find(x=>String(x.userId)===String(m[2]));
      if(role==='owner'||target?.role==='owner')throw httpError('Менять владельца беседы может только он сам','OWNER_ONLY',403);
    }
    const items=await store.setConversationMemberRole(s,m[1],m[2],role);
    const audience=await store.conversationAudience(s,m[1]);
    hub.broadcastUsers(s.workspaceId,audience,'conversation.members.updated',{conversationId:m[1],items});
    json(res,200,{items});return true;
  }
  if(m&&method==='DELETE'){
    const s=await requireSession(req),policy=await policyOr404(store,s,m[1]);requireConversationManager(s,policy);
    if(policy.conversation.kind==='direct')throw httpError('Direct conversation membership is immutable','DIRECT_MEMBERSHIP_IMMUTABLE',409);
    const previous=await store.conversationAudience(s,m[1]);
    if(s.role==='guest')throw httpError('A guest cannot remove people from a conversation','GUEST_CANNOT_MANAGE',403);
    const items=await store.removeConversationMember(s,m[1],m[2]);
    const audience=await store.conversationAudience(s,m[1]);
    hub.broadcastUsers(s.workspaceId,[...new Set([...previous,...audience,m[2]])],'conversation.members.updated',{conversationId:m[1],items});
    json(res,200,{items});return true;
  }

  /**
   * Перенос из WhatsApp или Telegram — с отметкой, откуда это.
   *
   * Половина работы приходит оттуда, и до сих пор её копировали руками:
   * в беседе оставалось «прислали смету», а через месяц не сказать ни
   * кто прислал, ни когда.
   */
  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/external-forwards$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req);await policyOr404(store,s,m[1]);
    if(!store.createExternalForward)throw httpError('Перенос из мессенджеров доступен в режиме с базой данных','EXTERNAL_FORWARD_UNAVAILABLE',503);
    const b=await readJson(req);
    const prepared=prepareForward({
      text:String(b.text??''),
      source:String(b.source??'other'),
      authorName:b.authorName??null,
      sentAt:b.sentAt??null,
      // Пояс того, кто переносит: в выгрузке мессенджера его нет, и
      // это единственный, который мы действительно знаем.
      offsetMinutes:Number.isFinite(Number(b.offsetMinutes))?Number(b.offsetMinutes):0,
    });
    if(prepared.body.length>MAX_FORWARD_TEXT)throw httpError('Слишком длинный кусок переписки','FORWARD_TOO_LONG',413);
    const message=await store.createExternalForward(s,m[1],prepared);
    const audience=await store.conversationAudience(s,m[1]);
    hub.broadcastUsers(s.workspaceId,audience,'message.created',{conversationId:m[1],message});
    json(res,201,{message});return true;
  }

  /**
   * Архив беседы по видам материалов.
   *
   * «Где та фотография акта» на полугодовой переписке — это десять
   * минут прокрутки. Разбор по виду, потому что приходят именно за
   * видом.
   */
  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/archive$`,'i'));
  if(m&&method==='GET'){
    const s=await requireSession(req);await policyOr404(store,s,m[1]);
    if(!store.conversationArchive)throw httpError('Архив беседы доступен в режиме с базой данных','ARCHIVE_UNAVAILABLE',503);
    const kind=url.searchParams.get('kind')||'all';
    const source=url.searchParams.get('source');
    if(source&&!SOURCES.has(source))throw httpError('Неизвестный источник','INVALID_SOURCE',400);
    json(res,200,{items:await store.conversationArchive(s,m[1],{kind,source:source||null,limit:url.searchParams.get('limit')})});
    return true;
  }

  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/messages$`,'i'));
  if(m&&method==='GET'){
    const s=await requireSession(req);
    const limit=pageSize(url.searchParams.get('limit'), 100, 200);
    const raw=url.searchParams.get('before');
    let before=null;
    if(raw){
      const [at,id]=String(raw).split('|');
      if(!at||!id||Number.isNaN(Date.parse(at)))throw httpError('Malformed cursor','INVALID_CURSOR',400);
      before={at:new Date(at).toISOString(),id};
    }
    // Окно вокруг сообщения: переход из поиска к старой реплике грузил
    // последние сто и молча не находил её среди них.
    const around=url.searchParams.get('around');
    if(around&&!/^[0-9a-f-]{36}$/i.test(around))throw httpError('Malformed message id','INVALID_MESSAGE_ID',400);
    // Ветка под сообщением: корень плюс ответы, по порядку. В самой
    // ленте ответов нет — там стоит корень со счётчиком.
    const thread=url.searchParams.get('thread');
    if(thread&&!/^[0-9a-f-]{36}$/i.test(thread))throw httpError('Malformed message id','INVALID_MESSAGE_ID',400);
    const items=await store.listMessages(s,m[1],limit,before,around||null,{threadRootId:thread||null});
    // A full page means there may be more; the cursor points at the oldest
    // row returned, which is where the next page starts.
    const oldest=items[0];
    // createdAt arrives from the driver as a Date, and a template literal
    // stringifies it with toString(): «Sun Sep 20 2026 00:58:40 GMT+0300».
    // Re-parsing that drops the milliseconds, so the cursor landed before
    // every message in the conversation and the second page was always empty —
    // the whole history past the first page was unreachable.
    const nextCursor=items.length===limit&&oldest?`${new Date(oldest.createdAt).toISOString()}|${oldest.id}`:null;
    json(res,200,{items,nextCursor,hasMore:Boolean(nextCursor)});
    return true;
  }
  if(m&&method==='POST'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MESSAGE_SEND);
    const policy=await policyOr404(store,s,m[1]);
    if(policy.conversation.announcementOnly&&!canManageConversation(s,policy))throw httpError('Only channel managers may publish in this announcement channel','ANNOUNCEMENT_ONLY',403);
    const b=await readJson(req),kind=String(b.kind??'text');
    if(!allowedMessageKinds.has(kind))throw httpError('Unsupported message kind','INVALID_MESSAGE_KIND',400);
    if(serverOnlyMessageKinds.has(kind))throw httpError('That message kind is written by the server, not by a client','MESSAGE_KIND_RESERVED',403);
    if(b.body!==undefined&&b.body!==null&&typeof b.body!=='string')throw httpError('Message body must be text','INVALID_MESSAGE_BODY',400);
    // Нулевой байт и прочие управляющие символы база не хранит, а запрос с
    // ними падал пятисоткой. Убираем до проверок, иначе «сообщение» из
    // одних невидимок пройдёт как непустое.
    if(typeof b.body==='string')b.body=stripControl(b.body);
    // Пробел нулевой ширины — не текст: пузырь в ленте выходил пустым.
    if(kind==='text'&&!String(b.body??'').replace(/[\u200b\u200c\u200d\ufeff]/g,'').trim())throw httpError('Message body required','INVALID_MESSAGE_BODY',400);
    if(typeof b.body==='string'&&b.body.length>12000)throw httpError('Message body is too long','MESSAGE_TOO_LONG',400);
    const message=await store.createMessage(s,m[1],{kind,body:b.body??null,replyToId:b.replyToId??null,threadRootId:b.threadRootId??null,metadata:b.metadata??{},mentionedUserIds:Array.isArray(b.mentionedUserIds)?b.mentionedUserIds:[],clientRequestId:b.clientRequestId??randomUUID()});
    const audience=await store.conversationAudience(s,m[1]),notificationAudience=store.conversationNotificationAudience?await store.conversationNotificationAudience(s,m[1]):audience;
    hub.broadcastUsers(s.workspaceId,audience,'message.created',{conversationId:m[1],message});
    // Лучшее старание, не гарантия: беседа не ждёт Telegram, а если моста
    // для неё нет, deliverOutbound сама тихо ничего не сделает.
    telegram?.enabled&&telegram.deliverOutbound(s,m[1],message).catch(()=>{});
    // Уведомление расходится двумя пачками, потому что для человека это
    // два разных события: его назвали по имени — или в канале, за
    // которым он следит, появилось сообщение. У них и переключатели
    // разные, и в тихий час первое проходит, а второе нет.
    // Названные по имени берутся из полного круга, а не из очищенного
    // от приглушивших: приглушение убирает шум «в канале что-то новое»,
    // но не личное обращение. Пока обе пачки строились из одного списка,
    // «приглушить на восемь часов» означало пропустить и прямой вопрос —
    // ровно то, от чего приглушение не должно защищать.
    const mentioned=new Set((message.mentionedUserIds??[]).map(String));
    const others=notificationAudience.filter(id=>id!==s.userId&&!mentioned.has(String(id)));
    const called=audience.filter(id=>id!==s.userId&&mentioned.has(String(id)));
    const conversation=S_KIND(store.getConversation?await store.getConversation(s,m[1]).catch(()=>null):null);
    await Promise.all([
      notifyUsers(s.workspaceId,called,{title:`Вас упомянул(а) ${s.displayName}`,body:message.body??messageKindLabel(message.kind),url:`/#/chats/${m[1]}?message=${message.id}`,kind:'message.mentioned'}),
      notifyUsers(s.workspaceId,others,{title:`Новое сообщение · ${s.displayName}`,body:message.body??messageKindLabel(message.kind),url:`/#/chats/${m[1]}`,kind:conversation}),
    ]);
    json(res,201,{message});return true;
  }

  m=path.match(new RegExp(`^/api/v1/messages/${MESSAGE_ID}/save$`,'i'));
  if(m&&(method==='POST'||method==='DELETE')){const s=await requireSession(req),state=await store.setMessageSaved(s,m[1],method==='POST');json(res,200,state);return true}

  m=path.match(new RegExp(`^/api/v1/messages/${MESSAGE_ID}/pin$`,'i'));
  if(m&&(method==='POST'||method==='DELETE')){
    const s=await requireSession(req),message=await store.getMessage(s,m[1]);if(!message||message.deletedAt)throw httpError('Message not found','NOT_FOUND',404);
    const policy=await policyOr404(store,s,message.conversationId);
    if(policy.conversation.kind!=='direct')requireConversationManager(s,policy);
    const state=await store.setMessagePinned(s,m[1],method==='POST'),audience=await store.conversationAudience(s,message.conversationId);
    hub.broadcastUsers(s.workspaceId,audience,'message.pin',{conversationId:message.conversationId,messageId:m[1],pinned:state.pinned});
    json(res,200,state);return true;
  }

  m=path.match(new RegExp(`^/api/v1/messages/${MESSAGE_ID}/forward$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MESSAGE_SEND);const source=await store.getMessage(s,m[1]);if(!source||source.deletedAt)throw httpError('Message not found','NOT_FOUND',404);
    const b=await readJson(req),targetConversationId=String(b.conversationId??''),policy=await policyOr404(store,s,targetConversationId);
    if(policy.conversation.announcementOnly&&!canManageConversation(s,policy))throw httpError('Only channel managers may publish in this announcement channel','ANNOUNCEMENT_ONLY',403);
    const message=await store.forwardMessage(s,m[1],targetConversationId),audience=await store.conversationAudience(s,targetConversationId),notificationAudience=store.conversationNotificationAudience?await store.conversationNotificationAudience(s,targetConversationId):audience;
    hub.broadcastUsers(s.workspaceId,audience,'message.created',{conversationId:targetConversationId,message});
    await notifyUsers(s.workspaceId,notificationAudience.filter(id=>id!==s.userId),{title:`Переслано · ${s.displayName}`,body:message.body??messageKindLabel(message.kind),url:`/#/chats/${targetConversationId}`,kind:'message.created'});
    json(res,201,{message});return true;
  }

  /**
   * Прежние редакции сообщения.
   *
   * Правка теперь оставляет след, и след этот должен быть виден не
   * только в журнале аудита, куда ходят двое: пометку «изменено» читают
   * все, и вопрос «что там было» возникает у того же, кто её видит.
   *
   * Образец стоит до маршрута сообщения по идентификатору: иначе
   * «versions» разберётся как часть пути к самому сообщению.
   */
  m=path.match(new RegExp(`^/api/v1/messages/${MESSAGE_ID}/versions$`,'i'));
  if(m&&method==='GET'){
    const s=await requireSession(req);
    if(!store.listMessageVersions)throw httpError('История правок доступна в режиме с базой данных','VERSIONS_UNAVAILABLE',503);
    json(res,200,{items:await store.listMessageVersions(s,m[1])});
    return true;
  }
  m=path.match(new RegExp(`^/api/v1/messages/${MESSAGE_ID}$`,'i'));
  if(m&&method==='PATCH'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MESSAGE_SEND);const message=await store.getMessage(s,m[1]);if(!message||message.deletedAt)throw httpError('Message not found','NOT_FOUND',404);
    if(message.authorId!==s.userId)throw httpError('Only the author may edit this message','MESSAGE_EDIT_FORBIDDEN',403);
    if(message.forwarded)throw httpError('Forwarded message content is immutable','MESSAGE_FORWARD_IMMUTABLE',409);
    if(message.kind!=='text')throw httpError('Only text messages can be edited','MESSAGE_KIND_NOT_EDITABLE',409);
    const b=await readJson(req),body=cleanText(b.body,12000),updated=await store.editMessage(s,m[1],body),audience=await store.conversationAudience(s,message.conversationId);
    hub.broadcastUsers(s.workspaceId,audience,'message.updated',{conversationId:message.conversationId,message:updated});json(res,200,{message:updated});return true;
  }
  if(m&&method==='DELETE'){
    const s=await requireSession(req),message=await store.getMessage(s,m[1]);if(!message||message.deletedAt)throw httpError('Message not found','NOT_FOUND',404);
    if(message.authorId===s.userId)requirePermission(s.role,Permission.MESSAGE_DELETE_OWN);else requirePermission(s.role,Permission.MESSAGE_DELETE_ANY);
    const deleted=await store.deleteMessage(s,m[1]),audience=await store.conversationAudience(s,message.conversationId);
    hub.broadcastUsers(s.workspaceId,audience,'message.deleted',{conversationId:message.conversationId,message:deleted});json(res,200,{message:deleted});return true;
  }

  m=path.match(/^\/api\/v1\/messages\/([0-9a-f-]+)\/reactions$/i);
  if(m&&method==='POST'){
    const s=await requireSession(req),conversationId=await store.messageConversation(s,m[1]);
    if(!conversationId||!(await store.canAccessConversation(s,conversationId)))throw httpError('Message not found','NOT_FOUND',404);
    const b=await readJson(req),reactions=await store.toggleReaction(s,m[1],cleanText(b.reaction,24));
    const audience=await store.conversationAudience(s,conversationId);
    hub.broadcastUsers(s.workspaceId,audience,'message.reaction',{messageId:m[1],reactions});
    json(res,200,{reactions});return true;
  }

  m=path.match(new RegExp(`^/api/v1/conversations/${CONVERSATION_ID}/read$`,'i'));
  if(m&&method==='POST'){
    const s=await requireSession(req);await policyOr404(store,s,m[1]);const b=await readJson(req);
    await store.markRead(s,m[1],b.messageId??null);
    const audience=await store.conversationAudience(s,m[1]);
    hub.broadcastUsers(s.workspaceId,audience,'conversation.read',{conversationId:m[1],userId:s.userId,messageId:b.messageId??null});
    noContent(res);return true;
  }
  return false;
}
