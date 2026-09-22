import { hashPassword, verifyPassword, equalizePasswordTiming, normalizeEmail, createOpaqueToken, hashToken } from '../security.js';
import { Permission, requirePermission } from '../rbac.js';
import { log } from '../obs/log.js';
import { cleanText, clientAddress, trustsProxy, json, noContent, readJson } from './helpers.js';
import { invitationMail, passwordResetMail } from '../mail/templates.js';

/** Адрес этого стенда глазами пришедшего — из него собираются ссылки в письмах. */
const originOf=(req)=>{
  const proto=String((trustsProxy()&&req.headers['x-forwarded-proto'])||(req.socket.encrypted?'https':'http')).split(',')[0];
  return `${proto}://${req.headers.host??'localhost'}`;
};

/**
 * Письмо ставится в очередь, но никогда не роняет сам запрос.
 *
 * Приглашение уже создано в базе, и ссылка уже в ответе: если почтовый
 * канал не настроен или очередь недоступна, приглашение всё равно
 * действительно, и его по-прежнему можно передать руками. Обратное —
 * ответить пятисоткой на успешно созданное приглашение — было бы хуже
 * молчания.
 */
async function post(ctx,letter){
  if(!ctx.mail)return{queued:false,reason:'no-queue'};
  try{
    const queued=await ctx.mail.enqueue(letter);
    return{queued:Boolean(queued),reason:queued?null:'duplicate'};
  }catch(error){
    log('error','mail.enqueue.failed',{kind:letter.kind,err:String(error?.message??error)});
    return{queued:false,reason:'enqueue-failed'};
  }
}

const invalidCredentials=()=>Object.assign(new Error('Invalid email or password'),{code:'INVALID_CREDENTIALS',statusCode:401});

export async function handleAuth(req,res,ctx,path,method,url=null){
  const {store,requireSession,openSession,clearSession,cookieToken,authThrottle}=ctx;
  const address=clientAddress(req);
  if(method==='POST'&&path==='/api/v1/auth/register-company'){
    authThrottle?.guard('register',{address});
    const b=await readJson(req),email=normalizeEmail(b.email),p=hashPassword(b.password);
    const x=await store.createCompany({companyName:cleanText(b.companyName,120),workspaceName:b.workspaceName?cleanText(b.workspaceName,120):undefined,ownerName:cleanText(b.ownerName,120),email,passwordHash:p.hash,passwordSalt:p.salt});
    await openSession(res,req,x.user.id,x.workspace.id,201);return true;
  }
  /**
   * Заведись сам по рабочей почте.
   *
   * Раньше попасть в компанию можно было только так: кто-то заводит
   * именно тебя и присылает ссылку. Для сорока человек это сорок
   * действий администратора, и каждый ждёт своей очереди.
   *
   * Здесь человек вводит свой рабочий адрес, и если его домен объявлен
   * компанией и места есть — на почту уходит та же ссылка-подтверждение,
   * что и у обычного приглашения. Дальше всё как всегда: имя, пароль,
   * вход.
   *
   * Ответ всегда один и тот же и всегда 202. Иначе этот адрес
   * превращается в справочник: «а пользуется ли ChatX компания
   * такая-то» — вопрос, на который посторонним отвечать нечего.
   */
  if(method==='POST'&&path==='/api/v1/auth/join'){
    authThrottle?.guard('register',{address});
    const b=await readJson(req);
    let email=null;
    try{email=normalizeEmail(b.email)}catch{email=null}
    const answer=()=>{json(res,202,{accepted:true,
      message:'Если ваша компания пользуется ChatX и в ней есть свободные места, письмо со ссылкой придёт в течение минуты.'});return true};
    if(!email)return answer();
    const company=await store.findCompanyForEmail?.(email);
    if(!company)return answer();
    if(await store.emailKnownInWorkspace(company.workspaceId,email))return answer();
    // Мест нет — человеку писать нечего, а вот владельцу есть: он один
    // может их добавить, и без этого письма он о запросе не узнает.
    // Ссылку кто-то должен выписать: приглашение без пригласившего —
    // это дыра в журнале. Выписывает владелец: домен объявил он.
    const owner=await store.workspaceOwner(company.workspaceId);
    if(!owner)return answer();
    if(company.full){
      {
        await post(ctx,{organizationId:company.organizationId,workspaceId:company.workspaceId,kind:'seats_full',actorId:null,
          to:owner.email,subject:`${company.name}: нет свободных мест`,
          text:`${email} пытается войти в «${company.name}», но свободных мест нет.\n\n`
            +`Занято ${company.seatsUsed} из ${company.seatLimit}. Увеличьте число мест в «Ещё → Компания» или освободите место.`});
      }
      return answer();
    }
    const token=createOpaqueToken();
    const invitation=await store.createInvitation(
      {organizationId:company.organizationId,workspaceId:company.workspaceId,userId:owner.userId},
      {email,role:'member',tokenHash:hashToken(token),expiresAt:new Date(Date.now()+7*86400000).toISOString(),accessUntil:null});
    const inviteUrl=`${originOf(req)}/?invite=${encodeURIComponent(token)}`;
    const letter=invitationMail({workspaceName:company.name,inviterName:company.name,role:'member',
      url:inviteUrl,expiresAt:invitation.expiresAt});
    await post(ctx,{organizationId:company.organizationId,workspaceId:company.workspaceId,kind:'invitation',actorId:null,
      to:email,subject:letter.subject,text:letter.text,html:letter.html,sourceId:invitation.id});
    return answer();
  }

  if(method==='POST'&&path==='/api/v1/invitations/accept'){
    authThrottle?.guard('invitation',{address});
    const b=await readJson(req),p=hashPassword(b.password),x=await store.acceptInvitation({tokenHash:hashToken(cleanText(b.token,200)),displayName:cleanText(b.displayName,120),passwordHash:p.hash,passwordSalt:p.salt});
    await openSession(res,req,x.user.id,x.workspace.id,201);return true;
  }
  if(method==='POST'&&path==='/api/v1/auth/login'){
    const b=await readJson(req),email=normalizeEmail(b.email);
    /**
     * Ночной подбор паролей не оставлял следа.
     *
     * В журнале было девять одинаковых строк «POST /login → 401» без
     * адреса, без почты и без времени: один хост, долбящий один аккаунт,
     * и ботнет по всей организации выглядели одинаково. В журнале аудита
     * при этом не было вообще ни одного события входа — ни удачного, ни
     * провального, — хотя именно за этим к нему и приходят.
     */
    const refuse=async(reason,userId=null,workspaceId=null)=>{
      log('warn','auth.login.failed',{reqId:req.reqId,email,reason,ip:address});
      if(userId&&workspaceId&&store.recordAuthEvent){
        await store.recordAuthEvent({workspaceId,userId,eventType:'auth.login.failed',payload:{reason,ip:address}}).catch(()=>{});
      }
      return invalidCredentials();
    };
    authThrottle?.guard('login',{address,identity:email});
    const a=await store.findAuthByEmail(email);
    // An unknown email must cost the same as a known one, or response time enumerates accounts.
    if(!a){equalizePasswordTiming(String(b.password??''));throw await refuse('unknown_email')}
    if(!verifyPassword(String(b.password??''),a.passwordSalt,a.passwordHash)){
      throw await refuse('bad_password',a.id,a.workspaceId);
    }
    // workspaceId arrives from the client, so membership is verified here rather
    // than being discovered as a null session on the next request.
    const workspaceId=b.workspaceId??a.workspaceId;
    if(!await store.hasMembership(a.id,workspaceId))throw await refuse('not_a_member',a.id,a.workspaceId);
    /**
     * Второй множитель — после пароля, а не вместо него.
     *
     * Отдельный ответ, а не «неверный пароль»: человек должен понимать,
     * что пароль принят и нужен код. Знания о том, включён ли у кого-то
     * второй множитель, это не выдаёт: до сюда доходит только тот, кто
     * уже назвал верный пароль.
     */
    if(ctx.twoFactor&&await ctx.twoFactor.required(a.id)){
      const check=await ctx.twoFactor.check(a.id,b.code);
      if(!check.ok){
        log('warn','auth.login.second_factor',{reqId:req.reqId,userId:a.id,reason:check.reason,ip:address});
        if(check.reason!=='missing'){
          await store.recordAuthEvent?.({workspaceId,userId:a.id,eventType:'auth.login.failed',payload:{reason:`totp_${check.reason}`,ip:address}}).catch(()=>{});
        }
        throw Object.assign(
          new Error(check.reason==='missing'?'Нужен код из приложения':'Код не подошёл'),
          {code:check.reason==='missing'?'TWO_FACTOR_REQUIRED':'TWO_FACTOR_BAD_CODE',statusCode:401,expose:true},
        );
      }
      await store.recordAuthEvent?.({workspaceId,userId:a.id,eventType:'auth.second_factor.passed',payload:{method:check.method,ip:address}}).catch(()=>{});
    }
    authThrottle?.succeeded('login',{address,identity:email});
    log('info','auth.login.ok',{reqId:req.reqId,userId:a.id,wsId:workspaceId,ip:address});
    if(store.recordAuthEvent){
      await store.recordAuthEvent({workspaceId,userId:a.id,eventType:'auth.login.succeeded',payload:{ip:address}}).catch(()=>{});
    }
    await openSession(res,req,a.id,workspaceId,200);return true;
  }
  if(method==='POST'&&path==='/api/v1/auth/logout'){const t=cookieToken(req);if(t)await store.revokeSession(hashToken(t));noContent(res,{'set-cookie':clearSession()});return true}
  if(method==='GET'&&path==='/api/v1/me'){const s=await requireSession(req);json(res,200,{...s,permissions:ctx.permissions(s.role)});return true}
  /**
   * Свои устройства и выход с них.
   *
   * До сих пор «выйти» отзывал ровно тот сеанс, из которого нажали, а
   * список входов не показывался нигде: украденный ноутбук оставался
   * внутри рабочего пространства до истечения срока сеанса.
   */
  if(method==='GET'&&path==='/api/v1/auth/sessions'){
    const s=await requireSession(req);
    if(!store.listSessions)throw Object.assign(new Error('Список входов доступен в режиме с базой данных'),{code:'SESSIONS_UNAVAILABLE',statusCode:503,expose:true});
    json(res,200,{items:await store.listSessions(s)});return true;
  }
  if(method==='POST'&&path==='/api/v1/auth/sessions/revoke-others'){
    const s=await requireSession(req);
    if(!store.revokeOtherSessions)throw Object.assign(new Error('Список входов доступен в режиме с базой данных'),{code:'SESSIONS_UNAVAILABLE',statusCode:503,expose:true});
    json(res,200,await store.revokeOtherSessions(s));return true;
  }
  {
    const m=path.match(/^\/api\/v1\/auth\/sessions\/([0-9a-f-]{36})$/i);
    if(m&&method==='DELETE'){
      const s=await requireSession(req);
      if(!store.revokeSessionById)throw Object.assign(new Error('Список входов доступен в режиме с базой данных'),{code:'SESSIONS_UNAVAILABLE',statusCode:503,expose:true});
      json(res,200,await store.revokeSessionById(s,m[1]));return true;
    }
  }

  /**
   * Смена своего пароля.
   *
   * Изнутри пароль сменить было нельзя: единственным способом оставалось
   * «я забыл пароль» — выйти, попросить письмо, дождаться его. Человеку,
   * которому пароль подсмотрели через плечо, продукт не предлагал
   * ничего.
   */
  if(method==='POST'&&path==='/api/v1/auth/password'){
    const s=await requireSession(req);
    if(!store.changePassword)throw Object.assign(new Error('Смена пароля доступна в режиме с базой данных'),{code:'PASSWORD_UNAVAILABLE',statusCode:503,expose:true});
    // Подбор старого пароля ограничивается так же, как вход: маршрут
    // закрыт сеансом, но сеанс — ровно то, что бывает у чужого.
    authThrottle?.guard('password',{address,identity:s.userId});
    const b=await readJson(req);
    const next=hashPassword(String(b.password??''));
    const result=await store.changePassword(s,{
      verify:(current)=>verifyPassword(String(b.currentPassword??''),current.passwordSalt,current.passwordHash),
      passwordHash:next.hash,passwordSalt:next.salt,keepSessionId:s.sessionId,
    });
    authThrottle?.succeeded('password',{address,identity:s.userId});
    json(res,200,result);return true;
  }

  /**
   * Второй множитель.
   *
   * Включает и выключает человек сам, за свою учётную запись: право
   * администратора здесь ни при чём, а обязать его включить — вопрос
   * договорённостей в компании, а не кнопки.
   *
   * Выключение и выпуск новых запасных кодов требуют пароля: сеанс
   * бывает украден, и без этого весь второй множитель снимается одним
   * запросом из чужой вкладки.
   */
  if(path==='/api/v1/auth/two-factor'){
    const s=await requireSession(req);
    if(!ctx.twoFactor)throw Object.assign(new Error('Второй множитель доступен в режиме с базой данных'),{code:'TWO_FACTOR_UNAVAILABLE',statusCode:503,expose:true});
    if(method==='GET'){json(res,200,await ctx.twoFactor.state(s.userId));return true}
    if(method==='POST'){
      authThrottle?.guard('password',{address,identity:s.userId});
      json(res,201,await ctx.twoFactor.begin(s.userId,s.email??s.userId));return true;
    }
    if(method==='DELETE'){
      const b=await readJson(req);
      await requirePasswordOf(ctx,s,b.password,{address,identity:s.userId,authThrottle});
      await store.recordAuthEvent?.({workspaceId:s.workspaceId,userId:s.userId,eventType:'auth.second_factor.disabled',payload:{ip:address}}).catch(()=>{});
      json(res,200,await ctx.twoFactor.disable(s.userId));return true;
    }
  }
  if(method==='POST'&&path==='/api/v1/auth/two-factor/confirm'){
    const s=await requireSession(req);
    if(!ctx.twoFactor)throw Object.assign(new Error('Второй множитель доступен в режиме с базой данных'),{code:'TWO_FACTOR_UNAVAILABLE',statusCode:503,expose:true});
    authThrottle?.guard('password',{address,identity:s.userId});
    const b=await readJson(req);
    const result=await ctx.twoFactor.confirm(s.userId,b.code);
    authThrottle?.succeeded('password',{address,identity:s.userId});
    await store.recordAuthEvent?.({workspaceId:s.workspaceId,userId:s.userId,eventType:'auth.second_factor.enabled',payload:{ip:address}}).catch(()=>{});
    json(res,201,result);return true;
  }
  if(method==='POST'&&path==='/api/v1/auth/two-factor/recovery-codes'){
    const s=await requireSession(req);
    if(!ctx.twoFactor)throw Object.assign(new Error('Второй множитель доступен в режиме с базой данных'),{code:'TWO_FACTOR_UNAVAILABLE',statusCode:503,expose:true});
    const b=await readJson(req);
    await requirePasswordOf(ctx,s,b.password,{address,identity:s.userId,authThrottle});
    json(res,201,await ctx.twoFactor.reissue(s.userId));return true;
  }

  if(method==='GET'&&path==='/api/v1/bootstrap'){const s=await requireSession(req),data=await store.getBootstrap(s);json(res,200,{...data,permissions:ctx.permissions(s.role),storageMode:ctx.mode,push:ctx.push});return true}
  // Recovery has no mail channel, so an administrator issues the link and
  // hands it over. The person who forgot cannot ask for it themselves —
  // asking is a conversation with their administrator, not an endpoint.
  if(method==='POST'&&path==='/api/v1/password-resets'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MEMBER_INVITE);
    if(!store.createPasswordReset)throw Object.assign(new Error('Password recovery requires a database deployment'),{code:'RESET_UNAVAILABLE',statusCode:503,expose:true});
    const b=await readJson(req),token=createOpaqueToken();
    const reset=await store.createPasswordReset(s,{userId:String(b.userId??''),tokenHash:hashToken(token),expiresAt:new Date(Date.now()+86400000).toISOString()});
    const resetUrl=`${originOf(req)}/?reset=${encodeURIComponent(token)}`;
    const person=(await store.listPeople(s)).find(x=>x.userId===reset.userId);
    const letter=passwordResetMail({workspaceName:s.workspaceName??'рабочее пространство',url:resetUrl,expiresAt:reset.expiresAt});
    const delivery=person?.email
      ?await post(ctx,{organizationId:s.organizationId,workspaceId:s.workspaceId,kind:'password_reset',actorId:s.userId,
        to:person.email,subject:letter.subject,text:letter.text,html:letter.html,sourceId:reset.id})
      :{queued:false,reason:'no-address'};
    json(res,201,{reset:{...reset,resetUrl},mail:delivery});return true;
  }

  /**
   * «Я забыл пароль» — сам, без администратора.
   *
   * До появления почтового канала этого маршрута не могло быть в
   * принципе: ссылку некуда было отправить, и человек ждал, пока кто-то
   * внутри выпишет её и передаст в мессенджере.
   *
   * Три правила, без которых маршрут вреднее, чем его отсутствие. Ответ
   * всегда один и тот же — иначе по нему перебирают адреса и узнают,
   * кто работает в компании. Попытки на адрес считаются — иначе это
   * рассылка по чужим ящикам от нашего имени. И считается их не
   * отправитель, а мы: счётчик в базе, а не в памяти процесса.
   */
  if(method==='POST'&&path==='/api/v1/password-resets/request'){
    const b=await readJson(req);
    const email=normalizeEmail(cleanText(b.email,320));
    // Ключей два, как и у входа: адрес источника — против одного, кто
    // перебирает ящики, адрес почты — против многих, сошедшихся на одном.
    authThrottle?.guard('reset',{address,identity:email||undefined});
    // Ответ готов заранее и не зависит ни от чего дальше.
    const answered=()=>{noContent(res);return true};
    if(!email||!store.createSelfPasswordReset||!ctx.mail)return answered();

    const windowMs=Number(process.env.PASSWORD_RESET_WINDOW_MS??3600000);
    const limit=Number(process.env.PASSWORD_RESET_LIMIT??3);
    const asked=await ctx.mail.countResetRequests(email,windowMs).catch(()=>0);
    if(asked>limit){
      log('warn','password.reset.throttled',{attempts:asked});
      return answered();
    }

    const token=createOpaqueToken();
    const reset=await store.createSelfPasswordReset({
      email,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+3600000).toISOString(),
    }).catch((error)=>{log('error','password.reset.failed',{err:String(error?.message??error)});return null});
    // Адреса нет у нас — человек об этом не узнает: ответ тот же.
    if(!reset)return answered();

    const letter=passwordResetMail({
      workspaceName:reset.workspaceName??'рабочее пространство',
      url:`${originOf(req)}/?reset=${encodeURIComponent(token)}`,
      expiresAt:reset.expiresAt,
    });
    await post(ctx,{organizationId:reset.organizationId,workspaceId:reset.workspaceId,kind:'password_reset',actorId:reset.userId,
      to:reset.email,subject:letter.subject,text:letter.text,html:letter.html,sourceId:reset.id});
    return answered();
  }

  if(method==='POST'&&path==='/api/v1/password-resets/redeem'){
    if(!store.redeemPasswordReset)throw Object.assign(new Error('Password recovery requires a database deployment'),{code:'RESET_UNAVAILABLE',statusCode:503,expose:true});
    const b=await readJson(req),p=hashPassword(b.password);
    await store.redeemPasswordReset({tokenHash:hashToken(cleanText(b.token,200)),passwordHash:p.hash,passwordSalt:p.salt});
    // The new password is set but no session is handed out: signing in with
    // it is the proof it arrived where it was meant to.
    noContent(res);return true;
  }

  /**
   * Что ушло почтой и дошло ли.
   *
   * Без этого списка непришедшее приглашение выглядит для компании как
   * «человек не отвечает»: письмо где-то между нами и его почтовым
   * сервером, и посмотреть негде.
   */
  if(method==='GET'&&path==='/api/v1/mail'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MEMBER_INVITE);
    if(!ctx.mail)throw Object.assign(new Error('Почтовый канал доступен в режиме с базой данных'),{code:'MAIL_UNAVAILABLE',statusCode:503,expose:true});
    json(res,200,{
      items:await ctx.mail.list(s,{limit:url?.searchParams.get('limit')??50,kind:url?.searchParams.get('kind')??null}),
      channel:ctx.mailWorker?.status?.()??{configured:false},
    });
    return true;
  }

  /**
   * Приглашения списком.
   *
   * Компания приходит не по одному человеку: у неё уже есть штат, и
   * заводить его по одной форме на сотрудника — час работы и десяток
   * опечаток. Здесь принимается разбор того, что человек вставил из
   * таблицы: адрес, роль и подразделение в каждой строке.
   *
   * Ответ — построчный: что ушло, что уже здесь, что не разобрано.
   * Одна плохая строка не отменяет остальных: иначе из-за опечатки в
   * пятидесятой строке пришлось бы звать заново все пятьдесят.
   */
  /**
   * В какое подразделение этот человек вправе звать.
   *
   * Проверка та же, что на добавление в отдел вручную: иначе приглашение
   * становится обходом — вписать кого угодно в закрытый отдел нельзя, а
   * позвать туда письмом было бы можно.
   */
  const unitForInvite=async(session,unitId)=>{
    if(!unitId)return null;
    if(!ctx.org)throw Object.assign(new Error('Оргструктура недоступна'),{code:'ORG_STRUCTURE_UNAVAILABLE',statusCode:503,expose:true});
    const workspaceWide=(ctx.permissions(session.role)??[]).includes(Permission.ORG_STRUCTURE_MANAGE);
    if(!(await ctx.org.canManageMembers(session,unitId,{workspaceWide}))){
      throw Object.assign(new Error('Вы не управляете этим подразделением'),{code:'ORG_UNIT_FORBIDDEN',statusCode:403,expose:true});
    }
    return unitId;
  };

  /**
   * Кого позвали и кто ещё не пришёл.
   *
   * Видит тот же, кто и зовёт: это общая очередь, и главное, ради чего
   * её показывают, — не позвать человека дважды.
   */
  if(method==='GET'&&path==='/api/v1/invitations'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MEMBER_INVITE);
    json(res,200,{items:await store.listPendingInvitations(s)});return true;
  }

  /**
   * Отозвать приглашение.
   *
   * Отзывает тот, кто позвал, или тот, кто распоряжается составом
   * компании: человек мог передумать увольняться, а ссылка живёт неделю.
   */
  if(method==='DELETE'&&/^\/api\/v1\/invitations\/[0-9a-f-]{36}$/i.test(path)){
    const s=await requireSession(req);requirePermission(s.role,Permission.MEMBER_INVITE);
    const id=path.split('/').pop();
    const mayManage=(ctx.permissions(s.role)??[]).includes(Permission.MEMBER_MANAGE);
    const{rows}=await store.pool.query("SELECT invited_by FROM workspace_invitations WHERE workspace_id=$1 AND id=$2 AND status='pending'",[s.workspaceId,id]);
    if(!rows.length)throw Object.assign(new Error('Приглашение не найдено'),{code:'INVITATION_NOT_FOUND',statusCode:404,expose:true});
    if(!mayManage&&rows[0].invited_by!==s.userId){
      throw Object.assign(new Error('Отозвать может тот, кто позвал'),{code:'NOT_YOUR_INVITATION',statusCode:403,expose:true});
    }
    await store.revokeInvitation(s,id);
    noContent(res);return true;
  }

  if(method==='POST'&&path==='/api/v1/invitations/bulk'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MEMBER_INVITE);
    const b=await readJson(req);
    const rows=Array.isArray(b.items)?b.items:[];
    if(!rows.length)throw Object.assign(new Error('Список пуст'),{code:'EMPTY_INVITE_LIST',statusCode:400,expose:true});
    if(rows.length>200)throw Object.assign(new Error('За один раз не больше 200 строк'),{code:'INVITE_LIST_TOO_LONG',statusCode:400,expose:true});
    const RANK={guest:0,member:1,manager:2,admin:3,owner:4};
    const mine=RANK[s.role??'member'];
    const seen=new Set();
    const results=[];
    // Список обычно приносят целиком — вместе с теми, кто уже здесь. Это
    // не ошибка, и звать их заново незачем: просто отмечаем строку.
    const already=new Set((await store.listPeople(s)).map(p=>normalizeEmail(p.email??'')).filter(Boolean));
    // Подразделения из третьего столбца ищем по имени: в таблице у
    // человека написано «Отдел аналитики», а не идентификатор.
    const units=ctx.org?await ctx.org.listUnits(s):[];
    const unitByName=new Map(units.map(u=>[String(u.name).trim().toLowerCase(),u.id]));
    const unitAllowed=new Map();
    // Домен компании: адрес не на нём — повод присмотреться, а не отказ.
    const domain=String((await store.findCompanyDomain?.(s.organizationId))??'').toLowerCase()||null;
    for(const row of rows){
      const raw=String(row?.email??'').trim();
      const role=row?.role??'member';
      // Разбор адреса не должен ронять весь список: строка с опечаткой —
      // это строка с опечаткой, а не отказ пригласить остальных.
      let email=null;
      try{email=normalizeEmail(raw)}catch{email=null}
      if(!email){results.push({email:raw,status:'invalid_email'});continue}
      if(seen.has(email)){results.push({email,status:'duplicate'});continue}
      seen.add(email);
      if(already.has(email)){results.push({email,status:'already',role});continue}
      if(!(role in RANK)||role==='owner'){results.push({email,status:'invalid_role',role});continue}
      if(RANK[role]>mine){results.push({email,status:'role_too_high',role});continue}
      const foreignDomain=Boolean(domain&&role!=='guest'&&!email.endsWith('@'+domain));
      let unitId=null;
      const unitName=String(row?.unit??'').trim();
      if(unitName&&role!=='guest'){
        unitId=unitByName.get(unitName.toLowerCase())??null;
        if(!unitId){results.push({email,status:'unknown_unit',role,unit:unitName});continue}
        if(!unitAllowed.has(unitId)){
          try{await unitForInvite(s,unitId);unitAllowed.set(unitId,true)}
          catch{unitAllowed.set(unitId,false)}
        }
        if(!unitAllowed.get(unitId)){results.push({email,status:'unit_forbidden',role,unit:unitName});continue}
      }
      try{
        const token=createOpaqueToken();
        const invitation=await store.createInvitation(s,{email,role,tokenHash:hashToken(token),
          expiresAt:new Date(Date.now()+7*86400000).toISOString(),accessUntil:null,unitId});
        const inviteUrl=`${originOf(req)}/?invite=${encodeURIComponent(token)}`;
        const letter=invitationMail({workspaceName:s.workspaceName??'рабочее пространство',
          inviterName:s.displayName??s.email,role,url:inviteUrl,expiresAt:invitation.expiresAt});
        await post(ctx,{organizationId:s.organizationId,workspaceId:s.workspaceId,kind:'invitation',actorId:s.userId,
          to:invitation.email,subject:letter.subject,text:letter.text,html:letter.html,sourceId:invitation.id});
        results.push({email,status:'invited',role,inviteUrl,unit:unitName||undefined,foreignDomain:foreignDomain||undefined});
      }catch(error){
        // Уже в компании или уже приглашён — не беда и не повод рушить
        // весь список: так и пишем в строке.
        results.push({email,status:error?.code==='EMAIL_TAKEN'||error?.code==='ALREADY_INVITED'?'already':'failed',
          role,reason:error?.message??String(error)});
      }
    }
    const invited=results.filter(x=>x.status==='invited').length;
    json(res,201,{invited,total:results.length,results});return true;
  }

  if(method==='POST'&&path==='/api/v1/invitations'){
    const s=await requireSession(req);requirePermission(s.role,Permission.MEMBER_INVITE);const b=await readJson(req);
    const RANK={guest:0,member:1,manager:2,admin:3,owner:4};
    const wanted=b.role??'member';
    if(!(wanted in RANK)||wanted==='owner')throw Object.assign(new Error('Такой роли для приглашения нет'),{code:'INVALID_INVITE_ROLE',statusCode:400,expose:true});
    if(RANK[wanted]>RANK[s.role??'member'])throw Object.assign(new Error('Нельзя пригласить человека с правами выше своих'),{code:'INVITE_ROLE_TOO_HIGH',statusCode:403,expose:true});
        // Срок доступа: приглашённый представитель заказчика не должен
    // оставаться в чужом пространстве навсегда. Для сотрудника срок по
    // умолчанию не ставится — он здесь работает.
    let accessUntil=null;
    if(b.accessUntil){
      const at=new Date(b.accessUntil);
      if(Number.isNaN(at.getTime()))throw Object.assign(new Error('Invalid date'),{code:'INVALID_DATE',statusCode:400,expose:true});
      if(at.getTime()<=Date.now())throw Object.assign(new Error('Срок доступа должен быть в будущем'),{code:'ACCESS_UNTIL_IN_PAST',statusCode:400,expose:true});
      accessUntil=at.toISOString();
    }
    // Гостя в оргструктуру не ставят: он чужой сотрудник, и схема
    // компании врала бы про то, кто здесь работает.
    const unitId=wanted==='guest'?null:await unitForInvite(s,b.unitId??null);
    const token=createOpaqueToken(),i=await store.createInvitation(s,{email:normalizeEmail(b.email),role:wanted,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+7*86400000).toISOString(),accessUntil,unitId});
    const inviteUrl=`${originOf(req)}/?invite=${encodeURIComponent(token)}`;
    const letter=invitationMail({workspaceName:s.workspaceName??'рабочее пространство',inviterName:s.displayName??s.email,role:wanted,url:inviteUrl,expiresAt:i.expiresAt});
    const delivery=await post(ctx,{organizationId:s.organizationId,workspaceId:s.workspaceId,kind:'invitation',actorId:s.userId,
      to:i.email,subject:letter.subject,text:letter.text,html:letter.html,sourceId:i.id});
    // Ссылка остаётся в ответе и когда письмо ушло: пригласивший часто
    // отправляет её сам, а до почты она может идти минуту.
    json(res,201,{invitation:{...i,inviteUrl},mail:delivery});return true;
  }
  return false;
}

/**
 * «Подтвердите паролем».
 *
 * Сеанс бывает украден, и для шагов, которые снимают защиту, одного
 * сеанса мало. Ограничение то же, что и у смены пароля: иначе здесь
 * появляется новое место для подбора.
 */
async function requirePasswordOf(ctx,session,password,{address,identity,authThrottle}){
  const {store}=ctx;
  if(!store.findAuthByEmail||!session.email){
    throw Object.assign(new Error('Подтверждение паролем недоступно'),{code:'PASSWORD_UNAVAILABLE',statusCode:503,expose:true});
  }
  authThrottle?.guard('password',{address,identity});
  const auth=await store.findAuthByEmail(normalizeEmail(session.email));
  if(!auth||!verifyPassword(String(password??''),auth.passwordSalt,auth.passwordHash)){
    throw Object.assign(new Error('Пароль не подошёл'),{code:'WRONG_PASSWORD',statusCode:403,expose:true});
  }
  authThrottle?.succeeded('password',{address,identity});
}
