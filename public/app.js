const S={view:'today',boot:null,voice:null,highlights:new Map(),notes:new Map(),favourites:new Set(),conversations:[],people:[],tasks:[],calendar:[],selected:null,messages:new Map(),messageCursor:new Map(),unreadFrom:new Map(),readUpTo:new Map(),invitations:[],loadingOlder:false,keepScroll:null,ws:null,mobileChat:false,reply:null,recorder:null,recordingAt:0,chatFilter:'all',gameFrom:null,gameWatch:null,labels:null,plan:[],planFilter:'open',labelsUnavailable:false,planUnavailable:false};
const $=(q,r=document)=>r.querySelector(q),$$=(q,r=document)=>[...r.querySelectorAll(q)];
const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
// Stroke icons on currentColor: the nav sits on both themes and the glyphs it
// used before ('●' for messages, '□' for calendar) named nothing.
const svg=(body)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const navIcon={
  today:svg('<path d="M3.6 10.4 12 3.8l8.4 6.6"/><path d="M5.6 9.2V19a1.2 1.2 0 0 0 1.2 1.2h10.4a1.2 1.2 0 0 0 1.2-1.2V9.2"/><path d="M9.8 20.2v-5.4h4.4v5.4"/>'),
  chats:svg('<path d="M20.2 12.4c0 3.9-3.7 7-8.2 7a9.4 9.4 0 0 1-2.6-.35L4.4 20.4l1.2-3.5A6.6 6.6 0 0 1 3.8 12.4c0-3.9 3.7-7 8.2-7s8.2 3.1 8.2 7Z"/>'),
  tasks:svg('<path d="M4.6 6.6h6.2M4.6 12h6.2M4.6 17.4h6.2"/><path d="m14.4 6.2 1.9 1.9 3.5-3.5"/><path d="m14.4 15.6 1.9 1.9 3.5-3.5"/>'),
  calendar:svg('<rect x="3.6" y="5.2" width="16.8" height="15.2" rx="2.4"/><path d="M3.6 10h16.8M8.4 3.6v3.2M15.6 3.6v3.2"/>'),
  more:svg('<circle cx="5.4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.6" cy="12" r="1.5" fill="currentColor" stroke="none"/>'),
};
const msgIcon={
  star:svg('<path d="M12 4.2l2.4 5 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 10l5.4-.8Z"/>'),
  marker:svg('<path d="M14.4 4.6 19.4 9.6 10.6 18.4H5.6v-5Z"/><path d="m12.6 6.4 5 5"/><path d="M4.4 20.4h6"/>'),
  note:svg('<path d="M6.4 3.8h8.2l4 4v12.4H6.4Z"/><path d="M14.6 3.8v4h4"/><path d="M9.2 12.4h6M9.2 15.6h4"/>'),
  react:svg('<circle cx="12" cy="12" r="8.2"/><path d="M8.8 14.4a4 4 0 0 0 6.4 0"/><path d="M9.2 9.6h.01M14.8 9.6h.01"/>'),
  reply:svg('<path d="M9.6 6.4 4.8 11l4.8 4.6"/><path d="M4.8 11h8.6a5.6 5.6 0 0 1 5.6 5.6v1"/>'),
  more:svg('<circle cx="5.4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.6" cy="12" r="1.5" fill="currentColor" stroke="none"/>'),
  forward:svg('<path d="m14.4 6.4 4.8 4.6-4.8 4.6"/><path d="M19.2 11h-8.6A5.6 5.6 0 0 0 5 16.6v1"/>'),
  pin:svg('<path d="M9.4 3.6h5.2l-.6 5 3 3.2-.9 1.4H8.9L8 11.8l3-3.2Z"/><path d="M12 13.2v7.2"/>'),
  edit:svg('<path d="M14.6 5.4 18.6 9.4 9 19H5v-4Z"/><path d="m13.2 6.8 4 4"/>'),
  trash:svg('<path d="M5.4 7.2h13.2"/><path d="M9.6 7.2V5.4h4.8v1.8"/><path d="M7.2 7.2 8 19.4a1.2 1.2 0 0 0 1.2 1.1h5.6a1.2 1.2 0 0 0 1.2-1.1l.8-12.2"/>'),
  task:svg('<rect x="4.6" y="4.6" width="14.8" height="14.8" rx="3"/><path d="m8.6 12 2.4 2.4 4.4-4.8"/>'),
};
const roomIcon={
  channel:svg('<path d="M9.4 4.2 7.8 19.8M16.2 4.2l-1.6 15.6"/><path d="M4.6 9h15.2M3.8 14.6H19"/>'),
  pins:svg('<path d="M9.4 3.6h5.2l-.6 5 3 3.2-.9 1.4H8.9L8 11.8l3-3.2Z"/><path d="M12 13.2v7.2"/>'),
  muted:svg('<path d="M6.6 10.4a5.4 5.4 0 0 1 8.2-4.6"/><path d="M17.4 12.2c0 3.2 1.2 4.6 1.2 4.6H7.4"/><path d="M4.6 4.6 19.4 19.4"/><path d="M10.2 19a2 2 0 0 0 3.6 0"/>'),
  bell:svg('<path d="M6.6 10.4a5.4 5.4 0 1 1 10.8 0c0 4 1.4 5.6 1.4 5.6H5.2s1.4-1.6 1.4-5.6Z"/><path d="M10.2 19a2 2 0 0 0 3.6 0"/>'),
  video:svg('<rect x="3.4" y="6.4" width="12" height="11.2" rx="2.2"/><path d="m15.4 11.2 5.2-2.8v7.2l-5.2-2.8Z"/>'),
  back:svg('<path d="M14.4 5.6 8 12l6.4 6.4"/>'),
};
const tileIcon={
  meetings:svg('<circle cx="12" cy="12" r="8.2"/><path d="M12 7.6V12l2.8 1.8"/>'),
  saved:svg('<path d="M7 4.6h10a1.4 1.4 0 0 1 1.4 1.4v13.4L12 16l-6.4 3.4V6A1.4 1.4 0 0 1 7 4.6Z"/>'),
  archive:svg('<rect x="3.6" y="5" width="16.8" height="4" rx="1.2"/><path d="M5.4 9v9.4a1.6 1.6 0 0 0 1.6 1.6h10a1.6 1.6 0 0 0 1.6-1.6V9"/><path d="M10 13h4"/>'),
  team:svg('<circle cx="9.4" cy="9" r="3.2"/><path d="M3.8 19.4c0-3 2.5-5 5.6-5s5.6 2 5.6 5"/><path d="M16.2 6.2a3 3 0 0 1 0 5.8"/><path d="M17.6 14.8c1.7.6 2.8 2 2.8 4"/>'),
  org:svg('<rect x="9.2" y="3.4" width="5.6" height="4.4" rx="1.2"/><rect x="3.2" y="16.2" width="5.6" height="4.4" rx="1.2"/><rect x="15.2" y="16.2" width="5.6" height="4.4" rx="1.2"/><path d="M12 7.8v4.4M6 16.2v-2.2h12v2.2"/>'),
  presence:svg('<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'),
  games:svg('<path d="M8.4 4.6h7.2l-1 3.4H9.4Z"/><path d="M9.4 8h5.2l1.2 5.6H8.2Z"/><path d="M7.4 13.6h9.2l1 5.8H6.4Z"/>'),
  contacts:svg('<rect x="4.4" y="3.6" width="15.2" height="16.8" rx="2.4"/><circle cx="12" cy="10" r="2.6"/><path d="M8 17.2c.6-1.8 2.1-2.8 4-2.8s3.4 1 4 2.8"/>'),
  vault:svg('<circle cx="9.6" cy="11" r="3.4"/><path d="M12.6 12.4h7.8v3"/><path d="M17.4 12.4v2.6"/>'),
  reminders:svg('<circle cx="12" cy="13" r="7.4"/><path d="M12 9.4V13l2.4 1.6"/><path d="m5.6 4.6 2.8 2M18.4 4.6l-2.8 2"/>'),
  plan:svg('<path d="m4.6 12.6 3.2 3.2 7.6-8.4"/><path d="M12.6 16.6h6.8"/><path d="M4.6 19.4h14.8"/>'),
  journal:svg('<path d="M5.6 4.4h9.2l4 4v11.2a1.2 1.2 0 0 1-1.2 1.2H5.6a1.2 1.2 0 0 1-1.2-1.2V5.6a1.2 1.2 0 0 1 1.2-1.2Z"/><path d="M14.4 4.4v4.4h4"/><path d="M8 12.6h7M8 16h5"/>'),
  labels:svg('<path d="M4.4 10.6V5.6a1.2 1.2 0 0 1 1.2-1.2h5l9 9-6.2 6.2-9-9Z"/><circle cx="8.6" cy="8.6" r="1.2" fill="currentColor" stroke="none"/>'),
  invite:svg('<circle cx="9.6" cy="8.8" r="3.4"/><path d="M3.8 19.4c0-3.1 2.6-5.2 5.8-5.2 1.3 0 2.5.35 3.4.95"/><path d="M17.4 13.6v6M14.4 16.6h6"/>'),
  files:svg('<path d="M6.4 3.8h7l4.2 4.2v12.2H6.4Z"/><path d="M13.2 3.8V8h4.4"/>'),
  calls:svg('<path d="M7.2 4.6h3l1.4 3.6-2 1.4a10.4 10.4 0 0 0 4.8 4.8l1.4-2 3.6 1.4v3a1.6 1.6 0 0 1-1.7 1.6C11 18 6 13 5.6 6.3a1.6 1.6 0 0 1 1.6-1.7Z"/>'),
  notifications:svg('<path d="M6.6 10.4a5.4 5.4 0 1 1 10.8 0c0 4 1.4 5.6 1.4 5.6H5.2s1.4-1.6 1.4-5.6Z"/><path d="M10.2 19a2 2 0 0 0 3.6 0"/>'),
  settings:svg('<circle cx="12" cy="12" r="3"/><path d="M19.2 14.2a1.4 1.4 0 0 0 .3 1.5l.1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.4 1.4 0 0 0-2.4 1v.3a1.7 1.7 0 1 1-3.4 0v-.2a1.4 1.4 0 0 0-2.4-1l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.4 1.4 0 0 0-1-2.4h-.3a1.7 1.7 0 1 1 0-3.4h.2a1.4 1.4 0 0 0 1-2.4l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.4 1.4 0 0 0 2.4-1v-.3a1.7 1.7 0 1 1 3.4 0v.2a1.4 1.4 0 0 0 2.4 1l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.4 1.4 0 0 0 1 2.4h.2a1.7 1.7 0 1 1 0 3.4h-.3a1.4 1.4 0 0 0-1.3.9Z"/>'),
};
const nav=[['today',navIcon.today,'Сегодня'],['chats',navIcon.chats,'Сообщения'],['tasks',navIcon.tasks,'Задачи'],['calendar',navIcon.calendar,'Календарь'],['more',navIcon.more,'Ещё']];
// Обязательство берёт на себя сотрудник компании. Гость — представитель
// заказчика: предлагать его ответственным значит обещать то, чего сервер
// не позволит, и заодно показывать чужим людям штат.
const colleagues=()=>S.people.filter(p=>p.role!=='guest'&&p.active!==false);
const me=()=>S.boot?.session,can=permission=>(S.boot?.permissions||[]).includes(permission),person=id=>S.people.find(p=>p.userId===id),name=id=>person(id)?.displayName||person(id)?.email||(id===me()?.userId?me()?.displayName:'Сотрудник');
const initials=(v='?')=>v.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join('')||'?';
const time=v=>v?new Intl.DateTimeFormat('ru',{hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'',dateTime=v=>v?new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'Без срока';
/**
 * The API answers in English — it is a contract, read by integrations as well
 * as by this screen. A refusal shown to a person should be a sentence in the
 * interface language that says what to do next, not the contract's wording:
 * «Conversation must keep at least one owner» told somebody trying to leave a
 * room neither what went wrong nor how to get out.
 *
 * Only codes a person can actually act on are here. Anything else keeps the
 * server's own words rather than being paraphrased into vagueness.
 */
const ERROR_MESSAGE={
  LAST_CONVERSATION_OWNER:'Вы единственный владелец беседы. Сначала назначьте владельцем кого-то ещё в списке участников.',
  MEDIA_PROVIDER_UNAVAILABLE:'Звонки на этом сервере ещё не подключены.',
  NOT_A_MEMBER:'Вы видите этот канал по его открытости — выходить не из чего, уберите его в архив.',
  DIRECT_CANNOT_LEAVE:'Личный диалог нельзя покинуть — его можно убрать в архив.',
  CONVERSATION_HAS_OWNER:'У беседы уже есть владелец — забирать её не нужно.',
  DIRECT_MEMBERSHIP_IMMUTABLE:'Состав личного диалога изменить нельзя.',
  DIRECT_NOT_EDITABLE:'У личного диалога нет настроек.',
  GUEST_NOT_IN_OPEN_ROOM:'Внешнего участника нельзя добавить в канал для всей компании. Создайте для него отдельную комнату.',
  GUEST_CANNOT_HOLD_TASK:'Задачу нельзя поручить внешнему участнику: он её не увидит.',
  GUEST_CANNOT_OWN_ROOM:'Внешний участник не может управлять беседой.',
  ANNOUNCEMENT_ONLY:'В этом канале публикуют только владелец, модераторы и управляющие каналами.',
  SEAT_LIMIT_REACHED:'В подразделении не осталось свободных мест. Увеличьте штат или выберите другое.',
  SEAT_LIMIT_BELOW_HEADCOUNT:'В подразделении уже больше людей, чем вы оставляете мест.',
  HEAD_NOT_IN_UNIT:'Руководителем можно назначить только того, кто состоит в подразделении.',
  ORG_DEPTH_EXCEEDED:'Глубже шести уровней вложенности структура не строится.',
  ORG_CYCLE:'Подразделение нельзя перенести внутрь самого себя.',
  ORG_UNIT_FORBIDDEN:'Это подразделение вне вашей ветки.',
  NOT_WORKSPACE_STAFF:'В штатную структуру входят только сотрудники компании.',
  STALE_TASK_ACTION:'Задачу изменили, пока экран был открыт. Откройте её заново.',
  TASK_REASON_REQUIRED:'Нужна причина — её сохранят в истории задачи.',
  TASK_EVIDENCE_REQUIRED:'Сначала приложите доказательство выполнения.',
  TASK_ACTION_FORBIDDEN:'Это действие доступно другому участнику задачи.',
  TASK_TERMINAL:'Задача закрыта — её больше нельзя менять.',
  TASK_NOTHING_TO_CHANGE:'Выберите другого человека.',
  INVALID_EVIDENCE_VALUE:'Значение не подходит к выбранному типу доказательства.',
  RESET_EXPIRED:'Срок действия ссылки истёк. Попросите администратора выписать новую.',
  RESET_NOT_FOUND:'Эта ссылка уже использована или отозвана.',
  WEAK_PASSWORD:'Пароль должен быть не короче 12 символов и содержать цифру.',
  INVALID_CURSOR:'Не удалось продолжить список. Откройте экран заново.',
  OPPONENT_NOT_HERE:'Этого человека нет в выбранной беседе.',
  NO_SHARED_ROOM:'У вас нет общей беседы — напишите человеку, и партию будет где играть.',
  GAME_ALREADY_RUNNING:'С этим человеком уже идёт партия в эту игру. Закончите её или сдайтесь.',
  NOT_YOUR_TURN:'Сейчас ходит соперник.',
  ILLEGAL_MOVE:'Так сходить нельзя.',
  INVALID_FLEET:'Флот расставлен не по правилам.',
  ALREADY_FIRED:'Вы уже стреляли в эту клетку.',
  NOT_A_PLAYER:'Вы не играете в этой партии.',
  LABEL_NOT_FOUND:'Метка недоступна.',
  TARGET_NOT_FOUND:'Объект недоступен.',
};

/**
 * Один вызов к серверу.
 *
 * Изменяющие запросы уходят с Idempotency-Key: сервер умеет отличать
 * повтор от нового действия с самого начала, а клиент ключа не посылал —
 * и оборванная сеть превращала одно нажатие в две задачи или два перевода
 * владения. Ключ живёт на попытку и переживает единственный автоповтор:
 * когда запрос не доехал, мы не знаем, выполнился он или нет, и повторяем
 * тем же ключом — второй раз сервер ничего не создаст, а вернёт первый
 * ответ.
 */
const WRITE_METHODS=new Set(['POST','PATCH','PUT','DELETE']);
async function api(path,o={}){
  const method=(o.method||'GET').toUpperCase();
  const headers={...(typeof o.body==='string'?{'content-type':'application/json'}:{}),...(o.headers||{})};
  if(WRITE_METHODS.has(method)&&!headers['idempotency-key']&&!headers['Idempotency-Key']){
    headers['Idempotency-Key']=o.idempotencyKey??(crypto.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }
  const send=()=>fetch(path,{credentials:'same-origin',...o,headers});
  let r;
  try{r=await send()}
  catch(networkError){
    if(!WRITE_METHODS.has(method))throw networkError;
    // Сеть моргнула: тем же ключом повтор безопасен.
    try{r=await send()}catch{throw networkError}
  }
  if(r.status===204)return null;
  const p=(r.headers.get('content-type')||'').includes('json')?await r.json():await r.text();
  if(!r.ok){
    const code=p?.error?.code;
    const e=new Error(ERROR_MESSAGE[code]||p?.error?.message||`HTTP ${r.status}`);
    e.status=r.status;e.code=code;e.serverMessage=p?.error?.message;throw e;
  }
  return p;
}

function toast(t){const n=document.createElement('div');n.className='toast';n.textContent=t;$('#toast-root').append(n);setTimeout(()=>n.remove(),2400)}
function auth(mode='login'){
  $('#app-view').hidden=true;$('#auth-view').hidden=false;
  const params=new URLSearchParams(location.search);
  const token=params.get('invite'),reset=params.get('reset');
  if(token){
    $('.segmented').hidden=true;$('#login-form').hidden=$('#register-form').hidden=true;
    $('#reset-password-form').hidden=true;
    $('#accept-invite-form').hidden=false;$('#accept-invite-form').dataset.token=token;
    $('#auth-title').textContent='Присоединиться к компании';
    bindAuthExtras();
    return;
  }
  // A recovery link is the third way through this screen, beside signing in
  // and registering a company.
  if(reset){
    $('.segmented').hidden=true;$('#login-form').hidden=$('#register-form').hidden=true;
    $('#accept-invite-form').hidden=true;
    $('#reset-password-form').hidden=false;$('#reset-password-form').dataset.token=reset;
    $('#auth-title').textContent='Новый пароль';
    $('#auth-help').hidden=true;
    bindAuthExtras();
    return;
  }
  setAuth(mode);
  bindAuthExtras();
}
function bindAuthExtras(){
  const forgot=$('[data-forgot]');
  if(forgot)forgot.onclick=forgotPasswordModal;
  const form=$('#reset-password-form');
  if(form)form.onsubmit=async(event)=>{
    event.preventDefault();
    const password=new FormData(event.currentTarget).get('password');
    try{
      await api('/api/v1/password-resets/redeem',{method:'POST',body:JSON.stringify({token:form.dataset.token,password})});
      // The new password is set but no session was handed out: signing in
      // with it is the proof it reached the right person.
      history.replaceState(null,'',location.pathname);
      $('#reset-password-form').hidden=true;$('#auth-help').hidden=false;
      setAuth('login');
      $('#auth-title').textContent='Войти в компанию';
      toast('Пароль изменён — войдите с новым');
    }catch(error){$('#auth-error').textContent=error.message}
  };
}

function setAuth(mode){$('.segmented').hidden=false;$('#accept-invite-form').hidden=true;$('#login-form').hidden=mode!=='login';$('#register-form').hidden=mode!=='register';$('#auth-title').textContent=mode==='login'?'Войти в компанию':'Создать компанию';$$('[data-auth-mode]').forEach(b=>b.classList.toggle('active',b.dataset.authMode===mode));$('#auth-error').textContent=''}
/**
 * Recovery has no mail channel, so the person who forgot asks the one party
 * who already knows who works here. Saying so beats an empty screen: before
 * this there was no «forgot» affordance at all.
 */
function forgotPasswordModal(){
  modal('Забыли пароль?',`
    <p class="muted">Ссылку на смену пароля выписывает владелец или администратор компании: почтовый канал у рабочего пространства не настроен, и отправить письмо некому.</p>
    <p class="muted" style="margin-top:10px">Напишите администратору любым доступным способом — он откроет вашу карточку в разделе «Команда» и создаст ссылку. Она живёт сутки и срабатывает один раз.</p>
    <button data-close-help class="button secondary" style="width:100%;margin-top:14px">Понятно</button>`,()=>{
    $('[data-close-help]').onclick=closeModal;
  });
}

async function bootstrap(){try{const b=await api('/api/v1/bootstrap');S.boot=b;S.conversations=b.conversations||[];S.people=b.people||[];S.selected=S.selected||S.conversations[0]?.id||null;await Promise.all([loadTasks(),loadCalendar(),loadInvitations(),loadPlan(),loadLabelTargets().catch(()=>{}),loadMarks()]);$('#auth-view').hidden=true;$('#app-view').hidden=false;shell();render();startClock();connect();await routeFromHash()}catch(e){if(e.status===401)auth();else{auth();$('#auth-error').textContent=e.message}}}
/**
 * Адрес страницы и то, что на ней видно, — одно и то же.
 *
 * Раньше в адресе жили только задача и беседа по прямой ссылке, а сам
 * раздел нигде не отражался: перезагрузка неизменно возвращала на
 * «Сегодня», кнопка «назад» уводила из приложения, а ссылку на календарь
 * коллеге было не дать.
 */
const VIEWS=new Set(nav.map(([id])=>id));
async function routeFromHash(){
  if(!S.boot)return;
  const raw=location.hash.replace(/^#\/?/,''),[pathPart,query='']=raw.split('?');
  const parts=pathPart.split('/').filter(Boolean),params=new URLSearchParams(query);
  if(parts[0]==='tasks'&&parts[1]){S.view='tasks';render();await openTask(parts[1]);return}
  if(parts[0]==='chats'&&parts[1]){await openChatAtMessage(parts[1],params.get('message'));return}
  if(parts[0]&&VIEWS.has(parts[0])){if(S.view!==parts[0])go(parts[0],{silent:true});return}
  if(!parts.length&&S.view!=='today')go('today',{silent:true});
}
window.addEventListener('hashchange',()=>{routeFromHash().catch(e=>toast(e.message))});
// The task list is paged now. The screen still shows one backlog, so it walks
// the cursor to the end — bounded, so a runaway cursor cannot spin forever.
async function loadTasks(){
  try{
    const items=[];let cursor=null,pages=0;
    do{
      const page=await api(`/api/v1/tasks?limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);
      items.push(...(page.items||[]));
      cursor=page.nextCursor||null;
    }while(cursor&&++pages<20);
    S.tasks=items;
  }catch{}
}
async function loadCalendar(){await loadCalendarRange()}

/**
 * Встречи, которые ждут ответа именно от вас.
 *
 * Сервер считал их с самого начала — и никто не спрашивал: приглашение
 * замечали, только наткнувшись на встречу в сетке календаря. Ответ на
 * приглашение — самое срочное, что может быть в рабочем дне: от него
 * зависит чужое расписание.
 */
async function loadInvitations(){
  try{S.invitations=(await api('/api/v1/calendar-invitations')).items||[]}
  catch{S.invitations=[]}
}
async function loadMessages(id){
  if(!id||S.messages.has(id))return;
  const page=await api(`/api/v1/conversations/${id}/messages`);
  S.messages.set(id,page.items||[]);
  S.messageCursor.set(id,page.nextCursor||null);
}

/**
 * Переписка глубже первой сотни сообщений была недостижима: сервер честно
 * отдавал курсор на следующую страницу, а клиент его выбрасывал. Договор
 * трёхмесячной давности в рабочем чате было нельзя ни найти, ни дочитать.
 *
 * Прокрутка вверх подгружает предыдущую страницу и удерживает то же место:
 * лента не прыгает под руками — ровно то, чего ждёшь от любого мессенджера.
 */
async function loadOlderMessages(id){
  const cursor=S.messageCursor.get(id);
  if(!cursor||S.loadingOlder)return;
  S.loadingOlder=true;
  const stream=$('#message-stream');
  const anchor=stream?{height:stream.scrollHeight,top:stream.scrollTop}:null;
  try{
    const page=await api(`/api/v1/conversations/${id}/messages?before=${encodeURIComponent(cursor)}`);
    const older=page.items||[];
    S.messageCursor.set(id,page.nextCursor||null);
    if(older.length){
      S.messages.set(id,[...older,...(S.messages.get(id)||[])]);
      S.keepScroll=anchor;
      render();
    }
  }catch(error){toast(error.message)}
  finally{S.loadingOlder=false}
}
function shell(){const s=me();$('#profile-card').innerHTML=`<span class="avatar dark">${esc(initials(s.displayName))}</span><span><strong>${esc(s.displayName)}</strong><small>${esc(s.role)}</small></span><span class="presence-dot online"></span>`;$('#top-avatar').textContent=initials(s.displayName);
  // Both of these carry a chevron and a press animation, so they promise an
  // action; neither had a handler of any kind.
  $('#profile-card').onclick=()=>personPage(me().userId);
  navs();lists()}

/** What the workspace actually is, since the switcher implies there is more than one. */
function navs(){const html=nav.map(([id,i,l])=>`<button class="nav-item pressable ${S.view===id?'active':''}" data-nav="${id}"${S.view===id?' aria-current="page"':''}><span class="nav-icon">${i}</span><span>${l}</span></button>`).join('');$('#desktop-nav').innerHTML=$('#mobile-nav').innerHTML=html}
function lists(){const channels=S.conversations.filter(c=>['channel','team','project'].includes(c.kind)),dm=S.conversations.filter(c=>['direct','group'].includes(c.kind));$('#channel-list').innerHTML=channels.map(c=>side(c,'#')).join('');$('#direct-list').innerHTML=dm.map(c=>side(c,'')).join('')}
function side(c,prefix){return `<button class="sidebar-row pressable ${S.selected===c.id?'active':''}" data-conversation="${c.id}"><span>${prefix||'<span class="presence-dot online"></span>'}</span><span class="label">${esc(c.title||'Диалог')}</span></button>`}
function render(){navs();lists();$('#screen-title').textContent=nav.find(x=>x[0]===S.view)?.[2]||'Chat';$('#screen').innerHTML=({today,chats,tasks,calendar,more})[S.view]();bind();bindCalendar()}
function today(){const active=S.tasks.filter(t=>!['closed','accepted_result','cancelled'].includes(t.status));
  const dayStart=new Date();dayStart.setHours(0,0,0,0);
  const dayEnd=new Date(dayStart);dayEnd.setDate(dayEnd.getDate()+1);
  const byStart=(a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt);
  const todays=S.calendar.filter(e=>{const t=Date.parse(e.startAt);return t>=dayStart.getTime()&&t<dayEnd.getTime()}).sort(byStart);
  const later=S.calendar.filter(e=>Date.parse(e.startAt)>=dayEnd.getTime()).sort(byStart);
  const events=(todays.length?todays:later).slice(0,4);
  const agendaTitle=todays.length||!later.length?'Расписание дня':'Ближайшие встречи';
  const agendaHint=todays.length?'Встречи и рабочее время':later.length?'Сегодня встреч нет':'Встречи и рабочее время';return `<div class="page-grid"><div class="stack"><section class="surface greeting"><p class="kicker" id="now-line" data-prefs-owned>${esc(nowLine())}</p><h2><span id="greeting-word">${greetingFor(new Date())}</span>, ${esc((me().displayName||'').split(' ')[0])}</h2><form class="quick-bar" data-quick-form><input name="quick" placeholder="Сообщение, задача или встреча…" aria-label="Быстрый захват"><button type="submit" class="button primary small pressable">Создать</button></form></section>${S.invitations.length?`<section class="surface"><div class="section-head"><div><h2>Ждут вашего ответа</h2><p class="muted">${S.invitations.length} ${plural(S.invitations.length,'приглашение','приглашения','приглашений')} на встречу</p></div></div>${S.invitations.map(i=>`<div class="agenda-row"><span class="agenda-time">${time(i.startAt)}</span><span><div class="row-title">${esc(i.title)}</div><div class="row-sub">${esc(new Date(i.startAt).toLocaleDateString('ru-RU',{day:'numeric',month:'long'}))}${i.organiser?` · ${esc(i.organiser)}`:''}</div></span><span class="inline-actions">${[['accepted','Приду'],['tentative','Под вопросом'],['declined','Не приду']].map(([value,caption])=>`<button class="button small ${value==='accepted'?'primary':'secondary'} pressable" data-invite-answer="${value}" data-invite-event="${esc(i.id)}">${caption}</button>`).join('')}</span></div>`).join('')}</section>`:''}<section class="surface"><div class="section-head"><div><h2>${esc(agendaTitle)}</h2><p class="muted">${esc(agendaHint)}</p></div>${can('calendar.create')?'<button data-action="event" class="button secondary small pressable">＋ Событие</button>':''}</div>${events.length?events.map(e=>`<button type="button" class="agenda-row pressable" data-cal-event="${esc(e.id)}" style="width:100%;text-align:left"><span class="agenda-time">${time(e.startAt)}</span><span><div class="row-title">${esc(e.title)}</div><div class="row-sub">${esc([
      Date.parse(e.startAt)>=dayEnd.getTime()?new Date(e.startAt).toLocaleDateString(locale()==='en'?'en-GB':'ru-RU',{day:'numeric',month:'long'}):'',
      e.participantCount?`${e.participantCount} ${pluralIn(e.participantCount,['участник','участника','участников'],['participant','participants'])}`:'',
      e.needsMyAnswer?'нужен ответ':'',
    ].filter(Boolean).join(' · '))}</div></span><span class="chip warm">${e.kind==='meeting'?'Встреча':'В плане'}</span></button>`).join(''):'<div class="empty"><strong>Свободный день</strong>Добавьте встречу или фокус-время.</div>'}</section>${answerNeededSection()}<section class="surface"><div class="section-head"><h2>Мои задачи</h2>${can('task.create')?'<button data-action="task" class="button secondary small pressable">＋ Задача</button>':''}</div>${active.slice(0,5).map(taskRow).join('')||'<div class="empty"><strong>Задач пока нет</strong>Создайте задачу вручную или из сообщения.</div>'}</section>${planSection()}</div><div class="stack"><div class="metric-grid"><div class="metric-card"><strong>${active.length}</strong><span>${plural(active.length,'активная задача','активные задачи','активных задач')}</span></div><div class="metric-card"><strong>${S.people.length}</strong><span>${plural(S.people.length,'сотрудник','сотрудника','сотрудников')}</span></div><div class="metric-card"><strong>${S.conversations.length}</strong><span>${plural(S.conversations.length,'диалог','диалога','диалогов')}</span></div></div><section class="surface"><div class="section-head"><h3>Последние сообщения</h3></div>${S.conversations.slice(0,6).map(c=>convRow(c)).join('')||'<div class="empty">Создайте первый канал.</div>'}</section></div></div>`}
/**
 * The personal list, on the screen where the day is planned. A commitment
 * belongs to «Мои задачи» above; this is the work nobody promised to anybody.
 */
/**
 * «3 активных задач» is not Russian. The form depends on the number: one,
 * two-to-four, and the rest — with the teens taking the last form whatever
 * their last digit says.
 */
/** Какой язык выбран сейчас. Русский — умолчание. */
const locale=()=>window.ChatPreferences?.locale==='en'?'en':'ru';

/**
 * Короткие названия дней для месячной сетки.
 *
 * Были вписаны строками по-русски, и в английском календарь оставался
 * «Пн Вт Ср». Берём у самого браузера — заодно правильные сокращения.
 */
function weekdayNames(){
  const fmt=new Intl.DateTimeFormat(locale()==='en'?'en-GB':'ru-RU',{weekday:'short'});
  // 5 января 2026 — понедельник: неделя в продукте начинается с него.
  return Array.from({length:7},(unused,i)=>{
    const day=fmt.format(new Date(2026,0,5+i));
    return day.charAt(0).toUpperCase()+day.slice(1).replace(/\.$/,'');
  });
}

/**
 * Счётное существительное.
 *
 * В английском формы две, в русском три, и переводчик, работающий по
 * готовой строке, тут бессилен: «1 участник» он не превратит в
 * «1 participant», потому что строка собирается на лету. Поэтому формы
 * задаются обеими сторонами сразу.
 */
function pluralIn(n,ru,en){
  if(locale()==='en'){const count=Math.abs(Number(n)||0);return count===1?en[0]:en[1]}
  return plural(n,...ru);
}
function plural(n,one,few,many){
  const count=Math.abs(Number(n)||0),last=count%10,tail=count%100;
  if(tail>=11&&tail<=14)return many;
  if(last===1)return one;
  if(last>=2&&last<=4)return few;
  return many;
}

/**
 * Задачи, которые ждут решения именно этого человека.
 *
 * Задача рождается «предложенной»: пока ответственный её не принял,
 * работать по ней нельзя. Но нигде не было сказано, что от него требуется
 * действие — строка в общем списке выглядела как любая другая, и
 * обязательство подвисало на неопределённый срок. Новый сотрудник в
 * первый день тем более не догадывался, что «предложена» значит «ответь».
 */
function answerNeededSection(){
  const waiting=S.tasks.filter(t=>t.status==='proposed'&&t.ownerId===me()?.userId);
  const invitations=S.invitations?.length??0;
  if(!waiting.length)return '';
  return `<section class="surface"><div class="section-head"><div><h2>Требуется ваш ответ</h2>
      <p class="muted">${waiting.length} ${plural(waiting.length,'задача ждёт','задачи ждут','задач ждут')} вашего решения${invitations?' · и приглашения на встречи выше':''}</p></div></div>
    ${waiting.map(t=>`<div class="row"><span><div class="row-title">${esc(t.title)}</div>
      <div class="row-sub">${esc(name(t.requesterId))}${t.promisedAt?` · до ${esc(dateTime(t.promisedAt))}`:''}</div></span>
      <span class="inline-actions">
        <button class="button small primary pressable" data-answer-task="${esc(t.id)}" data-answer-to="accepted">Принять</button>
        <button class="button small secondary pressable" data-answer-task="${esc(t.id)}" data-answer-to="clarify">Уточнить</button>
      </span></div>`).join('')}</section>`;
}

function planSection(){
  if(S.planUnavailable)return '';
  const open=S.plan.filter(i=>i.status!=='done').slice(0,6);
  return `<section class="surface"><div class="section-head"><div><h2>Мои дела</h2><p class="muted">Личный список, вне обязательств перед другими</p></div>
    <button data-action="plan" class="button secondary small pressable">Все дела</button></div>
    ${open.length?`<div class="plan-list">${open.map(planRow).join('')}</div>`
      :'<div class="empty"><strong>Список пуст</strong>Запишите, что нужно не забыть.</div>'}
    <form class="quick-bar" data-plan-quick style="margin-top:10px">
      <input name="title" placeholder="Записать дело" aria-label="Новое дело" maxlength="240">
      <button type="submit" class="button secondary small pressable">Добавить</button>
    </form></section>`;
}
/**
 * «Доброе утро» at one in the morning was the old rule reading hours<12 and
 * counting the small hours as morning. Night gets its own greeting, and the
 * boundaries are the ones people actually use.
 */
function greetingFor(now=new Date()){
  const hour=now.getHours();
  if(hour<5)return 'Доброй ночи';
  if(hour<12)return 'Доброе утро';
  if(hour<18)return 'Добрый день';
  if(hour<23)return 'Добрый вечер';
  return 'Доброй ночи';
}

/**
 * The date with the time running under it. The element carries
 * data-prefs-owned so the translator leaves it alone: it changes every second,
 * and re-reading it through the dictionary each tick would be pure waste.
 * The locale is applied here instead.
 */
function nowLine(now=new Date()){
  const loc=window.ChatPreferences?.locale==='en'?'en':'ru';
  const day=new Intl.DateTimeFormat(loc,{weekday:'long',day:'numeric',month:'long'}).format(now);
  const clock=new Intl.DateTimeFormat(loc,{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now);
  return `${day} · ${clock}`.toUpperCase();
}

let clockTimer=null,lastGreeting=null;
function tickClock(){
  const line=document.getElementById('now-line');
  if(!line)return;
  const now=new Date();
  const text=nowLine(now);
  if(line.textContent!==text)line.textContent=text;
  // The word changes four times a day; writing it every second would wake the
  // translator for nothing.
  const word=greetingFor(now);
  const slot=document.getElementById('greeting-word');
  if(slot&&lastGreeting!==word){lastGreeting=word;slot.textContent=word}
}
function startClock(){
  if(clockTimer)return;
  tickClock();
  clockTimer=setInterval(tickClock,1000);
}

/**
 * A flat column mixed a company announcement feed, a project channel, a
 * working group and a private word with a colleague. They are read at
 * different moments, so the pane sorts by what a room is for.
 *
 * An announcement-only channel is a feed rather than a conversation: the
 * whole company reads it and almost nobody writes, which is a different thing
 * from a channel people work in.
 */
const CONVERSATION_GROUPS=[['all','Все'],['channel','Каналы'],['feed','Ленты'],['group','Группы'],['direct','Личные']];

function conversationGroup(c){
  if(c.kind==='direct')return 'direct';
  if(c.kind==='group'||c.kind==='external')return 'group';
  if(c.announcementOnly)return 'feed';
  return 'channel';
}

function visibleConversations(){
  const filter=S.chatFilter||'all';
  return filter==='all'?S.conversations:S.conversations.filter(c=>conversationGroup(c)===filter);
}

/**
 * Непрочитанное за вкладкой, чтобы фильтр не прятал новое.
 *
 * Сервер считает до сотни на беседу и дальше не идёт: разница между
 * пятьюстами и пятью тысячами непрочитанных человеку ничего не говорит, а
 * полный пересчёт при каждом входе стоил дорого. Показываем «99+».
 */
function countIn(key){
  const rooms=key==='all'?S.conversations:S.conversations.filter(c=>conversationGroup(c)===key);
  const total=rooms.reduce((n,c)=>n+(Number(c.unreadCount)||0),0);
  return total>99?'99+':total;
}

function convRow(c){return `<button class="conversation-card pressable" data-open="${c.id}"><span class="avatar dark">${c.kind==='channel'?'#':esc(initials(c.title||'D'))}</span><span><strong>${esc(c.title||'Диалог')}</strong><div class="preview">${c.lastMessage?esc(c.lastMessage.body||kindLabel(c.lastMessage.kind)):esc(c.purpose||'')}</div>${c.lastMessage||c.purpose?'':'<div class="preview preview-empty">Открыть разговор</div>'}</span><span class="time">${time(c.lastMessage?.createdAt)}</span></button>`}
const TASK_STATUS={proposed:'Ожидает принятия',accepted:'Принята',scheduled:'Запланирована',in_progress:'В работе',blocked:'Заблокирована',in_review:'На проверке',accepted_result:'Результат принят',closed:'Закрыта',rejected:'Отклонена',cancelled:'Отменена',deferred:'Отложена',clarify:'Нужно уточнение',inbox:'Входящая'};
const TASK_EVENT={
  'commitment.created':'задача поставлена',
  'commitment.transitioned':'смена состояния',
  'commitment.rescheduled':'перенос срока',
  'commitment.reassigned':'передана другому',
  'evidence.added':'добавлено доказательство',
  'acceptance.recorded':'решение о приёмке',
};
const TASK_ACTION={accepted:'Принять ответственность',rejected:'Отказаться',clarify:'Запросить уточнение',scheduled:'Запланировать',in_progress:'Начать работу',blocked:'Есть блокировка',in_review:'Отправить на проверку',accepted_result:'Принять результат',closed:'Закрыть',deferred:'Отложить',cancelled:'Отменить'};
/**
 * Строка задачи.
 *
 * Слова «просрочено» не было во всём интерфейсе: просроченная задача
 * выглядела ровно как будущая — дата и чип важности, — и ответа на
 * вопрос «что сегодня горит» продукт не давал ни на одном экране.
 */
const taskOverdue=(t)=>Boolean(t.promisedAt)&&Date.parse(t.promisedAt)<Date.now()
  &&!['closed','accepted_result','cancelled','rejected'].includes(t.status);
const taskDueSoon=(t)=>Boolean(t.promisedAt)&&!taskOverdue(t)
  &&Date.parse(t.promisedAt)-Date.now()<24*3600*1000
  &&!['closed','accepted_result','cancelled','rejected'].includes(t.status);
function taskRow(t){
  const late=taskOverdue(t),soon=taskDueSoon(t);
  const when=t.promisedAt?esc(dateTime(t.promisedAt)):'без срока';
  return `<button class="task-card pressable${late?' overdue':''}" data-task-open="${t.id}"><span class="task-status"></span><span><div class="task-title">${esc(t.title)}</div><div class="task-meta"><span>${esc(TASK_STATUS[t.status]||t.status)}</span><span>·</span><span class="${late?'task-late':soon?'task-soon':''}">${late?'просрочено — ':soon?'сегодня — ':''}${when}</span><span>·</span><span>${esc(name(t.ownerId))}</span></div></span><span class="chip ${['high','urgent'].includes(t.priority)?'danger':''}">${esc(t.priority||'normal')}</span></button>`;
}
function kindLabel(k){return({voice:'Голосовое сообщение',file:'Файл',call:'Звонок',task:'Задача',calendar:'Событие'})[k]||''}
function chats(){const c=S.conversations.find(x=>x.id===S.selected),messages=S.messages.get(c?.id)||[],muted=c?.mutedUntil&&Date.parse(c.mutedUntil)>Date.now();return `<div class="chat-shell"><aside class="conversation-pane ${S.mobileChat?'hidden-mobile':''}"><div class="conversation-pane-header"><div class="chip-row">${CONVERSATION_GROUPS.map(([key,caption])=>`<button class="chipbtn pressable${(S.chatFilter||'all')===key?' on':''}" data-chat-filter="${key}">${esc(caption)}${countIn(key)?`<i>${countIn(key)}</i>`:''}</button>`).join('')}</div><button data-action="dm" class="round-button pressable" aria-label="Новый чат">＋</button></div>${visibleConversations().map(x=>`<button class="conversation-card pressable ${x.id===S.selected?'active':''}" data-conversation="${x.id}"><span class="avatar dark">${x.kind==='channel'?'#':esc(initials(x.title||'D'))}</span><span><strong>${esc(x.title||'Диалог')}</strong><div class="preview">${x.lastMessage?esc(x.lastMessage.body||kindLabel(x.lastMessage.kind)):''}</div>${x.lastMessage?'':'<div class="preview preview-empty">Нет сообщений</div>'}</span><span class="time">${time(x.lastMessage?.createdAt)}</span></button>`).join('')}</aside><section class="message-pane ${!S.mobileChat?'hidden-mobile':''}">${c?`<header class="message-header"><div class="inline-actions"><button data-action="back" class="round-button pressable mobile-back" aria-label="Назад к списку">‹</button><div><h2>${esc(c.kind==='channel'?'# '+c.title:(c.title||'Диалог'))}</h2><p>${esc(c.purpose||'Рабочая переписка')}${muted?' · уведомления выключены':''}</p></div></div><div class="inline-actions"><button data-action="favour-room" class="round-button pressable${S.favourites?.has('conversation:'+c.id)?' on':''}" title="${S.favourites?.has('conversation:'+c.id)?'Убрать из избранного':'В избранное'}" aria-label="${S.favourites?.has('conversation:'+c.id)?'Убрать беседу из избранного':'Добавить беседу в избранное'}">${msgIcon.star}</button><button data-action="pins" class="round-button pressable" title="Закреплённые" aria-label="Закреплённые сообщения">${roomIcon.pins}</button><button data-action="mute" class="round-button pressable" title="${muted?'Включить уведомления':'Отключить на 8 часов'}" aria-label="${muted?'Включить уведомления':'Отключить уведомления'}">${muted?roomIcon.muted:roomIcon.bell}</button><button data-action="archive" class="round-button pressable" title="Архивировать" aria-label="Убрать в архив">${tileIcon.archive}</button><button data-action="room-games" class="round-button pressable" title="Игры" aria-label="Игры в этой беседе">${tileIcon.games}</button><button data-action="conversation" class="round-button pressable" title="О беседе" aria-label="О беседе">${tileIcon.settings}</button>${c.kind!=='direct'?`<button data-action="members" class="round-button pressable" title="Участники" aria-label="Участники беседы">${tileIcon.team}</button>`:''}<button data-action="audio" class="round-button pressable" title="Аудиозвонок" aria-label="Аудиозвонок">${tileIcon.calls}</button><button data-action="video" class="round-button pressable" title="Видеозвонок" aria-label="Видеозвонок">${roomIcon.video}</button></div></header><div id="message-stream" class="message-stream">${S.messageCursor.get(c.id)?'<button id="load-older" class="button secondary pressable" style="margin:0 auto 10px;display:block">Показать более ранние</button>':''}${messageStream(messages)}</div><div id="typing" class="typing"></div><div class="composer-wrap">${S.reply?`<div class="reply-preview visible"><span>Ответ на: ${esc(S.reply.body||kindLabel(S.reply.kind))}</span><button data-action="cancel-reply" class="close-button">×</button></div>`:''}<div class="composer"><button data-action="attach" class="composer-button pressable" aria-label="Прикрепить файл">＋</button><textarea id="message-input" rows="1" placeholder="Сообщение"></textarea><button data-action="voice" class="composer-button pressable" aria-label="Голосовое сообщение">◖</button><button data-action="send" class="composer-button send pressable" aria-label="Отправить">↑</button></div></div>`:'<div class="empty"><strong>Выберите разговор</strong></div>'}</section></div>`}
/**
 * Лента переписки.
 *
 * Своё справа, чужое слева — так устроен любой мессенджер, и человек
 * читает принадлежность реплики не по имени, а по стороне, ещё до того,
 * как начал читать. Имя остаётся только у чужих сообщений: своё имя
 * человек знает.
 *
 * Время стоит в самом пузыре, а не отдельной строкой: оно нужно почти
 * всегда и не должно занимать место. Дата — разделителем между днями,
 * один раз на день, а не у каждой реплики.
 */
/** Длительность голосового: «0:07», а не «7с». */
function voiceLength(ms){
  const total=Math.max(0,Math.round((ms||0)/1000));
  return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
}
const PREVIEWABLE_TYPE=/^(image\/(?!svg\+xml)|application\/pdf$|text\/plain|audio\/|video\/)/i;
const filePreviewable=(meta)=>PREVIEWABLE_TYPE.test(meta?.mimeType??'');
/** Картинку и PDF открываем в окне, остальное отдаём на скачивание. */
const fileHref=(meta)=>{
  if(!meta?.fileId)return meta?.contentUrl??'#';
  return filePreviewable(meta)?`/api/v1/files/${meta.fileId}/preview`:`/api/v1/files/${meta.fileId}/content`;
};
const fileSize=(bytes)=>{
  if(!bytes&&bytes!==0)return '';
  if(bytes<1024)return `${bytes} Б`;
  if(bytes<1024*1024)return `${Math.round(bytes/1024)} КБ`;
  return `${(bytes/1048576).toFixed(1)} МБ`;
};
const fileMeta=(meta)=>[fileSize(meta?.size),filePreviewable(meta)?'открыть':'скачать'].filter(Boolean).join(' · ');

function dayLabel(value){
  const d=new Date(value), now=new Date();
  const same=(a,b)=>a.toDateString()===b.toDateString();
  const yesterday=new Date(now); yesterday.setDate(now.getDate()-1);
  if(same(d,now))return 'Сегодня';
  if(same(d,yesterday))return 'Вчера';
  return new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',...(d.getFullYear()!==now.getFullYear()?{year:'numeric'}:{})}).format(d);
}

function messageStream(items){
  if(!items.length)return '<div class="empty"><strong>Начните разговор</strong></div>';
  let out='',lastDay='',lastAuthor='',lastAt=0;
  // Граница непрочитанного: без неё вернувшийся из отпуска не понимает,
  // с какого места читать, — сто сообщений выглядят одной стеной.
  const boundary=S.unreadFrom.get(S.selected)||null;
  for(const m of items){
    if(boundary&&m.id===boundary){
      // «Непрочитанное · с Сегодня» читается коряво: подпись с датой
      // нужна, только когда пропущено не сегодняшнее.
      const since=m.createdAt?dayLabel(m.createdAt):'';
      const sameDay=since==='Сегодня'||since==='Today';
      out+=`<div class="unread-divider"><span>Непрочитанное${since&&!sameDay?` · с ${esc(since)}`:''}</span></div>`;
      lastAuthor='';
    }
    const day=new Date(m.createdAt).toDateString();
    if(day!==lastDay){out+=`<div class="day-divider"><span>${esc(dayLabel(m.createdAt))}</span></div>`;lastDay=day;lastAuthor='';}
    // Подряд идущие реплики одного человека за пять минут — одна связка:
    // имя и аватар печатаются один раз.
    const grouped=m.authorId===lastAuthor&&Date.parse(m.createdAt)-lastAt<5*60*1000;
    out+=message(m,grouped);
    lastAuthor=m.authorId;lastAt=Date.parse(m.createdAt);
  }
  return out;
}

function message(m,grouped=false){
  const reactions=(m.reactions||[]).reduce((a,r)=>(a[r.reaction]=(a[r.reaction]||0)+1,a),{});
  const deleted=Boolean(m.deletedAt);
  const mine=m.authorId===me().userId;
  const parent=m.replyToId?(S.messages.get(m.conversationId)||[]).find(x=>x.id===m.replyToId):null;
  const quote=m.replyToId?`<button class="reply-quote" data-jump="${esc(m.replyToId)}" title="Перейти к сообщению">${parent
    ?`<b>${esc(parent.authorId===me().userId?'Вы':name(parent.authorId))}</b> ${esc(parent.deletedAt?'сообщение удалено':(parent.body||kindLabel(parent.kind)||'вложение').slice(0,90))}`
    :'<b>Ответ</b> на сообщение выше'}</button>`:'';
  const forwarded=m.forwardedFrom
    ?(m.forwardedFrom.restricted
      ?'<div class="msg-forward">Пересланное сообщение</div>'
      :`<button class="msg-forward" data-forward-origin-conversation="${m.forwardedFrom.conversationId}" data-forward-origin-message="${m.forwardedFrom.messageId}">Переслано от ${esc(name(m.forwardedFrom.authorId))}${m.forwardedFrom.conversationTitle?' · '+esc(m.forwardedFrom.conversationTitle):''}</button>`)
    :'';
  const body=deleted?'<p class="message-body muted">Сообщение удалено</p>'
    :m.kind==='voice'?`<div class="voice-card voice-card-play" data-voice="${esc(m.metadata?.fileId??'')}">
      <button type="button" class="voice-play pressable" aria-label="Прослушать голосовое сообщение">▶</button>
      <div class="waveform"></div>
      <span class="mono">${voiceLength(m.metadata?.durationMs)}</span>
    </div>`
    :m.kind==='file'?`<a class="voice-card file-card" href="${esc(fileHref(m.metadata))}"${filePreviewable(m.metadata)?' target="_blank" rel="noopener"':' download'} title="${filePreviewable(m.metadata)?'Открыть':'Скачать'}">
      <span class="file-mark" aria-hidden="true">${tileIcon.files}</span>
      <span><strong>${esc(m.metadata?.name||'Файл')}</strong>
        <span class="row-sub">${esc(fileMeta(m.metadata))}</span></span>
    </a>`
    :`<p class="message-body">${bodyWithHighlights(m)}</p>`;
  const notes=(S.notes?.get(m.id)||[]);
  const noteBlock=notes.length?`<div class="msg-notes">${notes.map(n=>
    `<button class="msg-note kind-${esc(n.kind)}" data-note="${esc(n.id)}" title="Личная заметка — нажмите, чтобы изменить"><b>${esc(NOTE_KIND_LABEL[n.kind]||'заметка')}</b> ${esc(n.body.slice(0,120))}</button>`).join('')}</div>`:'';
  const stamp=`<span class="msg-stamp">${m.pinned?'<i title="Закреплено" aria-label="Закреплено">✦</i>':''}${m.saved?'<i title="В избранном" aria-label="В избранном">★</i>':''}${m.editedAt?`<i class="msg-edited" title="Изменено: ${esc(dateTime(m.editedAt))}">изменено в ${esc(time(m.editedAt))}</i>`:''}<time datetime="${esc(m.createdAt)}" title="${esc(dateTime(m.createdAt))}">${esc(time(m.createdAt))}</time></span>`;

  return `<article class="message-item${mine?' mine':''}${grouped?' grouped':''}" data-message-row="${m.id}">
    ${mine||grouped?'':`<span class="avatar dark">${esc(initials(name(m.authorId)))}</span>`}
    <div class="msg-column">
      ${mine||grouped?'':`<div class="message-meta"><span class="message-author">${esc(name(m.authorId))}</span></div>`}
      <div class="msg-bubble">
        ${forwarded}${quote}${body}${stamp}
      </div>
      ${noteBlock}
      ${(S.labelTargets?.get('message:'+m.id)||[]).length?`<div class="chip-row msg-labels">${(S.labelTargets.get('message:'+m.id)||[]).map(labelChip).join('')}</div>`:''}
      ${Object.keys(reactions).length?`<div class="chip-row msg-reactions">${Object.entries(reactions).map(([e,n])=>`<button class="reaction-button" data-react="${esc(e)}" data-message="${m.id}">${esc(e)} ${n}</button>`).join('')}</div>`:''}
      ${deleted?'':`<div class="msg-toolbar">
        <button class="msg-tool pressable" data-react-pick="${m.id}" title="Реакция" aria-label="Поставить реакцию">${msgIcon.react}</button>
        <button class="msg-tool pressable" data-reply="${m.id}" title="Ответить" aria-label="Ответить на сообщение">${msgIcon.reply}</button>
        <button class="msg-tool pressable" data-message-menu="${m.id}" title="Ещё" aria-label="Другие действия с сообщением">${msgIcon.more}</button>
      </div>`}
    </div>
  </article>`;
}

function tasks(){return `<section class="surface"><div class="section-head"><div><p class="muted">Ответственность → выполнение → доказательство → проверка → закрытие</p></div>${can('task.create')?'<button data-action="task" class="button primary small pressable">＋ Задача</button>':''}</div><div class="task-list">${S.tasks.map(taskRow).join('')||'<div class="empty"><strong>Ничего не потеряется</strong>Создайте задачу вручную или из сообщения.</div>'}</div></section>`}
function calendar(){
  const c=S.cal||(S.cal={view:'week',cursor:new Date(),selected:null});
  const base=new Date(c.cursor);
  const fmt=(o)=>new Intl.DateTimeFormat('ru',o);
  const sameDay=(a,b)=>a.toDateString()===b.toDateString();
  const today=new Date();
  const dayKey=(d)=>`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  /**
   * В какой день попадает событие.
   *
   * Встреча — это мгновение, и её день считается по часам смотрящего. А
   * «весь день» — календарная дата в поясе того, кто её назначил: отчётный
   * день 31 декабря, поставленный в Москве, у коллеги в Нью-Йорке
   * оказывался тридцатым, потому что клиент раскладывал всё по своему
   * поясу.
   */
  const eventDay=(e)=>{
    const at=new Date(e.startAt);
    if(!e.allDay||!e.timezone)return at;
    try{
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:e.timezone,year:'numeric',month:'2-digit',day:'2-digit'})
        .formatToParts(at).reduce((acc,p)=>(acc[p.type]=p.value,acc),{});
      return new Date(Number(parts.year),Number(parts.month)-1,Number(parts.day));
    }catch{return at}
  };
  const eventsOn=(d)=>(S.calendar||[]).filter(e=>sameDay(eventDay(e),d));
  // An event still awaiting this person's answer pulses: the grid is where a
  // missed invitation actually costs something.
  const dot=(e)=>`<i class="cal-dot ${e.needsMyAnswer?'pending':esc(e.kind)}"></i>`;
  const header=()=>{
    const label=c.view==='day'?fmt({day:'numeric',month:'long',year:'numeric'}).format(base)
      :c.view==='week'?`${fmt({day:'numeric',month:'short'}).format(weekStart())} — ${fmt({day:'numeric',month:'short',year:'numeric'}).format(new Date(weekStart().getTime()+6*864e5))}`
      :fmt({month:'long',year:'numeric'}).format(base);
    return `<div class="calendar-toolbar">
      <div><h2>${esc(label)}</h2></div>
      ${can('calendar.create')?'<button data-action="event" class="button primary small pressable">＋ Событие</button>':''}
    </div>
    <div class="cal-controls">
      <div class="cal-switch">${['day','week','month'].map(v=>`<button class="cal-tab ${c.view===v?'active':''}" data-cal-view="${v}">${v==='day'?'День':v==='week'?'Неделя':'Месяц'}</button>`).join('')}</div>
      <div class="cal-nav"><button data-cal-step="-1" class="round-button pressable" aria-label="Назад">‹</button><button data-cal-today class="button secondary small pressable">Сегодня</button><button data-cal-step="1" class="round-button pressable" aria-label="Вперёд">›</button></div>
    </div>`;
  };
  function weekStart(){const d=new Date(base);const shift=(d.getDay()+6)%7;d.setDate(d.getDate()-shift);d.setHours(0,0,0,0);return d}

  let grid='';
  if(c.view==='month'){
    const first=new Date(base.getFullYear(),base.getMonth(),1);
    const start=new Date(first);start.setDate(1-((first.getDay()+6)%7));
    const cells=Array.from({length:42},(_,i)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+i));
    grid=`<div class="cal-month">${weekdayNames().map(d=>`<span class="cal-weekday">${esc(d)}</span>`).join('')}
      ${cells.map(d=>{const list=eventsOn(d);const out=d.getMonth()!==base.getMonth();
        return `<button class="cal-cell ${out?'muted-cell':''} ${sameDay(d,today)?'today':''} ${c.selected===dayKey(d)?'chosen':''}" data-cal-day="${d.toISOString()}">
          <span class="cal-daynum">${d.getDate()}</span>
          <span class="cal-dots">${list.slice(0,4).map(dot).join('')}${list.length>4?`<i class="cal-more">+${list.length-4}</i>`:''}</span>
        </button>`}).join('')}</div>`;
  } else if(c.view==='week'){
    const days=Array.from({length:7},(_,i)=>new Date(weekStart().getTime()+i*864e5));
    grid=`<div class="cal-week">${days.map(d=>{const list=eventsOn(d);
      return `<button class="cal-daycol ${sameDay(d,today)?'today':''} ${c.selected===dayKey(d)?'chosen':''}" data-cal-day="${d.toISOString()}">
        <span class="cal-wd">${esc(fmt({weekday:'short'}).format(d))}</span>
        <strong>${d.getDate()}</strong>
        <span class="cal-dots">${list.slice(0,3).map(dot).join('')}${list.length>3?`<i class="cal-more">+${list.length-3}</i>`:''}</span>
      </button>`}).join('')}</div>`;
  }

  // The list under the grid follows the grid: the visible week or month, or a
  // single day once one is picked. Showing the whole loaded window would put
  // next month's meetings under this week.
  const inPeriod=(e)=>{
    const d=eventDay(e);
    if(c.view==='day')return sameDay(d,base);
    if(c.view==='week'){const s0=weekStart();return d>=s0&&d<new Date(s0.getTime()+7*864e5)}
    return d.getMonth()===base.getMonth()&&d.getFullYear()===base.getFullYear();
  };
  const shown=(S.calendar||[]).filter(e=>c.selected?dayKey(eventDay(e))===c.selected:inPeriod(e));
  const heading=c.selected?'Выбранный день':(c.view==='day'?'События дня':c.view==='week'?'События недели':'События месяца');
  const rows=shown.length?shown.map(e=>`<button class="calendar-event pressable ${e.needsMyAnswer?'needs-answer':''}" data-cal-event="${esc(e.id)}">
      <strong>${e.allDay?'весь день':esc(time(e.startAt))}${(c.view!=='day'&&!c.selected)?`<i class="event-day">${esc(new Date(e.startAt).toLocaleDateString('ru-RU',c.view==='month'?{day:'numeric',month:'short'}:{weekday:'short',day:'numeric'}))}</i>`:''}</strong><span class="event-line"></span>
      <div><div class="row-title">${esc(e.title)}</div><div class="row-sub">${esc(KIND_LABEL[e.kind]||e.kind)}${e.participantCount?` · ${e.participantCount} участн.`:''}${e.fileCount?` · ${e.fileCount} файл.`:''}</div></div>
      ${e.needsMyAnswer?'<span class="chip pulse">нужен ответ</span>':`<span class="chip warm">${e.endAt?esc(time(e.endAt)):'—'}</span>`}
    </button>`).join(''):'<div class="surface empty"><strong>Здесь пусто</strong></div>';

  return `<section class="surface">${header()}${grid}</section>
    <h3 class="person-section">${esc(heading)}</h3>
    <div class="calendar-list">${rows}</div>`;
}
const KIND_LABEL={meeting:'Встреча',focus:'Фокус',task_block:'Работа над задачей',deadline:'Дедлайн',reminder:'Напоминание',milestone:'Веха',other:'Событие'};

// Bindings for the calendar grid, re-attached on every render.
function bindCalendar(){
  const c=S.cal;if(!c)return;
  $$('[data-cal-view]').forEach(b=>b.onclick=async()=>{
    const next=b.dataset.calView;
    // Browsing a week and then asking for a day used to land on the last day
    // of that week. Today if today is in view, otherwise where the range
    // starts — never its far end.
    if(next==='day'&&c.view!=='day'){
      const now=new Date(),cursor=new Date(c.cursor);
      let start;
      if(c.view==='week'){start=new Date(cursor);start.setDate(cursor.getDate()-((cursor.getDay()+6)%7))}
      else start=new Date(cursor.getFullYear(),cursor.getMonth(),1);
      const end=c.view==='week'?new Date(start.getTime()+6*864e5):new Date(cursor.getFullYear(),cursor.getMonth()+1,0);
      c.cursor=(now>=start&&now<=end)?now:start;
    }
    c.view=next;c.selected=null;
    await loadCalendarRange();
    render();
  });
  $$('[data-cal-step]').forEach(b=>b.onclick=async()=>{
    const step=Number(b.dataset.calStep),d=new Date(c.cursor);
    if(c.view==='month')d.setMonth(d.getMonth()+step);
    else if(c.view==='week')d.setDate(d.getDate()+7*step);
    else d.setDate(d.getDate()+step);
    c.cursor=d;c.selected=null;await loadCalendarRange();render();
  });
  const todayButton=$('[data-cal-today]');
  if(todayButton)todayButton.onclick=async()=>{c.cursor=new Date();c.selected=null;await loadCalendarRange();render()};
  $$('[data-cal-day]').forEach(b=>b.onclick=()=>{
    const d=new Date(b.dataset.calDay);
    if(c.view==='day'){c.cursor=d}else{const key=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;c.selected=c.selected===key?null:key}
    render();
  });
  $$('[data-cal-event]').forEach(b=>b.onclick=()=>eventPage(b.dataset.calEvent));
}

// Load a window wide enough for the current view, so the grid never shows a
// month with events missing from its edges.
async function loadCalendarRange(){
  const c=S.cal||(S.cal={view:'week',cursor:new Date(),selected:null});
  const from=new Date(c.cursor),to=new Date(c.cursor);
  from.setDate(from.getDate()-45);to.setDate(to.getDate()+45);
  try{S.calendar=(await api(`/api/v1/calendar-events?from=${from.toISOString()}&to=${to.toISOString()}`)).items||[]}catch{}
}

const RESPONSE_LABEL={invited:'ждёт ответа',accepted:'придёт',tentative:'под вопросом',declined:'не придёт'};
async function eventPage(id){
  let event;
  try{event=(await api(`/api/v1/calendar-events/${id}`)).event}
  catch(error){toast(error.code==='CALENDAR_UNAVAILABLE'?'Детали встречи доступны в режиме с базой данных':error.message);return}
  const range=`${esc(dateTime(event.startAt))}${event.endAt?` — ${esc(time(event.endAt))}`:''}`;
  const people=event.participants.length
    ? event.participants.map(p=>`<div class="person-event"><span>${esc(p.displayName||'—')}${p.optional?' · необязательно':''}${p.note?` — ${esc(p.note)}`:''}</span><span class="inline-actions"><span class="chip ${p.response==='invited'?'pulse':'warm'}">${esc(RESPONSE_LABEL[p.response])}</span>${event.canEdit?`<button class="close-button" data-uninvite="${esc(p.userId)}" title="Убрать из встречи" aria-label="Убрать ${esc(p.displayName||'участника')} из встречи">×</button>`:''}</span></div>`).join('')
    : '<p class="muted">Участники не приглашены.</p>';
  const files=event.files.length
    ? event.files.map(f=>`<a class="person-event" href="/api/v1/files/${esc(f.id)}/content" target="_blank" rel="noopener"><span>${esc(f.name)}</span><time>${esc(String(f.sizeBytes))} Б</time></a>`).join('')
    : '<p class="muted">Вложений нет.</p>';
  const answer=event.myResponse?`<div class="stack" style="margin-top:12px">
      <div class="cal-answer">${['accepted','tentative','declined'].map(r=>`<button class="button ${event.myResponse===r?'primary':'secondary'} small" data-answer="${r}">${r==='accepted'?'Приду':r==='tentative'?'Под вопросом':'Не приду'}</button>`).join('')}</div>
    </div>`:'';

  modal(event.title,`
    <div class="person-fields">
      <div class="person-field"><span>Когда</span><strong>${range}</strong></div>
      <div class="person-field"><span>Тип</span><strong>${esc(KIND_LABEL[event.kind]||event.kind)}</strong></div>
      <div class="person-field"><span>Организатор</span><strong>${esc(event.ownerName||'—')}</strong></div>
      ${event.conversationTitle?`<div class="person-field"><span>Беседа</span><strong>${esc(event.conversationTitle)}</strong></div>`:''}
      ${event.commitmentTitle?`<div class="person-field"><span>Задача</span><strong>${esc(event.commitmentTitle)}</strong></div>`:''}
    </div>
    ${event.description?`<p class="person-about">${esc(event.description)}</p>`:''}
    ${event.needsMyAnswer?'<p class="cal-callout">Организатор ждёт вашего подтверждения.</p>':''}
    ${answer}
    <h3 class="person-section"><span>Участники</span> — ${event.participants.length}</h3><div class="person-feed">${people}</div>
    <h3 class="person-section">Материалы</h3><div class="person-feed">${files}</div>
    ${event.canEdit?`<div class="stack" style="margin-top:16px">
      <button data-event-edit class="button secondary">Изменить встречу</button>
      <button data-event-invite class="button secondary">Позвать ещё</button>
      <button data-event-cancel class="button danger">Отменить встречу</button>
    </div>`:''}
  `,()=>{
    $$('[data-answer]').forEach(b=>b.onclick=async()=>{
      try{
        await api(`/api/v1/calendar-events/${id}/respond`,{method:'POST',body:JSON.stringify({response:b.dataset.answer})});
        toast('Ответ отправлен');
        history.back();
        await loadCalendarRange();render();
      }catch(error){toast(error.message)}
    });
    $$('[data-uninvite]').forEach(b=>b.onclick=async()=>{
      try{
        await api(`/api/v1/calendar-events/${id}/participants/${b.dataset.uninvite}`,{method:'DELETE'});
        toast('Участник убран');closeModal();
        await loadCalendarRange();render();await eventPage(id);
      }catch(error){toast(error.message)}
    });
    const edit=$('[data-event-edit]');
    if(edit)edit.onclick=()=>eventEditModal(event);
    const invite=$('[data-event-invite]');
    if(invite)invite.onclick=()=>eventInviteModal(event);
    const cancel=$('[data-event-cancel]');
    if(cancel)cancel.onclick=()=>eventCancelModal(event);
  });
}

/**
 * Встречу можно было только завести и ответить на приглашение. Перенести,
 * переименовать, позвать ещё одного или отменить — всё это сервер умел с
 * самого начала, а в интерфейсе не было ни одной кнопки: договорённость
 * жила в календаре как высеченная.
 */
function eventEditModal(event){
  modal('Изменить встречу',`<form id="event-edit" class="form-stack">
    <label>Название<input name="title" required maxlength="240" value="${esc(event.title||'')}"></label>
    <label>Начало<input name="start" type="datetime-local" required value="${esc(toLocalInput(event.startAt))}"></label>
    <label>Окончание<input name="end" type="datetime-local" value="${event.endAt?esc(toLocalInput(event.endAt)):''}"></label>
    <label>Описание<textarea name="description" rows="2" maxlength="2000">${esc(event.description||'')}</textarea></label>
    <p class="muted">Перенос времени спрашивает участников заново: ответ на старый час не считается согласием на новый.</p>
    <button class="button primary">Сохранить</button>
  </form>`,()=>{
    $('#event-edit').onsubmit=async(submitEvent)=>{
      submitEvent.preventDefault();
      const form=new FormData(submitEvent.currentTarget);
      const startAt=new Date(form.get('start'));
      const endRaw=form.get('end');
      const endAt=endRaw?new Date(endRaw):null;
      if(endAt&&endAt<=startAt)return toast('Окончание должно быть позже начала');
      try{
        await api(`/api/v1/calendar-events/${event.id}`,{method:'PATCH',body:JSON.stringify({
          title:form.get('title'),description:form.get('description')||null,
          startAt:startAt.toISOString(),endAt:endAt?endAt.toISOString():null,
        })});
        toast('Встреча изменена');closeModal();
        await loadCalendarRange();render();await eventPage(event.id);
      }catch(error){toast(error.message)}
    };
  });
}

function eventInviteModal(event){
  const already=new Set(event.participants.map(p=>p.userId));
  const candidates=colleagues().filter(p=>!already.has(p.userId)&&p.userId!==event.ownerId);
  modal('Позвать на встречу',candidates.length?`<form id="event-invite" class="form-stack">
    <div>${candidates.map(p=>`<label class="row candidate-row" style="cursor:pointer"><input type="checkbox" name="who" value="${esc(p.userId)}"><span class="avatar dark">${esc(initials(p.displayName||p.email))}</span><span><div class="row-title">${esc(p.displayName||p.email)}</div><div class="row-sub">${esc(p.title||p.role)}</div></span></label>`).join('')}</div>
    <button class="button primary">Пригласить</button>
  </form>`:'<div class="empty"><strong>Звать больше некого</strong>Все сотрудники уже приглашены.</div>',()=>{
    const form=$('#event-invite');
    if(!form)return;
    form.onsubmit=async(submitEvent)=>{
      submitEvent.preventDefault();
      const userIds=[...form.querySelectorAll('input[name="who"]:checked')].map(x=>x.value);
      if(!userIds.length)return toast('Выберите, кого позвать');
      try{
        await api(`/api/v1/calendar-events/${event.id}/participants`,{method:'POST',body:JSON.stringify({userIds})});
        toast('Приглашения отправлены');closeModal();
        await loadCalendarRange();render();await eventPage(event.id);
      }catch(error){toast(error.message)}
    };
  });
}

function eventCancelModal(event){
  modal('Отменить встречу',`
    <p class="muted">Встреча пропадёт из календарей всех участников, и каждый получит уведомление об отмене.</p>
    <p class="muted" style="margin-top:10px">Вернуть её нельзя — придётся назначить заново.</p>
    <button id="confirm-cancel-event" class="button danger" style="width:100%;margin-top:14px">Отменить встречу</button>`,()=>{
    $('#confirm-cancel-event').onclick=async()=>{
      try{
        await api(`/api/v1/calendar-events/${event.id}`,{method:'DELETE'});
        toast('Встреча отменена');closeModal();closeModal();
        await loadCalendarRange();render();
      }catch(error){toast(error.message)}
    };
  });
}

function more(){const staff=me().role!=='guest';return `<div class="module-grid"><button class="module-card pressable" data-action="saved"><span class="module-icon">${tileIcon.saved}</span><strong>Избранное</strong><span>Беседы, сообщения, задачи, выделения и заметки</span></button><button class="module-card pressable" data-action="archived"><span class="module-icon">${tileIcon.archive}</span><strong>Архив чатов</strong><span>Скрытые только для вас разговоры</span></button>${staff?`<button class="module-card pressable" data-action="team"><span class="module-icon">${tileIcon.team}</span><strong>Команда</strong><span>${S.people.length} сотрудников, роли и статусы</span></button>`:''}${staff?`<button class="module-card pressable" data-action="org"><span class="module-icon">${tileIcon.org}</span><strong>Оргструктура</strong><span>Департаменты, отделы, штат и руководители</span></button>`:''}<button class="module-card pressable" data-action="presence"><span class="module-icon">${tileIcon.presence}</span><strong>Мой статус</strong><span>В сети, занят, не беспокоить</span></button>${can('organization.manage')?`<button class="module-card pressable" data-action="company"><span class="module-icon">${tileIcon.org}</span><strong>Компания</strong><span>Название и передача владения</span></button>`:''}${can('audit.read')?`<button class="module-card pressable" data-action="journal"><span class="module-icon">${tileIcon.journal}</span><strong>Журнал</strong><span>Кого пригласили, кто вошёл, кто раскрыл пароль</span></button>`:''}${can('integration.manage')?'<button class="module-card pressable" data-action="integrations"><span class="module-icon">⇄</span><strong>Интеграции</strong><span>Подписки на события и журнал доставок</span></button>':''}${staff?`<button class="module-card pressable" data-action="games"><span class="module-icon">${tileIcon.games}</span><strong>Игры</strong><span>Шахматы, шашки и морской бой с коллегами</span></button>`:''}<button class="module-card pressable" data-action="contacts"><span class="module-icon">${tileIcon.contacts}</span><strong>Контакты</strong><span>Кто вам пишет и кто с вами в подразделении</span></button><button class="module-card pressable" data-action="vault"><span class="module-icon">${tileIcon.vault}</span><strong>Пароли</strong><span>Зашифрованное личное хранилище</span></button><button class="module-card pressable" data-action="reminders"><span class="module-icon">${tileIcon.reminders}</span><strong>Напоминания</strong><span>Придут в назначенный час</span></button><button class="module-card pressable" data-action="plan"><span class="module-icon">${tileIcon.plan}</span><strong>Личные дела</strong><span>Список, заметки, приоритеты и сроки</span></button><button class="module-card pressable" data-action="labels"><span class="module-icon">${tileIcon.labels}</span><strong>Метки</strong><span>Важность, теги и папки для всего</span></button>${can('member.invite')?`<button class="module-card pressable" data-action="invite"><span class="module-icon">${tileIcon.invite}</span><strong>Пригласить</strong><span>Добавить сотрудника</span></button>`:''}<button class="module-card pressable" data-action="files"><span class="module-icon">${tileIcon.files}</span><strong>Файлы</strong><span>Вложения из рабочих контекстов</span></button><button class="module-card pressable" data-action="calls"><span class="module-icon">${tileIcon.calls}</span><strong>Звонки</strong><span>Аудио, видео и демонстрация экрана</span></button><button class="module-card pressable" data-action="push"><span class="module-icon">${tileIcon.notifications}</span><strong>Уведомления</strong><span>Push, упоминания и сроки</span></button><button class="module-card pressable" data-action="profile"><span class="module-icon">${tileIcon.settings}</span><strong>Настройки</strong><span>Профиль и безопасность</span></button></div>`}
function bind(){
  // Строка встречи в расписании дня выглядела нажимаемой и не открывала
  // ничего: карточку встречи знал только календарь.
  $$('[data-cal-event]').forEach(b=>b.onclick=()=>eventPage(b.dataset.calEvent));
  // Принять задачу или попросить уточнение можно прямо из строки: до сих
  // пор для этого нужно было открыть карточку и найти нужную кнопку.
  $$('[data-answer-task]').forEach(b=>b.onclick=async()=>{
    const task=S.tasks.find(t=>t.id===b.dataset.answerTask);
    if(!task)return;
    try{
      await api(`/api/v1/tasks/${task.id}/transitions`,{method:'POST',body:JSON.stringify({
        to:b.dataset.answerTo,expectedVersion:task.version,
        ...(b.dataset.answerTo==='clarify'?{reason:'Нужно уточнение'}:{}),
      })});
      toast(b.dataset.answerTo==='accepted'?'Задача принята':'Запрошено уточнение');
      await loadTasks();render();
    }catch(error){toast(error.message)}
  });
  // Ответить на приглашение можно прямо из «Сегодня», не открывая встречу.
  $$('[data-invite-answer]').forEach(b=>b.onclick=async()=>{
    try{
      await api(`/api/v1/calendar-events/${b.dataset.inviteEvent}/respond`,{method:'POST',
        body:JSON.stringify({response:b.dataset.inviteAnswer})});
      toast('Ответ отправлен');
      await Promise.all([loadInvitations(),loadCalendarRange()]);
      render();
    }catch(error){toast(error.message)}
  });
  // A phrase typed here becomes the thing it sounds like: a task by default,
  // an event when it names a time. Better than swallowing the text.
  const quickForm=$('[data-quick-form]');
  if(quickForm)quickForm.onsubmit=(event)=>{
    event.preventDefault();
    const text=new FormData(event.target).get('quick')?.toString().trim();
    if(!text)return quick();
    event.target.reset();
    if(/\b(в|с)\s?\d{1,2}[:.]\d{2}|встреч|созвон|планёрк/i.test(text))eventModal(text);
    else taskModal(null,text);
  };
  $$('[data-chat-filter]').forEach(b=>b.onclick=()=>{S.chatFilter=b.dataset.chatFilter;render()});
  tickClock();
  const planQuick=$('[data-plan-quick]');
  if(planQuick)planQuick.onsubmit=async(event)=>{
    event.preventDefault();
    const title=new FormData(event.target).get('title')?.toString().trim();
    if(!title)return;
    event.target.reset();
    try{await api('/api/v1/personal-items',{method:'POST',body:JSON.stringify({kind:'todo',title})});await loadPlan();render()}
    catch(error){toast(error.message)}
  };
  bindPlanRows(async()=>{await loadPlan();render()});
  $$('[data-nav]').forEach(b=>b.onclick=()=>go(b.dataset.nav));$$('[data-conversation],[data-open]').forEach(b=>b.onclick=()=>openChat(b.dataset.conversation||b.dataset.open));$$('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));$$('[data-react]').forEach(b=>b.onclick=()=>react(b.dataset.message,b.dataset.react));$$('[data-react-pick]').forEach(b=>b.onclick=()=>reactionPicker(b.dataset.reactPick));$$('[data-jump]').forEach(b=>b.onclick=()=>{
    const row=document.querySelector(`[data-message-row="${b.dataset.jump}"]`);
    if(!row)return toast('Это сообщение осталось выше по истории — прокрутите вверх.');
    row.scrollIntoView({block:'center',behavior:'smooth'});
    row.classList.remove('flash');void row.offsetWidth;row.classList.add('flash');
  });$$('[data-reply]').forEach(b=>b.onclick=()=>{S.reply=(S.messages.get(S.selected)||[]).find(m=>m.id===b.dataset.reply);render()});$$('[data-message-save]').forEach(b=>b.onclick=()=>toggleSave(b.dataset.messageSave,b.dataset.saved!=='1'));$$('[data-message-menu]').forEach(b=>b.onclick=()=>messageMenu(b.dataset.messageMenu));$$('[data-voice]').forEach(card=>{
  const button=card.querySelector('.voice-play');
  if(!button)return;
  button.onclick=()=>{
    const fileId=card.dataset.voice;
    if(!fileId)return toast('Запись не найдена');
    if(S.voice&&S.voice.card!==card){S.voice.audio.pause();S.voice.card.classList.remove('playing');S.voice=null}
    if(S.voice){
      const{audio}=S.voice;
      if(audio.paused)audio.play().catch(()=>toast('Не удалось воспроизвести запись'));
      else audio.pause();
      return;
    }
    const audio=new Audio(`/api/v1/files/${fileId}/preview`);
    audio.onplay=()=>{card.classList.add('playing');button.textContent='❚❚';button.setAttribute('aria-label','Пауза')};
    audio.onpause=()=>{card.classList.remove('playing');button.textContent='▶';button.setAttribute('aria-label','Прослушать голосовое сообщение')};
    audio.onended=()=>{S.voice=null;card.classList.remove('playing');button.textContent='▶'};
    audio.onerror=()=>{S.voice=null;card.classList.remove('playing');button.textContent='▶';toast('Запись не открывается')};
    S.voice={audio,card};
    audio.play().catch(()=>{S.voice=null;toast('Не удалось воспроизвести запись')});
  };
});$$('[data-highlight]').forEach(el=>el.onclick=async()=>{
  try{await api(`/api/v1/highlights/${el.dataset.highlight}`,{method:'DELETE'});await loadMarks();render();toast('Выделение снято')}
  catch(error){toast(error.message)}
});$$('[data-note]').forEach(el=>el.onclick=()=>{
  const note=[...(S.notes?.values()||[])].flat().find(n=>n.id===el.dataset.note);
  const message=(S.messages.get(S.selected)||[]).find(m=>m.id===note?.messageId);
  if(note&&message)noteModal(message,note);
});$$('[data-message-label]').forEach(b=>b.onclick=()=>labelPicker('message',b.dataset.messageLabel,{title:'Метки сообщения'}));$$('[data-message-remind]').forEach(b=>b.onclick=()=>{
  const source=(S.messages.get(S.selected)||[]).find(x=>x.id===b.dataset.messageRemind);
  remindAboutModal((source?.body||'Вернуться к сообщению').trim(),{sourceType:'message',sourceId:b.dataset.messageRemind,conversationId:S.selected});
});$$('[data-message-pin]').forEach(b=>b.onclick=()=>togglePin(b.dataset.messagePin,b.dataset.pinned!=='1'));$$('[data-message-forward]').forEach(b=>b.onclick=()=>forwardModal(b.dataset.messageForward));$$('[data-forward-origin-conversation]').forEach(b=>b.onclick=()=>openChatAtMessage(b.dataset.forwardOriginConversation,b.dataset.forwardOriginMessage));$$('[data-message-edit]').forEach(b=>b.onclick=()=>editMessageModal(b.dataset.messageEdit));$$('[data-message-delete]').forEach(b=>b.onclick=()=>deleteMessageModal(b.dataset.messageDelete));$$('[data-task-message]').forEach(b=>b.onclick=()=>{
  const source=(S.messages.get(S.selected)||[]).find(x=>x.id===b.dataset.taskMessage);
  taskModal(b.dataset.taskMessage,(source?.body||'').trim().slice(0,120));
});$$('[data-task-open]').forEach(b=>b.onclick=()=>openTask(b.dataset.taskOpen));const input=$('#message-input');if(input){input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};input.oninput=typing;
  const stream=$('#message-stream');
  if(stream){
    // Подгрузка вверх не должна выбрасывать читающего вниз ленты.
    if(S.keepScroll){
      const anchor=S.keepScroll;S.keepScroll=null;
      requestAnimationFrame(()=>{stream.scrollTop=stream.scrollHeight-anchor.height+anchor.top});
    }else{
      requestAnimationFrame(()=>{stream.scrollTo(0,999999)});
    }
    const older=$('#load-older');
    if(older)older.onclick=()=>loadOlderMessages(S.selected);
    stream.onscroll=()=>{
      if(stream.scrollTop<80)loadOlderMessages(S.selected);
      // Долистал до низа — значит прочитал. Раньше отметка ставилась уже
      // за то, что человек заглянул в беседу.
      if(stream.scrollHeight-stream.scrollTop-stream.clientHeight<40)markConversationRead(S.selected);
    };
    // Короткая переписка помещается целиком — тогда она и прочитана.
    // Через таймер, а не кадр анимации: в фоновой вкладке кадры не
    // рисуются, и отметка не ставилась бы вовсе.
    setTimeout(()=>{
      const pane=$('#message-stream');
      if(pane&&pane.scrollHeight-pane.clientHeight<40)markConversationRead(S.selected);
    },0);
  }}}
function go(v,{silent=false}={}){
  S.view=v;
  // Раздел записывается в адрес: перезагрузка возвращает туда, где человек
  // был, а ссылкой можно поделиться. `silent` — когда мы сюда и пришли по
  // адресу, второй записи в истории не нужно.
  if(!silent){
    const want=`#/${v}`;
    if(location.hash!==want){try{history.pushState(null,'',want)}catch{location.hash=want}}
  }
  if(v!=='chats')S.mobileChat=false;
  // A screen opened after scrolling another one started halfway down it: the
  // conversation header, the calendar toolbar and the day's greeting were all
  // above the fold before the person had touched anything.
  window.scrollTo(0,0);
  render();
}
/**
 * Открыть беседу — ещё не значит прочитать её.
 *
 * Отметка о прочтении ставилась сразу при открытии, по последнему
 * сообщению: человек, вернувшийся из отпуска, заглядывал в канал оценить
 * масштаб — и сто непрочитанных превращались в ноль за одно нажатие, а
 * вернуться к точке остановки было нечем.
 *
 * Теперь граница запоминается при входе и рисуется в ленте, а прочитанным
 * считается то, до чего человек долистал.
 */
async function openChat(id){
  S.selected=id;S.view='chats';S.mobileChat=true;
  await loadMessages(id);
  const conversation=S.conversations.find(c=>c.id===id);
  const unread=Number(conversation?.unreadCount||0);
  const list=S.messages.get(id)||[];
  // Граница — первое сообщение из непрочитанных: их столько, сколько
  // насчитал сервер, и все они в хвосте.
  S.unreadFrom.set(id,unread>0&&list.length?list[Math.max(0,list.length-unread)]?.id??null:null);
  render();
}

/** Отметить прочитанным до конца — когда человек дошёл до низа ленты. */
async function markConversationRead(id){
  const list=S.messages.get(id)||[];
  const last=list.at(-1)?.id||null;
  if(!last||S.readUpTo.get(id)===last)return;
  S.readUpTo.set(id,last);
  try{
    await api(`/api/v1/conversations/${id}/read`,{method:'POST',body:JSON.stringify({messageId:last})});
    const conversation=S.conversations.find(c=>c.id===id);
    if(conversation)conversation.unreadCount=0;
    window.ChatDailyWork?.refresh?.();
  }catch{ /* следующая прокрутка попробует снова */ }
}
async function openChatAtMessage(id,messageId=null){await openChat(id);if(messageId)requestAnimationFrame(()=>document.querySelector(`[data-message-row="${messageId}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}))}
const actions={quick:quick,task:()=>taskModal(),event:eventModal,dm:directModal,group:groupModal,members:membersModal,pins:pinsModal,mute:toggleMute,archive:archiveCurrent,saved:()=>favouritesModal(),archived:archivedModal,'new-direct':directModal,'new-channel':channelModal,back:()=>{S.mobileChat=false;render()},send,attach:()=>$('#file-picker').click(),voice:voice,'cancel-reply':()=>{S.reply=null;render()},invite:inviteModal,team:teamModal,org:orgModal,conversation:conversationModal,plan:()=>planModal(),reminders:()=>remindersModal(),vault:()=>vaultModal(),labels:labelsModal,contacts:contactsModal,games:()=>gamesModal(),presence:presenceModal,integrations:integrationsModal,journal:()=>journalModal(),company:()=>companyModal(),'room-games':()=>gamesModal(S.selected),'favour-room':()=>S.selected&&toggleFavourite('conversation',S.selected),search:()=>window.ChatDailyWork?.openSearch?.(),profile:()=>personPage(me().userId),push:()=>window.ChatDailyWork?.openNotifications?.()??toast('Центр уведомлений недоступен.'),files:()=>toast('Файлы доступны в связанных чатах; общий браузер — следующий экран.'),calls:callsModal,audio:()=>window.ChatCalls?.startOutgoing?.('audio'),video:()=>window.ChatCalls?.startOutgoing?.('video')};

const UNIT_KIND={company:'компания',department:'департамент',division:'отдел',team:'группа',office:'офис',guild:'сообщество'};
// ── org structure: reading and reshaping ────────────────────────────────────
// The chart was read-only and told people to POST to the API. Whoever runs a
// branch can now run it from here; moving a unit or changing its seat plan
// still takes workspace-wide rights, exactly as the server enforces.
const UNIT_ROLE={head:'руководитель',admin:'ответственный',member:'сотрудник'};

async function orgModal(){
  let data;
  try{data=await api('/api/v1/org/units')}
  catch(error){toast(error.code==='ORG_STRUCTURE_UNAVAILABLE'?'Оргструктура доступна в режиме с базой данных':error.message);return}

  const units=data.items||[];
  const wide=Boolean(data.canManage);
  const managed=new Set(data.managedUnitIds||[]);
  const mayManage=(id)=>wide||managed.has(id);
  const nameOf=(id)=>id?(S.people.find(p=>p.userId===id)?.displayName||'—'):null;

  if(!units.length){
    modal('Оргструктура',`<p class="muted">Структура ещё не заведена. Заведите верхний уровень — компанию или первый департамент — и стройте дерево от него.</p>
      ${wide?'<div class="stack" style="margin-top:14px"><button data-new-root class="button primary">Создать подразделение</button></div>'
            :'<p class="muted" style="margin-top:12px">У вас нет прав на изменение структуры.</p>'}`,()=>{
      if(wide)$('[data-new-root]').onclick=()=>unitFormModal(null,null,orgModal);
    });
    return;
  }

  const branch=(parentId,depth)=>units.filter(u=>u.parentId===parentId).map(u=>{
    const head=nameOf(u.headUserId);
    const seats=u.seats.limit===null?`${u.seats.used} <span>чел.</span>`:`${u.seats.used} из ${u.seats.limit}`;
    const tight=u.seats.limit!==null&&u.seats.free<=0;
    return `<div class="org-node" style="--org-depth:${depth}">
      <div class="org-line">
        <strong>${esc(u.name)}</strong>
        <span class="org-kind">${esc(UNIT_KIND[u.kind]||u.kind)}</span>
        ${mayManage(u.id)&&!wide?'<span class="org-kind own">вы управляете</span>':''}
        ${mayManage(u.id)?`<button class="text-button org-edit" data-unit="${esc(u.id)}">настроить</button>`:''}
      </div>
      <div class="org-meta"><span class="${tight?'org-full':''}">${seats}</span><span>${head?`<span>руководитель</span>: ${esc(head)}`:'<span>руководитель не назначен</span>'}</span></div>
    </div>${branch(u.id,depth+1)}`;
  }).join('');

  const planned=units.reduce((n,u)=>n+(u.seats.limit??0),0),taken=units.reduce((n,u)=>n+u.seats.used,0);
  modal('Оргструктура',`
    ${wide?'<div class="stack" style="margin-bottom:12px"><button data-new-root class="button secondary">＋ Подразделение верхнего уровня</button></div>':''}
    <div class="org-tree">${branch(null,0)}</div>
    <p class="muted" style="margin-top:12px"><span>Мест занято</span>: ${taken} / ${planned}${wide?'':' · <span>вы управляете только своей веткой</span>'}</p>`,()=>{
    if(wide)$('[data-new-root]').onclick=()=>unitFormModal(null,null,orgModal);
    $$('[data-unit]').forEach(button=>button.onclick=()=>unitSheet(units.find(u=>u.id===button.dataset.unit),{wide,units}));
  });
}

async function unitSheet(unit,{wide,units}){
  if(!unit)return;
  let members=[];
  try{members=(await api(`/api/v1/org/units/${unit.id}/members`)).items||[]}
  catch(error){toast(error.message)}

  const seats=unit.seats.limit===null?'не ограничено':`${unit.seats.used} из ${unit.seats.limit}`;
  const rows=members.length?members.map(m=>`<div class="label-row">
      <span><div class="row-title">${esc(m.displayName||name(m.userId))}</div><div class="row-sub">${esc(UNIT_ROLE[m.role]||m.role)}</div></span>
      <span class="inline-actions">
        ${m.role!=='head'?`<button class="text-button" data-make-head="${esc(m.userId)}">сделать руководителем</button>`:''}
        <button class="text-button danger" data-remove-member="${esc(m.userId)}">убрать</button>
      </span>
    </div>`).join(''):'<p class="muted">В подразделении пока никого нет.</p>';

  modal(unit.name,`
    <div class="person-fields">
      <div class="person-field"><span>Вид</span><strong>${esc(UNIT_KIND[unit.kind]||unit.kind)}</strong></div>
      <div class="person-field"><span>Уровень</span><strong>${unit.depth}</strong></div>
      <div class="person-field"><span>Штат</span><strong>${esc(seats)}</strong></div>
    </div>
    <h3 class="person-section"><span>Сотрудники</span> — ${members.length}</h3>
    <div class="label-list">${rows}</div>
    <div class="stack" style="margin-top:16px">
      <button data-add-member class="button secondary">Зачислить сотрудника</button>
      <button data-sub-unit class="button secondary">＋ Подразделение внутри</button>
      <button data-rename class="button secondary">Переименовать${wide?' и изменить штат':''}</button>
      ${wide?'<button data-delete class="button danger">Удалить подразделение</button>':''}
    </div>
    ${wide?'':'<p class="muted" style="margin-top:12px">Перенос подразделения и штатный план меняет владелец или администратор компании.</p>'}`,()=>{
    const back=()=>replaceModal(()=>unitSheet(unit,{wide,units}));
    $('[data-add-member]').onclick=()=>unitAddMemberModal(unit,members,back);
    $('[data-sub-unit]').onclick=()=>unitFormModal(unit.id,null,orgModal);
    $('[data-rename]').onclick=()=>unitFormModal(unit.parentId,unit,orgModal,{wide});
    $$('[data-make-head]').forEach(b=>b.onclick=async()=>{
      try{
        await api(`/api/v1/org/units/${unit.id}`,{method:'PATCH',body:JSON.stringify({headUserId:b.dataset.makeHead})});
        toast('Руководитель назначен');orgModal();
      }catch(error){toast(error.message)}
    });
    $$('[data-remove-member]').forEach(b=>b.onclick=async()=>{
      try{
        await api(`/api/v1/org/units/${unit.id}/members/${b.dataset.removeMember}`,{method:'DELETE'});
        back();
      }catch(error){toast(error.message)}
    });
    if(wide)$('[data-delete]').onclick=()=>{
      modal(`Удалить «${unit.name}»?`,`<p class="muted">Подразделение с вложенными в него удалить нельзя — сначала перенесите или удалите их. Сотрудники останутся в компании.</p>
        <button id="confirm-unit-delete" class="button danger" style="width:100%">Удалить</button>`,()=>{
        $('#confirm-unit-delete').onclick=async()=>{
          try{await api(`/api/v1/org/units/${unit.id}`,{method:'DELETE'});toast('Подразделение удалено');orgModal()}
          catch(error){toast(error.message)}
        };
      });
    };
  });
}

function unitFormModal(parentId,existing,after,{wide=true}={}){
  const heading=existing?'Настроить подразделение':'Новое подразделение';
  modal(heading,`<form id="unit-form" class="form-stack">
    <label>Название<input name="name" required maxlength="120" value="${esc(existing?.name??'')}"></label>
    ${existing?'':`<label>Вид<select name="kind" class="field">${Object.entries(UNIT_KIND).map(([value,caption])=>
      `<option value="${value}" ${value==='department'?'selected':''}>${esc(caption)}</option>`).join('')}</select></label>`}
    ${wide?`<label>Штатных мест<input name="seatLimit" type="number" min="1" step="1" placeholder="не ограничено"
      value="${existing?.seats?.limit??''}"></label>`:''}
    <button class="button primary">${existing?'Сохранить':'Создать'}</button>
  </form>`,()=>{
    $('#unit-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const raw=form.get('seatLimit');
      const seatLimit=raw===null||String(raw).trim()===''?null:Number(raw);
      try{
        if(existing){
          const patch={name:form.get('name')};
          if(wide)patch.seatLimit=seatLimit;
          await api(`/api/v1/org/units/${existing.id}`,{method:'PATCH',body:JSON.stringify(patch)});
        }else{
          await api('/api/v1/org/units',{method:'POST',body:JSON.stringify({
            parentId,kind:form.get('kind'),name:form.get('name'),seatLimit,
          })});
        }
        toast(existing?'Подразделение сохранено':'Подразделение создано');
        after?.();
      }catch(error){toast(error.message)}
    };
  });
}

function unitAddMemberModal(unit,members,after){
  const inside=new Set(members.map(m=>m.userId));
  // A guest is somebody else's employee and the server refuses to place one.
  const candidates=S.people.filter(p=>!inside.has(p.userId)&&p.role!=='guest');
  if(!candidates.length){toast('Все сотрудники уже в этом подразделении');return}
  modal(`Зачислить в «${unit.name}»`,`<form id="unit-member-form" class="form-stack">
    <label>Сотрудник<select name="userId" class="field">${candidates.map(p=>
      `<option value="${esc(p.userId)}">${esc(p.displayName||p.email)}</option>`).join('')}</select></label>
    <label>Роль в подразделении<select name="role" class="field">
      <option value="member">сотрудник</option>
      <option value="admin">ответственный</option>
      <option value="head">руководитель</option>
    </select></label>
    ${unit.seats.limit!==null?`<p class="muted"><span>Свободных мест</span>: ${unit.seats.free}</p>`:''}
    <button class="button primary">Зачислить</button>
  </form>`,()=>{
    $('#unit-member-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      try{
        await api(`/api/v1/org/units/${unit.id}/members`,{method:'POST',body:JSON.stringify({
          userId:form.get('userId'),role:form.get('role'),
        })});
        toast('Сотрудник зачислен');
        after?.();
      }catch(error){toast(error.message)}
    };
  });
}

// ── labels: importance, tags and folders ────────────────────────────────────
// One mechanism serves all three. The kind decides how it behaves: importance
// is exclusive (a second one replaces the first), tags and folders accumulate.
const LABEL_GROUPS=[['priority','Важность'],['tag','Теги'],['folder','Папки'],['status','Статусы']];
const LABEL_COLOURS=[['neutral','обычный'],['red','красный'],['amber','янтарный'],['green','зелёный'],['teal','бирюзовый'],['blue','синий'],['violet','фиолетовый'],['grey','серый']];

async function loadLabels(force=false){
  if(S.labels&&!force)return S.labels;
  try{
    S.labels=(await api('/api/v1/labels')).items||[];
    S.labelsUnavailable=false;
  }catch(error){
    S.labels=[];
    S.labelsUnavailable=error.code==='LABELS_UNAVAILABLE'||error.status===503;
    if(!S.labelsUnavailable)toast(error.message);
  }
  return S.labels;
}

const labelChip=(label)=>`<span class="label-chip" data-kind="${esc(label.kind)}" data-colour="${esc(label.colour||'neutral')}">${esc(label.name)}${label.personal?'<i title="личная">•</i>':''}</span>`;
const labelChips=(labels)=>(labels||[]).map(labelChip).join('')||'<span class="muted">без меток</span>';

/** Toggle one label on one thing. Importance is exclusive on the server. */
async function toggleLabelOn(labelId,targetType,targetId,applied){
  await api(`/api/v1/labels/${labelId}/links/${targetType}/${targetId}`,{method:applied?'DELETE':'PUT'});
}

/**
 * The picker every labelled thing opens: messages, tasks and personal items
 * all reach the same sheet, so the vocabulary stays one vocabulary.
 */
/**
 * Метка на сообщении, задаче или событии хранилась, но в потоке переписки
 * не появлялась: человек помечал сообщение и не видел пометки. Карта
 * «что чем помечено» собирается разом по числу меток, а не по числу
 * сообщений на экране.
 */
async function loadLabelTargets(){
  await loadLabels();
  if(S.labelsUnavailable){S.labelTargets=new Map();return}
  const map=new Map();
  await Promise.all((S.labels||[]).map(async(label)=>{
    try{
      const{items}=await api(`/api/v1/labels/${label.id}/targets?limit=200`);
      for(const target of items||[]){
        const key=`${target.targetType}:${target.targetId}`;
        if(!map.has(key))map.set(key,[]);
        map.get(key).push(label);
      }
    }catch{/* метка могла исчезнуть, пока строили карту */}
  }));
  S.labelTargets=map;
}

async function labelPicker(targetType,targetId,{title='Метки',onChange}={}){
  await loadLabels();
  if(S.labelsUnavailable){toast('Метки доступны в режиме с базой данных');return}
  let applied=[];
  try{applied=(await api(`/api/v1/labelled/${targetType}/${targetId}`)).items||[]}
  catch(error){toast(error.message);return}
  const on=new Set(applied.map(l=>l.id));
  const groups=LABEL_GROUPS.map(([kind,caption])=>{
    const rows=S.labels.filter(l=>l.kind===kind);
    if(!rows.length)return '';
    return `<h3 class="person-section">${esc(caption)}</h3><div class="label-grid">${rows.map(l=>
      `<button class="label-option pressable${on.has(l.id)?' on':''}" data-label="${esc(l.id)}" data-on="${on.has(l.id)?'1':''}">${labelChip(l)}</button>`).join('')}</div>`;
  }).join('');

  modal(title,`${groups||'<p class="muted">Меток пока нет.</p>'}
    <div class="stack" style="margin-top:16px"><button data-new-label class="button secondary">＋ Новая метка</button></div>`,()=>{
    $$('[data-label]').forEach(button=>button.onclick=async()=>{
      const id=button.dataset.label,was=Boolean(button.dataset.on);
      button.disabled=true;
      try{
        await toggleLabelOn(id,targetType,targetId,was);
        await loadLabelTargets();
        if(S.view==='chats')render();
        // Importance is exclusive, so one click can clear another chip: the
        // sheet is re-read rather than patched in place.
        replaceModal(()=>labelPicker(targetType,targetId,{title,onChange}));
        onChange?.();
      }catch(error){toast(error.message);button.disabled=false}
    });
    $('[data-new-label]').onclick=()=>labelFormModal(null,'tag',()=>replaceModal(()=>labelPicker(targetType,targetId,{title,onChange})));
  });
}

/** The vocabulary itself: create, rename, recolour, delete. */
async function labelsModal(){
  await loadLabels(true);
  if(S.labelsUnavailable){toast('Метки доступны в режиме с базой данных');return}
  const groups=LABEL_GROUPS.map(([kind,caption])=>{
    const rows=S.labels.filter(l=>l.kind===kind);
    return `<h3 class="person-section">${esc(caption)}
        <button class="text-button" data-add="${kind}">＋ добавить</button>
      </h3>
      ${rows.length?`<div class="label-list">${rows.map(l=>`<div class="label-row">
        ${labelChip(l)}
        <span class="muted">${l.usage!==undefined?`${l.usage} <span>объектов</span>`:''}</span>
        <span class="inline-actions">
          <button class="text-button" data-edit-label="${esc(l.id)}">изменить</button>
          <button class="text-button danger" data-drop-label="${esc(l.id)}">удалить</button>
        </span>
      </div>`).join('')}</div>`:'<p class="muted">Пока ни одной.</p>'}`;
  }).join('');

  modal('Метки',`${groups}
    <p class="muted" style="margin-top:14px">Важность взаимно исключающая: новая заменяет прежнюю. Теги и папки накапливаются. Личная метка видна только вам.</p>`,()=>{
    $$('[data-add]').forEach(b=>b.onclick=()=>labelFormModal(null,b.dataset.add,()=>replaceModal(labelsModal)));
    $$('[data-edit-label]').forEach(b=>b.onclick=()=>{
      const label=S.labels.find(l=>l.id===b.dataset.editLabel);
      if(label)labelFormModal(label,label.kind,()=>replaceModal(labelsModal));
    });
    $$('[data-drop-label]').forEach(b=>b.onclick=async()=>{
      const label=S.labels.find(l=>l.id===b.dataset.dropLabel);
      if(!label)return;
      modal(`Удалить «${label.name}»?`,`<p class="muted">Метка снимется со всех объектов, на которых стоит. Сами объекты останутся.</p>
        <button id="confirm-label-delete" class="button danger" style="width:100%">Удалить метку</button>`,()=>{
        $('#confirm-label-delete').onclick=async()=>{
          try{
            await api(`/api/v1/labels/${label.id}`,{method:'DELETE'});
            S.labels=null;toast('Метка удалена');
            replaceModal(labelsModal);
          }catch(error){toast(error.message)}
        };
      });
    });
  });
}

function labelFormModal(existing,kind,after){
  const heading=existing?'Изменить метку':'Новая метка';
  modal(heading,`<form id="label-form" class="form-stack">
    <label>Название<input name="name" required maxlength="60" value="${esc(existing?.name??'')}"></label>
    <label>Вид<select name="kind" class="field"${existing?' disabled':''}>${LABEL_GROUPS.map(([k,caption])=>
      `<option value="${k}" ${((existing?.kind)??kind)===k?'selected':''}>${esc(caption)}</option>`).join('')}</select></label>
    <label>Цвет<select name="colour" class="field">${LABEL_COLOURS.map(([value,caption])=>
      `<option value="${value}" ${(existing?.colour??'neutral')===value?'selected':''}>${esc(caption)}</option>`).join('')}</select></label>
    ${existing?'':`<label class="row" style="cursor:pointer"><input type="checkbox" name="personal">
      <span><div class="row-title">Личная метка</div><div class="row-sub">Видна только вам и не попадает в общий словарь компании</div></span></label>`}
    <button class="button primary">${existing?'Сохранить':'Создать'}</button>
  </form>`,()=>{
    $('#label-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      try{
        if(existing){
          await api(`/api/v1/labels/${existing.id}`,{method:'PATCH',body:JSON.stringify({name:form.get('name'),colour:form.get('colour')})});
        }else{
          await api('/api/v1/labels',{method:'POST',body:JSON.stringify({
            kind:form.get('kind'),name:form.get('name'),colour:form.get('colour'),personal:form.get('personal')==='on',
          })});
        }
        S.labels=null;
        toast(existing?'Метка сохранена':'Метка создана');
        after?.();
      }catch(error){toast(error.message)}
    };
  });
}

// ── personal planning ───────────────────────────────────────────────────────
// A commitment has an owner who accepted it and someone who accepts the
// result. This list is the other thing: work nobody promised to anybody.
const PLAN_KIND={todo:'дело',note:'заметка',screenshot:'скриншот',link:'ссылка'};
const PLAN_STATUS={open:'открыто',done:'сделано',dropped:'снято'};
const PLAN_FILTERS=[['open','Открытые'],['done','Сделанные'],['all','Все']];

async function loadPlan(status=S.planFilter||'open'){
  S.planFilter=status;
  try{
    S.plan=(await api(`/api/v1/personal-items?status=${encodeURIComponent(status)}&limit=100`)).items||[];
    S.planUnavailable=false;
  }catch(error){
    S.plan=[];
    S.planUnavailable=error.code==='PERSONAL_UNAVAILABLE'||error.status===503;
    if(!S.planUnavailable)toast(error.message);
  }
  return S.plan;
}

const planDue=(item)=>{
  if(item.plannedStart)return `в календаре ${dateTime(item.plannedStart)}`;
  if(item.dueAt)return `срок ${dateTime(item.dueAt)}`;
  return '';
};

function planRow(item){
  const meta=[planDue(item),item.commentCount?`${item.commentCount} комм.`:'',item.fileCount?`${item.fileCount} файл.`:''].filter(Boolean).join(' · ');
  return `<div class="plan-row${item.status==='done'?' is-done':''}">
    <button class="plan-check pressable" data-plan-toggle="${esc(item.id)}" data-status="${esc(item.status)}"
      aria-label="${item.status==='done'?'Вернуть в работу':'Отметить сделанным'}">${item.status==='done'?'✓':''}</button>
    <button class="plan-body pressable" data-plan-open="${esc(item.id)}">
      <div class="row-title">${esc(item.title)}</div>
      <div class="row-sub">${esc(PLAN_KIND[item.kind]||item.kind)}${meta?` · ${esc(meta)}`:''}</div>
      ${(item.labels||[]).length?`<div class="plan-labels">${(item.labels||[]).map(labelChip).join('')}</div>`:''}
    </button>
  </div>`;
}

/** Wires the two controls a row carries, wherever that row is rendered. */
function bindPlanRows(reload){
  $$('[data-plan-toggle]').forEach(button=>button.onclick=async()=>{
    const done=button.dataset.status==='done';
    button.disabled=true;
    try{
      await api(`/api/v1/personal-items/${button.dataset.planToggle}`,{method:'PATCH',body:JSON.stringify({status:done?'open':'done'})});
      await reload();
    }catch(error){toast(error.message);button.disabled=false}
  });
  $$('[data-plan-open]').forEach(button=>button.onclick=()=>planItemPage(button.dataset.planOpen));
}

/**
 * Хранилище паролей.
 *
 * Экран списка секретов не содержит: пароль приходит отдельным запросом и
 * только по нажатию — случайно увидеть чужой через плечо нельзя, и в
 * аудите остаётся, что его смотрели. Показанный пароль прячется сам.
 */
function generatePassword(length=20){
  // Без похожих знаков: 0/O и 1/l/I человек всё равно перепутает, когда
  // будет диктовать пароль по телефону.
  const alphabet='abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+';
  const bytes=new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map(v=>alphabet[v%alphabet.length]).join('');
}

function vaultRow(entry){
  return `<div class="row" data-vault="${esc(entry.id)}">
    <span class="avatar dark" aria-hidden="true">⚿</span>
    <span><div class="row-title">${esc(entry.title)}</div>
      <div class="row-sub">${esc([entry.login,entry.url].filter(Boolean).join(' · ')||'без логина')}</div>
      <div class="vault-secret" data-vault-secret="${esc(entry.id)}" hidden></div></span>
    <span class="inline-actions">
      <button class="text-button" data-vault-reveal="${esc(entry.id)}">Показать</button>
      <button class="text-button" data-vault-edit="${esc(entry.id)}">Изменить</button>
      <button class="text-button danger" data-vault-delete="${esc(entry.id)}" aria-label="Удалить запись">×</button>
    </span>
  </div>`;
}

async function vaultModal(){
  const build=async()=>{
    let items=[];
    try{items=(await api('/api/v1/vault')).items||[]}
    catch(error){
      return {title:'Пароли',body:`<div class="empty"><strong>Хранилище недоступно</strong>${esc(error.message)}</div>`,after:()=>{}};
    }
    return {
      title:'Пароли',
      body:`<p class="muted">Пароли хранятся зашифрованными, ключ лежит вне базы. Каждый показ пароля попадает в журнал действий.</p>
      <div class="stack" style="margin-top:12px">${items.length?items.map(vaultRow).join(''):'<div class="empty"><strong>Пока пусто</strong>Запишите первый пароль — он не попадёт в переписку.</div>'}</div>
      <button data-vault-new class="button primary" style="width:100%;margin-top:14px">＋ Новый пароль</button>`,
      after:()=>{
        $('[data-vault-new]').onclick=()=>vaultFormModal(null,refresh);
        $$('[data-vault-edit]').forEach(b=>b.onclick=()=>vaultFormModal(items.find(x=>x.id===b.dataset.vaultEdit),refresh));
        $$('[data-vault-delete]').forEach(b=>b.onclick=()=>{
          const entry=items.find(x=>x.id===b.dataset.vaultDelete);
          modal(`Удалить «${entry?.title??'запись'}»?`,`<p class="muted">Пароль пропадёт безвозвратно: расшифровать его потом будет нечем.</p>
            <button id="confirm-vault-delete" class="button danger" style="width:100%">Удалить</button>`,()=>{
            $('#confirm-vault-delete').onclick=async()=>{
              try{await api(`/api/v1/vault/${b.dataset.vaultDelete}`,{method:'DELETE'});history.back();setTimeout(refresh,250);toast('Запись удалена')}
              catch(error){toast(error.message)}
            };
          });
        });
        $$('[data-vault-reveal]').forEach(b=>b.onclick=async()=>{
          const slot=$(`[data-vault-secret="${b.dataset.vaultReveal}"]`);
          if(!slot.hidden){slot.hidden=true;slot.textContent='';b.textContent='Показать';return}
          try{
            const{entry}=await api(`/api/v1/vault/${b.dataset.vaultReveal}/secret`,{method:'POST'});
            slot.textContent=entry.secret;slot.hidden=false;b.textContent='Скрыть';
            try{await navigator.clipboard.writeText(entry.secret);toast('Пароль скопирован')}catch{toast('Пароль показан')}
            // Открытый пароль не должен висеть на экране: через полминуты
            // он прячется сам.
            setTimeout(()=>{if(slot.isConnected&&!slot.hidden){slot.hidden=true;slot.textContent='';b.textContent='Показать'}},30000);
          }catch(error){toast(error.message)}
        });
      },
    };
  };
  const refresh=async()=>{
    const next=await build();
    const top=overlayStack[overlayStack.length-1];
    if(top){Object.assign(top,next);renderOverlay()}
  };
  const first=await build();
  modal(first.title,first.body,first.after,build);
}

function vaultFormModal(entry,after){
  const editing=Boolean(entry);
  modal(editing?'Изменить запись':'Новый пароль',`<form id="vault-form" class="form-stack">
    <label>Название<input name="title" maxlength="200" required value="${esc(entry?.title??'')}" placeholder="Портал подрядчика"></label>
    <label>Логин<input name="login" maxlength="200" value="${esc(entry?.login??'')}" autocomplete="off"></label>
    <label>Адрес<input name="url" maxlength="500" value="${esc(entry?.url??'')}" placeholder="https://"></label>
    <label>Пароль${editing?' <span class="muted">(оставьте пустым, чтобы не менять)</span>':''}
      <input name="secret" type="password" maxlength="4000" autocomplete="new-password" ${editing?'':'required'}></label>
    <div class="chip-row"><button type="button" class="chipbtn pressable" data-generate>Придумать пароль</button>
      <button type="button" class="chipbtn pressable" data-show-secret>Показать ввод</button></div>
    <label>Заметка<textarea name="note" maxlength="2000" rows="2">${esc(entry?.note??'')}</textarea></label>
    <button class="button primary">${editing?'Сохранить':'Сохранить пароль'}</button>
  </form>`,()=>{
    const field=$('#vault-form [name="secret"]');
    $('[data-generate]').onclick=()=>{field.value=generatePassword();field.type='text';toast('Пароль придуман — не забудьте сохранить')};
    $('[data-show-secret]').onclick=()=>{field.type=field.type==='password'?'text':'password'};
    $('#vault-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const body={title:form.get('title'),login:form.get('login'),url:form.get('url'),note:form.get('note')};
      const secret=form.get('secret');
      if(secret)body.secret=secret;
      try{
        if(editing)await api(`/api/v1/vault/${entry.id}`,{method:'PATCH',body:JSON.stringify(body)});
        else await api('/api/v1/vault',{method:'POST',body:JSON.stringify(body)});
        history.back();setTimeout(()=>after?.(),250);
        toast(editing?'Запись изменена':'Пароль записан');
      }catch(error){toast(error.message)}
    };
  });
}

const REMINDER_FILTERS=[['open','Ждут'],['done','Сделанные'],['all','Все']];

/** «Через час», «завтра в 9», «в понедельник в 9» — то, что выбирают чаще всего. */
function reminderPresets(){
  const hour=new Date(Date.now()+3600e3);
  const morning=new Date();morning.setDate(morning.getDate()+1);morning.setHours(9,0,0,0);
  const monday=new Date();monday.setDate(monday.getDate()+((8-monday.getDay())%7||7));monday.setHours(9,0,0,0);
  return [['Через час',hour],['Завтра в 9:00',morning],['В понедельник',monday]];
}
const localInput=(date)=>{
  const pad=(n)=>String(n).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function reminderRow(r){
  const at=new Date(r.remindAt);
  const overdue=r.status==='fired'||(r.status==='pending'&&at.getTime()<Date.now());
  return `<div class="row" data-reminder="${esc(r.id)}">
    <span class="avatar dark" aria-hidden="true">◔</span>
    <span><div class="row-title">${esc(r.title)}</div>
      <div class="row-sub">${esc(dateTime(r.remindAt))}${r.note?` · ${esc(r.note.slice(0,60))}`:''}</div></span>
    <span class="inline-actions">
      ${overdue?'<span class="chip warm">пора</span>':''}
      ${r.status==='done'?'<button class="text-button" data-reminder-reopen="'+r.id+'">Снова ждать</button>'
        :`<button class="text-button" data-reminder-snooze="${esc(r.id)}">＋1 час</button><button class="text-button" data-reminder-done="${esc(r.id)}">Готово</button>`}
      <button class="text-button danger" data-reminder-delete="${esc(r.id)}" aria-label="Удалить напоминание">×</button>
    </span>
  </div>`;
}

/**
 * Напоминания. Отдельно от задач: задача — обязательство перед кем-то,
 * с ответственным и доказательством; напоминание — разговор с самим собой.
 */
async function remindersModal(status='open'){
  S.reminderFilter=status;
  const build=async()=>{
    let items=[];
    try{items=(await api(`/api/v1/reminders?status=${encodeURIComponent(S.reminderFilter)}`)).items||[]}
    catch(error){return {title:'Напоминания',body:`<div class="empty"><strong>Напоминания недоступны</strong>${esc(error.message)}</div>`,after:()=>{}}}
    const filters=REMINDER_FILTERS.map(([value,caption])=>
      `<button class="chipbtn pressable${S.reminderFilter===value?' on':''}" data-reminder-filter="${value}">${esc(caption)}</button>`).join('');
    return {
      title:'Напоминания',
      body:`<form id="reminder-add" class="form-stack" style="margin-bottom:14px">
        <label>О чём напомнить<input name="title" maxlength="200" required placeholder="Позвонить подрядчику"></label>
        <label>Когда<input name="remindAt" type="datetime-local" required value="${esc(localInput(new Date(Date.now()+3600e3)))}"></label>
        <div class="chip-row">${reminderPresets().map(([caption,when])=>
          `<button type="button" class="chipbtn pressable" data-preset="${esc(localInput(when))}">${esc(caption)}</button>`).join('')}</div>
        <button class="button primary">Напомнить</button>
      </form>
      <div class="chip-row">${filters}</div>
      <div class="stack" style="margin-top:10px">${items.length?items.map(reminderRow).join(''):'<div class="empty"><strong>Пока пусто</strong>Напоминание придёт в центр внимания в назначенный час.</div>'}</div>`,
      after:()=>{
        $('#reminder-add').onsubmit=async(event)=>{
          event.preventDefault();
          const form=new FormData(event.currentTarget);
          try{
            await api('/api/v1/reminders',{method:'POST',body:JSON.stringify({
              title:form.get('title'),remindAt:new Date(form.get('remindAt')).toISOString(),
            })});
            toast('Напоминание поставлено');await refresh();
          }catch(error){toast(error.message)}
        };
        $$('[data-preset]').forEach(b=>b.onclick=()=>{$('#reminder-add [name="remindAt"]').value=b.dataset.preset});
        $$('[data-reminder-filter]').forEach(b=>b.onclick=async()=>{S.reminderFilter=b.dataset.reminderFilter;await refresh()});
        const patch=async(id,body)=>{try{await api(`/api/v1/reminders/${id}`,{method:'PATCH',body:JSON.stringify(body)});await refresh()}catch(error){toast(error.message)}};
        $$('[data-reminder-done]').forEach(b=>b.onclick=()=>patch(b.dataset.reminderDone,{status:'done'}));
        $$('[data-reminder-reopen]').forEach(b=>b.onclick=()=>patch(b.dataset.reminderReopen,{status:'pending'}));
        $$('[data-reminder-snooze]').forEach(b=>b.onclick=()=>patch(b.dataset.reminderSnooze,{remindAt:new Date(Date.now()+3600e3).toISOString()}));
        $$('[data-reminder-delete]').forEach(b=>b.onclick=async()=>{
          try{await api(`/api/v1/reminders/${b.dataset.reminderDelete}`,{method:'DELETE'});await refresh()}catch(error){toast(error.message)}
        });
      },
    };
  };
  const refresh=async()=>{
    const next=await build();
    const top=overlayStack[overlayStack.length-1];
    if(top){Object.assign(top,next);renderOverlay()}
  };
  const first=await build();
  modal(first.title,first.body,first.after,build);
}

/** Напомнить о сообщении или задаче, не уходя со страницы. */
function remindAboutModal(title,{sourceType,sourceId,conversationId}={}){
  modal('Напомнить',`<form id="remind-about" class="form-stack">
    <label>О чём<input name="title" maxlength="200" required value="${esc(title.slice(0,200))}"></label>
    <label>Когда<input name="remindAt" type="datetime-local" required value="${esc(localInput(new Date(Date.now()+3600e3)))}"></label>
    <div class="chip-row">${reminderPresets().map(([caption,when])=>
      `<button type="button" class="chipbtn pressable" data-preset="${esc(localInput(when))}">${esc(caption)}</button>`).join('')}</div>
    <button class="button primary">Напомнить</button>
  </form>`,()=>{
    $$('[data-preset]').forEach(b=>b.onclick=()=>{$('#remind-about [name="remindAt"]').value=b.dataset.preset});
    $('#remind-about').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      try{
        await api('/api/v1/reminders',{method:'POST',body:JSON.stringify({
          title:form.get('title'),remindAt:new Date(form.get('remindAt')).toISOString(),
          sourceType,sourceId,conversationId,
        })});
        closeModal();toast('Напоминание поставлено');
      }catch(error){toast(error.message)}
    };
  });
}

async function planModal(status=S.planFilter||'open'){
  await loadPlan(status);
  if(S.planUnavailable){toast('Личное планирование доступно в режиме с базой данных');return}

  // Built as a function rather than a string: the sheet is re-read whenever it
  // becomes the top of the stack again, so a change made above it shows.
  const build=async(reload=false)=>{
    if(reload)await loadPlan(S.planFilter);
    const filters=PLAN_FILTERS.map(([value,caption])=>
      `<button class="chipbtn pressable${S.planFilter===value?' on':''}" data-plan-filter="${value}">${esc(caption)}</button>`).join('');
    const list=S.plan.length?S.plan.map(planRow).join(''):'<div class="empty">Здесь пусто. Запишите первое дело.</div>';
    return {
      title:'Личные дела',
      body:`
    <form id="plan-add" class="quick-bar" style="margin-bottom:12px">
      <input name="title" placeholder="Что нужно сделать или запомнить" aria-label="Новое дело" maxlength="240" required>
      <button type="submit" class="button primary small pressable">Добавить</button>
    </form>
    <div class="chip-row">${filters}</div>
    <div class="plan-list">${list}</div>`,
      after:()=>{
        $('#plan-add').onsubmit=async(event)=>{
          event.preventDefault();
          const title=new FormData(event.currentTarget).get('title')?.toString().trim();
          if(!title)return;
          try{
            await api('/api/v1/personal-items',{method:'POST',body:JSON.stringify({kind:'todo',title})});
            await refresh();
            if(S.view==='today')render();
          }catch(error){toast(error.message)}
        };
        $$('[data-plan-filter]').forEach(b=>b.onclick=async()=>{S.planFilter=b.dataset.planFilter;await refresh()});
        bindPlanRows(async()=>{await refresh();if(S.view==='today')render()});
      },
    };
  };

  const refresh=async()=>{
    const next=await build(true);
    const top=overlayStack[overlayStack.length-1];
    if(!top)return next;
    Object.assign(top,next);
    renderOverlay();
    return next;
  };

  const first=await build();
  modal(first.title,first.body,first.after,()=>build(true));
}

async function planItemPage(id){
  const build=async()=>{
    const item=(await api(`/api/v1/personal-items/${id}`)).item;
    const comments=item.comments||[];
    const files=item.files||[];
    return {
      title:item.title,
      body:`
    <div class="person-fields">
      <div class="person-field"><span>Тип</span><strong>${esc(PLAN_KIND[item.kind]||item.kind)}</strong></div>
      <div class="person-field"><span>Состояние</span><strong>${esc(PLAN_STATUS[item.status]||item.status)}</strong></div>
      ${item.plannedStart?`<div class="person-field"><span>В календаре</span><strong>${esc(dateTime(item.plannedStart))}</strong></div>`:''}
      ${item.dueAt?`<div class="person-field"><span>Срок</span><strong>${esc(dateTime(item.dueAt))}</strong></div>`:''}
    </div>
    ${item.body?`<p class="person-about">${esc(item.body)}</p>`:''}
    <h3 class="person-section">Метки <button class="text-button" data-plan-labels>изменить</button></h3>
    <div class="person-chips">${labelChips(item.labels)}</div>
    <h3 class="person-section"><span>Комментарии</span> — ${comments.length}</h3>
    <div class="person-feed">${comments.length?comments.map(c=>
      `<div class="person-event"><span>${esc(c.body)}</span><time>${esc(when(c.createdAt))}</time></div>`).join(''):'<p class="muted">Пока ничего не записано.</p>'}</div>
    <form id="plan-comment" class="quick-bar" style="margin-top:8px">
      <input name="body" placeholder="Добавить комментарий" aria-label="Комментарий" maxlength="4000" required>
      <button type="submit" class="button secondary small pressable">Записать</button>
    </form>
    <h3 class="person-section"><span>Файлы</span> — ${files.length}</h3>
    <div class="person-feed">${files.length?files.map(f=>
      `<a class="person-event" href="/api/v1/files/${esc(f.id)}/content" target="_blank" rel="noopener"><span>${esc(f.name)}</span></a>`).join(''):'<p class="muted">Вложений нет.</p>'}</div>
    <div class="stack" style="margin-top:16px">
      <button data-plan-edit class="button secondary">Изменить текст</button>
      <button data-plan-schedule class="button secondary">${item.plannedStart?'Перенести в календаре':'Поставить в календарь'}</button>
      <button data-plan-status class="button secondary">${item.status==='done'?'Вернуть в работу':'Отметить сделанным'}</button>
      <button data-plan-delete class="button danger">Удалить</button>
    </div>`,
      after:()=>{
        $('[data-plan-labels]').onclick=()=>labelPicker('note',item.id,{title:`Метки: ${item.title}`,onChange:async()=>{
          await loadPlan();if(S.view==='today')render();
        }});
        $('#plan-comment').onsubmit=async(event)=>{
          event.preventDefault();
          const body=new FormData(event.currentTarget).get('body')?.toString().trim();
          if(!body)return;
          try{await api(`/api/v1/personal-items/${item.id}/comments`,{method:'POST',body:JSON.stringify({body})});await refresh()}
          catch(error){toast(error.message)}
        };
        $('[data-plan-edit]').onclick=()=>planEditModal(item,refresh);
        $('[data-plan-schedule]').onclick=()=>planScheduleModal(item,refresh);
        $('[data-plan-status]').onclick=async()=>{
          try{
            await api(`/api/v1/personal-items/${item.id}`,{method:'PATCH',body:JSON.stringify({status:item.status==='done'?'open':'done'})});
            await loadPlan();if(S.view==='today')render();
            await refresh();
          }catch(error){toast(error.message)}
        };
        $('[data-plan-delete]').onclick=()=>{
          modal('Удалить дело?',`<p class="muted">Запись, её комментарии и вложения исчезнут. Событие в календаре, если оно было создано, останется.</p>
            <button id="confirm-plan-delete" class="button danger" style="width:100%">Удалить</button>`,()=>{
            $('#confirm-plan-delete').onclick=async()=>{
              try{
                await api(`/api/v1/personal-items/${item.id}`,{method:'DELETE'});
                await loadPlan();if(S.view==='today')render();
                toast('Дело удалено');
                closeModal();
              }catch(error){toast(error.message)}
            };
          });
        };
      },
    };
  };

  const refresh=async()=>{
    const next=await build();
    const top=overlayStack[overlayStack.length-1];
    if(top){Object.assign(top,next);renderOverlay()}
    return next;
  };

  try{
    const first=await build();
    modal(first.title,first.body,first.after,build);
  }catch(error){toast(error.message)}
}

function planEditModal(item,after){
  modal('Изменить дело',`<form id="plan-edit" class="form-stack">
    <label>Название<input name="title" required maxlength="240" value="${esc(item.title)}"></label>
    <label>Тип<select name="kind" class="field">${Object.entries(PLAN_KIND).map(([value,caption])=>
      `<option value="${value}" ${item.kind===value?'selected':''}>${esc(caption)}</option>`).join('')}</select></label>
    <label>Текст<textarea name="body" rows="5" maxlength="20000">${esc(item.body??'')}</textarea></label>
    <label>Срок<input name="dueAt" type="datetime-local" value="${esc(toLocalInput(item.dueAt))}"></label>
    <button class="button primary">Сохранить</button>
  </form>`,()=>{
    $('#plan-edit').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      try{
        await api(`/api/v1/personal-items/${item.id}`,{method:'PATCH',body:JSON.stringify({
          title:form.get('title'),kind:form.get('kind'),body:form.get('body')||null,
          dueAt:form.get('dueAt')?new Date(form.get('dueAt')).toISOString():null,
        })});
        await loadPlan();if(S.view==='today')render();
        replaceModal(after);
      }catch(error){toast(error.message)}
    };
  });
}

function planScheduleModal(item,after){
  const start=item.plannedStart?toLocalInput(item.plannedStart):toLocalInput(new Date(Date.now()+3600000).toISOString());
  modal('Поставить в календарь',`<form id="plan-schedule" class="form-stack">
    <p class="muted">Дело появится в вашем календаре отдельным блоком. Обещанием кому-то оно от этого не станет.</p>
    <label>Начало<input name="startAt" type="datetime-local" required value="${esc(start)}"></label>
    <label>Окончание<input name="endAt" type="datetime-local" value="${esc(toLocalInput(item.plannedEnd))}"></label>
    <button class="button primary">Поставить</button>
  </form>`,()=>{
    $('#plan-schedule').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      try{
        await api(`/api/v1/personal-items/${item.id}/schedule`,{method:'POST',body:JSON.stringify({
          startAt:new Date(form.get('startAt')).toISOString(),
          endAt:form.get('endAt')?new Date(form.get('endAt')).toISOString():null,
        })});
        await Promise.all([loadPlan(),loadCalendarRange()]);
        render();
        toast('Дело в календаре');
        replaceModal(after);
      }catch(error){toast(error.message)}
    };
  });
}

// ── games colleagues play with each other ──────────────────────────────────
// The board is drawn here; every rule is the server's. A move is sent and the
// position that comes back is the truth — this screen never decides what is
// legal, which is why two people cannot disagree about a position.
const GAME_NAME={chess:'Шахматы',checkers:'Шашки',battleship:'Морской бой'};
const GAME_ICON={chess:'♞',checkers:'⛂',battleship:'⚓'};
const CHESS_GLYPH={K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
const GAME_RESULT={checkmate:'мат',stalemate:'пат',resigned:'сдался',draw:'ничья','no-pieces':'все фигуры побиты','no-moves':'ходов не осталось','fleet-destroyed':'флот потоплен','insufficient-material':'ничья: нечем матовать','fifty-move':'ничья по правилу 50 ходов'};

async function gamesModal(conversationId=null){
  try{
    const first=await gamesBuild(conversationId);
    modal(first.title,first.body,first.after,()=>gamesBuild(conversationId));
  }catch(error){
    toast(error.code==='GAMES_UNAVAILABLE'?'Игры доступны в режиме с базой данных':error.message);
  }
}

/** Re-read when this sheet becomes the top again, so a finished game shows. */
async function gamesBuild(conversationId){
  const query=conversationId?`?conversationId=${encodeURIComponent(conversationId)}`:'';
  const items=(await api(`/api/v1/games${query}`)).items||[];
  return {title:conversationId?'Игры в этой беседе':'Игры',body:gamesBody(items,conversationId),after:()=>{
    $$('[data-game]').forEach(b=>b.onclick=()=>gamePage(b.dataset.game));
    $('[data-new-game]').onclick=()=>newGameModal(conversationId);
  }};
}
function gamesBody(items,conversationId){
  const row=(g)=>{
    const opponent=g.challengerId===me().userId?g.opponentId:g.challengerId;
    const waiting=g.status==='invited'&&g.opponentId===me().userId;
    const state=g.status==='finished'
      ? `${g.winnerId?(g.winnerId===me().userId?'вы выиграли':'вы проиграли'):'ничья'} · ${GAME_RESULT[g.result]||g.result}`
      : g.status==='invited'?(waiting?'ждёт вашего ответа':'ждём ответа соперника')
      : g.yourTurn?'ваш ход':'ход соперника';
    return `<button class="row pressable" data-game="${esc(g.id)}">
      <span class="game-mark">${GAME_ICON[g.kind]||'●'}</span>
      <span><div class="row-title">${esc(GAME_NAME[g.kind]||g.kind)} · ${esc(name(opponent))}</div><div class="row-sub">${esc(state)}</div></span>
      ${g.yourTurn&&g.status==='active'?'<span class="chip warm">ваш ход</span>':waiting?'<span class="chip warm">ответьте</span>':'<span class="chip"></span>'}
    </button>`;
  };
  return `${items.length?items.map(row).join(''):'<p class="muted">Партий пока нет.</p>'}
    <div class="stack" style="margin-top:16px"><button data-new-game class="button secondary">Позвать сыграть</button></div>`;
}

async function newGameModal(conversationId){
  let people=S.people.filter(p=>p.userId!==me().userId&&p.role!=='guest');
  if(conversationId){
    try{
      const{items}=await api(`/api/v1/conversations/${conversationId}/members`);
      const inRoom=new Set((items||[]).map(m=>m.userId));
      people=people.filter(p=>inRoom.has(p.userId));
    }catch{/* участников не прочитать — покажем всех, отказ объяснит сервер */}
    if(!people.length)return toast('В этой беседе больше никого нет — позовите коллегу в неё или начните игру из раздела «Игры».');
  }
  if(!people.length)return toast('Сначала пригласите коллег');
  modal('Позвать сыграть',`<form id="game-form" class="form-stack">
    <label>Игра<select name="kind" class="field">
      <option value="chess">Шахматы</option><option value="checkers">Шашки</option><option value="battleship">Морской бой</option>
    </select></label>
    <label>Соперник<select name="opponentId" class="field">${people.map(p=>`<option value="${esc(p.userId)}">${esc(p.displayName||p.email)}</option>`).join('')}</select></label>
    <p class="muted">Соперник получит приглашение и решит сам. Партия появится в беседе, которая у вас уже есть.</p>
    <button class="button primary">Позвать</button>
  </form>`,()=>{
    $('#game-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      try{
        const{game}=await api('/api/v1/games',{method:'POST',body:JSON.stringify({
          kind:form.get('kind'),opponentId:form.get('opponentId'),conversationId:conversationId??undefined,
        })});
        toast('Приглашение отправлено');
        replaceModal(()=>gamePage(game.id));
      }catch(error){toast(error.message)}
    };
  });
}

/** One game: the board, whose move it is, and what can be done about it. */
async function gamePage(id){
  const build=async()=>{
    const[{game},played]=await Promise.all([
      api(`/api/v1/games/${id}`),
      api(`/api/v1/games/${id}/moves`).catch(()=>({items:[]})),
    ]);
    const opponent=game.challengerId===me().userId?game.opponentId:game.challengerId;
    const record=(played.items||[]);
    const recordBlock=record.length?`<div class="game-record"><div class="row-title">Ходы</div><ol class="game-moves">${record.slice(-16).map(mv=>`<li><span class="muted">${mv.ordinal}.</span> ${esc(mv.notation)} <span class="muted">— ${esc(mv.actorId===me().userId?'вы':name(mv.actorId))}</span></li>`).join('')}</ol>${record.length>16?`<div class="row-sub">Показаны последние 16 из ${record.length}.</div>`:''}</div>`:'';
    const heading=`${GAME_NAME[game.kind]||game.kind} · ${name(opponent)}`;
    const status=game.status==='finished'
      ? `<div class="game-status done">${game.winnerId?(game.winnerId===me().userId?'Вы выиграли':'Вы проиграли'):'Ничья'} — ${esc(GAME_RESULT[game.result]||game.result)}</div>`
      : game.status==='invited'
        ? `<div class="game-status">${game.opponentId===me().userId?'Вас зовут сыграть':'Ждём ответа соперника'}</div>`
        : `<div class="game-status${game.yourTurn?' yours':''}">${game.yourTurn?'Ваш ход':'Ход соперника'}</div>`;

    const board=game.status==='invited'?'' :
      game.kind==='battleship'?battleshipBoards(game):squareBoard(game);

    const actions=[];
    if(game.status==='invited'&&game.opponentId===me().userId){
      actions.push('<button data-accept class="button primary">Играть</button>');
      actions.push('<button data-decline class="button secondary">Отказаться</button>');
    }
    if(game.status==='active')actions.push('<button data-resign class="button danger">Сдаться</button>');
    if(game.kind==='battleship'&&game.status==='active'&&game.state.phase==='placing'&&!game.state.myFleet.length){
      actions.unshift('<button data-fleet class="button primary">Расставить корабли</button>');
    }

    return {title:heading,body:`${status}${board}${recordBlock}
      <div class="stack" style="margin-top:14px">${actions.join('')}</div>`,after:()=>{
      $('[data-accept]')?.addEventListener('click',()=>respondGame(id,true,refresh));
      $('[data-decline]')?.addEventListener('click',()=>respondGame(id,false,refresh));
      $('[data-resign]')?.addEventListener('click',()=>{
        modal('Сдаться?','<p class="muted">Партия завершится, победа засчитается сопернику.</p><button id="confirm-resign" class="button danger" style="width:100%">Сдаюсь</button>',()=>{
          $('#confirm-resign').onclick=async()=>{
            try{await api(`/api/v1/games/${id}/resign`,{method:'POST'});toast('Партия завершена');history.back();setTimeout(refresh,300)}
            catch(error){toast(error.message)}
          };
        });
      });
      $('[data-fleet]')?.addEventListener('click',async()=>{
        try{await api(`/api/v1/games/${id}/moves`,{method:'POST',body:JSON.stringify({ships:randomFleetClient()})});await refresh()}
        catch(error){toast(error.message)}
      });
      bindBoard(game,refresh);
    }};
  };

  const refresh=async()=>{
    const next=await build();
    const top=overlayStack[overlayStack.length-1];
    if(top){Object.assign(top,next);renderOverlay()}
  };

  try{
    const first=await build();
    modal(first.title,first.body,first.after,build);
    // The opponent moves on their own screen; the board follows without a
    // reload because the server tells every player when a game changed.
    S.gameWatch=id;
  }catch(error){toast(error.message)}
}

async function respondGame(id,accept,after){
  try{
    await api(`/api/v1/games/${id}/respond`,{method:'POST',body:JSON.stringify({accept})});
    toast(accept?'Партия началась':'Вы отказались');
    if(accept)await after?.();else history.back();
  }catch(error){toast(error.message)}
}

/** Chess and draughts share one 8×8 grid; only the glyphs differ. */
function squareBoard(game){
  const state=game.state||{};
  const board=state.board||'';
  const flip=game.side==='b';
  const selected=S.gameFrom;
  const cells=[];
  for(let rank=0;rank<8;rank+=1){
    for(let file=0;file<8;file+=1){
      const index=flip?(7-rank)*8+(7-file):rank*8+file;
      const piece=board[index]||'.';
      const dark=(Math.floor(index/8)+index%8)%2===1;
      const glyph=game.kind==='chess'?(CHESS_GLYPH[piece]||'')
        :piece==='.'?'':`<i class="draught ${piece.toLowerCase()==='w'?'light':'dark'}${piece===piece.toUpperCase()?' king':''}"></i>`;
      cells.push(`<button class="game-cell${dark?' dark':''}${selected===index?' picked':''}" data-cell="${index}" ${game.yourTurn&&game.status==='active'?'':'disabled'}>${glyph}</button>`);
    }
  }
  return `<div class="game-board">${cells.join('')}</div>`;
}

function battleshipBoards(game){
  const state=game.state||{};
  if(state.phase==='placing'){
    const mine=new Set((state.myFleet||[]).flat());
    return `<p class="muted">${state.myFleet?.length?'Флот расставлен, ждём соперника.':'Расставьте корабли — кнопка ниже разложит их по правилам.'}</p>
      <div class="sea-wrap"><div class="sea">${Array.from({length:100},(_,i)=>`<span class="sea-cell${mine.has(i)?' ship':''}"></span>`).join('')}</div></div>`;
  }
  const mine=new Set((state.myFleet||[]).flat());
  const incoming=state.incoming||{},outgoing=state.outgoing||{};
  const theirs=Array.from({length:100},(_,i)=>{
    const shot=outgoing[i];
    return `<button class="sea-cell${shot?` ${shot}`:''}" data-shot="${i}" ${game.yourTurn&&!shot&&game.status==='active'?'':'disabled'}></button>`;
  }).join('');
  const ours=Array.from({length:100},(_,i)=>{
    const shot=incoming[i];
    return `<span class="sea-cell${mine.has(i)?' ship':''}${shot?` ${shot}`:''}"></span>`;
  }).join('');
  return `<h3 class="person-section">Поле соперника</h3><div class="sea-wrap"><div class="sea">${theirs}</div></div>
    <h3 class="person-section">Ваше поле</h3><div class="sea-wrap"><div class="sea">${ours}</div></div>`;
}

function bindBoard(game,refresh){
  $$('[data-cell]').forEach(cell=>cell.onclick=async()=>{
    const index=Number(cell.dataset.cell);
    const board=game.state?.board||'';
    const piece=board[index]||'.';
    const isMine=piece!=='.'&&((game.side==='w')===(piece===piece.toUpperCase()));
    if(S.gameFrom===null||S.gameFrom===undefined){
      if(!isMine)return;
      S.gameFrom=index;
      const top=overlayStack[overlayStack.length-1];
      if(top){Object.assign(top,{body:top.body});}
      cell.classList.add('picked');
      return;
    }
    if(S.gameFrom===index){S.gameFrom=null;cell.classList.remove('picked');return}
    if(isMine){ $$('[data-cell].picked').forEach(c=>c.classList.remove('picked')); S.gameFrom=index; cell.classList.add('picked'); return }
    const from=S.gameFrom;
    S.gameFrom=null;
    try{await api(`/api/v1/games/${game.id}/moves`,{method:'POST',body:JSON.stringify({from,to:index})});await refresh()}
    catch(error){toast(error.message);await refresh()}
  });
  $$('[data-shot]').forEach(cell=>cell.onclick=async()=>{
    try{
      const{game:next}=await api(`/api/v1/games/${game.id}/moves`,{method:'POST',body:JSON.stringify({cell:Number(cell.dataset.shot)})});
      const last=Object.entries(next.state.outgoing||{}).find(([k])=>Number(k)===Number(cell.dataset.shot));
      if(last)toast(last[1]==='hit'?'Попадание':'Мимо');
      await refresh();
    }catch(error){toast(error.message)}
  });
}

/**
 * A legal layout, produced here so nobody drags ten ships around on a phone.
 * The server checks it anyway — this is a convenience, not a source of truth.
 */
function randomFleetClient(){
  const SIZE=10,FLEET=[4,3,3,2,2,2,1,1,1,1];
  for(let attempt=0;attempt<500;attempt+=1){
    const ships=[],taken=new Set();
    let ok=true;
    for(const size of FLEET){
      let placed=null;
      for(let tries=0;tries<300&&!placed;tries+=1){
        const horizontal=Math.random()<0.5;
        const x=Math.floor(Math.random()*(horizontal?SIZE-size+1:SIZE));
        const y=Math.floor(Math.random()*(horizontal?SIZE:SIZE-size+1));
        const cells=[];
        for(let i=0;i<size;i+=1)cells.push(horizontal?y*SIZE+x+i:(y+i)*SIZE+x);
        if(cells.some(c=>taken.has(c)))continue;
        placed=cells;
      }
      if(!placed){ok=false;break}
      ships.push(placed);
      for(const cell of placed){
        const cx=cell%SIZE,cy=Math.floor(cell/SIZE);
        for(let dx=-1;dx<=1;dx+=1)for(let dy=-1;dy<=1;dy+=1){
          const nx=cx+dx,ny=cy+dy;
          if(nx>=0&&nx<SIZE&&ny>=0&&ny<SIZE)taken.add(ny*SIZE+nx);
        }
      }
    }
    if(ok)return ships;
  }
  throw new Error('Не удалось разложить флот');
}

// ── presence: saying what you are doing ─────────────────────────────────────
// Presence was shown everywhere — in the directory, on a person's card, beside
// a name in contacts — and there was no way to set it. The product told
// everybody you were «не в сети» and gave you no say in it.
const PRESENCE_CHOICES=[['online','В сети'],['away','Отошёл'],['busy','Занят'],['do_not_disturb','Не беспокоить'],['offline','Не в сети']];

const myPresence=()=>person(me()?.userId)?.presence??{state:'online',statusText:null};

function presenceModal(){
  const mine=myPresence();
  const current=mine.state||'online';
  const text=mine.statusText||'';
  modal('Ваш статус',`<form id="presence-form" class="form-stack">
    <label>Состояние<select name="state" class="field">${PRESENCE_CHOICES.map(([value,caption])=>
      `<option value="${value}" ${current===value?'selected':''}>${esc(caption)}</option>`).join('')}</select></label>
    <label>Чем заняты<input name="statusText" maxlength="140" placeholder="Например: на площадке до обеда" value="${esc(text)}"></label>
    <p class="muted">Коллеги увидят это рядом с вашим именем.</p>
    <button class="button primary">Сохранить</button>
  </form>`,()=>{
    $('#presence-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      try{
        await api('/api/v1/presence',{method:'POST',body:JSON.stringify({
          state:form.get('state'),statusText:form.get('statusText')||null,
        })});
        const self=person(me().userId);
        if(self)self.presence={state:form.get('state'),statusText:form.get('statusText')||null};
        toast('Статус обновлён');
        closeModal();shell();render();
      }catch(error){toast(error.message)}
    };
  });
}

// ── сама компания ───────────────────────────────────────────────────────────

/**
 * Название компании вписывали один раз при регистрации, а владелец был
 * владельцем навсегда: уйти из компании, оставив её на живого человека,
 * было нельзя. Оба решения — хозяйские, поэтому и живут за правом
 * `organization.manage`.
 */
function companyModal(){
  const staff=S.people.filter(p=>p.userId!==me().userId&&p.role!=='guest'&&p.active!==false);
  modal('Компания',`
    <form id="company-name" class="form-stack">
      <label>Название компании<input name="companyName" maxlength="120" value="${esc(me().organizationName||'')}"></label>
      <label>Название пространства<input name="workspaceName" maxlength="120" value="${esc(me().workspaceName||'')}"></label>
      <button class="button primary">Переименовать</button>
    </form>
    <h3 class="person-section">Передать владение</h3>
    <p class="muted">Новый владелец получит все права на компанию, вы останетесь работать администратором. Шаг обратный, но вернуть его сможет уже новый хозяин.</p>
    ${staff.length?`<form id="company-owner" class="form-stack" style="margin-top:10px">
      <label>Кому<select name="userId">${staff.map(p=>`<option value="${esc(p.userId)}">${esc(p.displayName||p.email)}</option>`).join('')}</select></label>
      <button class="button danger">Передать владение</button>
    </form>`:'<p class="muted">Передать пока некому: в компании нет других сотрудников.</p>'}
  `,()=>{
    $('#company-name').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      try{
        await api('/api/v1/workspace',{method:'PATCH',body:JSON.stringify({
          companyName:form.get('companyName'),workspaceName:form.get('workspaceName'),
        })});
        toast('Название изменено');await bootstrap();
      }catch(error){toast(error.message)}
    };
    const owner=$('#company-owner');
    if(owner)owner.onsubmit=async(event)=>{
      event.preventDefault();
      const userId=new FormData(event.currentTarget).get('userId');
      try{
        await api('/api/v1/workspace/owner',{method:'POST',body:JSON.stringify({userId})});
        toast('Владение передано');closeModal();await bootstrap();
      }catch(error){toast(error.message)}
    };
  });
}

// ── журнал рабочего пространства ────────────────────────────────────────────

/**
 * Записи велись с первого дня, а посмотреть их было негде. Здесь они на
 * человеческом языке: кого позвали, кто вошёл, кому выдали ссылку на смену
 * пароля, кто раскрыл пароль из общего сейфа.
 */
const JOURNAL_EVENT={
  'invitation.issued':['Приглашение отправлено', e=>`${e.payload?.email??''} — ${WORKSPACE_ROLE[e.payload?.role]??e.payload?.role??''}`],
  'invitation.accepted':['Человек вошёл в компанию', e=>`${e.payload?.email??''} — ${WORKSPACE_ROLE[e.payload?.role]??e.payload?.role??''}`],
  'password.reset.issued':['Выдана ссылка на смену пароля', ()=>'Ссылка действует ограниченное время'],
  'password.reset.used':['Пароль сменён по ссылке', ()=>''],
  'vault.created':['Пароль добавлен в сейф', e=>e.payload?.title??''],
  'vault.updated':['Запись в сейфе изменена', e=>e.payload?.title??''],
  'vault.revealed':['Пароль раскрыт из сейфа', e=>e.payload?.title??''],
  'vault.deleted':['Запись из сейфа удалена', e=>e.payload?.title??''],
  'profile.updated':['Карточка сотрудника изменена', ()=>''],
  'commitment.created':['Заведена задача', e=>e.payload?.title??''],
  'commitment.transitioned':['Задача перешла в новое состояние', e=>`${WORK_STATUS[e.payload?.to]??e.payload?.to??''}`],
  'commitment.reassigned':['Задачу передали другому', ()=>''],
  'commitment.rescheduled':['Срок задачи перенесён', ()=>''],
  'evidence.added':['Добавлено доказательство', ()=>''],
  'conversation.ownership_claimed':['Беседа осталась без владельца и принята', e=>e.payload?.title??''],
};

const JOURNAL_FILTERS=[['','Все'],['membership','Люди'],['commitment','Задачи'],['vault_entry','Пароли'],['conversation','Беседы']];

function journalRow(event){
  const[caption,detail]=JOURNAL_EVENT[event.eventType]??[event.eventType,()=>''];
  const extra=detail(event);
  return `<div class="row" style="width:100%">
    <span><div class="row-title">${esc(caption)}</div>
    <div class="row-sub">${esc(when(event.createdAt))} · ${esc(event.actorName||'—')}${extra?` · ${esc(extra)}`:''}</div></span>
  </div>`;
}

async function journalModal(){
  S.journalType=S.journalType??'';
  S.journalItems=[];
  S.journalCursor=null;
  const load=async(more=false)=>{
    const query=new URLSearchParams({limit:'50'});
    if(S.journalType)query.set('type',S.journalType);
    if(more&&S.journalCursor)query.set('cursor',S.journalCursor);
    const page=await api(`/api/v1/audit?${query}`);
    S.journalItems=more?[...S.journalItems,...(page.items||[])]:(page.items||[]);
    S.journalCursor=page.nextCursor??null;
  };
  const build=async(more=false)=>{
    try{await load(more)}
    catch(error){return{title:'Журнал',body:`<div class="empty"><strong>Журнал недоступен</strong>${esc(error.message)}</div>`,after:()=>{}}}
    const filters=JOURNAL_FILTERS.map(([value,caption])=>
      `<button class="chipbtn pressable${S.journalType===value?' on':''}" data-journal-type="${esc(value)}">${esc(caption)}</button>`).join('');
    return{
      title:'Журнал',
      body:`<div class="chip-row">${filters}</div>
      <div class="stack" style="margin-top:10px">${S.journalItems.length
        ?S.journalItems.map(journalRow).join('')
        :'<div class="empty"><strong>Записей пока нет</strong>Здесь появятся приглашения, входы, смены паролей и движение задач.</div>'}</div>
      ${S.journalCursor?'<button class="button" id="journal-more" style="margin-top:10px;width:100%">Показать ещё</button>':''}`,
      after:()=>{
        $$('[data-journal-type]').forEach(b=>b.onclick=async()=>{S.journalType=b.dataset.journalType;await refresh()});
        const more=$('#journal-more');
        if(more)more.onclick=async()=>{await refresh(true)};
      },
    };
  };
  const refresh=async(more=false)=>{
    const next=await build(more);
    const top=overlayStack[overlayStack.length-1];
    if(top){Object.assign(top,next);renderOverlay()}
  };
  const first=await build();
  modal(first.title,first.body,first.after,()=>build());
}

// ── outbound integrations ───────────────────────────────────────────────────
// Signed webhooks with retries, a dead-letter and a delivery log were built,
// tested and reachable only with curl. An administrator could not see whether
// anything was leaving the building.
const DELIVERY_STATUS={pending:'в очереди',delivering:'отправляется',delivered:'доставлено',failed:'не дошло',dead_letter:'остановлено'};

async function integrationsModal(){
  let endpoints=[],deliveries=[];
  try{
    endpoints=(await api('/api/v1/integrations/webhooks')).items||[];
    deliveries=(await api('/api/v1/integrations/deliveries?limit=20')).items||[];
  }catch(error){
    toast(error.status===403?'Интеграции настраивает владелец или администратор':error.message);
    return;
  }
  const endpointRow=(e)=>`<div class="label-row">
    <span><div class="row-title">${esc(e.label||e.url)}</div>
      <div class="row-sub">${esc(e.url)}</div>
      <div class="row-sub">${(e.topics||[]).map(t=>`<span class="label-chip" data-colour="blue">${esc(t)}</span>`).join(' ')||'<span class="muted">без тем</span>'}</div></span>
    <span class="inline-actions">
      <button class="text-button" data-toggle-endpoint="${esc(e.id)}" data-enabled="${e.enabled?'1':''}">${e.enabled?'выключить':'включить'}</button>
      <button class="text-button danger" data-drop-endpoint="${esc(e.id)}">удалить</button>
    </span>
  </div>`;
  const deliveryRow=(d)=>`<div class="person-event">
    <span><span>${esc(DELIVERY_STATUS[d.status]||d.status)}</span> · ${esc(d.topic||d.eventType||'')}${d.attempts?` · ${d.attempts} попыт.`:''}</span>
    <time>${esc(when(d.updatedAt||d.createdAt))}</time></div>`;

  modal('Интеграции',`
    <p class="muted">Каждое событие уходит подписанным запросом. Недоставленное повторяется с нарастающей паузой и не теряется.</p>
    <h3 class="person-section">Подписки — ${endpoints.length}</h3>
    ${endpoints.length?`<div class="label-list">${endpoints.map(endpointRow).join('')}</div>`:'<p class="muted">Подписок пока нет.</p>'}
    <h3 class="person-section">Последние доставки</h3>
    <div class="person-feed">${deliveries.length?deliveries.map(deliveryRow).join(''):'<p class="muted">Ничего ещё не отправлялось.</p>'}</div>
    <div class="stack" style="margin-top:16px"><button data-new-endpoint class="button secondary">Добавить подписку</button></div>`,()=>{
    $('[data-new-endpoint]').onclick=()=>endpointFormModal(()=>replaceModal(integrationsModal));
    $$('[data-toggle-endpoint]').forEach(b=>b.onclick=async()=>{
      const on=Boolean(b.dataset.enabled);
      try{
        await api(`/api/v1/integrations/webhooks/${b.dataset.toggleEndpoint}/${on?'disable':'enable'}`,{method:'POST'});
        replaceModal(integrationsModal);
      }catch(error){toast(error.message)}
    });
    $$('[data-drop-endpoint]').forEach(b=>b.onclick=()=>{
      modal('Удалить подписку?','<p class="muted">События перестанут уходить по этому адресу. Журнал доставок останется.</p><button id="confirm-endpoint-delete" class="button danger" style="width:100%">Удалить</button>',()=>{
        $('#confirm-endpoint-delete').onclick=async()=>{
          try{await api(`/api/v1/integrations/webhooks/${b.dataset.dropEndpoint}`,{method:'DELETE'});toast('Подписка удалена');replaceModal(integrationsModal)}
          catch(error){toast(error.message)}
        };
      });
    });
  });
}

const WEBHOOK_TOPICS=['task.created','task.transitioned','task.rescheduled','task.reassigned','task.evidence.added','message.created','calendar.created'];

function endpointFormModal(after){
  modal('Новая подписка',`<form id="endpoint-form" class="form-stack">
    <label>Название<input name="label" required maxlength="120" placeholder="Например: ERP компании"></label>
    <label>Адрес<input name="url" type="url" required placeholder="https://erp.example.ru/hooks/chat"></label>
    <div><div class="row-title">События</div>
      <div class="label-grid">${WEBHOOK_TOPICS.map(t=>`<label class="label-option"><input type="checkbox" name="topics" value="${t}"> <span class="label-chip" data-colour="blue">${esc(t)}</span></label>`).join('')}</div></div>
    <p class="muted">Секрет для подписи покажут один раз — сохраните его сразу.</p>
    <button class="button primary">Создать</button>
  </form>`,()=>{
    $('#endpoint-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const topics=form.getAll('topics');
      if(!topics.length)return toast('Выберите хотя бы одно событие');
      try{
        const{endpoint}=await api('/api/v1/integrations/webhooks',{method:'POST',body:JSON.stringify({
          label:form.get('label'),url:form.get('url'),topics,
        })});
        replaceModal(()=>modal('Подписка создана',`
          <p class="muted">Секрет показывают один раз. Он подписывает каждый запрос — сохраните его сейчас.</p>
          <input id="endpoint-secret" class="field" readonly value="${esc(endpoint.secret||'')}">
          <button data-copy class="button primary" style="width:100%;margin-top:12px">Скопировать</button>`,()=>{
          $('[data-copy]').onclick=async()=>{
            try{await navigator.clipboard.writeText($('#endpoint-secret').value);toast('Секрет скопирован')}
            catch{$('#endpoint-secret').select()}
          };
        }));
        after?.();
      }catch(error){toast(error.message)}
    };
  });
}

// ── contacts ────────────────────────────────────────────────────────────────
// Not the staff directory. Two questions, two answers: who already writes to
// me, and who an administrator put in a unit with me. A colleague in your
// division who has not written a line yet still belongs on this list.
async function contactsModal(){
  let data;
  try{data=await api('/api/v1/contacts')}
  catch(error){
    toast(error.code==='PEOPLE_UNAVAILABLE'?'Контакты доступны в режиме с базой данных':error.message);
    return;
  }
  const talking=data.talkingTo||[],units=data.units||[];

  // `note` is markup, not text: a caption glued to a number cannot be
  // translated as one node, so the caption travels in a span of its own.
  // Every caller below builds it from fixed captions and escaped values.
  const row=(p,note)=>`<button class="row pressable" data-person="${esc(p.userId)}">
    <span class="avatar dark">${esc(initials(p.displayName||p.email))}</span>
    <span>
      <div class="row-title">${esc(p.displayName||p.email)}</div>
      <div class="row-sub"><span>${esc(p.title||PRESENCE[p.presenceState]||'должность не указана')}</span>${note?` · ${note}`:''}</div>
    </span>
    <span class="chip">${esc(WORKSPACE_ROLE[p.workspaceRole]||p.workspaceRole||'')}</span>
  </button>`;

  const shared=(p)=>{
    const parts=[];
    if(p.hasDirect)parts.push('<span>личный чат</span>');
    parts.push(`${p.sharedCount} <span>${plural(p.sharedCount,'общая беседа','общие беседы','общих бесед')}</span>`);
    return parts.join(' · ');
  };

  const talkingBlock=talking.length
    ? talking.map(p=>row(p,shared(p))).join('')
    : '<p class="muted">Вы пока ни с кем не переписывались.</p>';

  const unitBlocks=units.map(u=>`<h3 class="person-section">${esc(u.name)} <span class="org-kind">${esc(UNIT_KIND[u.kind]||u.kind)}</span></h3>
    ${u.members.map(m=>row(m,m.unitRole&&m.unitRole!=='member'?`<span>${esc(UNIT_ROLE[m.unitRole]||m.unitRole)}</span>`:'')).join('')}`).join('');

  modal('Контакты',`
    <h3 class="person-section">Вы общаетесь</h3>
    ${talkingBlock}
    ${units.length?unitBlocks:'<h3 class="person-section">Ваши подразделения</h3><p class="muted">Администратор ещё не добавил вас ни в одно подразделение.</p>'}
    <div class="stack" style="margin-top:16px"><button data-action-team class="button secondary">Весь штат компании</button></div>`,()=>{
    $$('[data-person]').forEach(b=>b.onclick=()=>personPage(b.dataset.person));
    $('[data-action-team]').onclick=()=>replaceModal(teamModal);
  });
}
const WORKSPACE_ROLE={owner:'владелец',admin:'админ',manager:'руководитель',member:'сотрудник',guest:'гость'};

// ── employee card ───────────────────────────────────────────────────────────
const WORK_STATUS={proposed:'ожидает принятия',accepted:'принята',scheduled:'запланирована',in_progress:'в работе',blocked:'заблокирована',in_review:'на проверке',accepted_result:'результат принят',closed:'закрыта',deferred:'отложена',cancelled:'отменена',rejected:'отклонена'};
const PRESENCE={online:'в сети',away:'отошёл',busy:'занят',do_not_disturb:'не беспокоить',offline:'не в сети'};
const when=(v)=>v?new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'';

async function personPage(userId){
  let person,activity=[];
  try{
    person=(await api(`/api/v1/people/${userId}`)).person;
    activity=(await api(`/api/v1/people/${userId}/activity?limit=25`)).items||[];
  }catch(error){
    toast(error.code==='PEOPLE_UNAVAILABLE'?'Личные карточки доступны в режиме с базой данных':error.message);
    return;
  }
  const field=(label,value)=>value?`<div class="person-field"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`:'';
  const units=person.units.length
    ? person.units.map(u=>`<span class="person-chip">${esc(u.name)}${u.role!=='member'?` · <span>${u.role==='head'?'руководитель':'администратор'}</span>`:''}</span>`).join('')
    : `<span class="muted">не состоит в подразделениях</span>`;
  const reports=person.reportsTo.length
    ? person.reportsTo.map(r=>`${esc(r.headName||'—')} <span class="muted">(${esc(r.unit)})</span>`).join(' · ')
    : '<span class="muted">не назначено</span>';
  const load=Object.entries(person.workload.byStatus||{}).map(([k,v])=>`<span class="person-chip"><span>${esc(WORK_STATUS[k]||k)}</span>: ${v}</span>`).join('') || '<span class="muted">задач нет</span>';
  const feed=activity.length
    ? activity.map(a=>`<div class="person-event"><span><span>${esc(a.label)}</span>${a.subject?` · ${esc(a.subject)}`:''}</span><time>${esc(when(a.createdAt))}</time></div>`).join('')
    : '<p class="muted">Действий пока не записано.</p>';

  modal(person.displayName||person.email,`
    <div class="person-head">
      <span class="avatar dark">${esc(initials(person.displayName||person.email))}</span>
      <div>
        <div class="row-title">${esc(person.title||'Должность не указана')}</div>
        <div class="row-sub"><span>${esc(person.department||'Подразделение не указано')}</span> · <span>${esc(PRESENCE[person.presenceState]||'не в сети')}</span></div>
      </div>
    </div>
    <div class="person-fields">
      ${field('Почта',person.email)}
      ${field('Роль в системе',person.workspaceRole)}
      ${field('Город',person.location)}
      ${field('Телефон',person.phone)}
      ${field('В команде с',person.startedOn?String(person.startedOn).slice(0,10):null)}
      ${field('Часовой пояс',person.timezone)}
    </div>
    ${person.about?`<p class="person-about">${esc(person.about)}</p>`:''}
    <h3 class="person-section">Подразделения</h3><div class="person-chips">${units}</div>
    <h3 class="person-section">Подчиняется</h3><div class="person-chips">${reports}</div>
    <h3 class="person-section"><span>Задачи в работе</span> — ${person.workload.open}</h3><div class="person-chips">${load}</div>
    <h3 class="person-section">История действий</h3><div class="person-feed">${feed}</div>
    ${person.disabledAt?`<p class="person-about">Сотрудник уволен ${esc(when(person.disabledAt))}. Доступ закрыт, история работы сохранена.</p>`:''}
    ${!person.isSelf&&can('member.invite')?'<div class="stack" style="margin-top:16px"><button data-reset class="button secondary">Выписать ссылку для смены пароля</button></div>':''}
    ${!person.isSelf&&person.workspaceRole!=='owner'&&can('member.manage')?`<div class="stack" style="margin-top:10px">${person.disabledAt
      ?'<button data-employ class="button secondary">Вернуть на работу</button>'
      :'<button data-dismiss class="button danger">Уволить</button>'}</div>`:''}
    ${person.isSelf?'<div class="stack" style="margin-top:16px"><button data-edit class="button secondary">Редактировать карточку</button><button data-push class="button secondary">Включить push</button><button data-logout class="button danger">Выйти</button></div>':''}
  `,()=>{
    const reset=$('[data-reset]');
    if(reset)reset.onclick=()=>issueResetModal(person);
    const dismiss=$('[data-dismiss]');
    if(dismiss)dismiss.onclick=()=>dismissModal(person);
    const employ=$('[data-employ]');
    if(employ)employ.onclick=async()=>{
      try{
        await api(`/api/v1/people/${person.userId}/reactivate`,{method:'POST'});
        toast('Сотрудник снова в строю');await bootstrap();replaceModal(()=>personPage(person.userId));
      }catch(error){toast(error.message)}
    };
    if(!person.isSelf)return;
    $('[data-edit]').onclick=()=>editProfile(person);
    $('[data-push]').onclick=enablePush;
    $('[data-logout]').onclick=logout;
  });
}

/**
 * Увольнение — шаг, который нельзя сделать вполсилы: доступ закрывается в
 * тот же миг. Поэтому отдельное окно, прямым текстом о последствиях.
 */
function dismissModal(person){
  modal('Уволить сотрудника',`
    <p class="muted">${esc(person.displayName||person.email)} потеряет доступ немедленно: открытые сессии оборвутся, войти заново не выйдет.</p>
    <p class="muted" style="margin-top:10px">Задачи, сообщения и доказательства останутся на месте — история работы компании не стирается. Вернуть человека можно тем же движением.</p>
    <button id="confirm-dismiss" class="button danger" style="width:100%;margin-top:14px">Уволить</button>`,()=>{
    $('#confirm-dismiss').onclick=async()=>{
      try{
        await api(`/api/v1/people/${person.userId}/deactivate`,{method:'POST'});
        toast('Доступ закрыт');await bootstrap();replaceModal(()=>personPage(person.userId));
      }catch(error){toast(error.message)}
    };
  });
}

/** The administrator's half of recovery: make the link, hand it over. */
function issueResetModal(person){
  modal('Смена пароля',`
    <p class="muted">Ссылка позволит ${esc(person.displayName||person.email)} задать новый пароль. Она живёт сутки, срабатывает один раз и обрывает все открытые сессии этого человека.</p>
    <p class="muted" style="margin-top:10px">Передайте её лично: тот, у кого она окажется, войдёт в рабочее пространство.</p>
    <button id="issue-reset" class="button primary" style="width:100%;margin-top:14px">Выписать ссылку</button>`,()=>{
    $('#issue-reset').onclick=async()=>{
      try{
        const{reset}=await api('/api/v1/password-resets',{method:'POST',body:JSON.stringify({userId:person.userId})});
        replaceModal(()=>modal('Ссылка готова',`
          <p class="muted">Действует сутки, срабатывает один раз.</p>
          <input id="reset-link" class="field" readonly value="${esc(reset.resetUrl)}">
          <button data-copy class="button primary" style="width:100%;margin-top:12px">Скопировать</button>`,()=>{
          $('[data-copy]').onclick=async()=>{
            try{await navigator.clipboard.writeText($('#reset-link').value);toast('Ссылка скопирована')}
            catch{$('#reset-link').select()}
          };
        }));
      }catch(error){toast(error.message)}
    };
  });
}

function editProfile(person){
  const input=(name,label,value='')=>`<label class="field-group"><span>${esc(label)}</span><input name="${name}" value="${esc(value??'')}" maxlength="120"></label>`;
  modal('Редактировать карточку',`<form id="profile-form" class="stack">
    ${input('displayName','Имя и фамилия',person.displayName)}
    ${input('title','Должность',person.title)}
    ${input('department','Подразделение',person.department)}
    ${input('location','Город',person.location)}
    ${input('phone','Телефон',person.phone)}
    <label class="field-group"><span>О себе</span><textarea name="about" rows="3" maxlength="2000">${esc(person.about??'')}</textarea></label>
    <button class="button primary" type="submit">Сохранить</button>
  </form>`,()=>{
    $('#profile-form').onsubmit=async(event)=>{
      event.preventDefault();
      const data=Object.fromEntries(new FormData(event.target).entries());
      try{
        await api(`/api/v1/people/${person.userId}`,{method:'PATCH',body:JSON.stringify(data)});
        toast('Карточка обновлена');
        history.back();
        await bootstrap();
      }catch(error){toast(error.message)}
    };
  });
}

async function action(a){await actions[a]?.()}
async function send(){const i=$('#message-input'),body=i?.value.trim();if(!body)return;i.value='';try{const{message}=await api(`/api/v1/conversations/${S.selected}/messages`,{method:'POST',body:JSON.stringify({body,replyToId:S.reply?.id||null})});append(S.selected,message);S.reply=null;render()}catch(e){toast(e.message)}}
function append(id,m){const list=S.messages.get(id)||[];if(!list.some(x=>x.id===m.id))list.push(m);S.messages.set(id,list);const c=S.conversations.find(x=>x.id===id);if(c)c.lastMessage=m}
const REACTIONS=['👍','👏','🔥','✅','❤️','😀','🤔','👀','🙏','🎯','⏱','❌'];
/**
 * Плавающая панель маркера.
 *
 * Выделение пропадает от любого нажатия — в том числе по кнопке «ещё»,
 * — поэтому цвет надо предлагать сразу, пока текст ещё выделен, и рядом
 * с ним. Панель ловит выделение внутри текста сообщения, встаёт над ним
 * и исчезает, как только выделение снято.
 */
function ensureHighlightBar(){
  let bar=$('#hl-bar');
  if(bar)return bar;
  bar=document.createElement('div');
  bar.id='hl-bar'; bar.className='hl-bar'; bar.hidden=true;
  bar.innerHTML=`<span class="hl-bar-label">Маркер</span>${HIGHLIGHT_COLOURS.map(([value,caption])=>
    `<button type="button" class="hl-dot hl-${value}" data-hl-colour="${value}" title="${caption}" aria-label="Выделить: ${caption}"></button>`).join('')}`;
  document.body.append(bar);
  bar.addEventListener('mousedown',(event)=>event.preventDefault());
  bar.addEventListener('click',async(event)=>{
    const button=event.target.closest('[data-hl-colour]');
    if(!button||!bar._target)return;
    const{messageId,conversationId,quote,startOffset,endOffset}=bar._target;
    bar.hidden=true;
    try{
      await api('/api/v1/highlights',{method:'POST',body:JSON.stringify({
        conversationId,messageId,quote,startOffset,endOffset,colour:button.dataset.hlColour})});
      await loadMarks();render();toast('Выделено');
    }catch(error){toast(error.message)}
  });
  return bar;
}

function updateHighlightBar(){
  const bar=ensureHighlightBar();
  const selection=window.getSelection?.();
  if(!selection||selection.isCollapsed||!selection.rangeCount){bar.hidden=true;return}
  const body=selection.anchorNode?.parentElement?.closest?.('.message-body');
  const row=body?.closest('[data-message-row]');
  if(!body||!row||!body.contains(selection.focusNode)){bar.hidden=true;return}
  const quote=selection.toString();
  if(!quote.trim()){bar.hidden=true;return}
  const range=selection.getRangeAt(0);
  const before=range.cloneRange();
  before.selectNodeContents(body);
  before.setEnd(range.startContainer,range.startOffset);
  const start=before.toString().length;
  bar._target={messageId:row.dataset.messageRow,conversationId:S.selected,quote,startOffset:start,endOffset:start+quote.length};
  const rect=range.getBoundingClientRect();
  bar.hidden=false;
  const width=bar.offsetWidth||190;
  bar.style.left=`${Math.max(8,Math.min(window.innerWidth-width-8,rect.left+rect.width/2-width/2))}px`;
  bar.style.top=`${Math.max(8,rect.top-bar.offsetHeight-8)}px`;
}
document.addEventListener('selectionchange',()=>{clearTimeout(window.__hlTimer);window.__hlTimer=setTimeout(updateHighlightBar,120)});
document.addEventListener('scroll',()=>{const bar=$('#hl-bar');if(bar&&!bar.hidden)updateHighlightBar()},true);

const FAVOURITE_TABS=[['conversation','Беседы'],['message','Сообщения'],['task','Задачи'],['highlight','Выделения'],['note','Заметки']];

/**
 * Избранное и пометки одним экраном.
 *
 * Разбросанные по продукту звёздочки, маркеры и заметки бесполезны, если
 * к ним нельзя вернуться в одном месте. Здесь они и собраны: беседы,
 * сообщения, задачи, выделения, заметки — по вкладке на вид, и из каждой
 * строки можно перейти туда, где пометка стоит.
 */
async function favouritesModal(tab='conversation'){
  S.favouriteTab=tab;
  const build=async()=>{
    const active=S.favouriteTab;
    let rows='';
    try{
      if(active==='highlight'){
        const items=(await api('/api/v1/highlights')).items||[];
        rows=items.length?items.map(h=>`<button class="row pressable" data-go-message="${esc(h.messageId)}" data-go-conversation="${esc(h.conversationId)}">
          <span class="menu-icon hl-${esc(h.colour)}">${msgIcon.marker}</span>
          <span><div class="row-title">${esc(h.quote.slice(0,90))}</div><div class="row-sub">${esc(h.conversationTitle||'беседа')} · ${esc(dateTime(h.createdAt))}</div></span>
          <span class="text-button danger" data-drop-highlight="${esc(h.id)}">×</span></button>`).join(''):'';
      }else if(active==='note'){
        const items=(await api('/api/v1/message-notes')).items||[];
        rows=items.length?items.map(n=>`<button class="row pressable" data-go-message="${esc(n.messageId)}" data-go-conversation="${esc(n.conversationId)}">
          <span class="menu-icon">${msgIcon.note}</span>
          <span><div class="row-title">${esc(NOTE_KIND_LABEL[n.kind]||'заметка')}: ${esc(n.body.slice(0,80))}</div>
            <div class="row-sub">${esc(n.conversationTitle||'беседа')} · ${esc((n.messagePreview||'').slice(0,50))}</div></span>
          <span class="text-button danger" data-drop-note="${esc(n.id)}">×</span></button>`).join(''):'';
      }else if(active==='message'){
        const items=(await api('/api/v1/saved-messages')).items||[];
        rows=items.length?items.map(m=>`<button class="row pressable" data-go-message="${esc(m.id)}" data-go-conversation="${esc(m.conversationId)}">
          <span class="menu-icon">${msgIcon.star}</span>
          <span><div class="row-title">${esc((m.body||'вложение').slice(0,90))}</div>
            <div class="row-sub">${esc(name(m.authorId))} · ${esc(dateTime(m.createdAt))}</div></span><span></span></button>`).join(''):'';
      }else{
        const items=(await api(`/api/v1/favourites?type=${active}`)).items||[];
        rows=items.length?items.map(f=>`<button class="row pressable" ${active==='conversation'?`data-go-conversation="${esc(f.targetId)}"`:`data-go-task="${esc(f.targetId)}"`}>
          <span class="menu-icon">${active==='conversation'?tileIcon.team:msgIcon.task}</span>
          <span><div class="row-title">${esc(f.title||'без названия')}</div><div class="row-sub">${esc(dateTime(f.createdAt))}</div></span>
          <span class="text-button danger" data-drop-favourite="${esc(active)}:${esc(f.targetId)}">×</span></button>`).join(''):'';
      }
    }catch(error){
      rows=`<div class="empty"><strong>Не удалось прочитать</strong>${esc(error.message)}</div>`;
    }
    const tabs=FAVOURITE_TABS.map(([value,caption])=>
      `<button class="chipbtn pressable${active===value?' on':''}" data-fav-tab="${value}">${esc(caption)}</button>`).join('');
    return {
      title:'Избранное',
      body:`<div class="chip-row">${tabs}</div>
        <div class="stack" style="margin-top:12px">${rows||'<div class="empty"><strong>Пока пусто</strong>Отмечайте звездой беседы, сообщения и задачи — они соберутся здесь.</div>'}</div>`,
      after:()=>{
        $$('[data-fav-tab]').forEach(b=>b.onclick=async()=>{S.favouriteTab=b.dataset.favTab;await refresh()});
        $$('[data-go-conversation]').forEach(b=>b.onclick=(event)=>{
          if(event.target.closest('[data-drop-favourite],[data-drop-highlight],[data-drop-note]'))return;
          const messageId=b.dataset.goMessage;
          closeModal();openChat(b.dataset.goConversation);
          if(messageId)setTimeout(()=>{
            const row=document.querySelector(`[data-message-row="${CSS.escape(messageId)}"]`);
            if(row){row.scrollIntoView({block:'center',behavior:'smooth'});row.classList.remove('flash');void row.offsetWidth;row.classList.add('flash')}
          },700);
        });
        $$('[data-go-task]').forEach(b=>b.onclick=(event)=>{
          if(event.target.closest('[data-drop-favourite]'))return;
          closeModal();openTask(b.dataset.goTask);
        });
        $$('[data-drop-favourite]').forEach(b=>b.onclick=async(event)=>{
          event.stopPropagation();
          const [type,id]=b.dataset.dropFavourite.split(':');
          try{await api(`/api/v1/favourites/${type}/${id}`,{method:'DELETE'});await loadMarks();await refresh()}catch(error){toast(error.message)}
        });
        $$('[data-drop-highlight]').forEach(b=>b.onclick=async(event)=>{
          event.stopPropagation();
          try{await api(`/api/v1/highlights/${b.dataset.dropHighlight}`,{method:'DELETE'});await loadMarks();await refresh()}catch(error){toast(error.message)}
        });
        $$('[data-drop-note]').forEach(b=>b.onclick=async(event)=>{
          event.stopPropagation();
          try{await api(`/api/v1/message-notes/${b.dataset.dropNote}`,{method:'DELETE'});await loadMarks();await refresh()}catch(error){toast(error.message)}
        });
      },
    };
  };
  const refresh=async()=>{
    const next=await build();
    const top=overlayStack[overlayStack.length-1];
    if(top){Object.assign(top,next);renderOverlay()}
  };
  const first=await build();
  modal(first.title,first.body,first.after,build);
}

/** Звезда: одна кнопка для беседы, задачи и всего остального. */
async function toggleFavourite(type,id){
  const key=`${type}:${id}`;
  const on=S.favourites?.has(key);
  try{
    await api(`/api/v1/favourites/${type}/${id}`,{method:on?'DELETE':'PUT'});
    await loadMarks();
    toast(on?'Убрано из избранного':'В избранном');
    render();
  }catch(error){toast(error.message)}
}

const NOTE_KIND_LABEL={important:'важно',remember:'запомнить',question:'спросить',note:'заметка'};
const HIGHLIGHT_COLOURS=[['yellow','жёлтый'],['green','зелёный'],['pink','розовый'],['blue','синий']];
const NOTE_KINDS=[['important','важно'],['remember','запомнить'],['question','спросить'],['note','заметка']];

/**
 * Выделение маркером.
 *
 * Человек выделяет кусок текста мышью или пальцем прямо в сообщении, и
 * тогда панель предлагает цвет. Если ничего не выделено — предлагается
 * выделить сообщение целиком: это честнее, чем молчать.
 */
function selectionInMessage(messageId){
  const selection=window.getSelection?.();
  if(!selection||selection.isCollapsed)return null;
  const row=document.querySelector(`[data-message-row="${CSS.escape(messageId)}"] .message-body`);
  if(!row||!row.contains(selection.anchorNode)||!row.contains(selection.focusNode))return null;
  const text=row.textContent||'';
  const quote=selection.toString();
  if(!quote.trim())return null;
  const range=selection.getRangeAt(0);
  const before=range.cloneRange();
  before.selectNodeContents(row);
  before.setEnd(range.startContainer,range.startOffset);
  const start=before.toString().length;
  return {quote,startOffset:start,endOffset:start+quote.length,full:text};
}

function highlightModal(message){
  const picked=selectionInMessage(message.id);
  const body=message.body||'';
  const target=picked||{quote:body,startOffset:0,endOffset:body.length};
  if(!target.quote.trim())return toast('В этом сообщении нечего выделять');
  modal('Выделить маркером',`
    <p class="muted">${picked?'Выделено вами:':'Ничего не выделено — будет отмечено всё сообщение:'}</p>
    <p class="highlight-preview">${esc(target.quote.slice(0,300))}</p>
    <div class="chip-row" style="margin-top:12px">${HIGHLIGHT_COLOURS.map(([value,caption])=>
      `<button type="button" class="chipbtn pressable hl-${value}" data-colour="${value}">${esc(caption)}</button>`).join('')}</div>`,()=>{
    $$('[data-colour]').forEach(b=>b.onclick=async()=>{
      try{
        await api('/api/v1/highlights',{method:'POST',body:JSON.stringify({
          conversationId:message.conversationId??S.selected,messageId:message.id,
          quote:target.quote,startOffset:target.startOffset,endOffset:target.endOffset,colour:b.dataset.colour,
        })});
        await loadMarks();
        closeModal();render();toast('Выделено');
      }catch(error){toast(error.message)}
    });
  });
}

function noteModal(message,existing=null){
  modal(existing?'Изменить заметку':'Заметка к сообщению',`<form id="note-form" class="form-stack">
    <p class="muted msg-menu-quote">${esc((message.body||'').slice(0,120))}</p>
    <div class="chip-row">${NOTE_KINDS.map(([value,caption])=>
      `<button type="button" class="chipbtn pressable${(existing?.kind??'note')===value?' on':''}" data-kind="${value}">${esc(caption)}</button>`).join('')}</div>
    <label>Заметка<textarea name="body" rows="3" maxlength="2000" required>${esc(existing?.body??'')}</textarea></label>
    <button class="button primary">${existing?'Сохранить':'Записать'}</button>
  </form>`,()=>{
    let kind=existing?.kind??'note';
    $$('[data-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.kind;$$('[data-kind]').forEach(x=>x.classList.toggle('on',x===b))});
    $('#note-form').onsubmit=async(event)=>{
      event.preventDefault();
      const text=new FormData(event.currentTarget).get('body');
      try{
        if(existing)await api(`/api/v1/message-notes/${existing.id}`,{method:'PATCH',body:JSON.stringify({body:text,kind})});
        else await api('/api/v1/message-notes',{method:'POST',body:JSON.stringify({
          conversationId:message.conversationId??S.selected,messageId:message.id,body:text,kind})});
        await loadMarks();
        closeModal();render();toast(existing?'Заметка изменена':'Заметка записана');
      }catch(error){toast(error.message)}
    };
  });
}

/** Свои пометки держатся в памяти: их рисуют на каждой перерисовке ленты. */
async function loadMarks(){
  try{
    const [highlights,notes,favourites]=await Promise.all([
      api('/api/v1/highlights').then(r=>r.items||[]).catch(()=>[]),
      api('/api/v1/message-notes').then(r=>r.items||[]).catch(()=>[]),
      api('/api/v1/favourites').then(r=>r.items||[]).catch(()=>[]),
    ]);
    S.highlights=new Map();
    for(const h of highlights){
      if(!S.highlights.has(h.messageId))S.highlights.set(h.messageId,[]);
      S.highlights.get(h.messageId).push(h);
    }
    S.notes=new Map();
    for(const n of notes){
      if(!S.notes.has(n.messageId))S.notes.set(n.messageId,[]);
      S.notes.get(n.messageId).push(n);
    }
    S.favourites=new Set(favourites.map(f=>`${f.targetType}:${f.targetId}`));
  }catch{/* пометки не обязательны для работы ленты */}
}

/**
 * Текст сообщения с выделениями. Выделение хранит и смещения, и сам
 * текст: если по смещениям теперь стоит другое (сообщение поправили),
 * подсветка не рисуется — лучше её отсутствие, чем цветное пятно
 * посреди чужой фразы.
 */
function bodyWithHighlights(m){
  const text=m.body||kindLabel(m.kind)||'';
  const marks=(S.highlights?.get(m.id)||[])
    .filter(h=>text.slice(h.startOffset,h.endOffset)===h.quote)
    .sort((a,b)=>a.startOffset-b.startOffset);
  if(!marks.length)return esc(text);
  let out='',cursor=0;
  for(const h of marks){
    if(h.startOffset<cursor)continue;
    out+=esc(text.slice(cursor,h.startOffset));
    out+=`<mark class="hl hl-${esc(h.colour)}" data-highlight="${esc(h.id)}" title="Выделено вами — нажмите, чтобы снять">${esc(text.slice(h.startOffset,h.endOffset))}</mark>`;
    cursor=h.endOffset;
  }
  return out+esc(text.slice(cursor));
}

function messageMenu(messageId){
  const message=(S.messages.get(S.selected)||[]).find(x=>x.id===messageId);
  if(!message)return toast('Сообщение не найдено');
  const mine=message.authorId===me().userId;
  const rows=[
    ['react','Реакция',msgIcon.react],
    ['reply','Ответить',msgIcon.reply],
    ['star',message.saved?'Из избранного':'В избранное',msgIcon.star],
    ['highlight','Выделить',msgIcon.marker],
    ['note','Заметка',msgIcon.note],
    ['remind','Напомнить',tileIcon.reminders],
    ['forward','Переслать',msgIcon.forward],
    ['label','Метка',tileIcon.labels],
    ['pin',message.pinned?'Открепить':'Закрепить',msgIcon.pin],
    ['task','В задачу',msgIcon.task],
    ...(mine&&message.kind==='text'&&!message.forwarded?[['edit','Изменить',msgIcon.edit]]:[]),
    ...(mine||can('message.delete.any')?[['delete','Удалить',msgIcon.trash]]:[]),
  ];
  modal('Сообщение',`<p class="muted msg-menu-quote">${esc((message.body||kindLabel(message.kind)||'').slice(0,120))}</p>
    <div class="menu-grid">${rows.map(([action,caption,icon])=>
      `<button class="menu-tile pressable${action==='delete'?' danger':''}" data-menu="${action}"><span class="menu-icon">${icon}</span><span>${esc(caption)}</span></button>`).join('')}</div>`,()=>{
    const act={
      react:()=>replaceModal(()=>reactionPicker(messageId)),
      reply:()=>{closeModal();S.reply=message;render();$('#message-input')?.focus()},
      star:()=>{closeModal();toggleSave(messageId,!message.saved)},
      highlight:()=>replaceModal(()=>highlightModal(message)),
      note:()=>replaceModal(()=>noteModal(message)),
      remind:()=>replaceModal(()=>remindAboutModal((message.body||'Вернуться к сообщению').trim(),{sourceType:'message',sourceId:messageId,conversationId:S.selected})),
      forward:()=>replaceModal(()=>forwardModal(messageId)),
      label:()=>replaceModal(()=>labelPicker('message',messageId,{title:'Метки сообщения'})),
      pin:()=>{closeModal();togglePin(messageId,!message.pinned)},
      task:()=>replaceModal(()=>taskModal(messageId,(message.body||'').trim().slice(0,120))),
      edit:()=>replaceModal(()=>editMessageModal(messageId)),
      delete:()=>replaceModal(()=>deleteMessageModal(messageId)),
    };
    $$('[data-menu]').forEach(b=>b.onclick=()=>act[b.dataset.menu]?.());
  });
}

function reactionPicker(messageId){
  modal('Реакция',`<div class="chip-row">${REACTIONS.map(r=>`<button type="button" class="reaction-button" data-pick="${esc(r)}" style="font-size:22px;line-height:1">${esc(r)}</button>`).join('')}</div>`,()=>{
    $$('[data-pick]').forEach(b=>b.onclick=()=>{closeModal();react(messageId,b.dataset.pick)});
  });
}
async function react(id,reaction){try{const{reactions}=await api(`/api/v1/messages/${id}/reactions`,{method:'POST',body:JSON.stringify({reaction})});for(const list of S.messages.values()){const m=list.find(x=>x.id===id);if(m)m.reactions=reactions}render()}catch(e){toast(e.message)}}
function updateMessage(id,patch){for(const list of S.messages.values()){const m=list.find(x=>x.id===id);if(m)Object.assign(m,patch)}}
async function toggleSave(id,saved){try{await api(`/api/v1/messages/${id}/save`,{method:saved?'POST':'DELETE'});updateMessage(id,{saved});render();toast(saved?'Сохранено':'Удалено из сохранённых')}catch(e){toast(e.message)}}
async function togglePin(id,pinned){try{await api(`/api/v1/messages/${id}/pin`,{method:pinned?'POST':'DELETE'});updateMessage(id,{pinned});render();toast(pinned?'Сообщение закреплено':'Сообщение откреплено')}catch(e){toast(e.message)}}
function forwardModal(id){const targets=S.conversations.filter(c=>!c.archivedAt);modal('Переслать сообщение',targets.map(c=>`<button class="conversation-card" data-forward-target="${c.id}"><span class="avatar dark">${c.kind==='channel'?'#':esc(initials(c.title||'D'))}</span><span><strong>${esc(c.title||'Диалог')}</strong><div class="preview">${esc(c.purpose||'')}</div>${c.purpose?'':'<div class="preview preview-empty">Переслать сюда</div>'}</span></button>`).join('')||'<div class="empty">Нет доступных разговоров.</div>');$$('[data-forward-target]').forEach(b=>b.onclick=async()=>{try{const{message}=await api(`/api/v1/messages/${id}/forward`,{method:'POST',body:JSON.stringify({conversationId:b.dataset.forwardTarget})});append(b.dataset.forwardTarget,message);closeModal();toast('Сообщение переслано')}catch(e){toast(e.message)}})}
function editMessageModal(id){const m=[...S.messages.values()].flat().find(x=>x.id===id);if(!m)return;modal('Изменить сообщение',`<form id="message-edit-form" class="form-stack"><label>Текст<textarea name="body" rows="5" required>${esc(m.body||'')}</textarea></label><button class="button primary">Сохранить</button></form>`);$('#message-edit-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const{message}=await api(`/api/v1/messages/${id}`,{method:'PATCH',body:JSON.stringify({body:f.get('body')})});updateMessage(id,message);closeModal();render();toast('Сообщение изменено')}catch(error){toast(error.message)}}}
function deleteMessageModal(id){modal('Удалить сообщение',`<p class="muted">Сообщение останется в истории как удалённое, но его содержимое больше не будет показываться.</p><button id="confirm-message-delete" class="button danger" style="width:100%">Удалить</button>`);$('#confirm-message-delete').onclick=async()=>{try{const{message}=await api(`/api/v1/messages/${id}`,{method:'DELETE'});updateMessage(id,message);closeModal();render();toast('Сообщение удалено')}catch(e){toast(e.message)}}}
async function pinsModal(){
  if(!S.selected)return toast('Откройте чат.');
  const conversationId=S.selected;
  const draw=(items)=>{
    modal('Закреплённые сообщения',items.length?items.map(m=>`<div class="pin-row">
      <button class="conversation-card" data-jump-message="${esc(m.id)}"><span class="avatar dark">${esc(initials(name(m.authorId)))}</span><span><strong>${esc(name(m.authorId))}</strong><div class="preview">${esc(m.body||kindLabel(m.kind)||'Вложение')}</div></span><span class="time">${esc(time(m.createdAt))}</span></button>
      <button class="text-button danger" data-unpin="${esc(m.id)}">Открепить</button>
    </div>`).join(''):'<div class="empty">Закреплённых сообщений пока нет.</div>',()=>{
      $$('[data-jump-message]').forEach(b=>b.onclick=()=>{closeModal();document.querySelector(`[data-message-row="${b.dataset.jumpMessage}"]`)?.scrollIntoView({behavior:'smooth',block:'center'})});
      $$('[data-unpin]').forEach(b=>b.onclick=async()=>{
        b.disabled=true;
        try{
          await api(`/api/v1/messages/${b.dataset.unpin}/pin`,{method:'DELETE'});
          updateMessage(b.dataset.unpin,{pinned:false});
          const{items:left}=await api(`/api/v1/conversations/${conversationId}/pins`);
          history.back();
          draw(left);
          render();
          toast('Откреплено');
        }catch(error){b.disabled=false;toast(error.message)}
      });
    });
  };
  try{const{items}=await api(`/api/v1/conversations/${conversationId}/pins`);draw(items)}catch(e){toast(e.message)}
}
async function savedModal(){try{const{items}=await api('/api/v1/saved-messages');modal('Сохранённые сообщения',items.length?items.map(m=>`<button class="conversation-card" data-saved-conversation="${m.conversationId}" data-saved-message="${m.id}"><span class="avatar dark">☆</span><span><strong>${esc(m.conversationTitle||'Диалог')}</strong><div class="preview">${esc(m.body||kindLabel(m.kind)||'Вложение')}</div></span><span class="time">${time(m.savedAt)}</span></button>`).join(''):'<div class="empty">Сохранённых сообщений пока нет.</div>');$$('[data-saved-conversation]').forEach(b=>b.onclick=()=>{const messageId=b.dataset.savedMessage;closeModal();openChatAtMessage(b.dataset.savedConversation,messageId)})}catch(e){toast(e.message)}}
async function toggleMute(){const c=S.conversations.find(x=>x.id===S.selected);if(!c)return;const muted=c.mutedUntil&&Date.parse(c.mutedUntil)>Date.now(),mutedUntil=muted?null:new Date(Date.now()+8*3600000).toISOString();try{const{preferences}=await api(`/api/v1/conversations/${c.id}/preferences`,{method:'PATCH',body:JSON.stringify({mutedUntil})});c.mutedUntil=preferences.mutedUntil;render();toast(muted?'Уведомления включены':'Уведомления отключены на 8 часов')}catch(e){toast(e.message)}}
async function archiveCurrent(){const c=S.conversations.find(x=>x.id===S.selected);if(!c)return;try{await api(`/api/v1/conversations/${c.id}/preferences`,{method:'PATCH',body:JSON.stringify({archived:true})});S.conversations=S.conversations.filter(x=>x.id!==c.id);S.selected=S.conversations[0]?.id||null;S.mobileChat=false;render();toast('Чат перемещён в личный архив')}catch(e){toast(e.message)}}
async function archivedModal(){try{const{items}=await api('/api/v1/conversations/archived');modal('Архив чатов',items.length?items.map(c=>`<div class="row"><span class="avatar dark">${c.kind==='channel'?'#':esc(initials(c.title||'D'))}</span><span><div class="row-title">${esc(c.title||'Диалог')}</div><div class="row-sub">${esc(c.purpose||'Архивировано только для вас')}</div></span><button class="button secondary small" data-restore-conversation="${c.id}">Вернуть</button></div>`).join(''):'<div class="empty">Архив пуст.</div>');$$('[data-restore-conversation]').forEach(b=>b.onclick=async()=>{try{await api(`/api/v1/conversations/${b.dataset.restoreConversation}/preferences`,{method:'PATCH',body:JSON.stringify({archived:false})});const restored=items.find(x=>x.id===b.dataset.restoreConversation);if(restored&&!S.conversations.some(x=>x.id===restored.id))S.conversations.unshift({...restored,archivedAt:null});toast('Чат возвращён');await archivedModal();lists()}catch(e){toast(e.message)}})}catch(e){toast(e.message)}}
let typingTimer;function typing(){if(S.ws?.readyState!==1)return;S.ws.send(JSON.stringify({event:'typing.start',data:{conversationId:S.selected}}));clearTimeout(typingTimer);typingTimer=setTimeout(()=>S.ws?.send(JSON.stringify({event:'typing.stop',data:{conversationId:S.selected}})),1000)}
// Overlays keep a stack, so a person who went Ещё → Команда → карточка can
// step back the way they came instead of being dumped on the home screen.
// The stack is mirrored into browser history, which is what makes the phone's
// back gesture close an overlay rather than leave the app.
const overlayStack=[];
let openerBeforeOverlay=null;
function renderOverlay(){
  const top=overlayStack[overlayStack.length-1];
  if(!top){
    $('#modal-root').innerHTML='';
    // Фокус возвращается сразу, а не в следующем кадре: в свёрнутой или
    // фоновой вкладке кадры не рисуются вовсе, и человек, вернувшись,
    // обнаружил бы фокус в начале страницы.
    const opener=openerBeforeOverlay;openerBeforeOverlay=null;
    if(opener?.isConnected)opener.focus?.({preventScroll:true});
    return;
  }
  const back=overlayStack.length>1;
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-heading" tabindex="-1"><div class="modal-head">${back?'<button data-back class="close-button" aria-label="Назад">‹</button>':''}<h2 id="modal-heading">${esc(top.title)}</h2><button data-close class="close-button" aria-label="Закрыть">×</button></div>${top.body}</section></div>`;
  const backButton=$('[data-back]');if(backButton)backButton.onclick=()=>history.back();
  $('[data-close]').onclick=closeModal;
  $('.modal-backdrop').onclick=e=>{if(e.target===e.currentTarget)closeModal()};
  top.after?.();
  // Move focus into the dialog: the first thing a person types belongs to the
  // sheet they just opened, not to the page behind it.
  const dialog=$('.modal');
  const first=dialog?.querySelector('input,textarea,select,button:not([data-close]):not([data-back])');
  (first||dialog)?.focus?.({preventScroll:true});
}

// Escape closes the top sheet, and Tab stays inside it. The drawer overlays
// already behaved this way; the app's own modals did not.
document.addEventListener('keydown',(event)=>{
  if(!overlayStack.length)return;
  if(event.key==='Escape'){event.preventDefault();closeModal();return}
  if(event.key!=='Tab')return;
  const dialog=$('.modal');if(!dialog)return;
  const focusable=[...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>el.offsetParent!==null);
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  else if(!dialog.contains(document.activeElement)){event.preventDefault();first.focus()}
});
function modal(title,body,after,refresh){
  // Кто открыл окно, тому и вернуть фокус при закрытии: иначе человек с
  // клавиатуры каждый раз оказывается в начале страницы и идёт обратно
  // через всю боковую панель.
  if(!overlayStack.length)openerBeforeOverlay=document.activeElement;
  overlayStack.push({title,body,after,refresh});
  try{history.pushState({overlay:overlayStack.length},'',location.href)}catch{}
  renderOverlay();
}

/**
 * A sheet keeps the markup it was opened with, so stepping back onto one that
 * the sheet above it has changed showed yesterday's answer — apply a label,
 * go back, and the card still claimed it had none. A page that can go stale
 * hands modal() a refresh; it is re-read when it becomes the top again.
 */
async function resumeTop(){
  const top=overlayStack[overlayStack.length-1];
  if(!top?.refresh)return;
  try{
    const next=await top.refresh();
    if(overlayStack[overlayStack.length-1]!==top||!next)return;
    Object.assign(top,next);
    renderOverlay();
  }catch(error){toast(error.message)}
}
window.addEventListener('popstate',()=>{
  if(unwinding>0){unwinding-=1;return}
  if(overlayStack.length){overlayStack.pop();renderOverlay();resumeTop();return}
  // Окон не осталось — «назад» возвращает на прошлый раздел, а не выкидывает
  // из приложения.
  routeFromHash().catch(error=>toast(error.message));
});
let unwinding=0;
function closeModal(){
  const depth=overlayStack.length;
  overlayStack.length=0;
  renderOverlay();
  // history.go is asynchronous. The popstate it schedules must not swallow an
  // overlay opened in the meantime — that is what made every card in the
  // «Создать» sheet do nothing at all.
  if(depth){unwinding+=depth;try{history.go(-depth)}catch{unwinding-=depth}}
}
/** Swap the open sheet for another. One navigation, not a close and an open. */
function replaceModal(open){if(overlayStack.length)overlayStack.pop();open()}
function quick(){modal('Создать',`<div class="module-grid"><button class="module-card" data-q="dm"><span class="module-icon">${navIcon.chats}</span><strong>Сообщение</strong></button><button class="module-card" data-q="group"><span class="module-icon">${tileIcon.team}</span><strong>Группа</strong></button><button class="module-card" data-q="task"><span class="module-icon">${msgIcon.task}</span><strong>Задача</strong></button><button class="module-card" data-q="event"><span class="module-icon">${navIcon.calendar}</span><strong>Событие</strong></button><button class="module-card" data-q="channel"><span class="module-icon">${roomIcon.channel}</span><strong>Канал</strong></button></div>`);$$('[data-q]').forEach(b=>b.onclick=()=>{const x=b.dataset.q;replaceModal(({dm:directModal,group:groupModal,task:()=>taskModal(),event:eventModal,channel:channelModal})[x])})}
const TASK_PRIORITY={normal:'обычный',high:'высокий',urgent:'срочный',low:'низкий'};
function taskModal(sourceMessageId=null,prefill=''){modal('Новая задача',`<form id="task-form" class="form-stack"><label>Что нужно сделать<input name="title" required value="${esc(prefill)}"></label><label>Ожидаемый результат<textarea name="outcome" rows="3" placeholder="Как понять, что задача выполнена?"></textarea></label><label>Ответственный<select name="ownerId" class="field">${colleagues().map(p=>`<option value="${p.userId}" ${p.userId===me().userId?'selected':''}>${esc(p.displayName||p.email)}</option>`).join('')}</select></label><label>Кто принимает результат<select name="acceptorId" class="field">${colleagues().map(p=>`<option value="${p.userId}" ${p.userId===me().userId?'selected':''}>${esc(p.displayName||p.email)}</option>`).join('')}</select></label><label>Срок<input name="promisedAt" type="datetime-local"></label><label>Приоритет<select name="priority" class="field"><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option><option value="low">Низкий</option></select></label><button class="button primary">Создать</button></form>`);$('#task-form').onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    try{
      const{task}=await api('/api/v1/tasks',{method:'POST',body:JSON.stringify({
        title:f.get('title'),outcome:f.get('outcome')||undefined,
        ownerId:f.get('ownerId'),acceptorId:f.get('acceptorId'),priority:f.get('priority'),
        promisedAt:f.get('promisedAt')?new Date(f.get('promisedAt')).toISOString():null,sourceMessageId,
      })});
      upsertTask(task);closeModal();render();toast('Задача создана');
    }catch(error){toast(error.message)}
  };
}

function upsertTask(task){const i=S.tasks.findIndex(x=>x.id===task.id);if(i>=0)S.tasks[i]={...S.tasks[i],...task};else S.tasks.unshift(task)}
const taskReasonRequired=(task,to)=>['blocked','deferred','cancelled'].includes(to)||(task.status==='in_review'&&to==='in_progress')||(task.status==='accepted_result'&&to==='in_progress');
function taskActionLabel(task,to){if(to==='in_progress'&&task.status==='in_review')return'Вернуть на доработку';if(to==='in_progress'&&task.status==='accepted_result')return'Переоткрыть';return TASK_ACTION[to]||to}
function toLocalInput(v){if(!v)return'';const d=new Date(v),pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function canRescheduleTask(t){return !['closed','rejected','cancelled'].includes(t.status)&&([t.ownerId,t.requesterId].includes(me().userId)||['owner','admin','manager'].includes(me().role))}
async function openTask(id){try{const{task}=await api(`/api/v1/tasks/${id}`);upsertTask(task);taskDetailModal(task)}catch(e){toast(e.message)}}
function taskDetailModal(task){
  const evidence=task.evidence||[],acceptances=task.acceptances||[],audit=task.audit||[];
  // Labels are read when the card opens: the list screen would need one
  // request per row to show them, and that is not worth the round trips.
  api(`/api/v1/labelled/task/${task.id}`).then(({items})=>{
    const slot=$('[data-task-label-slot]');
    if(slot)slot.innerHTML=labelChips(items);
  }).catch(()=>{});
  modal(task.title,`<div class="stack">
    <div class="row"><span class="task-status"></span><span><div class="row-title">${esc(TASK_STATUS[task.status]||task.status)}</div><div class="row-sub">Версия ${Number(task.version||1)} · ${esc(TASK_PRIORITY[task.priority]||task.priority||'обычный')}</div></span><span class="chip">${esc(dateTime(task.promisedAt))}</span></div>
    <div><div class="row-title">Метки <button class="text-button" data-task-labels>изменить</button></div>
      <div class="person-chips" data-task-label-slot><span class="muted">загружаем…</span></div></div>
    <div class="surface"><div class="row-title">Ожидаемый результат</div><p class="muted">${esc(task.outcome||task.title)}</p><div class="row-sub">Ответственный: ${esc(name(task.ownerId))} · Принимает: ${esc(name(task.acceptorId))} · Поставил: ${esc(name(task.requesterId))}</div></div>
    <div><div class="row-title">Следующее действие</div>${task.status==='in_progress'&&!evidence.length?'<p class="muted" style="margin:6px 0 0">Чтобы сдать работу на проверку, приложите хотя бы одно доказательство — форма ниже.</p>':''}<div class="inline-actions" style="margin-top:8px">${(task.allowedTransitions||[]).map(to=>`<button class="button ${to==='accepted_result'||to==='closed'?'primary':'secondary'} small" data-task-transition="${esc(to)}">${esc(taskActionLabel(task,to))}</button>`).join('')||'<span class="muted">Доступных переходов сейчас нет.</span>'}</div></div>
    <form id="task-evidence-form" class="form-stack"><div class="row-title">Добавить результат / доказательство</div><label>Тип<select name="type" class="field"><option value="note">Комментарий / результат</option><option value="url">Ссылка</option><option value="metric">Метрика</option><option value="message">Ссылка на сообщение</option><option value="file">Идентификатор файла</option></select></label><label>Данные<textarea name="value" rows="3" required placeholder="Что сделано, где результат или чем это подтверждается"></textarea></label><button class="button secondary">Добавить доказательство</button></form>
    <button data-task-favour class="button secondary">${S.favourites?.has('task:'+task.id)?'Убрать из избранного':'В избранное'}</button><button data-task-remind class="button secondary">Напомнить о задаче</button>${canReassignTask(task)?'<button data-task-reassign class="button secondary">Передать задачу</button>':''}${canRescheduleTask(task)?'<button class="button secondary" data-task-reschedule>Изменить срок / прогноз</button>':''}
    <div><div class="row-title">Доказательства · ${evidence.length}</div>${evidence.length?evidence.map(e=>`<div class="row"><span>↗</span><span><div class="row-title">${esc(e.type)}</div><div class="row-sub">${esc(e.value)}</div></span><span class="time">${esc(dateTime(e.createdAt))}</span></div>`).join(''):'<div class="empty">Пока нет. Без доказательства результат нельзя отправить на проверку.</div>'}</div>
    ${acceptances.length?`<div><div class="row-title">Проверка результата</div>${acceptances.map(a=>`<div class="row"><span>${a.decision==='accepted'?'✓':'↩'}</span><span><div class="row-title">${a.decision==='accepted'?'Результат принят':'Возвращено на доработку'}</div><div class="row-sub">${esc(a.comment||'')}</div></span><span class="time">${esc(dateTime(a.createdAt))}</span></div>`).join('')}</div>`:''}
    ${audit.length?`<details><summary>История изменений · ${audit.length}</summary><div class="stack" style="margin-top:8px">${audit.map(a=>`<div class="row-sub">${esc(dateTime(a.createdAt))} · <span>${esc(TASK_EVENT[a.eventType]||a.eventType)}</span>${a.payload?.reason?` — «${esc(a.payload.reason)}»`:''}</div>`).join('')}</div></details>`:''}
  </div>`);
  $$('[data-task-transition]').forEach(b=>b.onclick=()=>taskTransition(task,b.dataset.taskTransition));
  $('[data-task-labels]').onclick=()=>labelPicker('task',task.id,{title:`Метки: ${task.title}`});
  const form=$('#task-evidence-form');if(form)form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);try{const r=await api(`/api/v1/tasks/${task.id}/evidence`,{method:'POST',body:JSON.stringify({type:f.get('type'),value:f.get('value'),expectedVersion:task.version})});upsertTask(r.task);toast('Доказательство добавлено');await openTask(task.id)}catch(error){toast(error.message);if(error.code==='STALE_TASK_ACTION')await openTask(task.id)}};
  $('[data-task-favour]')?.addEventListener('click',async()=>{await toggleFavourite('task',task.id);resumeTop()});
  $('[data-task-remind]')?.addEventListener('click',()=>remindAboutModal(task.title,{sourceType:'task',sourceId:task.id}));
  $('[data-task-reassign]')?.addEventListener('click',()=>taskReassignModal(task));
  $('[data-task-reschedule]')?.addEventListener('click',()=>taskRescheduleModal(task));
}
function taskTransition(task,to){if(taskReasonRequired(task,to)){modal(taskActionLabel(task,to),`<form id="task-transition-form" class="form-stack"><p class="muted">Причина будет сохранена в истории задачи.</p><label>Причина<textarea name="reason" rows="4" required></textarea></label><button class="button primary">${esc(taskActionLabel(task,to))}</button></form>`);$('#task-transition-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await executeTaskTransition(task,to,f.get('reason'))};return}executeTaskTransition(task,to,null)}
async function executeTaskTransition(task,to,reason){try{const{task:updated}=await api(`/api/v1/tasks/${task.id}/transitions`,{method:'POST',body:JSON.stringify({to,reason,expectedVersion:task.version})});upsertTask(updated);toast(TASK_STATUS[updated.status]||'Задача обновлена');await openTask(task.id);render()}catch(error){toast(error.message);if(error.code==='STALE_TASK_ACTION')await openTask(task.id)}}
/**
 * The cure for «Нина ушла в отпуск» used to be cancelling the task and making
 * a new one, which threw away the evidence and the audit chain. A new owner
 * has accepted nothing yet, so the task goes back to «предложена» and they get
 * the choice the first owner had.
 */
function taskReassignModal(task){
  const staff=S.people.filter(p=>p.role!=='guest');
  const option=(p,selected)=>`<option value="${esc(p.userId)}" ${p.userId===selected?'selected':''}>${esc(p.displayName||p.email)}</option>`;
  modal('Передать задачу',`<form id="task-assign-form" class="form-stack">
    <p class="muted">Доказательства, сроки и история останутся на месте. Новый ответственный сам решит, принять ли обязательство.</p>
    <label>Ответственный<select name="ownerId" class="field">${staff.map(p=>option(p,task.ownerId)).join('')}</select></label>
    <label>Кто принимает результат<select name="acceptorId" class="field">${staff.map(p=>option(p,task.acceptorId)).join('')}</select></label>
    <label>Причина<textarea name="reason" rows="3" required placeholder="Почему задача меняет исполнителя"></textarea></label>
    <button class="button primary">Передать</button>
  </form>`,()=>{
    $('#task-assign-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const body={reason:form.get('reason'),expectedVersion:task.version};
      if(form.get('ownerId')!==task.ownerId)body.ownerId=form.get('ownerId');
      if(form.get('acceptorId')!==task.acceptorId)body.acceptorId=form.get('acceptorId');
      if(body.ownerId===undefined&&body.acceptorId===undefined)return toast('Выберите другого человека');
      try{
        const{task:updated}=await api(`/api/v1/tasks/${task.id}/assignment`,{method:'PATCH',body:JSON.stringify(body)});
        upsertTask(updated);
        toast('Задача передана');
        closeModal();render();
        openTask(updated.id);
      }catch(error){toast(error.message)}
    };
  });
}

/** Only the person who asked for the work, or a manager, may hand it on. */
function canReassignTask(task){
  return !['closed','rejected','cancelled'].includes(task.status)
    && (task.requesterId===me().userId||['owner','admin','manager'].includes(me().role));
}

function taskRescheduleModal(task){modal('Изменить срок',`<form id="task-reschedule-form" class="form-stack"><label>Обещанный срок<input name="promisedAt" type="datetime-local" value="${esc(toLocalInput(task.promisedAt))}"></label><label>Прогноз<input name="forecastAt" type="datetime-local" value="${esc(toLocalInput(task.forecastAt))}"></label><label>Причина<textarea name="reason" rows="3" required placeholder="Почему срок или прогноз изменился"></textarea></label><button class="button primary">Сохранить изменение</button></form>`);$('#task-reschedule-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const{task:updated}=await api(`/api/v1/tasks/${task.id}/schedule`,{method:'PATCH',body:JSON.stringify({promisedAt:f.get('promisedAt')?new Date(f.get('promisedAt')).toISOString():null,forecastAt:f.get('forecastAt')?new Date(f.get('forecastAt')).toISOString():null,reason:f.get('reason'),expectedVersion:task.version})});upsertTask(updated);toast('Срок обновлён');await openTask(task.id);render()}catch(error){toast(error.message);if(error.code==='STALE_TASK_ACTION')await openTask(task.id)}}}
/**
 * A meeting is people plus a time. The form asked only for the time: the
 * invitations had to be added through the API afterwards, which is no use to
 * anyone. It also swallowed refusals — an end before the start rejected on
 * the server and the screen said nothing at all — and left the calendar
 * where it was, so an event made for another week looked like nothing had
 * happened.
 */
function eventModal(prefill=''){
  const start=new Date(Date.now()+3600000);start.setMinutes(0,0,0);
  const end=new Date(start.getTime()+3600000);
  modal('Новое событие',`<form id="event-form" class="form-stack">
    <label>Название<input name="title" required maxlength="240" value="${esc(prefill)}"></label>
    <label>Тип<select name="kind" class="field">
      <option value="meeting">Встреча</option><option value="focus">Фокус-время</option>
      <option value="deadline">Дедлайн</option><option value="reminder">Напоминание</option>
    </select></label>
    <label>Начало<input name="start" type="datetime-local" required value="${esc(toLocalInput(start.toISOString()))}"></label>
    <label>Окончание<input name="end" type="datetime-local" required value="${esc(toLocalInput(end.toISOString()))}"></label>
    <label>Описание<textarea name="description" rows="2" maxlength="2000"></textarea></label>
    ${S.boot?.storageMode==='memory'?'':`<div><div class="row-title">Кого позвать</div>
      <div class="row-sub">Каждый получит приглашение и подтвердит участие</div>
      <div style="margin-top:8px">${participantChecks([], 'guest')}</div></div>`}
    <button class="button primary">Создать</button>
  </form>`,()=>{
    $('#event-form').onsubmit=async(submitEvent)=>{
      submitEvent.preventDefault();
      const form=new FormData(submitEvent.currentTarget);
      const startAt=new Date(form.get('start'));
      const endRaw=form.get('end');
      const endAt=endRaw?new Date(endRaw):null;
      if(endAt&&endAt<=startAt)return toast('Окончание должно быть позже начала');
      const invited=form.getAll('guest');
      try{
        // Встреча и приглашения — одним запросом, без половинчатого результата.
        await api('/api/v1/calendar-events',{method:'POST',body:JSON.stringify({
          title:form.get('title'),kind:form.get('kind'),
          description:form.get('description')||null,
          startAt:startAt.toISOString(),endAt:endAt?endAt.toISOString():null,
          timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
          participantIds:invited,
        })});
        // Land on the day the event is on, or the person stares at a week
        // that does not contain what they just made.
        S.cal=S.cal||{view:'week',cursor:new Date(),selected:null};
        S.cal.cursor=startAt;
        closeModal();
        await loadCalendarRange();
        S.view='calendar';
        render();
        toast(invited.length?`Событие создано, приглашено ${invited.length}`:'Событие создано');
      }catch(error){toast(error.message)}
    };
  });
}
/**
 * `openRoom` leaves guests out: a company-wide room is exactly the one an
 * outsider must not be in, and the server refuses it — offering the name
 * would only produce a refusal.
 */
function participantChecks(selected=[],name='participant',{openRoom=false}={}){const chosen=new Set(selected);return S.people.filter(p=>p.userId!==me().userId&&p.active!==false&&(!openRoom||p.role!=='guest')).map(p=>`<label class="row candidate-row" style="cursor:pointer"><input type="checkbox" name="${name}" value="${p.userId}" ${chosen.has(p.userId)?'checked':''}><span class="avatar dark">${esc(initials(p.displayName||p.email))}</span><span><div class="row-title">${esc(p.displayName||p.email)}</div><div class="row-sub">${esc(p.title||p.role)}</div></span></label>`).join('')||'<div class="empty">Сначала пригласите сотрудников.</div>'}

function groupModal(){modal('Новая группа',`<form id="group-form" class="form-stack"><label>Название группы<input name="title" required maxlength="120"></label><div><div class="row-title">Участники</div><div class="row-sub">Выберите минимум одного коллегу</div><div style="margin-top:8px">${participantChecks()}</div></div><button class="button primary">Создать группу</button></form>`);$('#group-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,ids=[...form.querySelectorAll('input[name="participant"]:checked')].map(x=>x.value);if(ids.length<1)return toast('Для группового чата выберите минимум одного коллегу.');try{const f=new FormData(form),{conversation}=await api('/api/v1/conversations',{method:'POST',body:JSON.stringify({kind:'group',title:f.get('title'),participantIds:ids})});S.conversations.unshift(conversation);closeModal();openChat(conversation.id)}catch(error){toast(error.message)}}}

function channelModal(){modal('Новый канал',`<form id="channel-form" class="form-stack"><label>Название<input name="title" required></label><label>Описание<input name="purpose"></label><label>Доступ<select name="visibility" class="field"><option value="workspace">Вся компания</option><option value="private">Только участники</option></select></label><label class="row" style="cursor:pointer"><input type="checkbox" name="announcementOnly"><span><div class="row-title">Только объявления</div><div class="row-sub">Публиковать смогут владелец, модераторы и управляющие каналами</div></span></label><div><div class="row-title">Участники закрытого канала</div><div class="row-sub">Для общего канала список не ограничивает доступ</div><div style="margin-top:8px">${participantChecks()}</div></div><button class="button primary">Создать</button></form>`);$('#channel-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form),ids=[...form.querySelectorAll('input[name="participant"]:checked')].map(x=>x.value);try{const{conversation}=await api('/api/v1/conversations',{method:'POST',body:JSON.stringify({kind:'channel',title:f.get('title'),purpose:f.get('purpose'),visibility:f.get('visibility'),participantIds:ids,announcementOnly:f.get('announcementOnly')==='on'})});S.conversations.unshift(conversation);closeModal();openChat(conversation.id)}catch(error){toast(error.message)}}}

/**
 * What a room is and how to get out of it.
 *
 * The title, the purpose and the announcement-only flag were fixed at
 * creation for ever, and there was no way to leave a room at all: removing
 * yourself needed management rights, so a person invited into a channel
 * stayed in it.
 */
// The tile advertised calls and then told you to find them yourself. It now
// asks the one thing it needs: whom to call.
function callsModal(){
  const rooms=S.conversations.filter(c=>!c.archivedAt);
  if(!rooms.length)return toast('Сначала начните беседу — звонок идёт в неё.');
  modal('Позвонить',`<p class="muted">Звонок идёт в беседу: её участники увидят приглашение.</p>
    <div>${rooms.map(c=>`<div class="row">
      <span class="avatar dark">${c.kind==='channel'?'#':esc(initials(c.title||'Д'))}</span>
      <span><div class="row-title">${esc(c.title||'Диалог')}</div><div class="row-sub">${esc(kindLabel(c.kind)||'')}</div></span>
      <span class="inline-actions"><button class="button small secondary" data-call="audio" data-room="${c.id}">Аудио</button><button class="button small secondary" data-call="video" data-room="${c.id}">Видео</button></span>
    </div>`).join('')}</div>`,()=>{
    $$('[data-call]').forEach(button=>button.onclick=async()=>{
      const{call,room}=button.dataset;
      closeModal();
      openChat(room);
      // startOutgoing reads the open conversation from the page, so the call
      // waits for the screen it was asked about.
      await new Promise(resolve=>setTimeout(resolve,120));
      try{await window.ChatCalls?.startOutgoing?.(call)}catch(error){toast(ERROR_MESSAGE[error.code]||error.message)}
    });
  });
}

function conversationModal(){
  const c=S.conversations.find(x=>x.id===S.selected);
  if(!c)return toast('Сначала откройте беседу');
  const manager=['owner','moderator'].includes(c.memberRole)||['owner','admin','manager'].includes(me().role);
  const direct=c.kind==='direct';
  const kindLabel={channel:'Канал',group:'Группа',direct:'Личный диалог',team:'Команда',project:'Проект',external:'Комната с внешним участником'}[c.kind]||c.kind;
  const visibility=c.visibility==='workspace'?'вся компания':c.visibility==='organization'?'вся организация':'только участники';

  modal(c.title||kindLabel,`
    <div class="person-fields">
      <div class="person-field"><span>Тип</span><strong>${esc(kindLabel)}</strong></div>
      <div class="person-field"><span>Доступ</span><strong>${esc(visibility)}</strong></div>
      <div class="person-field"><span>Вы здесь</span><strong>${esc(c.memberRole?({owner:'владелец',moderator:'модератор',member:'участник',guest:'гость'}[c.memberRole]||c.memberRole):'по видимости канала')}</strong></div>
      ${c.announcementOnly?'<div class="person-field"><span>Режим</span><strong>только объявления</strong></div>':''}
    </div>
    ${c.purpose?`<p class="person-about">${esc(c.purpose)}</p>`:''}
    <div class="stack" style="margin-top:16px">
      ${manager&&!direct?'<button data-conv-edit class="button secondary">Переименовать и настроить</button>':''}
      <button data-conv-members class="button secondary">Участники</button>
      <button data-conv-archive class="button secondary">${c.archivedAt?'Вернуть из архива':'Убрать в архив'}</button>
      ${c.memberRole&&!direct?'<button data-conv-leave class="button danger">Выйти из беседы</button>':''}
    </div>
    ${direct?'<p class="muted" style="margin-top:12px">Личный диалог нельзя переименовать или покинуть — его можно убрать в архив.</p>'
      :(c.memberRole?'':'<p class="muted" style="margin-top:12px">Вы видите этот канал по его открытости, а не по членству: выходить не из чего, уберите его в архив.</p>')}`,()=>{
    if(manager&&!direct)$('[data-conv-edit]').onclick=()=>conversationEditModal(c);
    $('[data-conv-members]').onclick=()=>replaceModal(membersModal);
    $('[data-conv-archive]').onclick=async()=>{closeModal();await archiveCurrent()};
    if(c.memberRole&&!direct)$('[data-conv-leave]').onclick=()=>{
      modal(`Выйти из «${c.title||kindLabel}»?`,`<p class="muted">Беседа исчезнет из вашего списка, история останется у остальных. Вернуться можно только по приглашению.</p>
        <button id="confirm-leave" class="button danger" style="width:100%">Выйти</button>`,()=>{
        $('#confirm-leave').onclick=async()=>{
          try{
            await api(`/api/v1/conversations/${c.id}/leave`,{method:'POST'});
            S.conversations=S.conversations.filter(x=>x.id!==c.id);
            S.selected=S.conversations[0]?.id??null;
            S.mobileChat=false;
            closeModal();toast('Вы вышли из беседы');render();
          }catch(error){toast(error.message)}
        };
      });
    };
  });
}

function conversationEditModal(c){
  modal('Настроить беседу',`<form id="conv-form" class="form-stack">
    <label>Название<input name="title" required maxlength="120" value="${esc(c.title??'')}"></label>
    <label>Описание<input name="purpose" maxlength="500" value="${esc(c.purpose??'')}"></label>
    ${c.kind==='channel'?`<label class="row" style="cursor:pointer"><input type="checkbox" name="announcementOnly" ${c.announcementOnly?'checked':''}>
      <span><div class="row-title">Только объявления</div><div class="row-sub">Публиковать смогут владелец, модераторы и управляющие каналами</div></span></label>`:''}
    <button class="button primary">Сохранить</button>
  </form>`,()=>{
    $('#conv-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const body={title:form.get('title'),purpose:form.get('purpose')||null};
      if(c.kind==='channel')body.announcementOnly=form.get('announcementOnly')==='on';
      try{
        const{conversation}=await api(`/api/v1/conversations/${c.id}`,{method:'PATCH',body:JSON.stringify(body)});
        const i=S.conversations.findIndex(x=>x.id===c.id);
        if(i>=0)S.conversations[i]={...S.conversations[i],...conversation};
        toast('Беседа обновлена');closeModal();render();
      }catch(error){toast(error.message)}
    };
  });
}

async function membersModal(){const conversation=S.conversations.find(x=>x.id===S.selected);if(!conversation)return toast('Сначала откройте группу или канал.');try{const payload=await api(`/api/v1/conversations/${conversation.id}/members`),members=payload.items||[],orphaned=conversation.kind!=='direct'&&!members.some(x=>x.role==='owner')&&['owner','admin','manager'].includes(me().role),memberIds=new Set(members.map(x=>x.userId)),available=S.people.filter(p=>p.userId!==me().userId&&p.active!==false&&!memberIds.has(p.userId));modal('Участники',`<div class="stack"><div>${members.map(m=>`<div class="row" data-member-row="${m.userId}"><span class="avatar dark">${esc(initials(m.displayName||m.email))}</span><span><div class="row-title">${esc(m.displayName||m.email)}</div><div class="row-sub">${esc(m.title||m.workspaceRole||'')}</div></span>${payload.canManage?`<span class="inline-actions"><select class="field" data-member-role="${m.userId}" style="min-width:120px">${m.workspaceRole==='guest'?'':`<option value="owner" ${m.role==='owner'?'selected':''}>Владелец</option><option value="moderator" ${m.role==='moderator'?'selected':''}>Модератор</option>`}<option value="member" ${m.role==='member'?'selected':''}>Участник</option><option value="guest" ${m.role==='guest'?'selected':''}>Гость</option></select><button type="button" class="close-button" data-member-remove="${m.userId}" title="Удалить">×</button></span>`:`<span class="chip">${esc(m.role)}</span>`}</div>`).join('')}</div>${orphaned?`<div class="stack" style="margin:12px 0"><p class="muted">У беседы не осталось владельца: настраивать её и вести список участников некому.</p><button type="button" data-conv-claim class="button secondary">Стать владельцем</button></div>`:''}${payload.canManage&&available.length?`<form id="add-members-form" class="form-stack"><div><div class="row-title">Добавить участников</div><div style="margin-top:8px">${available.filter(p=>!['workspace','organization'].includes(conversation.visibility)||p.role!=='guest').map(p=>`<label class="row candidate-row" style="cursor:pointer"><input type="checkbox" name="candidate" value="${p.userId}"><span class="avatar dark">${esc(initials(p.displayName||p.email))}</span><span><div class="row-title">${esc(p.displayName||p.email)}</div><div class="row-sub">${esc(p.title||p.role)}</div></span></label>`).join('')}</div></div><button class="button secondary">Добавить выбранных</button></form>`:''}</div>`);const claimButton=$('[data-conv-claim]');if(claimButton)claimButton.onclick=async()=>{try{await api(`/api/v1/conversations/${conversation.id}/claim`,{method:'POST'});const i=S.conversations.findIndex(x=>x.id===conversation.id);if(i>=0)S.conversations[i]={...S.conversations[i],memberRole:'owner'};toast('Вы стали владельцем беседы');await membersModal();render()}catch(error){toast(error.message)}};if(payload.canManage){$$('[data-member-role]').forEach(select=>select.onchange=async()=>{try{await api(`/api/v1/conversations/${conversation.id}/members/${select.dataset.memberRole}`,{method:'PATCH',body:JSON.stringify({role:select.value})});toast('Роль обновлена');await membersModal()}catch(error){toast(error.message);await membersModal()}});$$('[data-member-remove]').forEach(button=>button.onclick=async()=>{try{await api(`/api/v1/conversations/${conversation.id}/members/${button.dataset.memberRemove}`,{method:'DELETE'});toast('Участник удалён');await membersModal()}catch(error){toast(error.message)}});const form=$('#add-members-form');if(form)form.onsubmit=async e=>{e.preventDefault();const ids=[...form.querySelectorAll('input[name="candidate"]:checked')].map(x=>x.value);if(!ids.length)return toast('Выберите участников.');try{await api(`/api/v1/conversations/${conversation.id}/members`,{method:'POST',body:JSON.stringify({userIds:ids})});toast('Участники добавлены');await membersModal()}catch(error){toast(error.message)}}}}catch(error){toast(error.message)}}

function directModal(){const others=S.people.filter(p=>p.userId!==me().userId);modal('Новое сообщение',others.map(p=>`<button class="conversation-card" data-person="${p.userId}"><span class="avatar dark">${esc(initials(p.displayName||p.email))}</span><span><strong>${esc(p.displayName||p.email)}</strong><div class="preview">${esc(p.title||p.role)}</div></span></button>`).join('')||'<div class="empty">Сначала пригласите сотрудников.</div>');$$('[data-person]').forEach(b=>b.onclick=async()=>{const p=person(b.dataset.person),{conversation}=await api('/api/v1/conversations',{method:'POST',body:JSON.stringify({kind:'direct',title:p?.displayName||null,participantIds:[b.dataset.person]})});S.conversations.unshift(conversation);closeModal();openChat(conversation.id)})}
function inviteModal(){modal('Пригласить сотрудника',`<form id="invite-form" class="form-stack"><label>Email<input name="email" type="email" required></label><label>Роль<select name="role" class="field"><option value="member">Сотрудник</option><option value="manager">Руководитель</option><option value="admin">Администратор</option><option value="guest">Гость</option></select></label><button class="button primary">Создать приглашение</button></form>`);$('#invite-form').onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    try{
      const{invitation}=await api('/api/v1/invitations',{method:'POST',body:JSON.stringify({email:f.get('email'),role:f.get('role')})});
      modal('Приглашение готово',`<p class="muted">Ссылка действует 7 дней.</p>
        <input id="invite-link" class="field" readonly value="${esc(invitation.inviteUrl)}">
        <button data-copy class="button primary" style="width:100%;margin-top:12px">Скопировать</button>`,()=>{
        $('[data-copy]').onclick=async()=>{
          // A clipboard write needs permission the pane may refuse; selecting
          // the text at least leaves the link copyable by hand.
          try{await navigator.clipboard.writeText(invitation.inviteUrl);toast('Ссылка скопирована')}
          catch{$('#invite-link').select()}
        };
      });
    }catch(error){toast(error.message)}
  };
}
function teamModal(){modal('Команда',S.people.map(p=>`<button class="row pressable" data-person="${esc(p.userId)}" style="width:100%;text-align:left"><span class="avatar dark">${esc(initials(p.displayName||p.email))}</span><span><div class="row-title">${esc(p.displayName||p.email)}${p.active===false?' · уволен':''}</div><div class="row-sub">${esc(p.title||p.role)}</div></span><span class="presence-dot ${esc(p.presence?.state||'offline')}"></span></button>`).join(''),()=>{
  $$('[data-person]').forEach(b=>{b.onclick=()=>personPage(b.dataset.person)});
})}
function profileModal(){modal('Профиль и безопасность',`<div class="row"><span class="avatar">${esc(initials(me().displayName))}</span><span><div class="row-title">${esc(me().displayName)}</div><div class="row-sub">${esc(me().email)} · ${esc(me().role)}</div></span></div><div class="stack" style="margin-top:14px"><button data-push class="button secondary">Включить push</button><button data-logout class="button danger">Выйти</button></div>`);$('[data-push]').onclick=enablePush;$('[data-logout]').onclick=logout}
async function logout(){await api('/api/v1/auth/logout',{method:'POST'}).catch(()=>{});S.ws?.close();S.boot=null;closeModal();auth()}
async function enablePush(){try{if(!S.boot?.push?.enabled)return toast('На сервере ещё не настроены VAPID-ключи.');if(!S.swReady)return toast('Браузер не разрешил фоновый сценарий — push здесь недоступен.');if(await Notification.requestPermission()!=='granted')return toast('Push не разрешён.');const r=await navigator.serviceWorker.ready;let sub=await r.pushManager.getSubscription();if(!sub)sub=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(S.boot.push.publicKey)});await api('/api/v1/push-subscriptions',{method:'POST',body:JSON.stringify(sub)});toast('Push включён')}catch(e){toast(e.message)}}
function key(v){const s=(v+'='.repeat((4-v.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(s);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}
function connect(){S.ws?.close();const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);S.ws=ws;ws.onmessage=e=>{try{const p=JSON.parse(e.data),d=p.data;if(p.event==='game.updated'){if(S.gameWatch&&d?.gameId===S.gameWatch)resumeTop();return}if(p.event==='message.created'){append(d.conversationId,d.message);if(S.view==='chats')render()}if(p.event==='message.reaction'){for(const list of S.messages.values()){const m=list.find(x=>x.id===d.messageId);if(m)m.reactions=d.reactions}if(S.view==='chats')render()}if(p.event==='message.updated'){updateMessage(d.message.id,d.message);if(S.view==='chats')render()}if(p.event==='message.deleted'){updateMessage(d.message.id,d.message);if(S.view==='chats')render()}if(p.event==='message.pin'){updateMessage(d.messageId,{pinned:d.pinned});if(S.view==='chats')render()}if(p.event==='conversation.created'&&!S.conversations.some(x=>x.id===d.id)){S.conversations.unshift(d);shell();if(S.view==='chats')render()}if(p.event==='presence.updated'){const x=person(d.userId);if(x)x.presence=d.presence;lists()}if(p.event==='task.created'&&!S.tasks.some(x=>x.id===d.id)){S.tasks.unshift(d);if(['today','tasks'].includes(S.view))render()}if(p.event==='task.updated'){upsertTask(d);if(['today','tasks'].includes(S.view))render()}if(p.event==='calendar.created'&&!S.calendar.some(x=>x.id===d.id)){S.calendar.push(d);if(['today','calendar'].includes(S.view))render()}if(p.event==='typing.start'||p.event==='typing.stop'){if(d.conversationId===S.selected&&$('#typing'))$('#typing').textContent=p.event.endsWith('start')?`${name(d.userId)} печатает…`:''}}catch{}};ws.onclose=()=>S.boot&&setTimeout(connect,1600)}
async function voice(){if(S.recorder?.state==='recording'){S.recorder.stop();return}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true}),chunks=[],r=new MediaRecorder(stream);S.recorder=r;S.recordingAt=Date.now();r.ondataavailable=e=>e.data.size&&chunks.push(e.data);r.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:r.mimeType||'audio/webm'}),duration=Date.now()-S.recordingAt;S.recorder=null;const resp=await fetch(`/api/v1/conversations/${S.selected}/voice?durationMs=${duration}`,{method:'POST',credentials:'same-origin',headers:{'content-type':blob.type},body:blob}),p=await resp.json();if(resp.ok){append(S.selected,p.message);render()}else toast(p?.error?.message||'Ошибка записи')};r.start(250);toast('Запись началась — нажмите ещё раз, чтобы отправить.')}catch{toast('Нет доступа к микрофону.')}}
$('#file-picker').onchange=async e=>{for(const file of e.target.files){const r=await fetch('/api/v1/files',{method:'POST',credentials:'same-origin',headers:{'content-type':file.type||'application/octet-stream','x-file-name':encodeURIComponent(file.name)},body:file}),p=await r.json();if(!r.ok){toast(p?.error?.message||'Ошибка загрузки');continue}const{message}=await api(`/api/v1/conversations/${S.selected}/messages`,{method:'POST',body:JSON.stringify({kind:'file',metadata:{fileId:p.file.id,name:file.name,mimeType:file.type,size:file.size,contentUrl:p.file.contentUrl}})});append(S.selected,message)}e.target.value='';render()};
$$('[data-auth-mode]').forEach(b=>b.onclick=()=>setAuth(b.dataset.authMode));$('#login-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/v1/auth/login',{method:'POST',body:JSON.stringify({email:f.get('email'),password:f.get('password')})});bootstrap()}catch(x){$('#auth-error').textContent=x.message}};$('#register-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/v1/auth/register-company',{method:'POST',body:JSON.stringify({companyName:f.get('companyName'),ownerName:f.get('ownerName'),email:f.get('email'),password:f.get('password')})});bootstrap()}catch(x){$('#auth-error').textContent=x.message}};$('#accept-invite-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/v1/invitations/accept',{method:'POST',body:JSON.stringify({token:e.currentTarget.dataset.token,displayName:f.get('displayName'),password:f.get('password')})});history.replaceState({},'',location.pathname);bootstrap()}catch(x){$('#auth-error').textContent=x.message}};
window.CHAT_ERRORS=ERROR_MESSAGE;
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').then(()=>{S.swReady=true}).catch(error=>{S.swError=error?.message||String(error)});bootstrap();
