const S={view:'today',boot:null,voice:null,highlights:new Map(),notes:new Map(),favourites:new Set(),conversations:[],people:[],tasks:[],calendar:[],selected:null,messages:new Map(),messageCursor:new Map(),unreadFrom:new Map(),readUpTo:new Map(),tasksFromMessage:new Map(),invitations:[],taskFilter:'active',taskScope:'mine',taskCounts:null,tasksPage:null,tasksCursor:null,loadingOlder:false,keepScroll:null,ws:null,mobileChat:false,reply:null,recorder:null,recordingAt:0,chatFilter:'all',gameFrom:null,gameWatch:null,labels:null,plan:[],planFilter:'open',labelsUnavailable:false,planUnavailable:false};
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
  assistant:svg('<path d="M12 3.6 13.6 8 18 9.6 13.6 11.2 12 15.6 10.4 11.2 6 9.6 10.4 8Z"/><path d="M18.4 15.6 19.2 17.6 21.2 18.4 19.2 19.2 18.4 21.2 17.6 19.2 15.6 18.4 17.6 17.6Z"/>'),
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
  digest:svg('<path d="M4.6 5.6h14.8v12.8H4.6z"/><path d="M7.6 9.2h8.8M7.6 12.4h8.8M7.6 15.6h5.4"/>'),
  report:svg('<path d="M5 19.4V9.2M12 19.4V4.6M19 19.4v-6.6"/><path d="M3.4 19.4h17.2"/>'),
  costs:svg('<rect x="3.4" y="6.4" width="17.2" height="11.2" rx="1.8"/><circle cx="12" cy="12" r="2.6"/><path d="M6.6 12h.01M17.4 12h.01"/>'),
  knowledge:svg('<path d="M12 5.4c-1.6-1.4-4-2-6.6-1.4v13.2c2.6-.6 5 0 6.6 1.4c1.6-1.4 4-2 6.6-1.4V4c-2.6-.6-5 0-6.6 1.4Z"/><path d="M12 5.4v13.2"/>'),
  settings:svg('<circle cx="12" cy="12" r="3"/><path d="M19.2 14.2a1.4 1.4 0 0 0 .3 1.5l.1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.4 1.4 0 0 0-2.4 1v.3a1.7 1.7 0 1 1-3.4 0v-.2a1.4 1.4 0 0 0-2.4-1l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.4 1.4 0 0 0-1-2.4h-.3a1.7 1.7 0 1 1 0-3.4h.2a1.4 1.4 0 0 0 1-2.4l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.4 1.4 0 0 0 2.4-1v-.3a1.7 1.7 0 1 1 3.4 0v.2a1.4 1.4 0 0 0 2.4 1l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.4 1.4 0 0 0 1 2.4h.2a1.7 1.7 0 1 1 0 3.4h-.3a1.4 1.4 0 0 0-1.3.9Z"/>'),
  apikeys:svg('<circle cx="8" cy="14.8" r="3.6"/><path d="M10.4 12.4 18.4 4.4M15.2 7.6l2.4 2.4M17.6 5.2 20 7.6"/>'),
  wiki:svg('<path d="M6.4 3.8h8.2l4 4v12.4H6.4Z"/><path d="M14.6 3.8v4h4"/><path d="M9.2 12h6M9.2 15.2h6M9.2 8.8h3"/>'),
  timeReport:svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.6 1.6"/><path d="M9.4 2.6h5.2"/>'),
  dashboard:svg('<rect x="3.4" y="3.4" width="7.6" height="7.6" rx="1.4"/><rect x="13" y="3.4" width="7.6" height="4.8" rx="1.4"/><rect x="13" y="10.4" width="7.6" height="10.2" rx="1.4"/><rect x="3.4" y="13.2" width="7.6" height="7.4" rx="1.4"/>'),
};
const nav=[['today',navIcon.today,'Сегодня'],['chats',navIcon.chats,'Сообщения'],['tasks',navIcon.tasks,'Задачи'],['calendar',navIcon.calendar,'Календарь'],['more',navIcon.more,'Ещё']];
// Гость — представитель заказчика: задач и календаря компании он не
// видит и завести не может. Две вечно пустые вкладки в нижнем меню
// выглядели как сломанный продукт, а не как границы доступа.
const GUEST_HIDDEN_VIEWS=new Set(['tasks','calendar']);
const guestShell=()=>me()?.role==='guest';
// «Мои задачи» и «Расписание дня» у гостя не наполнятся ничем и никогда:
// ни одной задачи компании он не увидит, ни одной встречи не заведёт.
// Пустые карточки с призывом «создайте задачу» — обещание вместо границы.
const tasksVisible=()=>!guestShell(),calendarVisible=()=>!guestShell();
const visibleNav=()=>guestShell()?nav.filter(([id])=>!GUEST_HIDDEN_VIEWS.has(id)):nav;
// Обязательство берёт на себя сотрудник компании. Гость — представитель
// заказчика: предлагать его ответственным значит обещать то, чего сервер
// не позволит, и заодно показывать чужим людям штат.
const colleagues=()=>S.people.filter(p=>p.role!=='guest'&&p.active!==false);
const me=()=>S.boot?.session,can=permission=>(S.boot?.permissions||[]).includes(permission),person=id=>S.people.find(p=>p.userId===id),name=id=>person(id)?.displayName||person(id)?.email||(id===me()?.userId?me()?.displayName:'Сотрудник');
/**
 * Лицо человека и обложка беседы.
 *
 * Раньше в списке стояли две буквы инициалов, и «Анна Дроздова» с
 * «Андрей Демидов» были одним и тем же серым кружком «АД». Группы не
 * различались вовсе: в узкой колонке название обрезается на третьем
 * слове, а иконка у всех одинаковая.
 *
 * Если фотография не открылась — файл удалили, сеть моргнула — кружок
 * с инициалами остаётся на месте: пустая рамка хуже двух букв.
 */
const avatarBox=(mark,url,extra='')=>`<span class="avatar dark ${extra}">${url
  ?`<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">`:''}${esc(mark)}</span>`;

/**
 * Вид беседы — это цвет рамки и знак.
 *
 * Канал, группа, личная переписка и комната с внешним человеком
 * выглядели одинаково, а перепутать их дорого: «отправил не туда»
 * здесь означает показать смету подрядчику или зарплату всей компании.
 */
/** Как назвать источник переноса в строке над сообщением. */
const SOURCE_WORD={whatsapp:'WhatsApp',telegram:'Telegram',sms:'СМС',email:'почты',other:'другого мессенджера'};

const ROOM_LOOK={
  channel:{mark:'#'},group:{mark:'❖'},direct:{mark:null},
  team:{mark:'◆'},project:{mark:'▲'},external:{mark:'◈'},
};
function roomAvatar(c){
  const look=ROOM_LOOK[c?.kind]??{mark:null};
  const mark=look.mark??initials(c?.title||'Д');
  return avatarBox(mark,c?.avatarUrl,`room room-${esc(c?.kind||'direct')}`);
}
/** Фотография человека, если он её поставил. */
/**
 * Кружок человека.
 *
 * По лицу коллеги в переписке рука тянется нажать — а это был просто
 * значок, и нажатие не делало ничего. Теперь он ведёт туда же, куда
 * строка в «Команде»: в карточку человека.
 */
function personAvatar(value,fallbackName){
  const p=typeof value==='string'?person(value):value;
  const label=p?.displayName||p?.email||fallbackName||'?';
  const id=typeof value==='string'?value:p?.userId;
  return avatarBox(initials(label),p?.avatarUrl,
    id?`opens-person" data-person="${esc(id)}" role="button" tabindex="0" title="${esc(label)}`:'');
}

const initials=(v='?')=>v.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join('')||'?';
const time=v=>v?new Intl.DateTimeFormat(locale()==='en'?'en-GB':'ru',{hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'',dateTime=v=>v?new Intl.DateTimeFormat(locale()==='en'?'en-GB':'ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):(locale()==='en'?'No due date':'Без срока');
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
  STALE_CONVERSATION:'Беседу успели поправить в другом окне. Закройте настройки, откройте заново и повторите.',
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
    // Пароля ещё нет — «забыли пароль» здесь нечего чинить.
    $('#auth-help').hidden=true;
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

function setAuth(mode){$('.segmented').hidden=false;$('#auth-help').hidden=false;$('#accept-invite-form').hidden=true;$('#join-form').hidden=true;$('#login-form').hidden=mode!=='login';$('#register-form').hidden=mode!=='register';$('#auth-title').textContent=mode==='login'?'Войти в компанию':'Создать компанию';$$('[data-auth-mode]').forEach(b=>b.classList.toggle('active',b.dataset.authMode===mode));$('#auth-error').textContent=''}
/**
 * Recovery has no mail channel, so the person who forgot asks the one party
 * who already knows who works here. Saying so beats an empty screen: before
 * this there was no «forgot» affordance at all.
 */
/**
 * «Забыли пароль».
 *
 * Здесь стоял текст «почтовый канал у рабочего пространства не настроен,
 * и отправить письмо некому — напишите администратору любым доступным
 * способом». Теперь письмо есть кому отправить.
 *
 * Ответ один и тот же на любой адрес: сервер намеренно не говорит, есть
 * ли у нас такой человек, и повторять его догадку в интерфейсе нельзя —
 * иначе форма превращается в проверку «кто здесь работает».
 */
function forgotPasswordModal(){
  modal('Забыли пароль?',`
    <form id="forgot-form" class="form-stack">
      <p class="muted">Укажите рабочую почту — пришлём ссылку для смены пароля. Она живёт час и сработает один раз.</p>
      <label>Рабочий email<input name="email" type="email" autocomplete="email" placeholder="name@company.com" required></label>
      <button class="button primary pressable" type="submit">Прислать ссылку</button>
      <p class="muted" style="font-size:12px">Если почта в компании ещё не настроена, ссылку по-прежнему может выписать владелец или администратор — он найдёт вас в разделе «Команда».</p>
    </form>`,()=>{
    const form=$('#forgot-form');
    form.onsubmit=async(event)=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      button.disabled=true;
      const email=new FormData(form).get('email');
      try{await api('/api/v1/password-resets/request',{method:'POST',body:JSON.stringify({email})})}
      catch(error){
        // Слишком частые просьбы — единственное, о чём стоит сказать
        // честно: молчание здесь выглядит как «форма не работает».
        if(error.code==='RATE_LIMITED'){button.disabled=false;return toast('Слишком часто. Попробуйте через несколько минут.')}
      }
      closeModal();
      toast('Если такой адрес у нас есть, письмо уже в пути.');
    };
  });
}

async function bootstrap(){try{const b=await (window.ChatBootstrap?.get({force:true})??api('/api/v1/bootstrap'));window.ChatBootstrap?.put(b);S.boot=b;S.conversations=b.conversations||[];S.people=b.people||[];S.selected=S.selected||S.conversations[0]?.id||null;await Promise.all([loadOnboarding(),loadTasks(),loadTaskPage(),loadCalendar(),loadInvitations(),loadPlan(),loadLabelTargets().catch(()=>{}),loadMarks()]);$('#auth-view').hidden=true;$('#app-view').hidden=false;shell();render();startClock();connect();await routeFromHash()}catch(e){if(e.status===401)auth();else{auth();$('#auth-error').textContent=e.message}}}
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
  // У задачи и беседы адрес был, у встречи — нет: уведомление «вас позвали»
  // вело в общий календарь, и человек искал нужную встречу глазами.
  if(parts[0]==='calendar'&&parts[1]){S.view='calendar';render();await eventPage(parts[1]);return}
  if(parts[0]&&VIEWS.has(parts[0])){if(S.view!==parts[0])go(parts[0],{silent:true});return}
  if(!parts.length&&S.view!=='today')go('today',{silent:true});
  // Неизвестный раздел: остаёмся, где были, а адрес приводим в порядок.
  if(parts.length&&!VIEWS.has(parts[0])&&!['meetings','meeting-operations'].includes(parts[0]))history.replaceState(null,'',`#/${S.view||'today'}`);
}
window.addEventListener('hashchange',()=>{routeFromHash().catch(e=>toast(e.message))});
// The task list is paged now. The screen still shows one backlog, so it walks
// the cursor to the end — bounded, so a runaway cursor cannot spin forever.
/**
 * Какие задачи выросли из какого сообщения.
 *
 * Связь хранится в базе и приходит в ответе с первого дня, но в
 * интерфейсе не была отрисована нигде: коллеги продолжали обсуждать
 * смету, не зная, что вопрос уже кому-то поручен.
 */
function indexTasksByMessage(){
  const index=new Map();
  for(const task of S.tasks||[]){
    if(!task.sourceMessageId)continue;
    const list=index.get(task.sourceMessageId)??[];
    list.push(task);
    index.set(task.sourceMessageId,list);
  }
  S.tasksFromMessage=index;
}

async function loadTasks(){
  try{
    const items=[];let cursor=null,pages=0;
    do{
      const page=await api(`/api/v1/tasks?limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);
      items.push(...(page.items||[]));
      cursor=page.nextCursor||null;
    }while(cursor&&++pages<20);
    S.tasks=items;
    indexTasksByMessage();
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
async function loadMessages(id,{force=false}={}){
  if(!id||(S.messages.has(id)&&!force))return;
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
function shell(){const s=me();$('#profile-card').innerHTML=`${personAvatar(s.userId,s.displayName)}<span><strong>${esc(s.displayName)}</strong><small>${esc(s.role)}</small></span><span class="presence-dot online"></span>`;// Своё лицо и в верхнем углу: человек узнаёт кнопку своего профиля
  // по нему, а не по двум буквам.
  const mine=person(s.userId)?.avatarUrl??s.profile?.avatarUrl;
  $('#top-avatar').innerHTML=mine
    ?`<img src="${esc(mine)}" alt="" onerror="this.replaceWith(document.createTextNode('${esc(initials(s.displayName))}'))">`
    :esc(initials(s.displayName));
  // Both of these carry a chevron and a press animation, so they promise an
  // action; neither had a handler of any kind.
  $('#profile-card').onclick=()=>personPage(me().userId);
  navs();lists()}

/** What the workspace actually is, since the switcher implies there is more than one. */
function navs(){const html=visibleNav().map(([id,i,l])=>`<button class="nav-item pressable ${S.view===id?'active':''}" data-nav="${id}"${S.view===id?' aria-current="page"':''}><span class="nav-icon">${i}</span><span>${l}</span></button>`).join('');$('#desktop-nav').innerHTML=$('#mobile-nav').innerHTML=html}
function lists(){const channels=S.conversations.filter(c=>['channel','team','project'].includes(c.kind)),dm=S.conversations.filter(c=>['direct','group'].includes(c.kind));$('#channel-list').innerHTML=channels.map(c=>side(c,'#')).join('');$('#direct-list').innerHTML=dm.map(c=>side(c,'')).join('')}
function side(c,prefix){return `<button class="sidebar-row pressable ${S.selected===c.id?'active':''}" data-conversation="${c.id}"><span>${prefix||'<span class="presence-dot online"></span>'}</span><span class="label">${esc(c.title||'Диалог')}</span></button>`}
/**
 * Знак ChatX в шапке — разметкой, а не картинкой по ссылке.
 *
 * Был отдельной картинкой по ссылке, и это лишняя точка отказа: не
 * отдался файл, застрял в кэше служебного работника, пришёл не с тем
 * типом — и вместо знака пустой квадрат с надорванным уголком. Внутри
 * страницы ломаться нечему, и запрос на один меньше.
 *
 * Те же две фигуры, что в `public/icon.svg`: пузырь разговора и галочка
 * внутри. Файл остаётся — он нужен манифесту и домашнему экрану.
 */
const BRAND_MARK='<svg class="brand-mark" viewBox="0 0 512 512" width="28" height="28" aria-hidden="true" focusable="false">'
  +'<rect width="512" height="512" rx="132" fill="#f1eee9"/>'
  +'<path d="M146 104h220a62 62 0 0 1 62 62v140a62 62 0 0 1-62 62H240l-78 64v-64h-16a62 62 0 0 1-62-62V166a62 62 0 0 1 62-62Z" fill="#0b0b0b"/>'
  +'<path d="M176 232l56 56 106-112" fill="none" stroke="#f1eee9" stroke-width="48" stroke-linecap="round" stroke-linejoin="round"/>'
  +'</svg>';

function render(){
  navs();lists();
  // Заголовок главной — это имя продукта, а не название раздела: человек,
  // открывший приложение, должен видеть, куда он попал. На остальных
  // экранах имя раздела нужнее: по нему понимают, где находятся.
  const heading=$('#screen-title');
  if(S.view==='today'){
    heading.innerHTML=`<span class="brand">${BRAND_MARK}<span>ChatX</span></span>`;
  }else{
    heading.textContent=nav.find(x=>x[0]===S.view)?.[2]||'ChatX';
  }
  $('#screen').innerHTML=({today,chats,tasks,calendar,more})[S.view]();
  bind();bindCalendar();bindPeopleAvatars();
}
/**
 * Расписание дня и «Мои задачи» — для тех, у кого они бывают.
 *
 * Гостю обе карточки показывали пустоту с призывом «добавьте встречу» и
 * «создайте задачу вручную или из сообщения»: ни того, ни другого сервер
 * ему не даст. Пустой экран честнее выглядит, когда его нет.
 */
const agendaSection=(events,agendaTitle,agendaHint,dayEnd)=>calendarVisible()?`<section class="surface"><div class="section-head"><div><h2>${esc(agendaTitle)}</h2><p class="muted">${esc(agendaHint)}</p></div>${can('calendar.create')?'<button data-action="event" class="button secondary small pressable">＋ Событие</button>':''}</div>${events.length?events.map(e=>`<${e.readOnly?'div':'button'} class="agenda-row ${esc(e.kind)}${e.readOnly?'':' pressable'}"${e.readOnly?'':` type="button" data-cal-event="${esc(e.id)}"`} style="width:100%;text-align:left"><span class="agenda-time">${e.allDay?'весь день':time(e.startAt)}</span><span><div class="row-title">${esc(e.title)}</div><div class="row-sub">${esc([
      Date.parse(e.startAt)>=dayEnd.getTime()?new Date(e.startAt).toLocaleDateString(locale()==='en'?'en-GB':'ru-RU',{day:'numeric',month:'long'}):'',
      e.participantCount?`${e.participantCount} ${pluralIn(e.participantCount,['участник','участника','участников'],['participant','participants'])}`:'',
      e.needsMyAnswer?'нужен ответ':'',
    ].filter(Boolean).join(' · '))}</div></span><span class="chip warm">${e.kind==='birthday'?'поздравить':e.kind==='holiday'?(e.dayOff?'нерабочий':'сокращённый'):e.kind==='meeting'?'Встреча':'В плане'}</span></${e.readOnly?'div':'button'}>`).join(''):'<div class="empty"><strong>Свободный день</strong>Добавьте встречу или фокус-время.</div>'}</section>`:'';
const myTasksSection=(active)=>tasksVisible()?`<section class="surface"><div class="section-head"><h2>Мои задачи</h2>${can('task.create')?'<button data-action="task" class="button secondary small pressable">＋ Задача</button>':''}</div>${active.slice(0,5).map(taskRow).join('')||'<div class="empty"><strong>Задач пока нет</strong>Создайте задачу вручную или из сообщения.</div>'}</section>`:'';
function today(){const active=S.tasks.filter(t=>!['closed','accepted_result','cancelled'].includes(t.status));
  const dayStart=new Date();dayStart.setHours(0,0,0,0);
  const dayEnd=new Date(dayStart);dayEnd.setDate(dayEnd.getDate()+1);
  const byStart=(a,b)=>Date.parse(a.startAt)-Date.parse(b.startAt);
  const todays=S.calendar.filter(e=>{const t=Date.parse(e.startAt);return t>=dayStart.getTime()&&t<dayEnd.getTime()}).sort(byStart);
  const later=S.calendar.filter(e=>Date.parse(e.startAt)>=dayEnd.getTime()).sort(byStart);
  const events=(todays.length?todays:later).slice(0,4);
  const agendaTitle=todays.length||!later.length?'Расписание дня':'Ближайшие встречи';
  const agendaHint=todays.length?'Встречи и рабочее время':later.length?'Сегодня встреч нет':'Встречи и рабочее время';return `<div class="page-grid"><div class="stack"><section class="surface greeting"><p class="kicker" id="now-line" data-prefs-owned>${esc(nowLine())}</p><h2><span id="greeting-word">${greetingFor(new Date())}</span>, ${esc((me().displayName||'').split(' ')[0])}</h2></section>${onboardingSection()}${S.invitations.length?`<section class="surface"><div class="section-head"><div><h2>Ждут вашего ответа</h2><p class="muted">${S.invitations.length} ${pluralIn(S.invitations.length,['приглашение','приглашения','приглашений'],['invitation','invitations'])} на встречу</p></div></div>${S.invitations.map(i=>`<div class="agenda-row"><span class="agenda-time">${time(i.startAt)}</span><span><div class="row-title">${esc(i.title)}</div><div class="row-sub">${esc(new Date(i.startAt).toLocaleDateString(locale()==='en'?'en-GB':'ru-RU',{day:'numeric',month:'long'}))}${i.organiser?` · ${esc(i.organiser)}`:''}</div></span><span class="inline-actions">${[['accepted','Приду'],['tentative','Под вопросом'],['declined','Не приду']].map(([value,caption])=>`<button class="button small ${value==='accepted'?'primary':'secondary'} pressable" data-invite-answer="${value}" data-invite-event="${esc(i.id)}">${caption}</button>`).join('')}</span></div>`).join('')}</section>`:''}${agendaSection(events,agendaTitle,agendaHint,dayEnd)}${answerNeededSection()}${myTasksSection(active)}${planSection()}</div><div class="stack"><div class="metric-grid">${tasksVisible()?`<button type="button" class="metric-card pressable" data-nav="tasks"><strong>${active.length}</strong><span>${pluralIn(active.length,['активная задача','активные задачи','активных задач'],['active task','active tasks'])}</span></button>`:''}${guestShell()?'':`<button type="button" class="metric-card pressable" data-action="team"><strong>${S.people.length}</strong><span>${pluralIn(S.people.length,['сотрудник','сотрудника','сотрудников'],['employee','employees'])}</span></button>`}<button type="button" class="metric-card pressable" data-nav="chats"><strong>${S.conversations.length}</strong><span>${pluralIn(S.conversations.length,['диалог','диалога','диалогов'],['conversation','conversations'])}</span></button></div><section class="surface"><div class="section-head"><h3>Последние сообщения</h3></div>${S.conversations.slice(0,6).map(c=>convRow(c)).join('')||'<div class="empty">Создайте первый канал.</div>'}</section></div></div>`}
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
 * Для строк, которые словарь-наблюдатель не достанет — модальный
 * заголовок вставляется как текст, а не HTML, поэтому <span>-изоляция
 * там не работает (см. gameName выше для того же приёма).
 */
const T=(ru,en)=>locale()==='en'?en:ru;
const EVIDENCE_LABEL={get note(){return T('Комментарий','Comment')},get url(){return T('Ссылка','Link')},get metric(){return T('Метрика','Metric')},get message(){return T('Ссылка на сообщение','Message link')},get file(){return T('Файл','File')}};

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
      <p class="muted">${waiting.length} ${pluralIn(waiting.length,['задача ждёт','задачи ждут','задач ждут'],['task is waiting','tasks are waiting'])} <span>вашего решения</span>${invitations?' <span>· и приглашения на встречи выше</span>':''}</p></div></div>
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

function convRow(c){return `<button class="conversation-card pressable" data-open="${c.id}">${roomAvatar(c)}<span><strong>${esc(c.title||'Диалог')}</strong><div class="preview">${previewOf(c,c.lastMessage?(c.lastMessage.body?escWithMentions(c.lastMessage.body):esc(kindLabel(c.lastMessage.kind))):esc(c.purpose||''))}</div>${c.lastMessage||c.purpose?'':'<div class="preview preview-empty">Открыть разговор</div>'}</span><span class="time">${time(c.lastMessage?.createdAt)}</span></button>`}
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
  const labels=S.labelTargets?.get('task:'+t.id)||[];
  return `<button class="task-card pressable${late?' overdue':''}" data-task-open="${t.id}"><span class="task-status"></span><span><div class="task-title">${esc(t.title)}</div><div class="task-meta"><span>${esc(TASK_STATUS[t.status]||t.status)}</span><span>·</span><span class="${late?'task-late':soon?'task-soon':''}">${late?'<span>просрочено</span> — ':soon?'<span>сегодня</span> — ':''}${when}</span><span>·</span><span>${esc(name(t.ownerId))}</span></div>${labels.length?`<div class="chip-row msg-labels">${labels.map(labelChip).join('')}</div>`:''}</span><span class="chip ${['high','urgent'].includes(t.priority)?'danger':''}">${esc(t.priority||'normal')}</span></button>`;
}
function kindLabel(k){return({voice:'Голосовое сообщение',file:'Файл',call:'Звонок',task:'Задача',calendar:'Событие'})[k]||''}
function chats(){const c=S.conversations.find(x=>x.id===S.selected),messages=S.messages.get(c?.id)||[],muted=c?.mutedUntil&&Date.parse(c.mutedUntil)>Date.now();return `<div class="chat-shell"><aside class="conversation-pane ${S.mobileChat?'hidden-mobile':''}"><div class="conversation-pane-header"><div class="chip-row">${CONVERSATION_GROUPS.map(([key,caption])=>`<button class="chipbtn pressable${(S.chatFilter||'all')===key?' on':''}" data-chat-filter="${key}">${esc(caption)}${countIn(key)?`<i>${countIn(key)}</i>`:''}</button>`).join('')}</div><button data-action="dm" class="round-button pressable" aria-label="Новый чат">＋</button></div>${visibleConversations().map(x=>`<button class="conversation-card pressable ${x.id===S.selected?'active':''}" data-conversation="${x.id}">${roomAvatar(x)}<span><strong>${esc(x.title||'Диалог')}</strong><div class="preview">${previewOf(x,x.lastMessage?(x.lastMessage.body?escWithMentions(x.lastMessage.body):esc(kindLabel(x.lastMessage.kind))):'')}</div>${x.lastMessage?'':'<div class="preview preview-empty">Нет сообщений</div>'}</span><span class="time">${time(x.lastMessage?.createdAt)}</span></button>`).join('')}</aside><section class="message-pane ${!S.mobileChat?'hidden-mobile':''}">${c?`<header class="message-header"><div class="inline-actions"><button data-action="back" class="round-button pressable mobile-back" aria-label="Назад к списку">‹</button><div><h2>${esc(c.kind==='channel'?'# '+c.title:(c.title||'Диалог'))}</h2><p>${esc(c.purpose||'Рабочая переписка')}${muted?'<span> · уведомления выключены</span>':''}</p></div></div><div class="inline-actions"><button data-action="audio" class="round-button pressable call-button" title="Аудиозвонок" aria-label="Аудиозвонок">${tileIcon.calls}</button><button data-action="video" class="round-button pressable call-button" title="Видеозвонок" aria-label="Видеозвонок">${roomIcon.video}</button><button data-action="favour-room" class="round-button pressable${S.favourites?.has('conversation:'+c.id)?' on':''}" title="${S.favourites?.has('conversation:'+c.id)?'Убрать из избранного':'В избранное'}" aria-label="${S.favourites?.has('conversation:'+c.id)?'Убрать беседу из избранного':'Добавить беседу в избранное'}">${msgIcon.star}</button><button data-action="pins" class="round-button pressable" title="Закреплённые" aria-label="Закреплённые сообщения">${roomIcon.pins}</button><button data-action="mute" class="round-button pressable" title="${muted?'Включить уведомления':'Отключить на 8 часов'}" aria-label="${muted?'Включить уведомления':'Отключить уведомления'}">${muted?roomIcon.muted:roomIcon.bell}</button><button data-action="assistant-summarize" class="round-button pressable" title="Обзор беседы" aria-label="Коротко о чём был разговор">${msgIcon.assistant}</button><button data-action="materials" class="round-button pressable" title="Материалы беседы" aria-label="Фото, видео, ссылки и переносы">${tileIcon.files}</button><button data-action="import" class="round-button pressable" title="Перенести из мессенджера" aria-label="Перенести переписку из WhatsApp или Telegram">⇥</button><button data-action="archive" class="round-button pressable" title="Архивировать" aria-label="Убрать в архив">${tileIcon.archive}</button>${guestShell()?'':`<button data-action="room-games" class="round-button pressable" title="Игры" aria-label="Игры в этой беседе">${tileIcon.games}</button>`}<button data-action="conversation" class="round-button pressable" title="О беседе" aria-label="О беседе">${tileIcon.settings}</button>${c.kind!=='direct'?`<button data-action="members" class="round-button pressable" title="Участники" aria-label="Участники беседы">${tileIcon.team}</button>`:''}</div></header><div id="message-stream" class="message-stream">${S.messageCursor.get(c.id)?'<button id="load-older" class="button secondary pressable" style="margin:0 auto 10px;display:block">Показать более ранние</button>':''}${messageStream(messages)}</div><div id="typing" class="typing"></div><div class="composer-wrap">${awayNotice(c)}${S.reply?`<div class="reply-preview visible"><span><span>Ответ на:</span> ${S.reply.body?escWithMentions(S.reply.body):esc(kindLabel(S.reply.kind))}</span><button data-action="cancel-reply" class="close-button">×</button></div>`:''}<div class="composer"><button data-action="attach" class="composer-button pressable" aria-label="Прикрепить файл">＋</button><button data-action="assistant-suggest" class="composer-button pressable" title="Предложить ответ" aria-label="Предложить варианты ответа">${msgIcon.assistant}</button><textarea id="message-input" rows="1" placeholder="Сообщение"></textarea><button data-action="voice" class="composer-button pressable" aria-label="Голосовое сообщение">◖</button><button data-action="send" class="composer-button send pressable" aria-label="Отправить">↑</button></div></div>`:'<div class="empty"><strong>Выберите разговор</strong></div>'}</section></div>`}
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
  // Единицы размера файла нигде не сидят одни в собственном узле —
  // словарь-наблюдатель их не достанет, поэтому язык выбираем прямо
  // здесь, как для заголовка модалки (см. T() выше).
  const unit=(ru,en)=>T(ru,en);
  if(bytes<1024)return `${bytes} ${unit('Б','B')}`;
  if(bytes<1024*1024)return `${Math.round(bytes/1024)} ${unit('КБ','KB')}`;
  return `${(bytes/1048576).toFixed(1)} ${unit('МБ','MB')}`;
};
const fileMeta=(meta)=>[esc(fileSize(meta?.size)),`<span>${filePreviewable(meta)?'открыть':'скачать'}</span>`].filter(Boolean).join(' · ');

function dayLabel(value){
  const d=new Date(value), now=new Date();
  const same=(a,b)=>a.toDateString()===b.toDateString();
  const yesterday=new Date(now); yesterday.setDate(now.getDate()-1);
  if(same(d,now))return 'Сегодня';
  if(same(d,yesterday))return 'Вчера';
  return new Intl.DateTimeFormat(locale()==='en'?'en-GB':'ru',{day:'numeric',month:'long',...(d.getFullYear()!==now.getFullYear()?{year:'numeric'}:{})}).format(d);
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
  const mineReact=(msg,e)=>(msg.reactions||[]).some(x=>x.reaction===e&&x.userId===me().userId);
  const reactorNames=(msg,e)=>(msg.reactions||[]).filter(x=>x.reaction===e).map(x=>x.userId===me().userId?T('Вы','You'):name(x.userId)).join(', ');
  const reactions=(m.reactions||[]).reduce((a,r)=>(a[r.reaction]=(a[r.reaction]||0)+1,a),{});
  const deleted=Boolean(m.deletedAt);
  const mine=m.authorId===me().userId;
  const parent=m.replyToId?(S.messages.get(m.conversationId)||[]).find(x=>x.id===m.replyToId):null;
  const quote=m.replyToId?`<button class="reply-quote" data-jump="${esc(m.replyToId)}" title="Перейти к сообщению">${parent
    ?`<b>${esc(parent.authorId===me().userId?'Вы':name(parent.authorId))}</b> ${esc(parent.deletedAt?T('сообщение удалено','message deleted'):(parent.body||kindLabel(parent.kind)||'вложение').slice(0,90))}`
    :'<b>Ответ</b> на сообщение выше'}</button>`:'';
  const forwarded=m.forwardedFrom
    ?(m.forwardedFrom.restricted
      ?'<div class="msg-forward">Пересланное сообщение</div>'
      :`<button class="msg-forward" data-forward-origin-conversation="${m.forwardedFrom.conversationId}" data-forward-origin-message="${m.forwardedFrom.messageId}"><span>Переслано</span> · ${esc(name(m.forwardedFrom.authorId))}${m.forwardedFrom.conversationTitle?' · '+esc(m.forwardedFrom.conversationTitle):''}</button>`)
    :'';
  // Откуда это пришло: без отметки перенос из мессенджера выглядит как
  // собственные слова того, кто его вставил.
  const outside=m.externalOrigin?`<div class="msg-forward outside"><span>Из</span> <span>${esc(SOURCE_WORD[m.externalOrigin.source]||'мессенджера')}</span>${
    m.externalOrigin.authorName?` · ${esc(m.externalOrigin.authorName)}`:''}${
    m.externalOrigin.sentAt?` · ${esc(dateTime(m.externalOrigin.sentAt))}`:''}</div>`:'';
  const body=deleted?'<p class="message-body muted">Сообщение удалено</p>'
    :m.kind==='voice'?`<div class="voice-card voice-card-play" data-voice="${esc(m.metadata?.fileId??'')}">
      <button type="button" class="voice-play pressable" aria-label="Прослушать голосовое сообщение">▶</button>
      <div class="waveform"></div>
      <span class="mono">${voiceLength(m.metadata?.durationMs)}</span>
    </div>`
    :m.kind==='file'?`<a class="voice-card file-card" href="${esc(fileHref(m.metadata))}"${filePreviewable(m.metadata)?' target="_blank" rel="noopener"':' download'} title="${filePreviewable(m.metadata)?'Открыть':'Скачать'}">
      <span class="file-mark" aria-hidden="true">${tileIcon.files}</span>
      <span><strong>${esc(m.metadata?.name||'Файл')}</strong>
        <span class="row-sub">${fileMeta(m.metadata)}</span></span>
    </a>`
    :`<p class="message-body">${bodyWithHighlights(m)}</p>`;
  const notes=(S.notes?.get(m.id)||[]);
  const noteBlock=notes.length?`<div class="msg-notes">${notes.map(n=>
    `<button class="msg-note kind-${esc(n.kind)}" data-note="${esc(n.id)}" title="Личная заметка — нажмите, чтобы изменить"><b>${esc(NOTE_KIND_LABEL[n.kind]||'заметка')}</b> ${esc(n.body.slice(0,120))}</button>`).join('')}</div>`:'';
  const stamp=`<span class="msg-stamp">${m.pinned?'<i title="Закреплено" aria-label="Закреплено">✦</i>':''}${m.saved?'<i title="В избранном" aria-label="В избранном">★</i>':''}${m.editedAt?`<button type="button" class="msg-edited" data-message-history="${esc(m.id)}" title="Показать, что было до правки"><span>изменено в</span> ${esc(time(m.editedAt))}</button>`:''}<time datetime="${esc(m.createdAt)}" title="${esc(dateTime(m.createdAt))}">${esc(time(m.createdAt))}</time></span>`;

  return `<article class="message-item${mine?' mine':''}${grouped?' grouped':''}" data-message-row="${m.id}">
    ${mine||grouped?'':`${personAvatar(m.authorId,name(m.authorId))}`}
    <div class="msg-column">
      ${mine||grouped?'':`<div class="message-meta"><span class="message-author">${esc(name(m.authorId))}</span></div>`}
      <div class="msg-bubble">
        ${outside}${forwarded}${quote}${body}${stamp}
      </div>
      ${noteBlock}
      ${(S.tasksFromMessage?.get(m.id)||[]).length?`<div class="chip-row msg-labels">${(S.tasksFromMessage.get(m.id)||[]).map(t=>`<button class="chip warm pressable" data-task-open="${esc(t.id)}" title="Открыть задачу">${msgIcon.task} ${esc(t.title.slice(0,40))}</button>`).join('')}</div>`:''}
      ${m.replyCount?`<div class="chip-row"><button class="thread-chip pressable" data-thread-open="${esc(m.id)}">${msgIcon.reply} ${m.replyCount} ${pluralIn(m.replyCount,['ответ','ответа','ответов'],['reply','replies'])}${m.lastReplyAt?` · ${esc(time(m.lastReplyAt))}`:''}</button></div>`:''}
      ${(S.labelTargets?.get('message:'+m.id)||[]).length?`<div class="chip-row msg-labels">${(S.labelTargets.get('message:'+m.id)||[]).map(labelChip).join('')}</div>`:''}
      ${Object.keys(reactions).length?`<div class="chip-row msg-reactions">${Object.entries(reactions).map(([e,n])=>`<button class="reaction-button${mineReact(m,e)?' mine':''}" data-react="${esc(e)}" data-message="${m.id}" aria-pressed="${mineReact(m,e)}" title="${esc(reactorNames(m,e))}">${esc(e)} ${n}</button>`).join('')}</div>`:''}
      ${deleted?'':`<div class="msg-toolbar">
        <button class="msg-tool pressable" data-react-pick="${m.id}" title="Реакция" aria-label="Поставить реакцию">${msgIcon.react}</button>
        <button class="msg-tool pressable" data-reply="${m.id}" title="Ответить" aria-label="Ответить на сообщение">${msgIcon.reply}</button>
        ${m.threadRootId?'':`<button class="msg-tool pressable" data-thread-open="${m.id}" title="Ответить в ветке" aria-label="Ответить в ветке">⤷</button>`}
        ${can('task.create')?`<button class="msg-tool pressable" data-quick-task="${m.id}" title="В задачу" aria-label="Превратить сообщение в задачу">${msgIcon.task}</button>`:''}
        <button class="msg-tool pressable" data-message-menu="${m.id}" title="Ещё" aria-label="Другие действия с сообщением">${msgIcon.more}</button>
      </div>`}
    </div>
  </article>`;
}

/**
 * Экран задач.
 *
 * Был плоским списком: закрытые, отменённые и предложенные вперемешку,
 * без вкладок, счётчиков и порядка. Чтобы понять, сколько сделано за
 * месяц, приходилось прокручивать всё, что накопилось за историю
 * компании, и считать глазами. Отбор по состоянию всё это время делался
 * в SQL — его просто никто не запрашивал.
 */
const TASK_TABS=[
  // «Ждут меня» стоит первой не из вежливости: остальные вкладки отвечают
  // на вопрос «что происходит», а эта — «за кем ход». Работа, сданная на
  // проверку, до сих пор не значилась нигде: исполнитель ждал, а
  // принимающий видел одну строчку в колокольчике, уходившую вниз за
  // полдня.
  ['mine','Ждут меня'],
  ['active','Открытые'],
  ['overdue','Просрочено'],
  ['proposed','Ждут ответа'],
  ['done','Сделано'],
  ['all','Все'],
];
function taskTabCount(key,counts){
  if(!counts)return null;
  if(key==='all')return counts.total;
  if(key==='done')return counts.done;
  if(key==='mine')return counts.mine;
  return counts[key]??null;
}
/** Открыть экран задач сразу на нужной вкладке. */
function openTaskFilter(filter){
  S.taskFilter=filter;
  S.tasksCursor=null;
  S.tasksPage=null;
  go('tasks');
  loadTaskPage().then(()=>render());
}
function tasks(){
  const filter=S.taskFilter||'active';
  const counts=S.taskCounts;
  const tabs=TASK_TABS.map(([key,caption])=>{
    const n=taskTabCount(key,counts);
    return `<button class="chipbtn pressable${filter===key?' on':''}" data-task-filter="${key}">${esc(caption)}${n?`<i>${n}</i>`:''}</button>`;
  }).join('');
  const team=can('task.manage.team')
    ? `<button class="chipbtn pressable${S.taskScope==='all'?' on':''}" data-task-scope="${S.taskScope==='all'?'mine':'all'}">${S.taskScope==='all'?'Вся команда':'Только мои'}</button>`
    : '';
  const shown=S.tasksPage??[];
  return `<section class="surface"><div class="section-head"><div><p class="muted">Ответственность → выполнение → доказательство → проверка → закрытие</p></div>${can('task.create')?'<button data-action="task" class="button primary small pressable">＋ Задача</button>':''}</div>
    <div class="chip-row">${tabs}${team}</div>
    <div class="task-list" style="margin-top:10px">${shown.map(taskRow).join('')||'<div class="empty"><strong>Здесь пусто</strong>В этой вкладке задач нет.</div>'}</div>
    ${S.tasksCursor?'<button id="tasks-more" class="button secondary" style="width:100%;margin-top:10px">Показать ещё</button>':''}</section>`;
}

/** Страница задач под выбранной вкладкой. */
async function loadTaskPage({append=false}={}){
  const query=new URLSearchParams({limit:'50',counts:'1'});
  const filter=S.taskFilter||'active';
  if(filter!=='all')query.set('status',filter==='done'?'closed,accepted_result':filter);
  if(S.taskScope==='all')query.set('scope','all');
  // «Ждут меня» — про смотрящего, и охват команды его не расширяет:
  // чужой ход остаётся чужим, сколько бы задач человеку ни было видно.
  if(filter==='mine')query.delete('scope');
  if(append&&S.tasksCursor)query.set('cursor',S.tasksCursor);
  try{
    const page=await api(`/api/v1/tasks?${query}`);
    S.tasksPage=append?[...(S.tasksPage??[]),...(page.items||[])]:(page.items||[]);
    S.tasksCursor=page.nextCursor??null;
    if(page.counts)S.taskCounts=page.counts;
  }catch(error){toast(error.message)}
}
function calendar(){
  const c=S.cal||(S.cal={view:'week',cursor:new Date(),selected:null});
  const base=new Date(c.cursor);
  const fmt=(o)=>new Intl.DateTimeFormat(locale()==='en'?'en-GB':'ru',o);
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
  // Событие «на несколько дней подряд» стоит в каждом из своих дней, а не
  // только в первом.
  const eventLastDay=(e)=>{
    const first=eventDay(e);
    if(!e.allDay||!e.endAt)return first;
    const last=eventDay({...e,startAt:e.endAt});
    return last<first?first:last;
  };
  const dayStart=(x)=>new Date(x.getFullYear(),x.getMonth(),x.getDate()).getTime();
  const eventsOn=(d)=>(S.calendar||[]).filter(e=>{
    const first=eventDay(e);
    if(sameDay(first,d))return true;
    if(!e.allDay)return false;
    const t=dayStart(d);
    return t>dayStart(first)&&t<=dayStart(eventLastDay(e));
  });
  // An event still awaiting this person's answer pulses: the grid is where a
  // missed invitation actually costs something.
  const dot=(e)=>`<i class="cal-dot ${e.needsMyAnswer?'pending':esc(e.kind)}"></i>`;
  const header=()=>{
    const label=c.view==='day'?fmt({day:'numeric',month:'long',year:'numeric'}).format(base)
      :c.view==='week'?`${fmt({day:'numeric',month:'short'}).format(weekStart())} — ${fmt({day:'numeric',month:'short',year:'numeric'}).format(new Date(weekStart().getTime()+6*864e5))}`
      :fmt({month:'long',year:'numeric'}).format(base);
    return `<div class="calendar-toolbar">
      <div><h2>${esc(label)}</h2></div>
      <div class="inline-actions">
        <button data-action="calendar-subscribe" class="button secondary small pressable">Подписка</button>
        ${can('calendar.create')?'<button data-action="event" class="button primary small pressable">＋ Событие</button>':''}
      </div>
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
  // Событие на несколько дней попадает в период, если хоть один его день
  // в нём — не только первый.
  const overlaps=(e,from,to)=>{const first=eventDay(e),last=eventLastDay(e);return first<to&&last>=from};
  const inPeriod=(e)=>{
    const d=eventDay(e);
    if(c.view==='day')return eventsOn(base).includes(e);
    if(c.view==='week'){const s0=weekStart();return overlaps(e,s0,new Date(s0.getTime()+7*864e5))}
    return overlaps(e,new Date(base.getFullYear(),base.getMonth(),1),new Date(base.getFullYear(),base.getMonth()+1,1));
  };
  const onSelectedDay=(e)=>{const [y,m,d]=String(c.selected).split('-').map(Number);return eventsOn(new Date(y,m,d)).includes(e)};
  const shown=(S.calendar||[]).filter(e=>c.selected?onSelectedDay(e):inPeriod(e));
  const heading=c.selected?'Выбранный день':(c.view==='day'?'События дня':c.view==='week'?'События недели':'События месяца');
  // Праздники и дни рождения — не встречи: их никто не заводил, открыть
  // у них нечего, и кнопкой они быть не должны. Строка, а не карточка.
  const rows=shown.length?shown.map(e=>e.readOnly?`<div class="calendar-event layer ${esc(e.kind)}">
      <strong>${e.kind==='birthday'?'🎂':(e.dayOff?'☼':'◔')}</strong>
      <div><div class="row-title">${esc(e.title)}</div>
        <div class="row-sub">${e.kind==='birthday'?'поздравьте коллегу':(e.dayOff?'нерабочий день':'сокращённый день')}</div></div>
      <span class="chip">${esc(new Date(e.startAt).toLocaleDateString(locale()==='en'?'en-GB':'ru-RU',{day:'numeric',month:'short'}))}</span>
    </div>`:`<button class="calendar-event pressable ${esc(e.kind)} ${e.needsMyAnswer?'needs-answer':''}" data-cal-event="${esc(e.id)}">
      <strong>${e.allDay?'весь день':esc(time(e.startAt))}${(c.view!=='day'&&!c.selected)?`<i class="event-day">${esc(new Date(e.startAt).toLocaleDateString(locale()==='en'?'en-GB':'ru-RU',c.view==='month'?{day:'numeric',month:'short'}:{weekday:'short',day:'numeric'}))}</i>`:''}</strong><span class="event-line"></span>
      <div><div class="row-title">${esc(e.title)}</div><div class="row-sub">${esc(KIND_LABEL[e.kind]||e.kind)}${e.participantCount?` · ${e.participantCount} участн.`:''}${e.fileCount?` · ${e.fileCount} файл.`:''}</div></div>
      ${e.needsMyAnswer?'<span class="chip pulse">нужен ответ</span>':`<span class="chip warm">${e.allDay?esc(T('весь день','all day')):e.endAt?esc(time(e.endAt)):'—'}</span>`}
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
      // Выбранный в сетке день и есть тот, который просят открыть. Выбор
      // сбрасывался, «День» показывал сегодняшний, и список менялся на
      // чужой — будто часть событий пропала по дороге.
      const picked=c.selected?c.selected.split('-').map(Number):null;
      if(picked&&picked.length===3&&picked.every(Number.isFinite)){
        c.cursor=new Date(picked[0],picked[1],picked[2]);
      }else{
        const now=new Date(),cursor=new Date(c.cursor);
        let start;
        if(c.view==='week'){start=new Date(cursor);start.setDate(cursor.getDate()-((cursor.getDay()+6)%7))}
        else start=new Date(cursor.getFullYear(),cursor.getMonth(),1);
        const end=c.view==='week'?new Date(start.getTime()+6*864e5):new Date(cursor.getFullYear(),cursor.getMonth()+1,0);
        c.cursor=(now>=start&&now<=end)?now:start;
      }
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

/** Кружки людей: клик и клавиша открывают карточку. */
function bindPeopleAvatars(){
  $$('[data-person]').forEach(b=>{
    b.onclick=(event)=>{event.stopPropagation();personPage(b.dataset.person)};
    b.onkeydown=(event)=>{
      if(event.key!=='Enter'&&event.key!==' ')return;
      event.preventDefault();event.stopPropagation();personPage(b.dataset.person);
    };
  });
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
/**
 * Карточка встречи — в том числе одного вхождения серии.
 *
 * Клиент получает вхождение под составным признаком «событие@момент»:
 * карточку открывает событие, а действия «пропустить» и «перенести»
 * относятся к моменту.
 */
async function eventPage(id){
  const [seriesId,occurrenceAt]=String(id).split('@');
  let event;
  try{event=(await api(`/api/v1/calendar-events/${seriesId}`)).event}
  catch(error){toast(error.code==='CALENDAR_UNAVAILABLE'?'Детали встречи доступны в режиме с базой данных':[400,404].includes(error.status)?T('Встреча не найдена или недоступна','Event not found or unavailable'):error.message);return}
  // Сервер отдаёт саму серию — то есть её первую встречу. Человек же
  // нажал на пятницу: карточка обязана показать пятницу, вместе с её
  // собственным временем и названием, если вхождение переносили.
  const shown=occurrenceAt?(S.calendar||[]).find(e=>e.id===id):null;
  if(shown)event={...event,startAt:shown.startAt,endAt:shown.endAt,title:shown.title??event.title};
  const dayOnly=(v)=>new Intl.DateTimeFormat(locale()==='en'?'en-GB':'ru',{day:'numeric',month:'long',...(event.timezone&&event.allDay?{timeZone:event.timezone}:{})}).format(new Date(v));
  const range=event.allDay
    ?`${esc(dayOnly(event.startAt))}${event.endAt&&dayOnly(event.endAt)!==dayOnly(event.startAt)?` — ${esc(dayOnly(event.endAt))}`:''} · ${esc(T('весь день','all day'))}`
    :`${esc(dateTime(event.startAt))}${event.endAt?` — ${esc(time(event.endAt))}`:''}`;
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
      ${event.recurrenceText?`<div class="person-field"><span>Повторение</span><strong>${esc(event.recurrenceText)}</strong></div>`:''}
    </div>
    ${event.description?`<p class="person-about">${esc(event.description)}</p>`:''}
    ${event.needsMyAnswer?'<p class="cal-callout">Организатор ждёт вашего подтверждения.</p>':''}
    ${answer}
    <h3 class="person-section"><span>Участники</span> — ${event.participants.length}</h3><div class="person-feed">${people}</div>
    <h3 class="person-section">Материалы</h3><div class="person-feed">${files}</div>
    <div class="stack" style="margin-top:12px"><button type="button" data-event-notes class="button secondary pressable">Протокол встречи</button></div>
    ${event.canEdit?`<div class="stack" style="margin-top:16px">
      <button data-event-edit class="button secondary">Изменить ${event.recurrenceText?'всю серию':'встречу'}</button>
      <button data-event-invite class="button secondary">Позвать ещё</button>
      ${occurrenceAt?'<button data-occurrence-skip class="button secondary">Пропустить эту встречу</button>':''}
      <button data-event-cancel class="button danger">Отменить ${event.recurrenceText?'всю серию':'встречу'}</button>
    </div>`:''}
  `,()=>{
    $$('[data-answer]').forEach(b=>b.onclick=async()=>{
      try{
        await api(`/api/v1/calendar-events/${seriesId}/respond`,{method:'POST',body:JSON.stringify({response:b.dataset.answer})});
        toast('Ответ отправлен');
        history.back();
        await loadCalendarRange();render();
      }catch(error){toast(error.message)}
    });
    // Пропустить одну встречу — не то же самое, что отменить серию, и
    // путать эти две кнопки нельзя: вторая убирает планёрку навсегда.
    const skip=$('[data-occurrence-skip]');
    if(skip)skip.onclick=async()=>{
      skip.disabled=true;
      try{
        await api(`/api/v1/calendar-events/${seriesId}/occurrences/${encodeURIComponent(occurrenceAt)}`,
          {method:'POST',body:JSON.stringify({cancelled:true})});
        toast('Эта встреча пропущена, остальные остались');
        closeModal();
        await loadCalendarRange();render();
      }catch(error){skip.disabled=false;toast(error.message)}
    };
    $$('[data-uninvite]').forEach(b=>b.onclick=async()=>{
      try{
        await api(`/api/v1/calendar-events/${seriesId}/participants/${b.dataset.uninvite}`,{method:'DELETE'});
        toast('Участник убран');closeModal();
        await loadCalendarRange();render();await eventPage(id);
      }catch(error){toast(error.message)}
    });
    const notesButton=$('[data-event-notes]');
    // Протокол — этой встречи, а не серии: передаём составной адрес.
    if(notesButton)notesButton.onclick=()=>notesModal(id,event.title);
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
    <div>${candidates.map(p=>`<label class="row candidate-row" style="cursor:pointer"><input type="checkbox" name="who" value="${esc(p.userId)}">${personAvatar(p)}<span><div class="row-title">${esc(p.displayName||p.email)}</div><div class="row-sub">${esc(p.title||roleWord(p.role))}</div></span></label>`).join('')}</div>
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

function more(){const staff=me().role!=='guest';return `<div class="module-grid"><button class="module-card pressable" data-action="saved"><span class="module-icon">${tileIcon.saved}</span><strong>Избранное</strong><span>Беседы, сообщения, задачи, выделения и заметки</span></button><button class="module-card pressable" data-action="archived"><span class="module-icon">${tileIcon.archive}</span><strong>Архив чатов</strong><span>Скрытые только для вас разговоры</span></button>${staff?`<button class="module-card pressable" data-action="team"><span class="module-icon">${tileIcon.team}</span><strong>Команда</strong><span>${S.people.length} ${pluralIn(S.people.length,['сотрудник','сотрудника','сотрудников'],['employee','employees'])}<span>, роли и статусы</span></span></button>`:''}${staff?`<button class="module-card pressable" data-action="org"><span class="module-icon">${tileIcon.org}</span><strong>Оргструктура</strong><span>Департаменты, отделы, штат и руководители</span></button>`:''}<button class="module-card pressable" data-action="presence"><span class="module-icon">${tileIcon.presence}</span><strong>Мой статус</strong><span>В сети, занят, не беспокоить</span></button>${can('organization.settings')?`<button class="module-card pressable" data-action="company"><span class="module-icon">${tileIcon.org}</span><strong>Компания</strong><span>${can('organization.manage')?'Название, реквизиты, места и передача владения':'Реквизиты, места и почтовый домен'}</span></button>`:''}${can('audit.read')?`<button class="module-card pressable" data-action="journal"><span class="module-icon">${tileIcon.journal}</span><strong>Журнал</strong><span>Кого пригласили, кто вошёл, кто раскрыл пароль</span></button>`:''}${can('integration.manage')?'<button class="module-card pressable" data-action="integrations"><span class="module-icon">⇄</span><strong>Интеграции</strong><span>Подписки на события и журнал доставок</span></button>':''}${staff?`<button class="module-card pressable" data-action="apikeys"><span class="module-icon">${tileIcon.apikeys}</span><strong>API-ключи</strong><span>Личный доступ к API от вашего имени</span></button>`:''}<button class="module-card pressable" data-action="catalogue"><span class="module-icon">${roomIcon.channel}</span><strong>Каналы компании</strong><span>Каталог: зачем нужен каждый и где сейчас живо</span></button>${can('knowledge.read')?`<button class="module-card pressable" data-action="knowledge"><span class="module-icon">${tileIcon.knowledge}</span><strong>База знаний</strong><span>HR-бот отвечает по статьям компании</span></button>`:''}${can('wiki.use')?`<button class="module-card pressable" data-action="wiki"><span class="module-icon">${tileIcon.wiki}</span><strong>Вики</strong><span>Совместные страницы, которые пишет любой сотрудник</span></button>`:''}${staff?`<button class="module-card pressable" data-action="time-report"><span class="module-icon">${tileIcon.timeReport}</span><strong>Отчёт по времени</strong><span>${can('task.manage.team')?'Ваши часы и часы команды по задачам':'Ваши часы по задачам'}</span></button>`:''}${staff?`<button class="module-card pressable" data-action="dashboard"><span class="module-icon">${tileIcon.dashboard}</span><strong>Дашборд</strong><span>Тренд по задачам и трекнутому времени</span></button>`:''}<button class="module-card pressable" data-action="digest"><span class="module-icon">${tileIcon.digest}</span><strong>Что я пропустил</strong><span>Упоминания, сроки и решения, принятые без вас</span></button>${tasksVisible()?`<button class="module-card pressable" data-action="report"><span class="module-icon">${tileIcon.report}</span><strong>Отчёт по обязательствам</strong><span>${can('task.manage.team')?'Кто держит слово, на ком перегруз и что застряло':'Ваши сроки, просрочки и что застряло'}</span></button>`:''}${can('meeting.cost.read')||can('meeting.ops.manage')?`<button class="module-card pressable" data-action="meeting-ops"><span class="module-icon">${tileIcon.costs}</span><strong>${can('meeting.cost.read')?'Расходы на встречи':'Обработка встреч'}</strong><span>${can('meeting.cost.read')?'Стоимость расшифровок, тарифы и вызовы провайдера':'Очередь расшифровок и повторные запуски'}</span></button>`:''}${staff?`<button class="module-card pressable" data-action="games"><span class="module-icon">${tileIcon.games}</span><strong>Игры</strong><span>Шахматы, шашки и морской бой с коллегами</span></button>`:''}<button class="module-card pressable" data-action="contacts"><span class="module-icon">${tileIcon.contacts}</span><strong>Контакты</strong><span>Кто вам пишет и кто с вами в подразделении</span></button>${can('vault.use')?`<button class="module-card pressable" data-action="vault"><span class="module-icon">${tileIcon.vault}</span><strong>Пароли</strong><span>Зашифрованное личное хранилище</span></button>`:''}<button class="module-card pressable" data-action="reminders"><span class="module-icon">${tileIcon.reminders}</span><strong>Напоминания</strong><span>Придут в назначенный час</span></button><button class="module-card pressable" data-action="plan"><span class="module-icon">${tileIcon.plan}</span><strong>Личные дела</strong><span>Список, заметки, приоритеты и сроки</span></button><button class="module-card pressable" data-action="labels"><span class="module-icon">${tileIcon.labels}</span><strong>Метки</strong><span>Важность, теги и папки для всего</span></button>${can('member.invite')?`<button class="module-card pressable" data-action="invite"><span class="module-icon">${tileIcon.invite}</span><strong>Пригласить</strong><span>Добавить сотрудника</span></button>`:''}<button class="module-card pressable" data-action="files"><span class="module-icon">${tileIcon.files}</span><strong>Файлы</strong><span>Вложения из рабочих контекстов</span></button><button class="module-card pressable" data-action="calls"><span class="module-icon">${tileIcon.calls}</span><strong>Звонки</strong><span>Аудио, видео и демонстрация экрана</span></button>${staff?`<button class="module-card pressable" data-action="decisions"><span class="module-icon">${tileIcon.meetings}</span><strong>Решения</strong><span>Что решили на встречах — одним списком</span></button>`:''}${staff?`<button class="module-card pressable" data-action="stories"><span class="module-icon">◉</span><strong>Сторис</strong><span>Как выглядит работа сегодня — и архив снятого</span></button>`:''}<button class="module-card pressable" data-action="push"><span class="module-icon">${tileIcon.notifications}</span><strong>Уведомления</strong><span>Push, упоминания и сроки</span></button><button class="module-card pressable" data-action="settings"><span class="module-icon">${tileIcon.settings}</span><strong>Настройки</strong><span>Пароль, входы и уведомления</span></button></div>`}
function bind(){
  // Строка встречи в расписании дня выглядела нажимаемой и не открывала
  // ничего: карточку встречи знал только календарь.
  $$('[data-cal-event]').forEach(b=>b.onclick=()=>eventPage(b.dataset.calEvent));
  $$('[data-task-filter]').forEach(b=>b.onclick=async()=>{
    S.taskFilter=b.dataset.taskFilter;S.tasksCursor=null;
    await loadTaskPage();render();
  });
  $$('[data-task-scope]').forEach(b=>b.onclick=async()=>{
    S.taskScope=b.dataset.taskScope;S.tasksCursor=null;
    await loadTaskPage();render();
  });
  const moreTasks=$('#tasks-more');
  if(moreTasks)moreTasks.onclick=async()=>{await loadTaskPage({append:true});render()};
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
  // Первые шаги: «Скрыть» закрывает подсказку насовсем, «Перейти» ведёт
  // туда, где шаг делается, — в том числе в разделы, а не только в модалки.
  const dismiss=$('[data-onboarding-dismiss]');
  if(dismiss)dismiss.onclick=async()=>{
    S.onboarding=null;render();
    await api('/api/v1/onboarding/dismiss',{method:'POST'}).catch(()=>{});
  };
  $$('[data-onboarding-go]').forEach(b=>b.onclick=()=>{
    const where=b.dataset.onboardingGo;
    if(where==='catalogue')return catalogueModal();
    if(where==='profile')return personPage(me().userId);
    go(where);
  });
  $$('[data-nav]').forEach(b=>b.onclick=()=>go(b.dataset.nav));$$('[data-conversation],[data-open]').forEach(b=>b.onclick=()=>openChat(b.dataset.conversation||b.dataset.open));$$('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));$$('[data-react]').forEach(b=>b.onclick=()=>react(b.dataset.message,b.dataset.react));$$('[data-react-pick]').forEach(b=>b.onclick=()=>reactionPicker(b.dataset.reactPick));$$('[data-jump]').forEach(b=>b.onclick=()=>{
    const row=document.querySelector(`[data-message-row="${b.dataset.jump}"]`);
    if(!row)return toast('Это сообщение осталось выше по истории — прокрутите вверх.');
    row.scrollIntoView({block:'center',behavior:'smooth'});
    row.classList.remove('flash');void row.offsetWidth;row.classList.add('flash');
  });$$('[data-reply]').forEach(b=>b.onclick=()=>{S.reply=(S.messages.get(S.selected)||[]).find(m=>m.id===b.dataset.reply);render()});$$('[data-quick-task]').forEach(b=>b.onclick=()=>{const m=(S.messages.get(S.selected)||[]).find(x=>x.id===b.dataset.quickTask);if(m)quickTaskModal(m)});$$('[data-message-save]').forEach(b=>b.onclick=()=>toggleSave(b.dataset.messageSave,b.dataset.saved!=='1'));$$('[data-message-menu]').forEach(b=>b.onclick=()=>messageMenu(b.dataset.messageMenu));$$('[data-thread-open]').forEach(b=>b.onclick=()=>threadModal(b.dataset.threadOpen));$$('[data-voice]').forEach(card=>{
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
});$$('[data-message-label]').forEach(b=>b.onclick=()=>labelPicker('message',b.dataset.messageLabel,{title:T('Метки сообщения','Message labels')}));$$('[data-message-remind]').forEach(b=>b.onclick=()=>{
  const source=(S.messages.get(S.selected)||[]).find(x=>x.id===b.dataset.messageRemind);
  remindAboutModal((source?.body||'Вернуться к сообщению').trim(),{sourceType:'message',sourceId:b.dataset.messageRemind,conversationId:S.selected});
});$$('[data-message-history]').forEach(b=>b.onclick=()=>messageHistoryModal(b.dataset.messageHistory));$$('[data-message-pin]').forEach(b=>b.onclick=()=>togglePin(b.dataset.messagePin,b.dataset.pinned!=='1'));$$('[data-message-forward]').forEach(b=>b.onclick=()=>forwardModal(b.dataset.messageForward));$$('[data-forward-origin-conversation]').forEach(b=>b.onclick=()=>openChatAtMessage(b.dataset.forwardOriginConversation,b.dataset.forwardOriginMessage));$$('[data-message-edit]').forEach(b=>b.onclick=()=>editMessageModal(b.dataset.messageEdit));$$('[data-message-delete]').forEach(b=>b.onclick=()=>deleteMessageModal(b.dataset.messageDelete));$$('[data-task-message]').forEach(b=>b.onclick=()=>{
  const source=(S.messages.get(S.selected)||[]).find(x=>x.id===b.dataset.taskMessage);
  taskModal(b.dataset.taskMessage,(source?.body||'').trim().slice(0,120));
});$$('[data-task-open]').forEach(b=>b.onclick=()=>openTask(b.dataset.taskOpen));const input=$('#message-input');if(input){// Черновик возвращается в поле при каждой отрисовке беседы: экран
  // перерисовывается и при новом сообщении, и при смене вкладки.
  if(S.selected&&!input.value)input.value=readDraft(S.selected);
  input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};input.oninput=e=>{typing(e);if(S.selected)writeDraft(S.selected,input.value)};
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
  // Адресом можно попасть куда угодно, в том числе на скрытый от гостя
  // раздел: тогда он увидел бы вечно пустой экран без объяснений.
  if(guestShell()&&GUEST_HIDDEN_VIEWS.has(v)){v='today';silent=false}
  S.view=v;
  // Раздел записывается в адрес: перезагрузка возвращает туда, где человек
  // был, а ссылкой можно поделиться. `silent` — когда мы сюда и пришли по
  // адресу, второй записи в истории не нужно.
  if(!silent){
    const want=`#/${v}`;
    if(location.hash!==want){try{history.pushState(null,'',want)}catch{location.hash=want}}
  }
  // Экран задач рисуется из отдельно загруженной страницы, а грузилась
  // она только при старте приложения и при смене вкладки. Человек
  // заводил задачу, шёл в «Задачи» — и видел «здесь пусто»: список был
  // тот же, что при входе. Входя на экран, перечитываем его.
  if(v==='tasks')loadTaskPage().then(()=>render());
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
/**
 * Запомнить беседу в списке — ровно один раз.
 *
 * Создавший беседу добавлял её себе сам, и тут же приходило событие по
 * сокету, которое добавляло её второй раз: в списке появлялись два
 * одинаковых канала с одним и тем же идентификатором. Открывались оба,
 * но человек видел две строки там, где беседа одна.
 */
function rememberConversation(conversation){
  if(!conversation?.id)return;
  const at=S.conversations.findIndex(x=>x.id===conversation.id);
  if(at>=0)S.conversations[at]={...S.conversations[at],...conversation};
  else S.conversations.unshift(conversation);
}

async function openChat(id){
  S.selected=id;S.view='chats';S.mobileChat=true;
  // Адрес обязан догонять экран. Беседу открывают из поиска, из центра
  // внимания, из карточки задачи — и раньше после этого в адресе
  // оставался прежний раздел: перезагрузка уводила на «Сегодня», а
  // ссылкой нельзя было поделиться. Заменяем запись, а не добавляем:
  // лишний шаг «назад» здесь никому не нужен.
  if(location.hash!=='#/chats'){try{history.replaceState(null,'','#/chats')}catch{}}
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
/**
 * Открыть беседу на конкретном сообщении.
 *
 * Переход из поиска к реплике трёхмесячной давности подгружал последние
 * сто сообщений, не находил её среди них и молча сдавался: человек
 * оказывался внизу ленты без подсветки и без объяснения. Теперь лента
 * грузится окном вокруг искомого.
 */
async function openChatAtMessage(id,messageId=null){
  if(!S.conversations.some(c=>c.id===id)){toast(T('Беседа не найдена или недоступна','Conversation not found or unavailable'));if(S.view!=='chats')go('chats',{silent:true});history.replaceState(null,'','#/chats');return}
  if(messageId){
    const known=(S.messages.get(id)||[]).some(m=>m.id===messageId);
    if(!known){
      try{
        const page=await api(`/api/v1/conversations/${id}/messages?around=${encodeURIComponent(messageId)}`);
        S.messages.set(id,page.items||[]);
        S.messageCursor.set(id,page.nextCursor||null);
      }catch(error){toast(error.code==='MESSAGE_NOT_FOUND'?'Сообщение удалено или недоступно':error.message)}
    }
  }
  await openChat(id);
  if(!messageId)return;
  // Кадры в фоновой вкладке не рисуются, поэтому подсветка через таймер.
  setTimeout(()=>{
    const row=document.querySelector(`[data-message-row="${CSS.escape(messageId)}"]`);
    if(!row){toast('Это сообщение не удалось показать');return}
    row.scrollIntoView({behavior:'smooth',block:'center'});
    row.classList.remove('flash');void row.offsetWidth;row.classList.add('flash');
  },60);
}
const actions={quick:quick,task:()=>taskModal(),event:eventModal,dm:directModal,group:groupModal,members:membersModal,pins:pinsModal,mute:toggleMute,archive:archiveCurrent,saved:()=>favouritesModal(),archived:archivedModal,'new-direct':directModal,'new-channel':channelModal,back:()=>{S.mobileChat=false;render()},send,attach:()=>$('#file-picker').click(),voice:voice,'cancel-reply':()=>{S.reply=null;render()},invite:inviteModal,team:teamModal,org:orgModal,conversation:conversationModal,plan:()=>planModal(),reminders:()=>remindersModal(),vault:()=>vaultModal(),knowledge:()=>knowledgeModal(),wiki:()=>wikiModal(),'calendar-subscribe':()=>calendarSubscribeModal(),labels:labelsModal,contacts:contactsModal,games:()=>gamesModal(),presence:presenceModal,integrations:integrationsModal,apikeys:()=>apiKeysModal(),'time-report':()=>timeReportModal(),dashboard:()=>dashboardModal(),'assistant-summarize':()=>assistantSummarizeModal(),'assistant-suggest':()=>assistantSuggestModal(),journal:()=>journalModal(),report:()=>reportModal(),digest:()=>digestModal(),catalogue:()=>catalogueModal(),company:()=>companyModal(),'meeting-ops':()=>window.ChatMeetingOperations?.open?.(can('meeting.cost.read')?'costs':'jobs')??toast('Контроль встреч недоступен.'),'room-games':()=>gamesModal(S.selected),'favour-room':()=>S.selected&&toggleFavourite('conversation',S.selected),search:()=>window.ChatDailyWork?.openSearch?.(),profile:()=>personPage(me().userId),settings:()=>profileModal(),push:()=>window.ChatDailyWork?.openNotifications?.()??toast('Центр уведомлений недоступен.'),files:()=>window.ChatDailyWork?.openFiles?.()??toast('Экран файлов не загрузился — обновите страницу.'),calls:callsModal,decisions:()=>decisionsModal(),stories:()=>storiesModal(),materials:()=>materialsModal(),import:()=>importModal(),audio:()=>window.ChatCalls?.startOutgoing?.('audio'),video:()=>window.ChatCalls?.startOutgoing?.('video')};

/**
 * Роль по-русски.
 *
 * Роль подставлялась в интерфейс как есть, английским словом из базы:
 * «Олег Прораб · member». Словарь один на все места, где роль видна
 * человеку, — иначе следующее такое место напишут снова руками.
 */
const ROLE_WORD={owner:'владелец',admin:'администратор',manager:'руководитель',member:'сотрудник',guest:'гость'};
const roleWord=(role)=>ROLE_WORD[role]??role??'';
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
    const seats=u.seats.limit===null?`${u.seats.used} ${pluralIn(u.seats.used,['чел.','чел.','чел.'],['person','people'])}`:`${u.seats.used} <span>из</span> ${u.seats.limit}`;
    const tight=u.seats.limit!==null&&u.seats.free<=0;
    // Закрытое подразделение снаружи: имя, замок и счёт. Писать про него
    // «руководитель не назначен» было бы враньём — он назначен, просто не
    // ваше дело кто.
    const shut=u.closed&&!u.inside;
    return `<div class="org-node${u.closed?' closed':''}" style="--org-depth:${depth}">
      <div class="org-line">
        <strong>${u.closed?'<span class="org-lock" aria-hidden="true">⊘</span> ':''}${esc(u.name)}</strong>
        <span class="org-kind">${esc(UNIT_KIND[u.kind]||u.kind)}</span>
        ${u.closed?`<span class="org-kind shut">${u.inside?'закрытое · вы внутри':'закрытое'}</span>`:''}
        ${mayManage(u.id)&&!wide?'<span class="org-kind own">вы управляете</span>':''}
        ${mayManage(u.id)?`<button class="text-button org-edit" data-unit="${esc(u.id)}">настроить</button>`:''}
      </div>
      <div class="org-meta"><span class="${tight?'org-full':''}">${seats}</span><span>${
        shut?'<span>состав виден только участникам</span>'
        :head?`<span>руководитель</span>: ${esc(head)}`:'<span>руководитель не назначен</span>'}</span></div>
    </div>${branch(u.id,depth+1)}`;
  }).join('');

  const planned=units.reduce((n,u)=>n+(u.seats.limit??0),0),taken=units.reduce((n,u)=>n+u.seats.used,0);

  /**
   * Свои подразделения — первым делом.
   *
   * Человек в четырёх отделах видел четыре строчки в общей схеме и
   * должен был искать их глазами. Здесь они собраны наверху, с
   * непрочитанным в каждом и входом одним нажатием: комната
   * подразделения — обычная беседа, поэтому счётчик берётся оттуда же,
   * откуда во всём остальном приложении.
   */
  const ROLE_IN_UNIT={head:'руководитель',admin:'администратор',member:'участник'};
  const mine=units.filter(u=>u.mine);
  const mineBlock=mine.length?`<h3 class="person-section"><span>Мои подразделения</span> — ${mine.length}</h3>
    <div class="person-feed">${mine.map(u=>{
      const room=u.conversationId?S.conversations.find(c=>c.id===u.conversationId):null;
      const unread=Number(room?.unreadCount||0);
      return `<button type="button" class="row flow pressable unit-row" ${u.conversationId?`data-unit-room="${esc(u.conversationId)}"`:''} style="width:100%;text-align:left">
        <span><div class="row-title">${u.closed?'<span class="org-lock" aria-hidden="true">⊘</span> ':''}${esc(u.name)}</div>
          <div class="row-sub"><span>${esc(UNIT_KIND[u.kind]||u.kind)}</span> · ${u.seats.used} ${pluralIn(u.seats.used,['чел.','чел.','чел.'],['person','people'])}${u.headUserId===me().userId?' · <span>вы руководитель</span>':''}</div></span>
        ${unread?`<span class="chip pulse">${unread}</span>`:'<span class="chip">открыть</span>'}
      </button>`;
    }).join('')}</div>`:'';

  modal('Оргструктура',`
    ${mineBlock}
    ${wide?'<div class="stack" style="margin:14px 0 12px"><button data-new-root class="button secondary">＋ Подразделение верхнего уровня</button></div>':''}
    ${mine.length?'<h3 class="person-section">Вся компания</h3>':''}
    <div class="org-tree">${branch(null,0)}</div>
    <p class="muted" style="margin-top:12px"><span>Мест занято</span>: ${taken} / ${planned}${wide?'':' · <span>вы управляете только своей веткой</span>'}</p>`,()=>{
    if(wide)$('[data-new-root]').onclick=()=>unitFormModal(null,null,orgModal);
    $$('[data-unit]').forEach(button=>button.onclick=()=>unitSheet(units.find(u=>u.id===button.dataset.unit),{wide,units}));
    // Вход в комнату подразделения: закрываем лист и открываем беседу —
    // это обычная комната, и дальше всё работает как везде.
    $$('[data-unit-room]').forEach(button=>button.onclick=()=>openChatFromSheet(button.dataset.unitRoom));
  });
}

async function unitSheet(unit,{wide,units}){
  if(!unit)return;
  let members=[];
  try{members=(await api(`/api/v1/org/units/${unit.id}/members`)).items||[]}
  catch(error){toast(error.message)}
  // Штат перечитываем вместе со списком: карточка показывала числа,
  // взятые при первой загрузке экрана, и после зачисления человека
  // отдел оставался «0 из 6» — руководитель, который считает по ней
  // штат, считает неправильно.
  try{
    const fresh=((await api('/api/v1/org/units')).items||[]).find(u=>u.id===unit.id);
    if(fresh)unit=fresh;
  }catch{}

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
      modal(T(`Удалить «${unit.name}»?`,`Delete "${unit.name}"?`),`<p class="muted">Подразделение с вложенными подразделениями или людьми удалить нельзя — сначала перенесите или удалите их.</p>
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
    ${existing||!can('org.unit.private.create')?'':`<label class="switch-row"><input type="checkbox" name="closed">
      <span><span class="section-title">Закрытое подразделение</span>
      <span class="row-sub">В схеме останется имя, замок и число людей. Состав, назначение и руководитель — только тем, кто внутри; вы станете руководителем и сможете добавлять людей сами.</span></span></label>`}
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
            visibility:form.get('closed')?'closed':'open',
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
        if(S.view==='chats'||S.view==='tasks')render();
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
      modal(T(`Удалить «${label.name}»?`,`Delete "${label.name}"?`),`<p class="muted">Метка снимется со всех объектов, на которых стоит. Сами объекты останутся.</p>
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
      <span><div class="section-title">Личная метка</div><div class="row-sub">Видна только вам и не попадает в общий словарь компании</div></span></label>`}
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
        toast(existing?T('Метка сохранена','Label saved'):T('Метка создана','Label created'));
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
          modal(T(`Удалить «${entry?.title??'запись'}»?`,`Delete "${entry?.title??'entry'}"?`),`<p class="muted">Пароль пропадёт безвозвратно: расшифровать его потом будет нечем.</p>
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

/**
 * База знаний и HR-бот над ней.
 *
 * Бот не сочиняет: он полнотекстовым поиском находит лучшую статью и
 * показывает её фрагмент с подсветкой совпавших слов (см. ask() на
 * сервере). Не нашлось ничего похожего — так и написано, а не выдуман
 * правдоподобный, но неверный ответ на вопрос про отпуск или больничный.
 */
async function knowledgeModal(){
  const build=async()=>{
    let items=[];
    try{items=(await api('/api/v1/knowledge')).items||[]}
    catch(error){
      return {title:'База знаний',body:`<div class="empty"><strong>База знаний недоступна</strong>${esc(error.message)}</div>`,after:()=>{}};
    }
    return {
      title:'База знаний',
      body:`<form id="kb-ask-form" class="form-stack"><label>Спросите HR-бота<textarea name="question" rows="2" placeholder="Например: сколько дней отпуска мне положено"></textarea></label><button class="button primary" type="submit">Спросить</button></form>
      <div id="kb-ask-answer"></div>
      <p class="muted" style="margin-top:16px">Статьи компании</p>
      <div class="stack">${items.length?items.map(knowledgeRow).join(''):'<div class="empty"><strong>Пока пусто</strong>Здесь появятся написанные HR ответы на частые вопросы.</div>'}</div>
      ${can('knowledge.manage')?'<button data-kb-new class="button primary" style="width:100%;margin-top:14px">＋ Новая статья</button>':''}`,
      after:()=>{
        $('[data-kb-new]')?.addEventListener('click',()=>knowledgeFormModal(null,refresh));
        $$('[data-kb-open]').forEach(b=>b.onclick=()=>knowledgeArticleModal(items.find(x=>x.id===b.dataset.kbOpen),refresh));
        $('#kb-ask-form').onsubmit=async(event)=>{
          event.preventDefault();
          const question=new FormData(event.currentTarget).get('question');
          const answerBox=$('#kb-ask-answer');
          if(!String(question||'').trim()){toast('Напишите вопрос');return}
          answerBox.innerHTML='<div class="empty">Ищем в статьях…</div>';
          try{
            const{matches}=await api('/api/v1/knowledge/ask',{method:'POST',body:JSON.stringify({question})});
            answerBox.innerHTML=matches.length
              ? matches.map(m=>`<button class="surface pressable" style="width:100%;text-align:left;display:block;margin-top:10px" data-kb-answer-open="${m.id}"><strong>${esc(m.title)}</strong><p class="muted" style="margin:6px 0 0">${m.snippet}</p></button>`).join('')
              : '<div class="empty"><strong>В базе знаний нет ответа на этот вопрос</strong>Спросите HR напрямую — и, может быть, стоит завести новую статью.</div>';
            $$('[data-kb-answer-open]').forEach(el=>el.onclick=()=>knowledgeArticleModal(items.find(x=>x.id===el.dataset.kbAnswerOpen),refresh));
          }catch(error){toast(error.message)}
        };
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
function knowledgeRow(article){
  return `<button class="row flow pressable" style="width:100%;background:transparent" data-kb-open="${article.id}"><span><div class="row-title">${esc(article.title)}${article.category?`<span class="chip" style="margin-left:8px">${esc(article.category)}</span>`:''}</div></span><time class="muted">${new Date(article.updatedAt).toLocaleDateString(locale()==='en'?'en-GB':'ru')}</time></button>`;
}
async function knowledgeArticleModal(article,after){
  if(!article)return;
  modal(article.title,`<p class="muted">${article.category?esc(article.category)+' · ':''}<span>обновлено</span> ${new Date(article.updatedAt).toLocaleString(locale()==='en'?'en-GB':'ru')}</p>
    <div class="message-body" style="white-space:pre-wrap;margin-top:12px">${esc(article.body)}</div>
    ${can('knowledge.manage')?`<div class="chip-row" style="margin-top:16px"><button data-kb-edit class="chipbtn pressable">Изменить</button><button data-kb-delete class="chipbtn pressable">Удалить</button></div>`:''}`,
  ()=>{
    $('[data-kb-edit]')?.addEventListener('click',()=>knowledgeFormModal(article,after));
    $('[data-kb-delete]')?.addEventListener('click',()=>{
      modal(T(`Удалить «${article.title}»?`,`Delete "${article.title}"?`),`<p class="muted">Статья пропадёт безвозвратно.</p><button id="confirm-kb-delete" class="button danger" style="width:100%">Удалить</button>`,()=>{
        $('#confirm-kb-delete').onclick=async()=>{
          try{
            await api(`/api/v1/knowledge/${article.id}`,{method:'DELETE'});
            // Два уровня назад — подтверждение и карточку статьи, — не
            // закрывая весь список целиком, как делает closeModal().
            const depth=2;overlayStack.splice(-depth);renderOverlay();unwinding+=depth;try{history.go(-depth)}catch{unwinding-=depth}
            setTimeout(()=>after?.(),250);toast(T('Статья удалена','Article deleted'))
          }
          catch(error){toast(error.message)}
        };
      });
    });
  });
}
function knowledgeFormModal(article,after){
  const editing=Boolean(article);
  modal(editing?T('Изменить статью','Edit article'):T('Новая статья','New article'),`<form id="kb-form" class="form-stack">
    <label>Заголовок<input name="title" maxlength="200" required value="${esc(article?.title??'')}" placeholder="Например: Отпуск"></label>
    <label>Категория<input name="category" maxlength="100" value="${esc(article?.category??'')}" placeholder="HR"></label>
    <label>Текст статьи<textarea name="body" rows="10" required placeholder="Ответ, который увидит сотрудник и найдёт HR-бот">${esc(article?.body??'')}</textarea></label>
    <button class="button primary">${editing?'Сохранить':'Опубликовать'}</button>
  </form>`,()=>{
    $('#kb-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const body={title:form.get('title'),category:form.get('category')||null,body:form.get('body')};
      try{
        if(editing)await api(`/api/v1/knowledge/${article.id}`,{method:'PATCH',body:JSON.stringify(body)});
        else await api('/api/v1/knowledge',{method:'POST',body:JSON.stringify(body)});
        history.back();setTimeout(()=>after?.(),250);
        toast(editing?T('Статья изменена','Article updated'):T('Статья опубликована','Article published'));
      }catch(error){toast(error.message)}
    };
  });
}

/**
 * Вики: дерево совместных страниц.
 *
 * В отличие от базы знаний (один куратор, вся компания читает), здесь
 * пишет и правит любой сотрудник — регламент, план онбординга, заметки
 * по проекту обычно ближе тому, кто их и заводит. `pageId=null` —
 * страницы верхнего уровня; иначе — сама страница и её подстраницы.
 */
async function wikiModal(pageId=null){
  const build=async()=>{
    let page=null,items=[];
    try{
      if(pageId){page=await api(`/api/v1/wiki/pages/${pageId}`);items=page.children||[]}
      else items=(await api('/api/v1/wiki/pages')).items||[];
    }catch(error){
      return{title:'Вики',body:`<div class="empty"><strong>Вики недоступна</strong>${esc(error.message)}</div>`,after:()=>{}};
    }
    const rows=items.map(p=>`<button class="row flow pressable" style="width:100%;background:transparent" data-wiki-open="${esc(p.id)}"><span><div class="row-title">${esc(p.title)}</div></span><time class="muted">${esc(dateTime(p.updatedAt))}</time></button>`).join('');
    return{
      title:page?page.title:'Вики',
      body:`
        ${page?`<div class="message-body" style="white-space:pre-wrap">${page.content?esc(page.content):'<span class="muted">Пусто. Нажмите «Изменить», чтобы написать текст.</span>'}</div>
        <div class="chip-row" style="margin-top:10px"><button data-wiki-edit class="chipbtn pressable">Изменить</button><button data-wiki-history class="chipbtn pressable">История</button><button data-wiki-archive class="chipbtn pressable">Архивировать</button></div>`
        :`<form id="wiki-search-form" class="form-stack"><label>Поиск по вики<input name="q" placeholder="Например: отпуск"></label></form><div id="wiki-search-results"></div>`}
        <p class="muted" style="margin-top:16px">${page?'Подстраницы':'Страницы'}</p>
        <div class="stack">${items.length?rows:'<div class="empty"><strong>Пока пусто</strong>Создайте первую страницу.</div>'}</div>
        <button data-wiki-new class="button primary" style="width:100%;margin-top:14px">＋ <span>${page?'Новая подстраница':'Новая страница'}</span></button>`,
      after:()=>{
        $$('[data-wiki-open]').forEach(b=>b.onclick=()=>wikiModal(b.dataset.wikiOpen));
        $('[data-wiki-new]')?.addEventListener('click',()=>wikiPageFormModal(null,pageId,refresh));
        $('[data-wiki-edit]')?.addEventListener('click',()=>wikiPageFormModal(page,page.parentId,refresh));
        $('[data-wiki-history]')?.addEventListener('click',()=>wikiHistoryModal(page.id));
        $('[data-wiki-archive]')?.addEventListener('click',()=>{
          modal('Архивировать страницу?','<p class="muted">Страница пропадёт из дерева, но останется доступна в истории.</p><button id="confirm-wiki-archive" class="button danger" style="width:100%">Архивировать</button>',()=>{
            $('#confirm-wiki-archive').onclick=async()=>{
              try{
                await api(`/api/v1/wiki/pages/${page.id}`,{method:'DELETE'});
                toast('Страница архивирована');
                // Два обычных «назад» вместо прыжка через overlayStack.splice
                // и глушения popstate счётчиком unwinding: тот приём экономит
                // один кадр отрисовки, но при частых действиях подряд счётчик
                // может разойтись с тем, сколько popstate браузер реально
                // пришлёт, и тогда следующий клик «‹»/«×» ведёт не туда. Два
                // настоящих history.back() — это два настоящих popstate,
                // каждый с собственным штатным resumeTop(). Второй back()
                // ждёт реального popstate от первого, а не setTimeout(0) —
                // порядок между навигацией и таймером ничем не гарантирован.
                window.addEventListener('popstate',()=>history.back(),{once:true});
                history.back();
              }catch(error){toast(error.message)}
            };
          });
        });
        // Форма без видимой кнопки отправки — раньше поиск ждал Enter,
        // которого ничто на экране не обещало, и печатать в поле не делало
        // вообще ничего. Теперь ищем по вводу, тем же приёмом (debounce),
        // что и остальной поиск в приложении.
        $('#wiki-search-form')?.addEventListener('submit',(event)=>event.preventDefault());
        let wikiSearchTimer;
        $('#wiki-search-form [name="q"]')?.addEventListener('input',(event)=>{
          // currentTarget перестаёт существовать сразу после того, как
          // событие отгремело: к моменту, когда сработает таймер, читать
          // его — читать null. Значение берём сразу, пока элемент ещё жив.
          const value=event.currentTarget.value;
          clearTimeout(wikiSearchTimer);
          wikiSearchTimer=setTimeout(()=>runWikiSearch(value),220);
        });
        const runWikiSearch=async(q)=>{
          const box=$('#wiki-search-results');
          if(!box)return;
          if(!String(q||'').trim()){box.innerHTML='';return}
          box.innerHTML='<div class="empty">Ищем…</div>';
          try{
            const{items:found}=await api(`/api/v1/wiki/search?q=${encodeURIComponent(q)}`);
            box.innerHTML=found.length
              ?found.map(p=>`<button class="surface pressable" style="width:100%;text-align:left;display:block;margin-top:10px" data-wiki-found="${esc(p.id)}"><strong>${esc(p.title)}</strong><p class="muted" style="margin:6px 0 0">${p.snippet}</p></button>`).join('')
              :'<div class="empty"><strong>Ничего не найдено</strong>Попробуйте другое слово.</div>';
            $$('[data-wiki-found]').forEach(b=>b.onclick=()=>wikiModal(b.dataset.wikiFound));
          }catch(error){toast(error.message)}
        };
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
function wikiPageFormModal(page,parentId,after){
  const editing=Boolean(page);
  modal(editing?'Изменить страницу':'Новая страница',`<form id="wiki-page-form" class="form-stack">
    <label>Заголовок<input name="title" required maxlength="200" value="${esc(page?.title??'')}"></label>
    <label>Текст<textarea name="content" rows="10">${esc(page?.content??'')}</textarea></label>
    <button class="button primary">${editing?'Сохранить':'Создать'}</button>
  </form>`,()=>{
    $('#wiki-page-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const submit=event.currentTarget.querySelector('button');if(submit)submit.disabled=true;
      try{
        if(editing)await api(`/api/v1/wiki/pages/${page.id}`,{method:'PATCH',body:JSON.stringify({title:form.get('title'),content:form.get('content'),expectedVersion:page.version})});
        else await api('/api/v1/wiki/pages',{method:'POST',body:JSON.stringify({title:form.get('title'),content:form.get('content'),parentId})});
        history.back();setTimeout(()=>after?.(),250);
        toast(editing?'Страница сохранена':'Страница создана');
      }catch(error){
        toast(error.code==='STALE_VERSION'?'Страницу успели изменить, пока вы её редактировали. Откройте её заново.':error.message);
        if(submit)submit.disabled=false;
      }
    };
  });
}
async function wikiHistoryModal(pageId){
  let items=[];
  try{items=(await api(`/api/v1/wiki/pages/${pageId}/history`)).items||[]}
  catch(error){toast(error.message);return}
  modal('История страницы',items.length?items.map(v=>`<div class="person-event"><span><strong>${esc(v.title)}</strong><p class="muted" style="white-space:pre-wrap;margin:4px 0 0">${esc((v.content||'').slice(0,300))}</p></span><time>${esc(dateTime(v.replacedAt))}</time></div>`).join(''):'<div class="empty"><strong>Правок ещё не было</strong>История появится после первой правки.</div>',()=>{});
}

const TIME_REPORT_PERIODS=[['7','неделя'],['30','месяц'],['365','год']];
/** Отчёт по трекнутому времени: свои часы всегда, часы команды — только тому, кому доверено вести чужие задачи. */
async function timeReportModal(){
  S.timeReportDays=S.timeReportDays??'30';
  S.timeReportScope=S.timeReportScope??'mine';
  const build=async()=>{
    let report;
    try{
      const from=new Date(Date.now()-Number(S.timeReportDays)*86400000).toISOString();
      report=await api(`/api/v1/time-entries/report?from=${encodeURIComponent(from)}&scope=${S.timeReportScope}`);
    }catch(error){
      return{title:'Отчёт по времени',body:`<div class="empty"><strong>Отчёт недоступен</strong>${esc(error.message)}</div>`,after:()=>{}};
    }
    const rows=report.items.map(r=>`<div class="row"><span><div class="row-title">${esc(r.taskTitle)}</div>${S.timeReportScope==='team'?`<div class="row-sub">${esc(name(r.userId))}</div>`:''}</span><span class="chip mono">${formatDuration(r.totalSeconds)}</span></div>`).join('');
    return{
      title:'Отчёт по времени',
      body:`<div class="chip-row">${TIME_REPORT_PERIODS.map(([value,caption])=>`<button class="chipbtn pressable${S.timeReportDays===value?' on':''}" data-time-report-period="${value}">${caption}</button>`).join('')}
        ${can('task.manage.team')?`<button class="chipbtn pressable${S.timeReportScope==='team'?' on':''}" data-time-report-scope="${S.timeReportScope==='team'?'mine':'team'}">${S.timeReportScope==='team'?'Вся команда':'Только я'}</button>`:''}</div>
      <p class="muted" style="margin:10px 0 0"><span>Всего:</span> <strong class="mono">${formatDuration(report.totalSeconds)}</strong></p>
      <div class="stack" style="margin-top:10px">${rows||'<div class="empty"><strong>Пока пусто</strong>За этот период трекнутого времени нет.</div>'}</div>`,
      after:()=>{
        $$('[data-time-report-period]').forEach(b=>b.onclick=async()=>{S.timeReportDays=b.dataset.timeReportPeriod;await refresh()});
        $('[data-time-report-scope]')?.addEventListener('click',async(event)=>{S.timeReportScope=event.currentTarget.dataset.timeReportScope;await refresh()});
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

/**
 * Свой мини-график, а не третья зависимость ради нескольких столбиков.
 *
 * `rows` — уже готовый дневной ряд с сервера (не досчитывается на
 * клиенте: дашборд не должен уметь то, чего не умеет /api/v1/dashboard,
 * иначе однажды они разойдутся). Пустой день — нулевой столбик, а не
 * пропуск: провал виден только рядом с тем, что было вчера и позавчера.
 */
function barChartSvg(rows,keys,{width=320,height=64,colors=['var(--warm)','var(--success)']}={}){
  const n=Math.max(1,rows.length);
  const max=Math.max(1,...rows.flatMap(r=>keys.map(k=>Number(r[k]||0))));
  const groupW=width/n,gap=Math.min(2,groupW/6),barW=Math.max(1,(groupW-gap*(keys.length+1))/keys.length);
  let bars='';
  rows.forEach((row,i)=>{
    keys.forEach((k,ki)=>{
      const v=Number(row[k]||0);
      // Нулевой день рисуется тоже — тонкой чертой у нуля, а не пустым
      // местом. Без неё график с активностью в один день из тридцати
      // выглядел как ничего не отрисовавшийся, а не как «в остальные дни
      // было тихо»: не отличить одно от другого, если не видно оси.
      const h=v>0?Math.max(2,(v/max)*(height-4)):1;
      const x=i*groupW+gap+ki*(barW+gap);
      bars+=`<rect x="${x.toFixed(1)}" y="${(height-h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${colors[ki]}" opacity="${v>0?'1':'.25'}"><title>${esc(String(row.date||''))}: ${esc(String(v))}</title></rect>`;
    });
  });
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none">${bars}</svg>`;
}
/**
 * Дашборд: тренд поверх уже существующих отчётов.
 *
 * Числа те же, что в «Отчёте по обязательствам» и «Отчёте по времени» —
 * здесь только дневной ряд для графика вместо одной суммы за период, и
 * оба отчёта рядом, а не за два разных клика.
 */
async function dashboardModal(){
  S.dashboardDays=S.dashboardDays??'30';
  S.dashboardScope=S.dashboardScope??(can('task.manage.team')?'team':'mine');
  const build=async()=>{
    let data;
    try{
      const from=new Date(Date.now()-Number(S.dashboardDays)*86400000).toISOString();
      data=await api(`/api/v1/dashboard?from=${encodeURIComponent(from)}&scope=${S.dashboardScope}`);
    }catch(error){
      return{title:'Дашборд',body:`<div class="empty"><strong>Дашборд недоступен</strong>${esc(error.message)}</div>`,after:()=>{}};
    }
    const t=data.tasks.totals;
    const kpis=[
      ['Открыто',t.open],
      ['Просрочено',t.overdue],
      ['Закрыто за период',t.closed],
      ['Сдержано обещаний',t.keptPromises==null?'—':`${t.keptPromises}%`],
    ];
    // Округление до десятой доли часа превращало любую трекнутую секунду
    // короче шести минут в ровный ноль — и полоска гасла целиком, будто
    // в этот день вообще не работали, хотя таймер точно шёл.
    const timeRows=(data.time?.daily||[]).map(d=>({date:d.date,hours:d.totalSeconds>0?Math.max(0.1,Math.round((d.totalSeconds/3600)*10)/10):0}));
    return{
      title:'Дашборд',
      body:`<div class="chip-row">${TIME_REPORT_PERIODS.map(([value,caption])=>`<button class="chipbtn pressable${S.dashboardDays===value?' on':''}" data-dashboard-period="${value}">${caption}</button>`).join('')}
        ${can('task.manage.team')?`<button class="chipbtn pressable${S.dashboardScope==='team'?' on':''}" data-dashboard-scope="${S.dashboardScope==='team'?'mine':'team'}">${S.dashboardScope==='team'?'Вся команда':'Только я'}</button>`:''}</div>
      <div class="chip-row" style="margin-top:12px;flex-wrap:wrap">${kpis.map(([label,value])=>`<div class="surface" style="padding:10px 14px;min-width:120px"><div class="row-sub">${esc(label)}</div><strong style="font-size:21px">${esc(String(value))}</strong></div>`).join('')}</div>
      <h3 class="person-section" style="margin-top:16px">Задачи по дням<span class="muted" style="font-weight:400"> · <span style="color:var(--warm)">создано</span> / <span style="color:var(--success)">закрыто</span></span></h3>
      ${barChartSvg(data.tasks.daily,['created','closed'])}
      ${data.time?`<h3 class="person-section" style="margin-top:16px">Время по дням, ч</h3>${barChartSvg(timeRows,['hours'],{colors:['var(--room-channel)']})}<p class="muted" style="margin-top:6px"><span>Всего:</span> <strong class="mono">${formatDuration(data.time.totalSeconds)}</strong></p>`:''}`,
      after:()=>{
        $$('[data-dashboard-period]').forEach(b=>b.onclick=async()=>{S.dashboardDays=b.dataset.dashboardPeriod;await refresh()});
        $('[data-dashboard-scope]')?.addEventListener('click',async(event)=>{S.dashboardScope=event.currentTarget.dataset.dashboardScope;await refresh()});
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

/**
 * Подписка на календарь ChatX в Google/Outlook/Apple Calendar.
 *
 * Ссылка — секрет сама по себе: календарное приложение читает по ней
 * без пароля и перечитывает по расписанию. Показываем её один раз на
 * экране, а не только по клику «скопировать» — то, что нельзя увидеть
 * снова после случайного закрытия, раздражает больше, чем помогает.
 */
async function calendarSubscribeModal(){
  let token=null;
  try{({token}=await api('/api/v1/calendar/ics'))}catch(error){toast(error.message);return}
  const render=()=>{
    const url=`${location.origin}/api/v1/calendar/ics/${token}`;
    modal('Подписка на календарь',`
      <p class="muted">Вставьте эту ссылку в Google Calendar («Другие календари → По URL»), Outlook или Apple Calendar («Подписаться на календарь») — события ChatX появятся там и будут обновляться сами.</p>
      <label>Ссылка на подписку<textarea readonly rows="3" onclick="this.select()">${esc(url)}</textarea></label>
      <div class="chip-row" style="margin-top:10px">
        <button type="button" class="chipbtn pressable" data-copy-ics>Скопировать ссылку</button>
        <button type="button" class="chipbtn pressable" data-regenerate-ics>Выпустить новую ссылку</button>
      </div>
      <p class="muted" style="margin-top:10px">Новая ссылка — старая сразу перестаёт работать: полезно, если ссылка случайно кому-то досталась.</p>`,
    ()=>{
      $('[data-copy-ics]').onclick=async()=>{try{await navigator.clipboard.writeText(url);toast('Ссылка скопирована')}catch{toast('Скопируйте ссылку вручную')}};
      $('[data-regenerate-ics]').onclick=async()=>{
        modal('Выпустить новую ссылку?','<p class="muted">Старая ссылка перестанет открывать календарь — приложение по ней больше ничего не получит.</p><button id="confirm-ics-regen" class="button danger" style="width:100%">Выпустить новую</button>',()=>{
          $('#confirm-ics-regen').onclick=async()=>{
            try{
              await api('/api/v1/calendar/ics',{method:'POST'});
              // Два уровня назад — подтверждение и старую ссылку, — не
              // закрывая всё окно целиком, как делает closeModal().
              const depth=2;overlayStack.splice(-depth);renderOverlay();unwinding+=depth;try{history.go(-depth)}catch{unwinding-=depth}
              setTimeout(()=>{toast('Новая ссылка готова');calendarSubscribeModal()},250);
            }catch(error){toast(error.message)}
          };
        });
      };
    });
  };
  render();
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
      <div class="row-sub">${esc(dateTime(r.remindAt))}${r.note?` · ${esc(r.note.slice(0,60))}`:''}</div>
      ${r.sourceId&&['message','task','event'].includes(r.sourceType)?`<button class="text-button" data-reminder-open="${esc(r.sourceType)}:${esc(r.sourceId)}:${esc(r.conversationId||'')}">${esc(T('Открыть источник','Open source'))}</button>`:''}</span>
    <span class="inline-actions">
      ${overdue?'<span class="chip warm">пора</span>':''}
      ${r.status==='done'?'<button class="text-button" data-reminder-reopen="'+r.id+'">Снова ждать</button>'
        :`<button class="text-button" data-reminder-snooze="${esc(r.id)}" data-at="${esc(r.remindAt)}">＋1 час</button><button class="text-button" data-reminder-done="${esc(r.id)}">Готово</button>`}
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
        $$('[data-reminder-open]').forEach(b=>b.onclick=()=>{
          const [type,id,conv]=b.dataset.reminderOpen.split(':');
          closeModal();
          setTimeout(()=>{
            if(type==='message'&&conv)openChatAtMessage(conv,id);
            else if(type==='task')openTask(id);
            else if(type==='event')eventPage(id);
          },120);
        });
        $$('[data-reminder-done]').forEach(b=>b.onclick=()=>patch(b.dataset.reminderDone,{status:'done'}));
        $$('[data-reminder-reopen]').forEach(b=>b.onclick=()=>patch(b.dataset.reminderReopen,{status:'pending'}));
        $$('[data-reminder-snooze]').forEach(b=>b.onclick=()=>patch(b.dataset.reminderSnooze,{remindAt:new Date(Math.max(Date.now(),new Date(b.dataset.at).getTime())+3600e3).toISOString()}));
        $$('[data-reminder-delete]').forEach(b=>b.onclick=async()=>{
          try{await api(`/api/v1/reminders/${b.dataset.reminderDelete}`,{method:'DELETE'});await refresh();toast(T('Напоминание удалено','Reminder deleted'))}catch(error){toast(error.message)}
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
// Заголовок партии — динамическая строка («Шахматы · Имя»), а заголовок
// модалки вставляется как экранированный текст (esc()), а не HTML: там
// не работает span-изоляция, на которой держится остальной перевод.
// Название игры выбирается по языку прямо здесь, а не через словарь.
const GAME_NAME_BY_LOCALE={ru:{chess:'Шахматы',checkers:'Шашки',battleship:'Морской бой'},en:{chess:'Chess',checkers:'Checkers',battleship:'Battleship'}};
const GAME_NAME=GAME_NAME_BY_LOCALE.ru;
const gameName=(kind)=>GAME_NAME_BY_LOCALE[locale()]?.[kind]??GAME_NAME_BY_LOCALE.ru[kind]??kind;
const GAME_ICON={chess:'♞',checkers:'⛂',battleship:'⚓'};
const CHESS_GLYPH={K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
const GAME_RESULT={checkmate:'мат',stalemate:'пат',resigned:'партия сдана',draw:'ничья','no-pieces':'все фигуры побиты','no-moves':'ходов не осталось','fleet-destroyed':'флот потоплен','insufficient-material':'ничья: нечем матовать','fifty-move':'ничья по правилу 50 ходов'};

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
    // В списке беседы партии бывают и чужие: играют двое других, а
    // смотрят все. Строка же говорила «вы проиграли» тому, кто за доску
    // не садился, и «ход соперника» — по отклонённому приглашению,
    // открыв которое человек попадал на доску без единой кнопки.
    const mine=g.challengerId===me().userId||g.opponentId===me().userId;
    const opponent=g.challengerId===me().userId?g.opponentId:g.challengerId;
    const waiting=g.status==='invited'&&g.opponentId===me().userId;
    const finished=g.status==='finished'
      ? (g.result==='invite_cancelled'
          ? `<span>приглашение отменено</span>`
          : mine
            ? `<span>${g.winnerId?(g.winnerId===me().userId?'вы выиграли':'вы проиграли'):'ничья'}</span> · <span>${esc(GAME_RESULT[g.result]||g.result)}</span>`
            : `${g.winnerId?`<span>выиграл(а)</span> ${esc(name(g.winnerId))}`:'<span>ничья</span>'} · <span>${esc(GAME_RESULT[g.result]||g.result)}</span>`)
      : null;
    const state=finished
      ?? (g.status==='declined'?(mine&&g.challengerId===me().userId?'соперник отказался':'вы отказались')
      : g.status==='abandoned'?'партия брошена'
      : g.status==='invited'?(waiting?'ждёт вашего ответа':'ждём ответа соперника')
      : !mine?'идёт партия'
      : g.yourTurn?'ваш ход':'ход соперника');
    return `<button class="row pressable" data-game="${esc(g.id)}">
      <span class="game-mark">${GAME_ICON[g.kind]||'●'}</span>
      <span><div class="row-title"><span data-game-kind="${esc(g.kind)}">${esc(gameName(g.kind))}</span> · ${esc(mine?name(opponent):`${name(g.challengerId)} и ${name(g.opponentId)}`)}</div><div class="row-sub">${state}</div></span>
      ${g.yourTurn&&g.status==='active'&&mine?'<span class="chip warm">ваш ход</span>':waiting?'<span class="chip warm">ответьте</span>':'<span class="chip"></span>'}
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
    const recordBlock=record.length?`<div class="game-record"><div class="section-title">Ходы</div><ol class="game-moves">${record.slice(-16).map(mv=>`<li><span class="muted">${mv.ordinal}.</span> ${esc(mv.notation)} <span class="muted">— ${esc(mv.actorId===me().userId?'вы':name(mv.actorId))}</span></li>`).join('')}</ol>${record.length>16?`<div class="row-sub">Показаны последние 16 из ${record.length}.</div>`:''}</div>`:'';
    const heading=`${gameName(game.kind)} · ${name(opponent)}`;
    const status=game.status==='finished'
      ? (game.result==='invite_cancelled'
        ? `<div class="game-status"><span>Приглашение отменено</span></div>`
        : `<div class="game-status done"><span>${game.winnerId?(game.winnerId===me().userId?'Вы выиграли':'Вы проиграли'):'Ничья'}</span> — <span>${esc(GAME_RESULT[game.result]||game.result)}</span></div>`)
      : game.status==='invited'
        ? `<div class="game-status"><span>${game.opponentId===me().userId?'Вас зовут сыграть':'Ждём ответа соперника'}</span></div>`
        : `<div class="game-status${game.yourTurn?' yours':''}"><span>${game.yourTurn?'Ваш ход':'Ход соперника'}</span></div>`;

    const board=game.status==='invited'?'' :
      game.kind==='battleship'?battleshipBoards(game):squareBoard(game);

    const actions=[];
    if(game.status==='invited'&&game.opponentId===me().userId){
      actions.push('<button data-accept class="button primary">Играть</button>');
      actions.push('<button data-decline class="button secondary">Отказаться</button>');
    }
    // Позвавший ждал ответа и не мог ничего сделать с приглашением,
    // кроме как ждать: ни отменить, ни отозвать. Та же кнопка «сдаться»
    // технически закрывает и неотвеченное приглашение — только с другой
    // подписью и последствием, которые человек здесь и увидит.
    if(game.status==='invited'&&game.challengerId===me().userId)actions.push('<button data-cancel-invite class="button secondary">Отменить приглашение</button>');
    if(game.status==='active')actions.push('<button data-resign class="button danger">Сдаться</button>');
    if(game.kind==='battleship'&&game.status==='active'&&game.state.phase==='placing'&&!game.state.myFleet.length){
      actions.unshift('<button data-fleet class="button primary">Расставить корабли</button>');
    }

    return {title:heading,body:`${status}${board}${recordBlock}
      <div class="stack" style="margin-top:14px">${actions.join('')}</div>`,after:()=>{
      $('[data-accept]')?.addEventListener('click',()=>respondGame(id,true,refresh));
      $('[data-decline]')?.addEventListener('click',()=>respondGame(id,false,refresh));
      $('[data-cancel-invite]')?.addEventListener('click',()=>{
        modal('Отменить приглашение?','<p class="muted">Соперник больше не увидит это приглашение.</p><button id="confirm-cancel-invite" class="button danger" style="width:100%">Отменить приглашение</button>',()=>{
          $('#confirm-cancel-invite').onclick=async()=>{
            try{await api(`/api/v1/games/${id}/resign`,{method:'POST'});toast('Приглашение отменено');history.back();setTimeout(refresh,300)}
            catch(error){toast(error.message)}
          };
        });
      });
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
/**
 * Объявленная доступность.
 *
 * Присутствие («в сети», «отошёл») вычисляет приложение по сокету. Но
 * на работе спрашивают не «онлайн ли Нина», а «когда она вернётся», и
 * на это отвечает только сам человек.
 *
 * Набор короткий намеренно: длинный список статусов никто не
 * поддерживает в актуальном состоянии, и он быстро начинает врать.
 */
const MONTHS_GENITIVE=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const AVAILABILITY=[
  ['available','Доступен','',''],
  ['meeting','На встрече','◷','до конца встречи'],
  ['lunch','На обеде','🍽','обычно час'],
  ['focus','Не отвлекать','◉','сосредоточен на работе'],
  ['away','Буду позже','↩','укажите, когда вернётесь'],
  ['sick','На больничном','✚',''],
  ['vacation','В отпуске','☼',''],
  ['trip','В командировке','✈',''],
];
const AVAILABILITY_BY=Object.fromEntries(AVAILABILITY.map(([value,caption,mark,hint])=>[value,{caption,mark,hint}]));

/** Когда человек вернётся — короткой фразой, а не меткой времени. */
function backAtWord(value){
  if(!value)return '';
  const at=new Date(value);
  if(Number.isNaN(at.getTime()))return '';
  const now=new Date();
  const sameDay=at.toDateString()===now.toDateString();
  const tomorrow=new Date(now.getTime()+86400000).toDateString()===at.toDateString();
  if(sameDay)return `до ${time(value)}`;
  if(tomorrow)return `до завтра, ${time(value)}`;
  return `до ${new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long'}).format(at)}, ${time(value)}`;
}

/**
 * Подпись доступности рядом с именем.
 *
 * Пусто для доступного человека: значок «всё хорошо» рядом с каждым
 * именем — это шум, из которого не выделяется важное.
 */
function availabilityNote(presence){
  const kind=presence?.availability;
  if(!kind||kind==='available')return '';
  const meta=AVAILABILITY_BY[kind];
  if(!meta)return '';
  const back=backAtWord(presence.backAt);
  return `${meta.mark?meta.mark+' ':''}${meta.caption}${back?` ${back}`:''}`;
}
const availabilityChip=(presence)=>{
  const kind=presence?.availability;
  if(!kind||kind==='available')return '';
  const meta=AVAILABILITY_BY[kind];
  if(!meta)return '';
  const back=backAtWord(presence.backAt);
  // Тот же фрагмент, что availabilityNote(), но подпись — в своём <span>:
  // единой текстовой строкой словарь-наблюдатель не переводит слово
  // внутри чужой фразы, даже если для самого слова запись уже есть.
  return `<span class="away-chip">${meta.mark?esc(meta.mark)+' ':''}<span>${esc(meta.caption)}</span>${back?` ${esc(back)}`:''}</span>`;
};

/**
 * Кого из беседы сейчас нет.
 *
 * Статусы были видны только значком у имени — то есть тогда, когда на
 * имя смотрят. Писать и назначать задачи при этом продолжали так,
 * будто человек за столом, и «почему молчит» выяснялось через день.
 */
function awayIn(conversation){
  if(!conversation)return [];
  const others=(S.people||[]).filter(p=>p.userId!==me().userId&&p.active!==false);
  const pool=conversation.kind==='direct'
    // В личной переписке собеседник один, и в списке людей он есть по
    // названию беседы: участников беседы клиент отдельно не держит.
    ?others.filter(p=>(p.displayName||p.email)===conversation.title)
    :[];
  return pool.filter(p=>p.presence?.availability&&p.presence.availability!=='available');
}

/** Строка-предупреждение над полем ввода, если собеседника нет на месте. */
function awayNotice(conversation){
  const away=awayIn(conversation);
  if(!away.length)return '';
  const who=away[0];
  return `<div class="away-notice">${esc(who.displayName||who.email)} — ${esc(availabilityNote(who.presence))}. Ответ может быть не сегодня.</div>`;
}

const PRESENCE_CHOICES=[['online','В сети'],['away','Отошёл'],['busy','Занят'],['do_not_disturb','Не беспокоить'],['offline','Не в сети']];

const myPresence=()=>person(me()?.userId)?.presence??{state:'online',statusText:null};

function presenceModal(){
  const mine=myPresence();
  const current=mine.state||'online';
  const kind=mine.availability||'available';
  const backAt=mine.backAt?toLocalInput(mine.backAt):'';
  modal('Ваш статус',`<form id="presence-form" class="form-stack">
    <div><div class="section-title">Я сейчас</div>
      <div class="chip-row" style="margin-top:8px">${AVAILABILITY.map(([value,caption,mark])=>
        `<button type="button" class="chipbtn pressable${kind===value?' on':''}" data-availability="${value}">${mark?esc(mark)+' ':''}<span>${esc(caption)}</span></button>`).join('')}</div>
      <p class="muted" id="availability-hint" style="margin:8px 0 0">${esc(AVAILABILITY_BY[kind]?.hint||'')}</p></div>
    <label id="back-at-field" ${kind==='available'?'hidden':''}>Вернусь
      <input name="backAt" type="datetime-local" value="${esc(backAt)}"></label>
    <label>Чем заняты<input name="statusText" maxlength="140" placeholder="Например: на площадке до обеда" value="${esc(mine.statusText||'')}"></label>
    <label>Состояние<select name="state" class="field">${PRESENCE_CHOICES.map(([value,caption])=>
      `<option value="${value}" ${current===value?'selected':''}>${esc(caption)}</option>`).join('')}</select></label>
    <p class="muted">Коллеги увидят это рядом с вашим именем — в списке людей, в беседах и в задачах.</p>
    <button class="button primary pressable">Сохранить</button>
  </form>`,()=>{
    const form=$('#presence-form');
    let chosen=kind;
    const field=$('#back-at-field'),hint=$('#availability-hint');
    $$('[data-availability]').forEach(b=>b.onclick=()=>{
      chosen=b.dataset.availability;
      $$('[data-availability]').forEach(x=>x.classList.toggle('on',x===b));
      // «Доступен» — единственное состояние без возвращения: у него
      // нечему заканчиваться.
      field.hidden=chosen==='available';
      hint.textContent=AVAILABILITY_BY[chosen]?.hint||'';
    });
    form.onsubmit=async(event)=>{
      event.preventDefault();
      const data=new FormData(form);
      const raw=data.get('backAt');
      const body={
        state:data.get('state'),
        statusText:data.get('statusText')||null,
        availability:chosen,
        backAt:chosen==='available'||!raw?null:new Date(raw).toISOString(),
      };
      if(body.backAt&&Date.parse(body.backAt)<=Date.now())return toast('Момент возвращения должен быть в будущем');
      try{
        const{presence}=await api('/api/v1/presence',{method:'POST',body:JSON.stringify(body)});
        const self=person(me().userId);
        if(self)self.presence=presence;
        toast('Статус обновлён');
        closeModal();shell();render();
      }catch(error){toast(error.code==='BACK_AT_IN_PAST'?'Момент возвращения должен быть в будущем':error.message)}
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
      ${can('organization.manage')?`
      <label>Название компании<input name="companyName" maxlength="120" value="${esc(me().organizationName||'')}"></label>
      <label>Название пространства<input name="workspaceName" maxlength="120" value="${esc(me().workspaceName||'')}"></label>`:''}
      <label>Юридическое лицо<input name="legalName" maxlength="200" placeholder="ООО «Гранит»" value="${esc(S.boot?.company?.legalName||'')}"></label>
      <label>ИНН<input name="taxId" maxlength="40" inputmode="numeric" value="${esc(S.boot?.company?.taxId||'')}"></label>
      <label>Адрес<input name="address" maxlength="300" value="${esc(S.boot?.company?.address||'')}"></label>
      <label>Сайт<input name="website" maxlength="200" placeholder="granit.ru" value="${esc(S.boot?.company?.website||'')}"></label>
      <label>Телефон<input name="phone" maxlength="40" inputmode="tel" value="${esc(S.boot?.company?.phone||'')}"></label>
      <label>Почтовый домен<input name="emailDomain" maxlength="120" placeholder="granit.ru" value="${esc(S.boot?.company?.emailDomain||'')}"></label>
      <label>Мест в компании<input name="seatLimit" type="number" min="1" step="1" placeholder="без ограничения" value="${S.boot?.company?.seatLimit??''}"></label>
      <p class="muted" style="margin:-4px 0 0;font-size:12px"><span>Занято</span> ${(S.boot?.company?.seatsUsed??0)+(S.boot?.company?.seatsInvited??0)}${S.boot?.company?.seatLimit?` <span>из</span> ${S.boot.company.seatLimit}`:''}: ${S.boot?.company?.seatsUsed??0} ${pluralIn(S.boot?.company?.seatsUsed??0,['человек','человека','человек'],['person','people'])} <span>и</span> ${S.boot?.company?.seatsInvited??0} ${pluralIn(S.boot?.company?.seatsInvited??0,['неотвеченное приглашение','неотвеченных приглашения','неотвеченных приглашений'],['unanswered invitation','unanswered invitations'])}. <span>Гости мест не занимают.</span></p>
      <label class="switch-row"><input type="checkbox" name="domainJoin" ${S.boot?.company?.domainJoin?'checked':''}>
        <span><span class="section-title">Сотрудники заводятся сами</span>
        <span class="row-sub">Человек с адресом на вашем домене вводит рабочую почту и получает ссылку-подтверждение — заводить каждого руками не нужно. Пока мест хватает; когда кончатся, письмо придёт вам.</span></span></label>
      <button class="button primary">Сохранить</button>
    </form>
    <div class="section-head" style="margin-top:16px"><div><h3>Календарь компании</h3>
      <p class="muted">Нерабочий день одинаков для всех, кто здесь работает, поэтому слои включаются на всю компанию.</p></div></div>
    <form id="company-layers" class="form-stack">
      <label class="switch-row"><input type="checkbox" name="showHolidays" ${S.boot?.workspace?.showHolidays===false?'':'checked'}>
        <span><span class="section-title">Праздники и переносы</span>
          <span class="row-sub">Официальные нерабочие и сокращённые дни в сетке календаря.</span></span></label>
      <label class="switch-row"><input type="checkbox" name="showBirthdays" ${S.boot?.workspace?.showBirthdays===false?'':'checked'}>
        <span><span class="section-title">Дни рождения коллег</span>
          <span class="row-sub">Из карточек сотрудников — только день и месяц, без года.</span></span></label>
      <button class="button secondary pressable">Сохранить слои</button>
    </form>
    ${can('organization.manage')?`
    <h3 class="person-section">Выгрузка данных</h3>
    <p class="muted">Весь архив пространства одним файлом: люди, беседы, все сообщения, обязательства, календарь, журнал действий и сами вложения. Внутри — обычный текст по строке на запись, читается чем угодно. Выгрузка займёт время: она собирается на лету, а не лежит готовой.</p>
    <div class="row flow" style="margin-top:10px">
      <a class="button secondary pressable" href="/api/v1/export" download>Скачать всё</a>
      <a class="button ghost pressable" href="/api/v1/export?files=0" download>Без вложений</a>
    </div>
    <p class="muted" style="margin-top:6px">Каждая выгрузка попадает в журнал действий.</p>
    <h3 class="person-section">Передать владение</h3>
    <p class="muted">Новый владелец получит все права на компанию, вы останетесь работать администратором. Шаг обратный, но вернуть его сможет уже новый хозяин.</p>
    ${staff.length?`<form id="company-owner" class="form-stack" style="margin-top:10px">
      <label>Кому<select name="userId">${staff.map(p=>`<option value="${esc(p.userId)}">${esc(p.displayName||p.email)}</option>`).join('')}</select></label>
      <button class="button danger">Передать владение</button>
    </form>`:'<p class="muted">Передать пока некому: в компании нет других сотрудников.</p>'}`:''}
  `,()=>{
    $('#company-layers').onsubmit=async(event)=>{
      event.preventDefault();
      const data=new FormData(event.currentTarget);
      try{
        const{workspace}=await api('/api/v1/workspace',{method:'PATCH',body:JSON.stringify({
          showHolidays:data.get('showHolidays')==='on',showBirthdays:data.get('showBirthdays')==='on'})});
        if(S.boot)S.boot.workspace=workspace;
        toast('Слои календаря обновлены');
        await loadCalendarRange();render();
      }catch(error){toast(error.message)}
    };
    $('#company-name').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      try{
        // Поля названия администратору не показаны: посылать по ним
        // пустоту нельзя — сервер примет её за попытку переименовать и
        // откажет всей форме, вместе с реквизитами и местами.
        const named=form.has('companyName')?{companyName:form.get('companyName'),workspaceName:form.get('workspaceName')}:{};
        await api('/api/v1/workspace',{method:'PATCH',body:JSON.stringify({
          ...named,
          legalName:form.get('legalName'),taxId:form.get('taxId'),address:form.get('address'),
          website:form.get('website'),phone:form.get('phone'),emailDomain:form.get('emailDomain'),
          seatLimit:form.get('seatLimit')===''?null:Number(form.get('seatLimit')),
          domainJoin:Boolean(form.get('domainJoin')),
        })});
        toast('Данные компании сохранены');await bootstrap();
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
  'conversation.created':['Заведена беседа', e=>`${e.payload?.title??'без названия'} — ${({channel:'канал',group:'группа',direct:'личная переписка',team:'команда',project:'проект',external:'комната с внешним участником'})[e.payload?.kind]??e.payload?.kind??''}`],
  'org.unit.created':['Заведено подразделение', e=>`${e.payload?.name??''}${e.payload?.seatLimit?` — штат ${e.payload.seatLimit}`:''}`],
  'org.unit.updated':['Подразделение изменено', e=>Object.keys(e.payload?.changed??{}).map(k=>({name:'название',purpose:'назначение',seatLimit:'штат',parentId:'место в структуре',headUserId:'руководитель'})[k]??k).join(', ')],
  'org.unit.deleted':['Подразделение удалено', e=>e.payload?.name??''],
  'org.unit.member_added':['Зачислен в подразделение', e=>name(e.payload?.userId)],
  'org.unit.head_appointed':['Назначен руководитель подразделения', e=>name(e.payload?.userId)],
  'org.unit.member_removed':['Выведен из подразделения', e=>name(e.payload?.userId)],
  'auth.login.succeeded':['Вход в пространство', e=>e.payload?.ip??''],
  'auth.login.failed':['Неудачная попытка входа', e=>`${({unknown_email:'такой почты нет',bad_password:'неверный пароль',not_a_member:'не сотрудник этого пространства'})[e.payload?.reason]??e.payload?.reason??''}${e.payload?.ip?` · ${e.payload.ip}`:''}`],
  'auth.second_factor.enabled':['Включён второй множитель', ()=>'Теперь при входе спрашивают код'],
  'auth.second_factor.disabled':['Выключен второй множитель', ()=>'Вход снова только по паролю'],
  'auth.second_factor.passed':['Код при входе принят', e=>e.payload?.method==='recovery'?'запасным кодом':'кодом из приложения'],
  'password.changed':['Пароль сменён', e=>e.payload?.sessionsRevoked?`Закрыто других входов: ${e.payload.sessionsRevoked}`:''],
  'password.reset.requested':['Запрошено восстановление пароля', e=>e.payload?.email??''],
  'session.revoked':['Закрыт один из входов', ()=>''],
  'session.revoked.others':['Закрыты все остальные входы', e=>e.payload?.revoked?`Сеансов: ${e.payload.revoked}`:''],
  'access.limited':['Ограничен срок доступа', e=>e.payload?.accessUntil?`До ${dateTime(e.payload.accessUntil)}`:'Срок снят'],
  'member.deactivated':['Сотрудник отключён', e=>name(e.aggregateId)],
  'member.reactivated':['Сотрудник возвращён', e=>name(e.aggregateId)],
  'member.role_changed':['Сменилась роль сотрудника', e=>`${name(e.aggregateId)}: ${WORKSPACE_ROLE[e.payload?.from]??e.payload?.from} → ${WORKSPACE_ROLE[e.payload?.to]??e.payload?.to}`],
  'ownership.transferred':['Передано владение компанией', e=>name(e.payload?.toUserId)],
  'workspace.renamed':['Компания переименована', e=>e.payload?.workspaceName??e.payload?.companyName??''],
  'workspace.exported':['Выгрузка пространства', e=>e.payload?.withFiles===false?'без вложений':'со вложениями'],
  'conversation.member_removed':['Участник выведен из беседы', e=>name(e.payload?.userId)],
  'message.edited':['Сообщение изменено', e=>e.payload?.wasLength!==undefined?`Было ${e.payload.wasLength} знаков, стало ${e.payload.nowLength}`:''],
  'meeting.notes.saved':['Записан протокол встречи', e=>`Решений: ${e.payload?.decisions??0}, пунктов: ${e.payload?.actionItems??0}`],
  'meeting.job.retried':['Разбор встречи запущен заново', ()=>''],
  'meeting.price_version.created':['Изменены тарифы на разбор встреч', ()=>''],
  'integration.endpoint.disabled':['Интеграция отключена', e=>e.payload?.reason??'Слишком много неудачных доставок'],
  'mail.undelivered':['Письмо не доставлено', e=>e.payload?.to??''],
  'demo.seed.completed':['Заполнено демонстрационное пространство', ()=>''],
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
    <span><div class="section-title">${esc(caption)}</div>
    <div class="row-sub">${esc(when(event.createdAt))} · ${esc(event.actorName||'—')}${extra?` · <span>${esc(extra)}</span>`:''}</div></span>
  </div>`;
}

/**
 * Каталог каналов.
 *
 * Список названий в боковой панели — не ответ на вопрос «что здесь
 * есть»: на тридцати каналах новый сотрудник не понимает ни зачем
 * каждый нужен, ни живой он или брошенный. Каталог отвечает описанием,
 * размером и тем, пишут ли в нём.
 */
async function catalogueModal(){
  S.catalogueQuery=S.catalogueQuery??'';
  const build=async()=>{
    let items;
    try{items=(await api(`/api/v1/conversations/catalogue${S.catalogueQuery?`?q=${encodeURIComponent(S.catalogueQuery)}`:''}`)).items||[]}
    catch(error){return{title:'Каналы компании',body:`<div class="empty"><strong>Каталог недоступен</strong>${esc(error.message)}</div>`,after:()=>{}}}
    const row=(c)=>{
      const quiet=!c.recentMessages;
      return `<div class="row flow">
        <span><div class="row-title">${esc(c.title||c.slug||'Канал')}</div>
          <div class="row-sub">${c.announcementOnly?'<span>только объявления</span> · ':''}${c.purpose?`${esc(c.purpose)} · `:''}${c.memberCount} ${pluralIn(c.memberCount,['участник','участника','участников'],['member','members'])} · ${quiet?'<span>за месяц тихо</span>':`${c.recentMessages} ${pluralIn(c.recentMessages,['сообщение','сообщения','сообщений'],['message','messages'])} <span>за месяц</span>`}</div></span>
        ${c.member
          ?`<button type="button" class="button small secondary pressable" data-catalogue-open="${esc(c.id)}">Открыть</button>`
          :`<button type="button" class="button small primary pressable" data-catalogue-join="${esc(c.id)}">Войти</button>`}
      </div>`;
    };
    return{
      title:'Каналы компании',
      body:`<div class="form-stack"><label>Поиск<input id="catalogue-search" value="${esc(S.catalogueQuery)}" placeholder="Название или зачем канал нужен"></label></div>
        <div class="stack" style="margin-top:12px">${items.length?items.map(row).join('')
          :S.catalogueQuery?'<div class="empty"><strong>Ничего не найдено</strong>Попробуйте другое слово из названия.</div>'
          :'<div class="empty"><strong>Открытых каналов нет</strong>Каналы компании появятся здесь, как только их создадут.</div>'}</div>`,
      after:()=>{
        const search=$('#catalogue-search');
        if(search){
          search.oninput=()=>{
            clearTimeout(catalogueModal.timer);
            catalogueModal.timer=setTimeout(async()=>{S.catalogueQuery=search.value.trim();await refresh()},220);
          };
        }
        $$('[data-catalogue-open]').forEach(b=>b.onclick=()=>openChatFromSheet(b.dataset.catalogueOpen));
        $$('[data-catalogue-join]').forEach(b=>b.onclick=async()=>{
          b.disabled=true;
          try{
            await api(`/api/v1/conversations/${b.dataset.catalogueJoin}/join`,{method:'POST'});
            // Боковая панель строится из списка бесед — его и обновляем,
            // иначе канал появится только после перезагрузки.
            S.conversations=(await api('/api/v1/conversations')).items||[];
            closeModal();
            openChat(b.dataset.catalogueJoin);
            toast('Вы в канале');
          }catch(error){b.disabled=false;toast(error.message)}
        });
      },
    };
  };
  const refresh=async()=>{
    const next=await build();
    const top=overlayStack[overlayStack.length-1];
    if(top){
      Object.assign(top,next);
      renderOverlay();
      // Поле поиска перерисовано — курсор возвращаем в конец, иначе
      // человек теряет место после каждой буквы.
      const search=$('#catalogue-search');
      if(search){search.focus();search.setSelectionRange(search.value.length,search.value.length)}
    }
  };
  const first=await build();
  modal(first.title,first.body,first.after,()=>build());
}

/**
 * Первые шаги.
 *
 * Шаги не отмечаются нажатием — каждый выводится из настоящего
 * состояния: заполнена ли должность, состоит ли человек хоть в одном
 * канале, писал ли он что-нибудь. Мастер настройки с галочками, которые
 * ставит сам пользователь, врёт с первого экрана.
 */
function onboardingSection(){
  const state=S.onboarding;
  if(!state)return '';
  return `<section class="surface onboarding">
    <div class="section-head"><div><h2>Первые шаги</h2>
      <p class="muted"><span>Вы здесь недавно. Осталось</span> ${state.left} <span>из</span> ${state.steps.length}<span> — это не обязательно, но так коллегам будет проще.</span></p></div>
      <button class="button small secondary pressable" data-onboarding-dismiss>Скрыть</button></div>
    ${state.steps.map(step=>`<div class="row onboarding-step${step.done?' done':''}">
      <span class="onboarding-mark">${step.done?'✓':''}</span>
      <span><div class="section-title">${esc(step.title)}</div><div class="row-sub">${esc(step.hint)}</div></span>
      ${step.done?'':`<button type="button" class="button small secondary pressable" data-onboarding-go="${esc(step.action)}">Перейти</button>`}
    </div>`).join('')}
  </section>`;
}
async function loadOnboarding(){
  try{S.onboarding=(await api('/api/v1/onboarding')).onboarding??null}
  catch{S.onboarding=null}
}

/**
 * «Что я пропустил».
 *
 * Вопрос понедельника после недели отсутствия. Отвечать на него продукт
 * умел единственным способом — листайте всё подряд, — и у кого сорок
 * бесед, тот не листал: пропущенное просто пропадало.
 *
 * Сводка короткая намеренно. Здесь то, что касается лично вас и требует
 * решения, а не пересказ всего, что произошло в компании.
 */
const DIGEST_PERIODS=[['','с прошлого раза'],['7','неделя'],['30','месяц']];
const digestStatus={proposed:'ждёт ответа',accepted:'принято',scheduled:'запланировано',in_progress:'в работе',blocked:'заблокировано',in_review:'на проверке',accepted_result:'результат принят',closed:'закрыто',cancelled:'отменено',rejected:'отклонено',deferred:'отложено',clarify:'уточняется'};
async function digestModal(){
  S.digestDays=S.digestDays??'';
  const build=async()=>{
    let data;
    const query=S.digestDays?`?from=${encodeURIComponent(new Date(Date.now()-Number(S.digestDays)*86400000).toISOString())}`:'';
    try{data=await api(`/api/v1/digest${query}`)}
    catch(error){return{title:'Что я пропустил',body:`<div class="empty"><strong>Сводка недоступна</strong>${esc(error.message)}</div>`,after:()=>{}}}
    const block=(title,hint,rows)=>rows.length
      ?`<div class="section-head" style="margin-top:16px"><div><h3>${title}</h3>${hint?`<p class="muted">${hint}</p>`:''}</div></div>${rows.join('')}`
      :'';
    const mentions=block('Вас упоминали','',data.mentions.map(m=>
      `<button type="button" class="row pressable" data-digest-message="${esc(m.messageId)}" data-digest-conversation="${esc(m.conversationId)}" style="width:100%;text-align:left">
        ${personAvatar(m.authorId,m.authorName)}
        <span><div class="row-title">${esc(m.authorName)} · ${esc(m.conversationTitle||'Личная переписка')}</div>
          <div class="row-sub">${esc(m.snippet)}</div></span>
        <time class="row-sub">${esc(dateTime(m.createdAt))}</time></button>`));
    // Раздел показывает три разных «ждут вас», и подпись обязана их
    // различать: предложенное обязательство, сданная вам работа и
    // принятый результат, который некому закрыть.
    const awaitingWhy=(t)=>t.status==='in_review'?`${esc(t.ownerName??'исполнитель')} <span>сдал(а) работу — нужна приёмка</span>`
      :t.status==='accepted_result'?'<span>результат принят — осталось закрыть</span>'
      :`<span>просит</span> ${esc(t.requesterName)}`;
    const awaiting=block('Ждут вашего ответа','Пока вы не ответите, не движется никто.',data.awaitingYourAnswer.map(t=>
      `<button type="button" class="row flow pressable" data-task-open="${esc(t.id)}" style="width:100%;text-align:left">
        <span><div class="row-title">${esc(t.title)}</div>
          <div class="row-sub">${awaitingWhy(t)}${t.promisedAt?` · <span>срок</span> ${esc(dateTime(t.promisedAt))}`:''}</div></span></button>`));
    const invitations=block('Приглашения на встречи','',data.invitations.map(i=>
      `<button type="button" class="row flow pressable" data-cal-event="${esc(i.id)}" style="width:100%;text-align:left">
        <span><div class="row-title">${esc(i.title)}</div>
          <div class="row-sub">${esc(i.organiserName)} · ${esc(dateTime(i.startAt))}</div></span></button>`));
    const slipped=block('Сроки прошли, пока вас не было','',data.slippedDeadlines.map(t=>
      `<button type="button" class="row flow pressable" data-task-open="${esc(t.id)}" style="width:100%;text-align:left">
        <span><div class="row-title">${esc(t.title)}</div>
          <div class="row-sub"><span class="late"><span>срок</span> ${esc(dateTime(t.promisedAt))}</span> · ${esc(t.ownerName)} · <span>${esc(digestStatus[t.status]??t.status)}</span></div></span></button>`));
    // Сюда приходят три вида движения, а не один: переход по
    // состояниям, передача задачи другому и перенос срока. У последних
    // двух нет «из» и «в», и подпись «undefined → undefined» была бы
    // хуже молчания.
    const movedWhat=(m)=>{
      if(m.eventType==='commitment.reassigned')return '<span>передал(а) задачу другому</span>';
      if(m.eventType==='commitment.rescheduled')return `<span>перенёс(ла) срок</span>${m.promisedAt?` на ${esc(dateTime(m.promisedAt))}`:''}`;
      return `<span>${esc(digestStatus[m.from]??m.from)}</span> → <span>${esc(digestStatus[m.to]??m.to)}</span>`;
    };
    const moved=block('Двигалось без вас','',data.movedWithoutYou.map(m=>
      `<button type="button" class="row flow pressable" data-task-open="${esc(m.id)}" style="width:100%;text-align:left">
        <span><div class="row-title">${esc(m.title)}</div>
          <div class="row-sub">${esc(m.actorName)}: ${movedWhat(m)} · ${esc(dateTime(m.at))}${m.reason?`<br>${esc(m.reason)}`:''}</div></span></button>`));
    const meetings=block('Встречи прошли','',data.meetingsHeld.map(m=>
      `<div class="row flow"><span><div class="row-title">${esc(m.title)}</div>
        <div class="row-sub">${esc(m.organiserName)} · ${esc(dateTime(m.startAt))}${m.attended?'':' · вы не подтверждали участие'}</div></span></div>`));
    const busiest=block('Где больше всего нового','',data.busiest.map(c=>
      `<button type="button" class="row flow pressable" data-digest-conversation="${esc(c.id)}" style="width:100%;text-align:left">
        <span><div class="row-title">${esc(c.title||'Личная переписка')}</div>
          <div class="row-sub">${c.newMessages
            ?`${c.newMessages} ${pluralIn(c.newMessages,['новое сообщение','новых сообщения','новых сообщений'],['new message','new messages'])}`
            :'в ленте ничего нового'}${c.newInThreads
            ?` · ${c.newInThreads} ${pluralIn(c.newInThreads,['ответ в ветке','ответа в ветках','ответов в ветках'],['thread reply','thread replies'])}`
            :''} · <span>последнее</span> ${esc(dateTime(c.lastAt))}</div></span></button>`));
    const joined=block('Появились в компании','',data.joined.map(p=>
      `<button type="button" class="row pressable" data-digest-person="${esc(p.userId)}" style="width:100%;text-align:left">
        ${personAvatar(p)}
        <span><div class="row-title">${esc(p.displayName)}</div><div class="row-sub">${esc(p.title||roleWord(p.role))} · с ${esc(dateTime(p.joinedAt))}</div></span></button>`));
    const body=[awaiting,invitations,mentions,slipped,moved,meetings,busiest,joined].filter(Boolean).join('');
    return{
      title:'Что я пропустил',
      body:`<div class="chip-row">${DIGEST_PERIODS.map(([value,caption])=>
          `<button class="chipbtn pressable${S.digestDays===value?' on':''}" data-digest-days="${value}">${caption}</button>`).join('')}</div>
        <p class="muted" style="margin:10px 0 0"><span>${data.guessedSince?'С вашего прошлого визита':'За выбранный период'}</span> — <span>с</span> ${esc(dateTime(data.since))}.</p>
        ${body||'<div class="empty"><strong>Ничего не пропустили</strong>За это время вас не упоминали, сроки не подходили и решений без вас не принимали.</div>'}`,
      after:()=>{
        $$('[data-digest-days]').forEach(b=>b.onclick=async()=>{S.digestDays=b.dataset.digestDays;await refresh()});
        $$('[data-task-open]').forEach(b=>b.onclick=()=>openTask(b.dataset.taskOpen));
        $$('[data-digest-person]').forEach(b=>b.onclick=()=>personPage(b.dataset.digestPerson));
        $$('[data-digest-conversation]').forEach(b=>b.onclick=()=>{
          closeModal();
          // closeModal() уходит назад по истории, и popstate приходит позже:
          // перейти в чат сразу — значит получить откат на #/more.
          const conversation=b.dataset.digestConversation,message=b.dataset.digestMessage||null;
          setTimeout(()=>openChatAtMessage(conversation,message),120);
        });
        $$('[data-cal-event]').forEach(b=>b.onclick=()=>{closeModal();eventPage(b.dataset.calEvent)});
      },
    };
  };
  const refresh=async()=>{
    const next=await build();
    const top=overlayStack[overlayStack.length-1];
    if(top){Object.assign(top,next);renderOverlay()}
  };
  const first=await build();
  modal(first.title,first.body,first.after,()=>build());
}

/**
 * Отчёт по обязательствам и людям.
 *
 * Показываем то же, что считает сервер, и ровно в том же тоне: без
 * рейтингов, баллов и «продуктивности». Главная цифра — доля обещаний,
 * закрытых в обещанный срок; всё остальное объясняет её.
 */
const REPORT_PERIODS=[['30','30 дней'],['90','90 дней'],['365','Год']];
const hoursWord=(hours)=>hours>=48?`${Math.round(hours/24)} ${pluralIn(Math.round(hours/24),['день','дня','дней'],['day','days'])}`:`${hours} ${pluralIn(hours,['час','часа','часов'],['hour','hours'])}`;
const REPORT_STATUS={blocked:'заблокировано',deferred:'отложено',clarify:'уточняется',proposed:'ждёт ответа'};
async function reportModal(){
  S.reportDays=S.reportDays??'30';
  S.reportScope=S.reportScope??'team';
  const build=async()=>{
    let data;
    const from=new Date(Date.now()-Number(S.reportDays)*86400000).toISOString();
    const query=new URLSearchParams({from,scope:S.reportScope});
    try{data=await api(`/api/v1/tasks/report?${query}`)}
    catch(error){return{title:T('Отчёт','Report'),body:`<div class="empty"><strong>Отчёт недоступен</strong>${esc(error.message)}</div>`,after:()=>{}}}
    const t=data.totals;
    // Доля «в срок» не показывается, когда сроков никто не обещал:
    // ноль процентов здесь читался бы как «все опоздали».
    const kept=t.keptPromises===null
      ?`<div class="metric-card"><strong>—</strong><span>сроков никто не обещал</span></div>`
      :`<div class="metric-card"><strong class="${t.keptPromises>=80?'':'late'}">${t.keptPromises}%</strong><span><span>обещаний закрыто в срок (</span>${t.onTime}<span> из </span>${t.promised}<span>)</span></span></div>`;
    const canSwitch=can('task.manage.team');
    const people=data.people.map(p=>`<div class="row" data-report-person="${esc(p.userId)}" style="cursor:pointer">
        ${personAvatar(p)}
        <span><div class="row-title">${esc(p.displayName)}</div>
          <div class="row-sub">${p.open} ${pluralIn(p.open,['обязательство','обязательства','обязательств'],['commitment','commitments'])}${p.overdue?` · <span class="late">${p.overdue} <span>просрочено</span></span>`:''}${p.dueSoon?` · ${p.dueSoon} <span>в ближайшие сутки</span>`:''}${p.awaitingAnswer?` · ${p.awaitingAnswer} <span>ждёт ответа</span>`:''}</div></span>
        <span class="chip">${p.keptPromises===null?'—':`${p.keptPromises}%`}</span>
      </div>${p.avgLateHours?`<div class="row-sub" style="margin:-4px 0 8px 46px"><span>когда опаздывает — в среднем на</span> ${esc(hoursWord(p.avgLateHours))}</div>`:''}`).join('');
    const stuck=data.stuck.length?`<div class="section-head" style="margin-top:16px"><div><h3>Застряло</h3><p class="muted">Не просрочено, но и не двигается — именно это чаще всего оказывается забытым.</p></div></div>
      ${data.stuck.map(s=>`<button type="button" class="row flow pressable" data-task-open="${esc(s.id)}" style="width:100%;text-align:left">
        <span><div class="row-title">${esc(s.title)}</div><div class="row-sub">${esc(REPORT_STATUS[s.status]??s.status)} · ${esc(s.ownerName)} · <span>без движения</span> ${s.stillDays} ${pluralIn(s.stillDays,['день','дня','дней'],['day','days'])}</div></span></button>`).join('')}`:'';
    const pairs=data.pairs.length?`<div class="section-head" style="margin-top:16px"><div><h3>Кто кого просит</h3><p class="muted">Обычно человек перегружен не задачами вообще, а просьбами одного и того же коллеги.</p></div></div>
      ${data.pairs.map(pair=>`<div class="row flow"><span><div class="row-title">${esc(pair.requesterName)} → ${esc(pair.ownerName)}</div><div class="row-sub">${pair.count} ${pluralIn(pair.count,['обязательство','обязательства','обязательств'],['commitment','commitments'])} <span>за период</span></div></span></div>`).join('')}`:'';
    return{
      title:T('Отчёт по обязательствам','Commitment report'),
      body:`<div class="chip-row">${REPORT_PERIODS.map(([value,caption])=>
          `<button class="chipbtn pressable${S.reportDays===value?' on':''}" data-report-days="${value}">${caption}</button>`).join('')}
        ${canSwitch?['team','mine'].map(value=>`<button class="chipbtn pressable${S.reportScope===value?' on':''}" data-report-scope="${value}">${value==='team'?'Вся компания':'Только я'}</button>`).join(''):''}</div>
      <div class="metric-grid" style="margin-top:12px">
        ${kept}
        <div class="metric-card"><strong class="${t.overdue?'late':''}">${t.overdue}</strong><span><span>просрочено сейчас</span>${t.oldestOverdueSec?`<span>, старшему</span> ${esc(hoursWord(Math.round(t.oldestOverdueSec/3600)))}`:''}</span></div>
        <div class="metric-card"><strong>${t.awaitingAnswer}</strong><span>${pluralIn(t.awaitingAnswer,['ждёт','ждут','ждут'],['is waiting','are waiting'])} <span>ответа — им ещё не пообещали</span></span></div>
      </div>
      <p class="muted" style="margin:12px 0 0"><span>За период взяли</span> ${t.created} ${pluralIn(t.created,['обязательство','обязательства','обязательств'],['commitment','commitments'])}<span>, закрыли</span> ${t.closed}${t.dropped?`<span>, сняли</span> ${t.dropped}`:''}<span>. Сейчас в работе</span> ${t.open}${t.undated?`<span>, из них без срока</span> ${t.undated}`:''}<span>.</span></p>
      <div class="section-head" style="margin-top:16px"><div><h3>Люди</h3><p class="muted">Справа — доля обещаний, закрытых в срок.</p></div></div>
      <div class="stack">${people||'<div class="empty"><strong>Пока не на ком</strong>В компании ещё нет обязательств.</div>'}</div>
      ${stuck}${pairs}`,
      after:()=>{
        $$('[data-report-days]').forEach(b=>b.onclick=async()=>{S.reportDays=b.dataset.reportDays;await refresh()});
        $$('[data-report-scope]').forEach(b=>b.onclick=async()=>{S.reportScope=b.dataset.reportScope;await refresh()});
        $$('[data-report-person]').forEach(b=>b.onclick=()=>personPage(b.dataset.reportPerson));
        $$('[data-task-open]').forEach(b=>b.onclick=()=>openTask(b.dataset.taskOpen));
      },
    };
  };
  const refresh=async()=>{
    const next=await build();
    const top=overlayStack[overlayStack.length-1];
    if(top){Object.assign(top,next);renderOverlay()}
  };
  const first=await build();
  modal(first.title,first.body,first.after,()=>build());
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
// База хранит `dead`, а ключ был взят из соседней схемы, где состояние
// зовётся `dead_letter`: на экране печаталось английское слово — прямо
// под обещанием, что недоставленное «не теряется».
const DELIVERY_STATUS={pending:'в очереди',delivering:'отправляется',delivered:'доставлено',failed:'не дошло',dead:'остановлено',dead_letter:'остановлено'};

async function integrationsModal(){
  let endpoints=[],deliveries=[],bridges=[];
  try{
    endpoints=(await api('/api/v1/integrations/webhooks')).items||[];
    deliveries=(await api('/api/v1/integrations/deliveries?limit=20')).items||[];
    bridges=(await api('/api/v1/integrations/telegram')).items||[];
  }catch(error){
    toast(error.status===403?'Интеграции настраивает владелец или администратор':error.message);
    return;
  }
  const bridgeRow=(b)=>`<div class="label-row">
    <span><div class="row-title">@${esc(b.botUsername)} → ${esc((S.conversations.find(c=>c.id===b.conversationId)||{}).title||'беседа')}</div>
      <div class="row-sub">Telegram-чат ${esc(b.telegramChatId)}${b.lastError?` · <span class="warn-text">${esc(b.lastError)}</span>`:''}</div></span>
    <span class="inline-actions"><button class="text-button danger" data-drop-bridge="${esc(b.id)}">удалить</button></span>
  </div>`;
  const endpointRow=(e)=>`<div class="label-row">
    <span><div class="row-title">${esc(e.label||e.url)}</div>
      <div class="row-sub">${esc(e.url)}</div>
      <div class="row-sub">${(e.topics||[]).map(t=>`<span class="label-chip" data-colour="blue">${esc(t)}</span>`).join(' ')||'<span class="warn-text">все события</span>'}</div></span>
    <span class="inline-actions">
      <button class="text-button" data-toggle-endpoint="${esc(e.id)}" data-enabled="${e.enabled?'1':''}">${e.enabled?'выключить':'включить'}</button>
      <button class="text-button danger" data-drop-endpoint="${esc(e.id)}">удалить</button>
    </span>
  </div>`;
  const deliveryRow=(d)=>`<div class="person-event">
    <span><span>${esc(DELIVERY_STATUS[d.status]||d.status)}</span> · ${esc(d.topic||d.eventType||'')}${d.attempts?` · ${d.attempts} <span>попыт.</span>`:''}</span>
    <time>${esc(when(d.updatedAt||d.createdAt))}</time></div>`;

  modal('Интеграции',`
    <p class="muted">Каждое событие уходит подписанным запросом. Недоставленное повторяется с нарастающей паузой и не теряется.</p>
    <h3 class="person-section"><span>Подписки</span> — ${endpoints.length}</h3>
    ${endpoints.length?`<div class="label-list">${endpoints.map(endpointRow).join('')}</div>`:'<p class="muted">Подписок пока нет.</p>'}
    <h3 class="person-section">Последние доставки</h3>
    <div class="person-feed">${deliveries.length?deliveries.map(deliveryRow).join(''):'<p class="muted">Ничего ещё не отправлялось.</p>'}</div>
    <div class="stack" style="margin-top:16px"><button data-new-endpoint class="button secondary">Добавить подписку</button></div>
    <h3 class="person-section"><span>Мосты с Telegram</span> — ${bridges.length}</h3>
    <p class="muted">Беседа ChatX и чат в Telegram становятся одной перепиской через бота, которого вы туда добавите.</p>
    ${bridges.length?`<div class="label-list">${bridges.map(bridgeRow).join('')}</div>`:'<p class="muted">Мостов пока нет.</p>'}
    <div class="stack" style="margin-top:16px"><button data-new-bridge class="button secondary">Подключить Telegram</button></div>`,()=>{
    $('[data-new-endpoint]').onclick=()=>endpointFormModal(()=>replaceModal(integrationsModal));
    $('[data-new-bridge]').onclick=()=>telegramBridgeFormModal(()=>replaceModal(integrationsModal));
    $$('[data-drop-bridge]').forEach(b=>b.onclick=()=>{
      modal('Удалить мост?','<p class="muted">Сообщения перестанут ходить между ChatX и этим чатом Telegram. Уже написанное останется в обеих беседах.</p><button id="confirm-bridge-delete" class="button danger" style="width:100%">Удалить</button>',()=>{
        $('#confirm-bridge-delete').onclick=async()=>{
          try{await api(`/api/v1/integrations/telegram/${b.dataset.dropBridge}`,{method:'DELETE'});toast('Мост удалён');replaceModal(integrationsModal)}
          catch(error){toast(error.message)}
        };
      });
    });
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

/**
 * Личные API-ключи.
 *
 * Ключ действует от лица того, кто его выпустил, поэтому здесь нет
 * ролевой проверки вроде can('integration.manage') — это не настройка
 * компании, а личный инструмент, как сейф паролей: любой сотрудник
 * может завести ключ для своего собственного доступа к API.
 */
async function apiKeysModal(){
  let items=[];
  try{items=(await api('/api/v1/api-keys')).items||[]}
  catch(error){toast(error.message);return}
  const row=(k)=>`<div class="label-row">
    <span><div class="row-title">${esc(k.name)}</div>
      <div class="row-sub">${k.revokedAt?'<span>отозван</span> · ':''}${esc(k.keyPrefix)}…${k.readOnly?' · <span>только чтение</span>':''}${k.lastUsedAt?` · <span>использован</span> ${esc(when(k.lastUsedAt))}`:' · <span>ни разу не использован</span>'}</div></span>
    ${k.revokedAt?'':`<span class="inline-actions"><button class="text-button danger" data-drop-key="${esc(k.id)}">отозвать</button></span>`}
  </div>`;
  modal('API-ключи',`
    <p class="muted">Ключ работает как вы сами: те же права, что у вас в приложении, не шире. Секрет показывается один раз, сразу после создания, — потеряли его, заводите новый и отзывайте старый.</p>
    <div class="label-list">${items.length?items.map(row).join(''):'<p class="muted">Ключей пока нет.</p>'}</div>
    <div class="stack" style="margin-top:16px"><button data-new-key class="button secondary">Создать ключ</button></div>`,()=>{
    $('[data-new-key]').onclick=()=>apiKeyFormModal(()=>replaceModal(apiKeysModal));
    $$('[data-drop-key]').forEach(b=>b.onclick=()=>{
      modal('Отозвать ключ?','<p class="muted">Все запросы с этим ключом начнут получать отказ немедленно. Отменить нельзя — понадобится новый ключ.</p><button id="confirm-key-revoke" class="button danger" style="width:100%">Отозвать</button>',()=>{
        $('#confirm-key-revoke').onclick=async()=>{
          try{await api(`/api/v1/api-keys/${b.dataset.dropKey}`,{method:'DELETE'});toast(T('Ключ отозван','Key revoked'));replaceModal(apiKeysModal)}
          catch(error){toast(error.message)}
        };
      });
    });
  });
}
function apiKeyFormModal(after){
  modal('Новый API-ключ',`<form id="api-key-form" class="form-stack">
    <label>Название<input name="name" required maxlength="100" placeholder="Например: скрипт экспорта отчётов"></label>
    <label class="row" style="cursor:pointer"><input type="checkbox" name="readOnly">
      <span><div class="section-title">Только чтение</div><div class="row-sub">Ключ сможет только читать данные — ни одного изменяющего запроса</div></span></label>
    <button class="button primary">Создать</button>
  </form>`,()=>{
    $('#api-key-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const submit=event.currentTarget.querySelector('[type="submit"],button');if(submit)submit.disabled=true;
      try{
        const created=await api('/api/v1/api-keys',{method:'POST',body:JSON.stringify({name:form.get('name'),readOnly:form.get('readOnly')==='on'})});
        apiKeyRevealModal(created,after);
      }catch(error){toast(error.message);if(submit)submit.disabled=false}
    };
  });
}
function apiKeyRevealModal(created,after){
  modal('Ключ создан',`
    <p class="muted">Это единственный раз, когда ключ показан полностью. Скопируйте его сейчас — сервер хранит только хеш и не сможет показать его снова.</p>
    <div class="recovery-codes">${esc(created.key)}</div>
    <button id="api-key-copy" class="button secondary" style="width:100%;margin-top:10px">Скопировать</button>
    <button id="api-key-done" class="button primary" style="width:100%;margin-top:10px">Готово</button>`,()=>{
    $('#api-key-copy').onclick=async()=>{
      try{await navigator.clipboard.writeText(created.key);toast('Скопировано')}catch{toast('Не удалось скопировать — выделите текст вручную')}
    };
    $('#api-key-done').onclick=()=>{closeModal();after?.()};
  });
}

/**
 * Обзор беседы и предложенные ответы.
 *
 * То же правило, что и в Meeting Intelligence: ИИ ничего не решает и
 * ничего не отправляет сам. Обзор — это чтение вслух того, что уже
 * написано; предложенный ответ ложится в поле ввода, а не в ленту —
 * отправка остаётся отдельным, осознанным нажатием того, кто печатает.
 */
async function assistantSummarizeModal(){
  if(!S.selected)return toast('Откройте беседу.');
  modal('Обзор беседы','<p class="muted">Читаем последние сообщения…</p>',()=>{});
  try{
    const result=await api(`/api/v1/conversations/${S.selected}/assistant/summarize`,{method:'POST',body:JSON.stringify({})});
    replaceModal(()=>modal('Обзор беседы',`
      <p>${esc(result.summary)}</p>
      ${result.highlights?.length?`<h3 class="person-section">Важное</h3><ul class="stack" style="margin:0;padding-left:18px">${result.highlights.map(h=>`<li>${esc(h)}</li>`).join('')}</ul>`:''}
    `,()=>{}));
  }catch(error){
    closeModal();
    toast(error.code==='CHAT_ASSISTANT_UNAVAILABLE'?'Обзор беседы недоступен: ИИ-помощник не настроен на этом сервере':error.message);
  }
}
async function assistantSuggestModal(){
  if(!S.selected)return toast('Откройте беседу.');
  modal('Предложить ответ','<p class="muted">Придумываем варианты…</p>',()=>{});
  try{
    const result=await api(`/api/v1/conversations/${S.selected}/assistant/suggest-replies`,{method:'POST',body:JSON.stringify({})});
    replaceModal(()=>modal('Предложить ответ',`
      <p class="muted">Вариант только заполняет поле ввода — отправляете вы сами.</p>
      <div class="stack">${result.replies.map((text,i)=>`<button type="button" class="button secondary" style="text-align:left;white-space:normal;height:auto;padding:12px" data-suggested-reply="${i}">${esc(text)}</button>`).join('')}</div>
    `,()=>{
      $$('[data-suggested-reply]').forEach(b=>b.onclick=()=>{
        const input=$('#message-input');
        if(input){input.value=result.replies[Number(b.dataset.suggestedReply)];input.dispatchEvent(new Event('input',{bubbles:true}));input.focus()}
        closeModal();
      });
    }));
  }catch(error){
    closeModal();
    toast(error.code==='CHAT_ASSISTANT_UNAVAILABLE'?'Предложенные ответы недоступны: ИИ-помощник не настроен на этом сервере':error.message);
  }
}

function telegramBridgeFormModal(after){
  modal('Подключить Telegram',`<form id="telegram-bridge-form" class="form-stack">
    <p class="muted">1. Создайте бота через @BotFather в Telegram и добавьте его в нужную группу.<br>2. Узнайте ID группы (например, через @userinfobot) — обычно отрицательное число.<br>3. Вставьте токен бота сюда — он будет храниться зашифрованным и больше нигде не покажется.</p>
    <label>Беседа ChatX<select name="conversationId" class="field" required>${S.conversations.map(c=>`<option value="${esc(c.id)}">${esc(c.title||'Диалог')}</option>`).join('')}</select></label>
    <label>Токен бота<input name="botToken" required placeholder="123456:AAExampleTokenFromBotFather" autocomplete="off"></label>
    <label>ID чата Telegram<input name="chatId" required placeholder="-1001234567890"></label>
    <button class="button primary">Подключить</button>
  </form>`,()=>{
    $('#telegram-bridge-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const submit=event.currentTarget.querySelector('[type="submit"],button');if(submit)submit.disabled=true;
      try{
        await api('/api/v1/integrations/telegram',{method:'POST',body:JSON.stringify({conversationId:form.get('conversationId'),botToken:form.get('botToken'),chatId:form.get('chatId')})});
        history.back();setTimeout(()=>after?.(),250);
        toast('Мост подключён');
      }catch(error){toast(error.message);if(submit)submit.disabled=false}
    };
  });
}

// В форме предлагались два события, которых не бывает: `message.created`
// и `calendar.created` никогда не попадают в очередь исходящих — они
// живут только как мгновенная рассылка. Подписка на них создавалась,
// показывалась включённой и не срабатывала никогда.
const WEBHOOK_TOPICS=['task.created','task.transitioned','task.rescheduled','task.reassigned','task.evidence.added'];

function endpointFormModal(after){
  modal('Новая подписка',`<form id="endpoint-form" class="form-stack">
    <label>Название<input name="label" required maxlength="120" placeholder="Например: ERP компании"></label>
    <label>Адрес<input name="url" type="url" required placeholder="https://erp.example.ru/hooks/chat"></label>
    <div><div class="section-title">События</div>
      <div class="label-grid">${WEBHOOK_TOPICS.map(t=>`<label class="label-option"><input type="checkbox" name="topics" value="${t}"> <span class="label-chip" data-colour="blue">${esc(t)}</span></label>`).join('')}</div></div>
    <p class="muted">Секрет для подписи покажут один раз — сохраните его сразу.</p>
    <button class="button primary">Создать</button>
  </form>`,()=>{
    $('#endpoint-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      const topics=form.getAll('topics');
      if(!topics.length)return toast(T('Выберите хотя бы одно событие','Choose at least one event'));
      try{
        const{endpoint}=await api('/api/v1/integrations/webhooks',{method:'POST',body:JSON.stringify({
          label:form.get('label'),url:form.get('url'),topics,
        })});
        // Вызванный сразу же, `after` (обновление списка подписок)
        // стирал только что показанный секрет тем же кадром — раньше, чем
        // человек успевал его увидеть, не то что скопировать. Список сам
        // освежится штатно: «‹» назад к списку — обычный popstate, и
        // resumeTop() вызовет refresh, который уже хранит integrationsModal.
        replaceModal(()=>modal('Подписка создана',`
          <p class="muted">Секрет показывают один раз. Он подписывает каждый запрос — сохраните его сейчас.</p>
          <input id="endpoint-secret" class="field" readonly value="${esc(endpoint.secret||'')}">
          <button data-copy class="button primary" style="width:100%;margin-top:12px">Скопировать</button>`,()=>{
          $('[data-copy]').onclick=async()=>{
            try{await navigator.clipboard.writeText($('#endpoint-secret').value);toast('Секрет скопирован')}
            catch{$('#endpoint-secret').select()}
          };
        }));
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
    ${personAvatar(p)}
    <span>
      <div class="row-title">${esc(p.displayName||p.email)}</div>
      <div class="row-sub"><span>${esc(p.title||PRESENCE[p.presenceState]||'должность не указана')}</span>${note?` · ${note}`:''}</div>
    </span>
    <span class="chip">${esc(WORKSPACE_ROLE[p.workspaceRole]||p.workspaceRole||'')}</span>
  </button>`;

  const shared=(p)=>{
    const parts=[];
    if(p.hasDirect)parts.push('<span>личный чат</span>');
    parts.push(`${p.sharedCount} <span>${pluralIn(p.sharedCount,['общая беседа','общие беседы','общих бесед'],['shared conversation','shared conversations'])}</span>`);
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
const when=(v)=>v?new Intl.DateTimeFormat(locale()==='en'?'en-GB':'ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'';

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
      ${personAvatar(person)}
      <div>
        <div class="row-title">${esc(person.title||'Должность не указана')}</div>
        <div class="row-sub"><span>${esc(person.department||'Подразделение не указано')}</span> · <span>${esc(PRESENCE[person.presenceState]||'не в сети')}</span></div>
        ${availabilityChip({availability:person.availability,backAt:person.backAt})}
      </div>
    </div>
    <div class="person-fields">
      ${field('Почта',person.email)}
      ${field('Роль в системе',WORKSPACE_ROLE[person.workspaceRole]??person.workspaceRole)}
      ${field('Город',person.location)}
      ${field('Телефон',person.phone)}
      ${field('В команде с',person.startedOn?String(person.startedOn).slice(0,10):null)}
      ${field('День рождения',person.birthDay?`${person.birthDay} ${MONTHS_GENITIVE[person.birthMonth-1]}`:null)}
      ${field('Часовой пояс',person.timezone)}
    </div>
    ${person.about?`<p class="person-about">${esc(person.about)}</p>`:''}
    <h3 class="person-section">Подразделения</h3><div class="person-chips">${units}</div>
    <h3 class="person-section">Подчиняется</h3><div class="person-chips">${reports}</div>
    <h3 class="person-section"><span>Задачи в работе</span> — ${person.workload.open}</h3><div class="person-chips">${load}</div>
    <!--
      История действий свёрнута по умолчанию. Это самый длинный блок
      карточки, и открывают её обычно не ради него: нужны должность,
      телефон, подразделение и чем человек занят сейчас. Развёрнутая
      история отодвигала всё это за край экрана.
    -->
    <details class="person-history"${activity.length?'':' open'}>
      <summary><span>История действий</span>${activity.length?` — ${activity.length}`:''}</summary>
      <div class="person-feed">${feed}</div>
    </details>
    ${person.disabledAt?`<p class="person-about">Сотрудник уволен ${esc(when(person.disabledAt))}. Доступ закрыт, история работы сохранена.</p>`:''}
    ${!person.isSelf&&can('member.invite')?'<div class="stack" style="margin-top:16px"><button data-reset class="button secondary">Выписать ссылку для смены пароля</button></div>':''}
    ${!person.isSelf&&person.workspaceRole!=='owner'&&can('member.manage')?`
    ${person.disabledAt?'':`<h3 class="person-section">Роль в компании</h3>
      <p class="muted">Назначить можно роль ниже своей. Человек выйдет из своих сеансов и войдёт заново — уже с новыми правами. Всё, что за ним числится, остаётся при нём.</p>
      <form id="person-role" class="row flow" style="margin-top:8px;gap:8px">
        <select name="role" class="input" style="flex:1 1 160px">
          ${['guest','member','manager','admin'].map(r=>`<option value="${r}"${person.workspaceRole===r?' selected':''}>${esc(WORKSPACE_ROLE[r]??r)}</option>`).join('')}
        </select>
        <button class="button secondary pressable">${esc(T('Назначить','Assign'))}</button>
      </form>`}
    <div class="stack" style="margin-top:10px">${person.disabledAt
      ?'<button data-employ class="button secondary">Вернуть на работу</button>'
      :'<button data-dismiss class="button danger">Уволить</button>'}</div>`:''}
    ${person.isSelf?'<div class="stack" style="margin-top:16px"><button data-edit class="button secondary">Редактировать карточку</button><button data-push class="button secondary">Включить push</button><button data-logout class="button danger">Выйти</button></div>':''}
  `,()=>{
    const reset=$('[data-reset]');
    if(reset)reset.onclick=()=>issueResetModal(person);
    const roleForm=$('#person-role');
    if(roleForm)roleForm.onsubmit=async(event)=>{
      event.preventDefault();
      const role=new FormData(event.currentTarget).get('role');
      if(role===person.workspaceRole){toast('Эта роль у человека уже есть');return}
      const button=event.currentTarget.querySelector('button');
      button.disabled=true;
      try{
        await api(`/api/v1/people/${person.userId}/role`,{method:'PUT',body:JSON.stringify({role})});
        toast(locale()==='en'?`${person.displayName||person.email} is now ${WORKSPACE_ROLE[role]??role}`:`${person.displayName||person.email} теперь ${WORKSPACE_ROLE[role]??role}`);
        S.people=(await api('/api/v1/bootstrap')).people||S.people;closeModal();personPage(person.userId);
      }catch(error){button.disabled=false;toast(ERROR_MESSAGE[error.code]||error.message)}
    };
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
    <p class="muted"><span>Ссылка позволит</span> ${esc(person.displayName||person.email)} <span>задать новый пароль. Она живёт сутки, срабатывает один раз и обрывает все открытые сессии этого человека.</span></p>
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
    ${input('birthday','День рождения (ДД.ММ)',person.birthDay?`${person.birthDay}.${person.birthMonth}`:'')}
    <p class="muted" style="margin:-4px 0 0;font-size:12px">Год не спрашиваем: поздравить нужно в правильный день, а возраст — ваше дело.</p>
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
async function send(){const i=$('#message-input'),body=i?.value.trim();if(!body)return;i.value='';writeDraft(S.selected,'');try{const{message}=await api(`/api/v1/conversations/${S.selected}/messages`,{method:'POST',body:JSON.stringify({body,replyToId:S.reply?.id||null})});append(S.selected,message);S.reply=null;render()}catch(e){toast(e.message)}}
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
          openChatFromSheet(b.dataset.goConversation);
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
    ${existing?'<button type="button" class="button danger" id="note-delete">Удалить заметку</button>':''}
  </form>`,()=>{
    let kind=existing?.kind??'note';
    const del=$('#note-delete');
    if(del)del.onclick=async()=>{
      del.disabled=true;
      try{await api(`/api/v1/message-notes/${existing.id}`,{method:'DELETE'});await loadMarks();closeModal();render();toast(T('Заметка удалена','Note deleted'))}
      catch(error){del.disabled=false;toast(error.message)}
    };
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
/**
 * Упоминание набирается как «@handle» — техническая часть почты, а не
 * имя человека. Без замены на отображаемое имя переписка читалась как
 * набор логинов: «@cancelui-yg7qwk» вместо «Иван Партнёр».
 */
const mentionHandleOf=(person)=>String(person.email||'').split('@')[0].replace(/[^\p{L}\p{N}._-]/gu,'').toLowerCase()||String(person.displayName||'').toLowerCase().replace(/\s+/g,'.');
function escWithMentions(text){
  const escaped=esc(text);
  if(!S.people?.length)return escaped;
  return escaped.replace(/@([\p{L}\p{N}._-]{1,40})/gu,(full,handle)=>{
    const person=S.people.find(p=>mentionHandleOf(p)===handle.toLowerCase());
    return person?`<span class="mention-chip">@${esc(person.displayName||person.email)}</span>`:full;
  });
}
function bodyWithHighlights(m){
  const text=m.body||kindLabel(m.kind)||'';
  const marks=(S.highlights?.get(m.id)||[])
    .filter(h=>text.slice(h.startOffset,h.endOffset)===h.quote)
    .sort((a,b)=>a.startOffset-b.startOffset);
  if(!marks.length)return escWithMentions(text);
  let out='',cursor=0;
  for(const h of marks){
    if(h.startOffset<cursor)continue;
    out+=escWithMentions(text.slice(cursor,h.startOffset));
    out+=`<mark class="hl hl-${esc(h.colour)}" data-highlight="${esc(h.id)}" title="Выделено вами — нажмите, чтобы снять">${escWithMentions(text.slice(h.startOffset,h.endOffset))}</mark>`;
    cursor=h.endOffset;
  }
  return out+escWithMentions(text.slice(cursor));
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
    ['link','Скопировать ссылку','🔗'],
    ...((S.highlights?.get(message.id)||[]).length?[['unhighlight','Снять выделение',msgIcon.pin]]:[]),
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
      label:()=>replaceModal(()=>labelPicker('message',messageId,{title:T('Метки сообщения','Message labels')})),
      pin:()=>{closeModal();togglePin(messageId,!message.pinned)},
      task:()=>replaceModal(()=>taskModal(messageId,(message.body||'').trim().slice(0,120))),
      unhighlight:async()=>{
        closeModal();
        try{
          for(const h of S.highlights?.get(messageId)||[])await api(`/api/v1/highlights/${h.id}`,{method:'DELETE'});
          await loadMarks();render();toast(T('Выделение снято','Highlight removed'));
        }catch(error){toast(error.message)}
      },
      link:async()=>{
        closeModal();
        const url=`${location.origin}/#/chats/${S.selected}?message=${messageId}`;
        try{await navigator.clipboard.writeText(url);toast(T('Ссылка скопирована','Link copied'))}
        catch{toast(url)}
      },
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
/**
 * Что было до правки.
 *
 * Пометка «изменено» была подсказкой на наведение мыши — на телефоне её
 * не увидеть вовсе, а главное, она не отвечала на единственный вопрос,
 * который возникает: что там стояло раньше.
 */
/**
 * Ветка под сообщением.
 *
 * Столбец под неё был в схеме с самого начала и не читался ни разу:
 * ответ падал в общий поток вперемешку с остальным, и разбор одного
 * вопроса растворялся в переписке дня. Теперь в ленте стоит корень со
 * счётчиком, а разговор идёт здесь.
 */
/** Что показывать в архиве беседы и как это назвать. */
const MATERIAL_KINDS=[['all','Все'],['photo','Фото'],['video','Видео'],['link','Ссылки'],['forward','Переносы'],['file','Файлы'],['voice','Голосовые']];

/**
 * Материалы беседы.
 *
 * Фотографии, акты и ссылки копились в ленте и находились только
 * прокруткой: «где та фотография акта» на полугодовой переписке — это
 * десять минут листания.
 */
/**
 * Сторис: как выглядит работа сегодня.
 *
 * Привезли, залили, смонтировали — показать это было негде:
 * фотография уходила в беседу и через день тонула под перепиской.
 * Живут сутки, снятое остаётся в личном архиве.
 */
/**
 * Решения компании.
 *
 * Принятое на встрече решение оставалось внутри её карточки: чтобы
 * вспомнить, что решили по объекту, надо было помнить, на какой именно
 * встрече. Через полгода этого не помнит никто, и спор начинается
 * заново.
 */
/**
 * Протокол встречи, у которой не было записи.
 *
 * Разбор с расшифровкой есть только у записанного звонка. Совещание в
 * кабинете, планёрка на объекте, разговор с заказчиком по телефону
 * проходили мимо: договорились и разошлись, а через месяц каждый
 * помнит своё.
 */
/**
 * Адрес протокола.
 *
 * У вхождения серии опознаватель составной — «событие@момент», — а в
 * моменте двоеточия, которых в пути быть не может. Кодируем только
 * хвост: собака разделяет части и должна остаться собой.
 */
function notesPath(eventId){
  const [seriesId,occurrenceAt]=String(eventId).split('@');
  return occurrenceAt?`${seriesId}@${encodeURIComponent(occurrenceAt)}`:seriesId;
}
async function notesModal(eventId,eventTitle=''){
  let notes=null;
  let failed=null;
  try{notes=(await api(`/api/v1/calendar-events/${notesPath(eventId)}/notes`)).notes}
  catch(error){failed=ERROR_MESSAGE[error.code]||error.message}

  const list=(values)=>(values||[]).join('\n');
  modal('Протокол',`
    ${failed?`<div class="empty"><strong>Протокол недоступен</strong>${esc(failed)}</div>`:`
    <p class="muted">${notes?`Записал(а) ${esc(notes.createdByName||'кто-то из участников')}, ${esc(dateTime(notes.updatedAt))}.`
      :'Протокола ещё нет. Он виден тем же людям, что и сама встреча.'}</p>
    <form id="notes-form" class="form-stack">
      <label>Название<input name="title" maxlength="240" value="${esc(notes?.title||eventTitle||'')}"></label>
      <label>Что обсуждали<textarea name="notes" rows="5" maxlength="20000">${esc(notes?.notes||'')}</textarea></label>
      <label>Решения — по одному в строке<textarea name="decisions" rows="3" placeholder="Берём подрядчика Б">${esc(list(notes?.decisions))}</textarea></label>
      <label>Что делаем — по одному в строке<textarea name="actionItems" rows="3" placeholder="Заказать пересчёт сметы">${esc(list(notes?.actionItems))}</textarea></label>
      <button class="button primary pressable" type="submit">Сохранить протокол</button>
    </form>
    ${notes?.actionItems?.length?`<h3 class="person-section">Из пунктов — задачи</h3>
      <p class="muted">Пока у пункта нет владельца и срока, это не договорённость, а благое намерение.</p>
      ${notes.actionItems.map((item,index)=>{
        // Рядом написано, что без владельца и срока это благое намерение
        // — а кнопка ровно его и делала: задача падала на того, кто вёл
        // протокол, и без срока. Спрашиваем здесь же, не уводя с экрана.
        const done=(notes.committed||[]).includes(index);
        return `<div class="row" style="align-items:flex-start;gap:8px;flex-wrap:wrap">
        <span style="flex:1 1 160px"><div class="row-title">${esc(item)}</div>
          ${done?'<div class="row-sub">уже поручено</div>':''}</span>
        ${done?'<span class="chip">в задачах</span>':`
        <select data-commit-owner="${index}" class="input small" style="flex:0 1 150px">
          <option value="">кому — выберите</option>
          ${S.people.filter(p=>p.role!=='guest'&&p.active!==false).map(p=>`<option value="${esc(p.userId)}"${p.userId===me().userId?' selected':''}>${esc(p.displayName||p.email)}</option>`).join('')}
        </select>
        <input type="date" data-commit-date="${index}" class="input small" style="flex:0 1 140px">
        <button type="button" class="button small secondary pressable" data-commit="${index}">В задачу</button>`}</div>`;
      }).join('')}`:''}
    <p class="muted" style="margin-top:12px;font-size:12px">Решения отсюда попадают в общий список решений компании — искать их потом можно там.</p>`}
  `,()=>{
    const form=$('#notes-form');
    if(form)form.onsubmit=async(event)=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      button.disabled=true;
      const data=new FormData(form);
      const rows=(value)=>String(value||'').split('\n').map(x=>x.trim()).filter(Boolean);
      try{
        await api(`/api/v1/calendar-events/${notesPath(eventId)}/notes`,{method:'PUT',body:JSON.stringify({
          title:data.get('title')||eventTitle||'Встреча',
          notes:data.get('notes')||null,
          decisions:rows(data.get('decisions')),
          actionItems:rows(data.get('actionItems')),
        })});
        toast('Протокол сохранён');
        closeModal();notesModal(eventId,eventTitle);
      }catch(error){button.disabled=false;toast(ERROR_MESSAGE[error.code]||error.message)}
    };
    $$('[data-commit]').forEach(button=>button.onclick=async()=>{
      button.disabled=true;
      try{
        const index=Number(button.dataset.commit);
        const owner=$(`[data-commit-owner="${index}"]`)?.value||null;
        const day=$(`[data-commit-date="${index}"]`)?.value||null;
        const{task}=await api(`/api/v1/calendar-events/${notesPath(eventId)}/notes/commit`,{method:'POST',
          body:JSON.stringify({index,ownerId:owner,promisedAt:day?new Date(`${day}T18:00:00`).toISOString():null})});
        toast(`Задача создана: ${task.title}`);
        if(!S.tasks.some(x=>x.id===task.id))S.tasks.unshift(task);
        // Перерисовываем: пункт должен отметиться как уже поручённый,
        // иначе вторая попытка заведёт вторую такую же задачу.
        closeModal();notesModal(eventId,eventTitle);
      }catch(error){button.disabled=false;toast(ERROR_MESSAGE[error.code]||error.message)}
    });
  });
}

async function decisionsModal(query=''){
  let items=[];
  let failed=null;
  try{items=(await api(`/api/v1/meetings/decisions${query?`?q=${encodeURIComponent(query)}`:''}`)).items||[]}
  catch(error){failed=ERROR_MESSAGE[error.code]||error.message}

  modal('Решения',failed?`<div class="empty"><strong>Решения недоступны</strong>${esc(failed)}</div>`:`
    <p class="muted">Только принятые решения со встреч, где вы были. Предложенное — ещё не решение, отклонённое им не стало.</p>
    <form id="decisions-search" class="form-stack">
      <label>Найти<input name="q" value="${esc(query)}" placeholder="Например: СГ-114"></label>
    </form>
    ${items.length?items.map(d=>`<div class="row">
        <span><div class="row-title">${esc(d.title)}</div>
          ${d.body?`<div class="row-sub">${esc(d.body)}</div>`:''}
          <div class="row-sub">${esc(dateTime(d.acceptedAt))}${d.acceptedByName?` · <span>записал(а)</span> ${esc(d.acceptedByName)}`:''}${
            d.callTitle?` · ${esc(d.callTitle)}`:''}</div></span>
        ${d.conversationId?`<button type="button" class="button small secondary pressable" data-decision-room="${esc(d.conversationId)}">К беседе</button>`:''}
      </div>`).join('')
      :`<p class="muted">${query?'По этому слову решений нет.':'Принятых решений пока нет. Они появляются, когда на разборе встречи отмечают «Зафиксировать».'}</p>`}
  `,()=>{
    if(failed)return;
    const form=$('#decisions-search');
    form.onsubmit=(event)=>{event.preventDefault();closeModal();decisionsModal(new FormData(form).get('q')||'')};
    $$('[data-decision-room]').forEach(button=>button.onclick=()=>openChatFromSheet(button.dataset.decisionRoom));
  });
}

async function storiesModal(tab='live'){
  let items=[];
  let failed=null;
  try{items=(await api(tab==='live'?'/api/v1/stories':'/api/v1/stories/archive')).items||[]}
  catch(error){failed=ERROR_MESSAGE[error.code]||error.message}

  const card=(s)=>`<div class="story-card${s.seen?'':' unseen'}">
    <img src="${esc(s.url)}" alt="" loading="lazy">
    <div class="story-meta">
      <div class="row-title">${esc(s.authorName||name(s.authorId))}</div>
      ${s.caption?`<div class="row-sub">${esc(s.caption)}</div>`:''}
      <div class="row-sub">${esc(dateTime(s.createdAt))}${tab==='archive'?(s.live?` · ${T('идёт','live')}`:` · ${T('погасла','expired')}`):''}${
        s.authorId===me().userId?` · ${s.views} ${pluralIn(s.views,['просмотр','просмотра','просмотров'],['view','views'])}`:''}</div>
      <div class="inline-actions">
        ${s.authorId===me().userId?`<button type="button" class="button small ghost pressable" data-story-viewers="${esc(s.id)}">Кто смотрел</button>
        ${tab==='archive'&&!s.live?'':`<button type="button" class="button small danger pressable" data-story-remove="${esc(s.id)}">Убрать</button>`}`:''}
      </div>
    </div></div>`;

  modal('Сторис',failed?`<div class="empty"><strong>Сторис недоступны</strong>${esc(failed)}</div>`:`
    <div class="chip-row">
      <button class="chipbtn pressable${tab==='live'?' active':''}" data-story-tab="live">Сейчас</button>
      <button class="chipbtn pressable${tab==='archive'?' active':''}" data-story-tab="archive">Мой архив</button>
    </div>
    <form id="story-form" class="form-stack">
      <label>Снимок<input name="photo" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" required></label>
      <label>Подпись<input name="caption" maxlength="300" placeholder="Залили плиту на СГ-114"></label>
      <button class="button primary pressable" type="submit">Опубликовать на сутки</button>
    </form>
    ${items.length?`<div class="story-grid">${items.map(card).join('')}</div>`
      :`<p class="muted">${tab==='live'?'Сейчас никто ничего не показывает.':'Вы пока ничего не публиковали. Снятое остаётся здесь и после того, как сторис погасла.'}</p>`}
  `,()=>{
    if(failed)return;
    $$('[data-story-tab]').forEach(button=>button.onclick=()=>{closeModal();storiesModal(button.dataset.storyTab)});
    $$('[data-story-remove]').forEach(button=>button.onclick=async()=>{
      button.disabled=true;
      try{await api(`/api/v1/stories/${button.dataset.storyRemove}`,{method:'DELETE'});toast('Убрали');closeModal();storiesModal(tab)}
      catch(error){button.disabled=false;toast(error.message)}
    });
    $$('[data-story-viewers]').forEach(button=>button.onclick=async()=>{
      try{
        const{items:viewers}=await api(`/api/v1/stories/${button.dataset.storyViewers}/viewers`);
        modal('Кто смотрел',viewers.length
          ?viewers.map(v=>`<div class="row">${personAvatar(v.userId,v.displayName)}
            <span><div class="row-title">${esc(v.displayName)}</div>
              <div class="row-sub">${esc(dateTime(v.seenAt))}</div></span></div>`).join('')
          :'<p class="muted">Пока никто.</p>');
      }catch(error){toast(error.message)}
    });

    // Отметку о просмотре ставим, когда снимок действительно показался
    // на экране: «загрузил страницу» — это не «посмотрел».
    if(tab==='live'&&'IntersectionObserver'in window){
      const watcher=new IntersectionObserver((entries)=>{
        for(const entry of entries){
          if(!entry.isIntersecting)continue;
          const id=entry.target.dataset.storyId;
          watcher.unobserve(entry.target);
          api(`/api/v1/stories/${id}/seen`,{method:'POST',body:'{}'}).catch(()=>{});
        }
      },{threshold:0.6});
      items.forEach((s,index)=>{
        const node=$$('.story-card')[index];
        if(!node||s.authorId===me().userId)return;
        node.dataset.storyId=s.id;
        watcher.observe(node);
      });
    }

    const form=$('#story-form');
    form.onsubmit=async(event)=>{
      event.preventDefault();
      const file=form.querySelector('[name="photo"]').files[0];
      if(!file)return toast('Выберите снимок.');
      const button=form.querySelector('button[type="submit"]');
      button.disabled=true;
      try{
        const fileId=await uploadPicture(file);
        await api('/api/v1/stories',{method:'POST',body:JSON.stringify({fileId,caption:new FormData(form).get('caption')||null})});
        toast(T('Опубликовано','Published'));
        closeModal();storiesModal('live');
      }catch(error){button.disabled=false;toast(ERROR_MESSAGE[error.code]||error.message)}
    };
  });
}

async function materialsModal(kind='all',conversationId=S.selected){
  if(!conversationId)return toast('Сначала откройте беседу.');
  let items=[];
  let failed=null;
  try{items=(await api(`/api/v1/conversations/${conversationId}/archive?kind=${kind}&limit=100`)).items||[]}
  catch(error){failed=ERROR_MESSAGE[error.code]||error.message}

  const line=(m)=>{
    const from=m.externalOrigin
      ?`<span class="chip warm">из ${esc(SOURCE_WORD[m.externalOrigin.source]||'мессенджера')}${m.externalOrigin.authorName?` · ${esc(m.externalOrigin.authorName)}`:''}</span>`
      :m.forwardedInside?'<span class="chip">переслано внутри</span>':'';
    const what=m.fileId
      ?`<a href="/api/v1/files/${esc(m.fileId)}/content">${esc(m.fileName||'файл')}</a> <span class="row-sub">${fileMeta({mimeType:m.mimeType,size:m.sizeBytes})}</span>`
      :esc((m.body||kindLabel(m.kind)||'').slice(0,200));
    return `<button type="button" class="row pressable" data-material="${esc(m.id)}">
      <span><div class="row-title">${what}</div>
        <div class="row-sub">${esc(name(m.authorId))} · ${esc(dateTime(m.createdAt))}</div>
        ${from?`<div class="chip-row">${from}</div>`:''}</span></button>`;
  };

  modal('Материалы',`
    <div class="chip-row">${MATERIAL_KINDS.map(([key,caption])=>
      `<button class="chipbtn pressable${key===kind?' active':''}" data-material-kind="${key}">${caption}</button>`).join('')}</div>
    ${failed?`<div class="empty"><strong>Материалы недоступны</strong>${esc(failed)}</div>`
      :items.length?items.map(line).join('')
      :'<p class="muted">Здесь пока ничего нет. Сюда попадают фотографии, файлы, ссылки и всё, что перенесли из других мессенджеров.</p>'}
  `,()=>{
    $$('[data-material-kind]').forEach(button=>button.onclick=()=>{closeModal();materialsModal(button.dataset.materialKind,conversationId)});
    $$('[data-material]').forEach(button=>button.onclick=()=>{
      closeModal();
      openChatAtMessage(conversationId,button.dataset.material);
    });
  });
}

/**
 * Перенос переписки из WhatsApp или Telegram.
 *
 * Копировали и раньше — но в беседе оставалось «прислали смету», без
 * автора, без даты и без следа, откуда это. Теперь источник, имя и
 * время сохраняются рядом с текстом, и по ним можно отфильтровать
 * архив.
 */
function importModal(conversationId=S.selected){
  if(!conversationId)return toast('Сначала откройте беседу.');
  modal('Перенести переписку',`
    <p class="muted">Скопируйте кусок разговора в мессенджере и вставьте сюда целиком — служебные строки с именем и временем разберутся сами.</p>
    <form id="import-form" class="form-stack">
      <label>Откуда<select name="source" class="field">
        <option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option>
        <option value="sms">СМС</option><option value="email">Почта</option><option value="other">Другое</option>
      </select></label>
      <label>Текст<textarea name="text" rows="7" maxlength="8000" placeholder="[21.09.2026, 19:40] Олег: Смету пересчитал" required></textarea></label>
      <label>Кто это написал<input name="authorName" maxlength="120" placeholder="Если в тексте имени нет"></label>
      <button class="button primary pressable" type="submit">Перенести в беседу</button>
    </form>
  `,()=>{
    const form=$('#import-form');
    form.onsubmit=async(event)=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      button.disabled=true;
      const data=new FormData(form);
      try{
        const{message}=await api(`/api/v1/conversations/${conversationId}/external-forwards`,{method:'POST',body:JSON.stringify({
          source:data.get('source'),
          text:data.get('text'),
          authorName:data.get('authorName')||null,
          // Пояс того, кто переносит: в выгрузке мессенджера его нет.
          offsetMinutes:new Date().getTimezoneOffset(),
        })});
        append(conversationId,message);
        closeModal();render();
        toast('Перенесено с отметкой об источнике');
      }catch(error){button.disabled=false;toast(ERROR_MESSAGE[error.code]||error.message)}
    };
  });
}

async function threadModal(rootId,conversationId=S.selected){
  const load=async()=>{
    const{items}=await api(`/api/v1/conversations/${conversationId}/messages?thread=${rootId}&limit=200`);
    return items||[];
  };
  let items=[];
  try{items=await load()}
  catch(error){return toast(ERROR_MESSAGE[error.code]||error.message)}
  const root=items[0];
  const replies=items.slice(1);

  const line=(m)=>`<div class="row">${personAvatar(m.authorId,name(m.authorId))}
    <span><div class="row-title">${esc(name(m.authorId))} · ${esc(time(m.createdAt))}</div>
      <div class="row-sub">${m.deletedAt?'Сообщение удалено':esc(m.body||kindLabel(m.kind)||'')}</div></span></div>`;

  modal('Ветка',`
    <div class="thread-root">${line(root)}</div>
    <div class="section-head"><div><h3>Ответы</h3>
      <p class="muted">${replies.length?'Здесь разбирают один вопрос — в общей ленте их не видно.':'Ответов пока нет. Первый начнёт разбор, не засоряя общую ленту.'}</p></div></div>
    ${replies.map(line).join('')}
    <form id="thread-reply" class="form-stack">
      <label>Ответ<textarea name="body" rows="3" maxlength="4000" placeholder="Что вы об этом думаете" required></textarea></label>
      <button class="button primary pressable" type="submit">Ответить в ветке</button>
    </form>
  `,()=>{
    const form=$('#thread-reply');
    form.onsubmit=async(event)=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      button.disabled=true;
      try{
        await api(`/api/v1/conversations/${conversationId}/messages`,{method:'POST',
          body:JSON.stringify({body:new FormData(form).get('body'),threadRootId:rootId})});
        // Счётчик под корнем в ленте должен сойтись с тем, что человек
        // только что написал, поэтому перечитываем и ленту тоже.
        await loadMessages(conversationId,{force:true});
        closeModal();
        threadModal(rootId,conversationId);
        render();
      }catch(error){button.disabled=false;toast(ERROR_MESSAGE[error.code]||error.message)}
    };
  });
}

async function messageHistoryModal(id){
  let items=[];
  try{items=(await api(`/api/v1/messages/${id}/versions`)).items||[]}
  catch(error){return toast(error.message)}
  const current=(S.messages.get(S.selected)||[]).find(m=>m.id===id);
  modal('История правок',`<div class="stack">
    <div><div class="section-title">Сейчас</div><p class="muted">${esc(current?.body||'')}</p></div>
    ${items.length?items.map(v=>`<div><div class="row-title">До ${esc(dateTime(v.replacedAt))}${v.editedByName?` · ${esc(v.editedByName)}`:''}</div>
      <p class="muted">${esc(v.body||'(пусто)')}</p></div>`).join('')
      :'<p class="muted">Прежних редакций не сохранилось: сообщение правили до того, как история стала записываться.</p>'}
  </div>`);
}

function forwardModal(id){const targets=S.conversations.filter(c=>!c.archivedAt);modal('Переслать сообщение',targets.map(c=>`<button class="conversation-card" data-forward-target="${c.id}">${roomAvatar(c)}<span><strong>${esc(c.title||'Диалог')}</strong><div class="preview">${esc(c.purpose||'')}</div>${c.purpose?'':'<div class="preview preview-empty">Переслать сюда</div>'}</span></button>`).join('')||'<div class="empty">Нет доступных разговоров.</div>');$$('[data-forward-target]').forEach(b=>b.onclick=async()=>{try{const{message}=await api(`/api/v1/messages/${id}/forward`,{method:'POST',body:JSON.stringify({conversationId:b.dataset.forwardTarget})});append(b.dataset.forwardTarget,message);closeModal();toast('Сообщение переслано')}catch(e){toast(e.message)}})}
function editMessageModal(id){const m=[...S.messages.values()].flat().find(x=>x.id===id);if(!m)return;modal('Изменить сообщение',`<form id="message-edit-form" class="form-stack"><label>Текст<textarea name="body" rows="5" required>${esc(m.body||'')}</textarea></label><button class="button primary">Сохранить</button></form>`);$('#message-edit-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(!String(f.get('body')||'').trim())return toast('Введите текст сообщения');try{const{message}=await api(`/api/v1/messages/${id}`,{method:'PATCH',body:JSON.stringify({body:f.get('body')})});updateMessage(id,message);closeModal();render();toast('Сообщение изменено')}catch(error){toast(error.message)}}}
function deleteMessageModal(id){modal('Удалить сообщение',`<p class="muted">Сообщение останется в истории как удалённое, но его содержимое больше не будет показываться.</p><button id="confirm-message-delete" class="button danger" style="width:100%">Удалить</button>`);$('#confirm-message-delete').onclick=async()=>{try{const{message}=await api(`/api/v1/messages/${id}`,{method:'DELETE'});updateMessage(id,message);closeModal();render();toast('Сообщение удалено')}catch(e){toast(e.message)}}}
async function pinsModal(){
  if(!S.selected)return toast('Откройте чат.');
  const conversationId=S.selected;
  const draw=(items)=>{
    modal('Закреплённые сообщения',items.length?items.map(m=>`<div class="pin-row">
      <button class="conversation-card" data-jump-message="${esc(m.id)}">${personAvatar(m.authorId,name(m.authorId))}<span><strong>${esc(name(m.authorId))}</strong><div class="preview">${m.body?escWithMentions(m.body):esc(kindLabel(m.kind)||'Вложение')}</div></span><span class="time">${esc(time(m.createdAt))}</span></button>
      <button class="text-button danger" data-unpin="${esc(m.id)}">Открепить</button>
    </div>`).join(''):'<div class="empty">Закреплённых сообщений пока нет.</div>',()=>{
      $$('[data-jump-message]').forEach(b=>b.onclick=()=>{closeModal();document.querySelector(`[data-message-row="${b.dataset.jumpMessage}"]`)?.scrollIntoView({behavior:'smooth',block:'center'})});
      $$('[data-unpin]').forEach(b=>b.onclick=async()=>{
        b.disabled=true;
        try{
          await api(`/api/v1/messages/${b.dataset.unpin}/pin`,{method:'DELETE'});
          updateMessage(b.dataset.unpin,{pinned:false});
          const{items:left}=await api(`/api/v1/conversations/${conversationId}/pins`);
          // history.back() открывает popstate не сразу, а draw() тут же
          // толкает новую запись в overlayStack — отложенный popstate
          // потом снимал не тот слой. replaceModal меняет текущий синхронно.
          replaceModal(()=>draw(left));
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
async function archivedModal(){try{const{items}=await api('/api/v1/conversations/archived');modal('Архив чатов',items.length?items.map(c=>`<div class="row">${roomAvatar(c)}<span><div class="row-title">${esc(c.title||'Диалог')}</div><div class="row-sub">${c.purpose?esc(c.purpose):'<span>Архивировано только для вас</span>'}</div></span><button class="button secondary small" data-restore-conversation="${c.id}">Вернуть</button></div>`).join(''):'<div class="empty">Архив пуст.</div>');$$('[data-restore-conversation]').forEach(b=>b.onclick=async()=>{try{await api(`/api/v1/conversations/${b.dataset.restoreConversation}/preferences`,{method:'PATCH',body:JSON.stringify({archived:false})});const restored=items.find(x=>x.id===b.dataset.restoreConversation);if(restored)rememberConversation({...restored,archivedAt:null});toast('Чат возвращён');await archivedModal();lists()}catch(e){toast(e.message)}})}catch(e){toast(e.message)}}
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
  // Кружки людей есть и внутри листов — в участниках, в команде, в задаче.
  bindPeopleAvatars();
  top.after?.();
  // Move focus into the dialog: the first thing a person types belongs to the
  // sheet they just opened, not to the page behind it.
  const dialog=$('.modal');
  const first=dialog?.querySelector('input,textarea,select,button:not([data-close]):not([data-back]):not([data-skip-autofocus])');
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
// Название игры — не пара «русский текст → словарь», а прямой выбор по
// языку (gameName()), потому что стоит внутри .row-title, который
// словарь и его MutationObserver нарочно не трогают (там обычно имя
// человека, а не системная надпись). За это приходится расплачиваться
// самим: переключение языка, пока список открыт, не подхватывает его
// само собой — обновляем эти несколько элементов вручную.
window.addEventListener('chat:localechange',()=>{
  $$('[data-game-kind]').forEach(node=>{node.textContent=gameName(node.dataset.gameKind)});
});
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
/**
 * Меняем открытый лист на другой: одно перемещение, а не закрытие и
 * открытие.
 *
 * Крутить здесь историю нельзя. `history.go` срабатывает не сразу, и
 * отложенный переход снимал лист, открытый за это время, — от этого
 * когда-то не работала ни одна плитка в листе «Создать». Лишняя запись
 * в истории — плата за то, чтобы плитки открывались.
 */
/**
 * Закрыть лист и уйти в беседу.
 *
 * `closeModal` откручивает историю, а откручивание асинхронно: переход,
 * сделанный сразу после него, отменяет отложенный popstate — человек
 * жмёт «Комиссия по сделке» и оказывается на «Сегодня». Так открывались
 * беседы из каталога каналов, из решения, по ссылке «перейти к беседе» и
 * из своих подразделений — все четыре места.
 *
 * Историю здесь не откручиваем вовсе, а сразу правим адрес: лишняя
 * запись в истории — привычная для этого места плата за то, чтобы
 * переход случился. Ровно так же поступает `replaceModal` ниже.
 */
function openChatFromSheet(id){
  overlayStack.length=0;
  renderOverlay();
  go('chats');
  openChat(id);
}

function replaceModal(open){if(overlayStack.length)overlayStack.pop();open()}
function quick(){modal('Создать',`<div class="module-grid"><button class="module-card" data-q="dm"><span class="module-icon">${navIcon.chats}</span><strong>Сообщение</strong></button><button class="module-card" data-q="group"><span class="module-icon">${tileIcon.team}</span><strong>Группа</strong></button><button class="module-card" data-q="task"><span class="module-icon">${msgIcon.task}</span><strong>Задача</strong></button><button class="module-card" data-q="event"><span class="module-icon">${navIcon.calendar}</span><strong>Событие</strong></button><button class="module-card" data-q="channel"><span class="module-icon">${roomIcon.channel}</span><strong>Канал</strong></button></div>`);$$('[data-q]').forEach(b=>b.onclick=()=>{const x=b.dataset.q;replaceModal(({dm:directModal,group:groupModal,task:()=>taskModal(),event:eventModal,channel:channelModal})[x])})}
const TASK_PRIORITY={normal:'обычный',high:'высокий',urgent:'срочный',low:'низкий'};
/**
 * Сообщение → задача одним движением.
 *
 * Полный путь занимал шестнадцать нажатий: три, чтобы добраться до
 * пункта «В задачу» (десятая плитка из двенадцати в меню «ещё»), и
 * тринадцать на форму из шести полей. На объекте с телефона так никто
 * делать не будет — вопрос останется висеть в переписке.
 *
 * Здесь только то, без чего обязательства не бывает: что, кто и когда.
 * Остальное у задачи уже есть по умолчанию и правится в карточке.
 */
function quickTaskModal(message){
  const text=String(message.body||kindLabel(message.kind)||'').trim();
  const presets=[
    ['Сегодня',new Date(new Date().setHours(18,0,0,0))],
    ['Завтра',new Date(new Date(Date.now()+86400000).setHours(18,0,0,0))],
    ['В пятницу',(()=>{const d=new Date();d.setDate(d.getDate()+((5-d.getDay()+7)%7||7));d.setHours(18,0,0,0);return d})()],
  ];
  modal('В задачу',`<form id="quick-task" class="form-stack">
    <label>Что нужно сделать<input name="title" required maxlength="240" value="${esc(text.slice(0,240))}"></label>
    <label>Кто сделает<select name="ownerId" class="field">${colleagues().map(p=>`<option value="${esc(p.userId)}"${p.userId===me().userId?' selected':''}>${esc(p.displayName||p.email)}</option>`).join('')}</select></label>
    <div><div class="section-title">Когда</div>
      <div class="chip-row" style="margin-top:8px">${presets.map(([caption,when])=>`<button type="button" class="chipbtn pressable" data-due="${esc(when.toISOString())}">${caption}</button>`).join('')}
        <button type="button" class="chipbtn pressable on" data-due="">Без срока</button></div>
      <input type="hidden" name="promisedAt" value="">
    </div>
    <p class="muted">Остальное — приёмку, важность, доказательства — можно задать в карточке задачи.</p>
    <button class="button primary">Поставить задачу</button>
  </form>`,()=>{
    const form=$('#quick-task');
    $$('[data-due]').forEach(b=>b.onclick=()=>{
      $$('[data-due]').forEach(x=>x.classList.remove('on'));
      b.classList.add('on');
      form.querySelector('[name="promisedAt"]').value=b.dataset.due;
    });
    form.onsubmit=async(event)=>{
      event.preventDefault();
      const data=new FormData(form);
      try{
        const{task}=await api('/api/v1/tasks',{method:'POST',body:JSON.stringify({
          title:data.get('title'),
          ownerId:data.get('ownerId'),
          acceptorId:me().userId,
          promisedAt:data.get('promisedAt')||null,
          sourceMessageId:message.id,
        })});
        toast('Задача поставлена');
        closeModal();
        await Promise.all([loadTasks(),loadTaskPage()]);
        render();
        void task;
      }catch(error){toast(error.message)}
    };
  });
}

/**
 * Предупреждение о том, что ответственного нет на месте.
 *
 * Задача со сроком на завтра, назначенная человеку в отпуске до
 * пятого числа, — это не задача, а недоразумение, которое выяснится
 * послезавтра. Не запрещаем: бывает, что назначить надо именно ему.
 */
function watchOwnerAvailability(form){
  const select=form.querySelector('[name="ownerId"]');
  const note=form.querySelector('[data-owner-away]');
  if(!select||!note)return;
  const sync=()=>{
    const who=person(select.value);
    const text=who&&who.userId!==me().userId?availabilityNote(who.presence):'';
    note.hidden=!text;
    note.textContent=text?`${who.displayName||who.email} — ${text}. Задача подождёт до возвращения.`:'';
  };
  select.onchange=sync;sync();
}

function taskModal(sourceMessageId=null,prefill=''){modal('Новая задача',`<form id="task-form" class="form-stack"><label>Что нужно сделать<input name="title" required value="${esc(prefill)}"></label><label>Ожидаемый результат<textarea name="outcome" rows="3" placeholder="Как понять, что задача выполнена?"></textarea></label><label>Ответственный<select name="ownerId" class="field">${colleagues().map(p=>`<option value="${p.userId}" ${p.userId===me().userId?'selected':''}>${esc(p.displayName||p.email)}</option>`).join('')}</select></label><div class="away-notice" data-owner-away hidden></div><label>Кто принимает результат<select name="acceptorId" class="field">${colleagues().map(p=>`<option value="${p.userId}" ${p.userId===me().userId?'selected':''}>${esc(p.displayName||p.email)}</option>`).join('')}</select></label><label>Срок<input name="promisedAt" type="datetime-local"></label><label>Приоритет<select name="priority" class="field"><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option><option value="low">Низкий</option></select></label><button class="button primary">Создать</button></form>`,()=>{
  // Привязка внутри `after`: лист перерисовывается при возврате с того,
  // что открыли поверх, и обработчик, навешенный снаружи, после этого
  // пропадал вместе со старой разметкой — кнопка «Создать» становилась
  // мёртвой. У соседних форм он и так внутри.
  watchOwnerAvailability($('#task-form'));$('#task-form').onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    try{
      const{task}=await api('/api/v1/tasks',{method:'POST',body:JSON.stringify({
        title:f.get('title'),outcome:f.get('outcome')||undefined,
        ownerId:f.get('ownerId'),acceptorId:f.get('acceptorId'),priority:f.get('priority'),
        promisedAt:f.get('promisedAt')?new Date(f.get('promisedAt')).toISOString():null,sourceMessageId,
      })});
      // Не только в общий список, но и в страницу экрана задач: иначе
      // только что заведённая задача не видна там, где её пошли искать.
      upsertTask(task);closeModal();await loadTaskPage();render();toast('Задача создана');
    }catch(error){toast(error.message)}
  };
});
}

function upsertTask(task){const i=S.tasks.findIndex(x=>x.id===task.id);if(i>=0)S.tasks[i]={...S.tasks[i],...task};else S.tasks.unshift(task)}
// Отказ тоже спрашивает причину: без неё просивший не узнает, что делать
// дальше, а договорённость уже умерла — переоткрыть её нельзя.
const taskReasonRequired=(task,to)=>['blocked','deferred','cancelled','rejected'].includes(to)||(task.status==='in_review'&&to==='in_progress')||(task.status==='accepted_result'&&to==='in_progress');
/**
 * Часы прямо на карточке задачи.
 *
 * Один таймер на человека сразу на всё пространство (см. миграцию
 * time_entries): если он идёт на другой задаче, кнопка «Запустить»
 * здесь отключена, а не молча перехватывает чужой отсчёт.
 */
function formatDuration(seconds){
  const total=Math.max(0,Math.round(seconds));
  const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
let taskTimeTicker=null;
async function renderTaskTimeSlot(task){
  const slot=$('#task-time-slot');
  if(!slot)return;
  clearInterval(taskTimeTicker);
  let entries,current;
  try{
    [entries,current]=await Promise.all([
      api(`/api/v1/tasks/${task.id}/time-entries`),
      api('/api/v1/time-entries/current'),
    ]);
  }catch(error){
    slot.innerHTML=`<span class="muted">${esc(error.message)}</span>`;
    return;
  }
  const runningHere=current.entry&&current.entry.taskId===task.id;
  const runningElsewhere=current.entry&&current.entry.taskId!==task.id;
  // entries.totalSeconds уже включает текущий бегущий интервал, посчитанный
  // на момент этого запроса (listForTask сам оценивает running-строку как
  // «сейчас минус старт»). Тикать поверх него — значит считать этот
  // отрезок дважды: раз в total на момент фетча, второй раз в `live`
  // каждую секунду. Складывать нужно с базой без бегущей строки.
  const baseSeconds=entries.items.filter(e=>!e.running).reduce((sum,e)=>sum+e.durationSeconds,0);
  const draw=()=>{
    if(!document.body.contains(slot)){clearInterval(taskTimeTicker);return}
    const live=runningHere?Math.max(0,(Date.now()-new Date(current.entry.startedAt))/1000):0;
    slot.innerHTML=`<div class="row-sub"><span>Всего:</span> <strong class="mono">${formatDuration(baseSeconds+live)}</strong>${runningElsewhere?' · <span class="warn-text">Таймер идёт на другой задаче</span>':''}</div>
      <div class="inline-actions" style="margin-top:8px">${runningHere
        ?`<button class="button danger small" data-time-stop>Остановить</button>`
        :`<button class="button secondary small" data-time-start${runningElsewhere?' disabled title="Сначала остановите таймер на другой задаче"':''}>Запустить таймер</button>`}</div>`;
    $('[data-time-stop]')?.addEventListener('click',async()=>{
      try{await api(`/api/v1/time-entries/${current.entry.id}/stop`,{method:'POST'});toast('Таймер остановлен');await renderTaskTimeSlot(task)}
      catch(error){toast(error.message)}
    });
    $('[data-time-start]')?.addEventListener('click',async()=>{
      try{await api(`/api/v1/tasks/${task.id}/time-entries/start`,{method:'POST',body:JSON.stringify({})});toast('Таймер запущен');await renderTaskTimeSlot(task)}
      catch(error){toast(error.message)}
    });
  };
  draw();
  if(runningHere)taskTimeTicker=setInterval(draw,1000);
}
function taskActionLabel(task,to){if(to==='in_progress'&&task.status==='in_review')return'Вернуть на доработку';if(to==='in_progress'&&task.status==='accepted_result')return'Переоткрыть';return TASK_ACTION[to]||to}
function toLocalInput(v){if(!v)return'';const d=new Date(v),pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function canRescheduleTask(t){return !['closed','rejected','cancelled'].includes(t.status)&&([t.ownerId,t.requesterId].includes(me().userId)||['owner','admin','manager'].includes(me().role))}
async function openTask(id){try{const{task}=await api(`/api/v1/tasks/${id}`);upsertTask(task);taskDetailModal(task)}catch(e){toast([400,404].includes(e.status)?T('Задача не найдена или недоступна','Task not found or unavailable'):e.message)}}
/**
 * Внутренности обязательства: шаги, помощники и связи.
 *
 * Три таблицы под это лежали в схеме с первого дня, и кода за ними не
 * было ни строки. Шаги — потому что одно обещание с пятью шагами
 * честнее пяти обещаний: человек обещал одно дело. Помощники — потому
 * что отвечает один, а делают обычно вдвоём. Связи — потому что отчёт
 * умеет показать застрявшее, но не может объяснить, чего оно ждёт.
 */
const DEPENDENCY_WORD={depends:'ждёт',blocks:'держит'};
function taskStructureSection(task){
  const checklist=task.checklist||[],helpers=task.collaborators||[],links=task.dependencies||[];
  const done=checklist.filter(x=>x.completedAt).length;
  return `
  <div><div class="section-title"><span>Шаги</span>${checklist.length?` · ${done} <span>из</span> ${checklist.length}`:''}</div>
    ${checklist.map(item=>`<div class="row flow">
      <span><label class="checkline"><input type="checkbox" data-step-toggle="${esc(item.id)}" ${item.completedAt?'checked':''}>
        <span class="${item.completedAt?'step-done':''}">${esc(item.title)}</span></label>
        ${item.completedAt?`<div class="row-sub">${esc(item.completedByName||'')} · ${esc(dateTime(item.completedAt))}</div>`:''}</span>
      <button type="button" class="close-button" data-step-remove="${esc(item.id)}" title="Убрать шаг">×</button>
    </div>`).join('')}
    <form id="task-step-form" class="form-stack" style="margin-top:8px">
      <label>Добавить шаг<input name="title" maxlength="240" placeholder="Что именно надо сделать" required></label>
    </form></div>

  <div><div class="section-title"><span>Кто помогает</span>${helpers.length?` · ${helpers.length}`:''}</div>
    <div class="row-sub"><span>Отвечает всё равно</span> ${esc(name(task.ownerId))} <span>— помощник видит задачу и отмечает шаги.</span></div>
    ${helpers.map(p=>`<div class="row flow"><span><div class="row-title">${esc(p.displayName)}</div>
      <div class="row-sub">${esc(p.title||'')}</div></span>
      <button type="button" class="close-button" data-helper-remove="${esc(p.userId)}" title="Убрать">×</button></div>`).join('')}
    <button type="button" class="button secondary small pressable" data-helper-add style="margin-top:8px">Позвать помочь</button></div>

  ${links.length?`<div><div class="section-title">Связанные обязательства</div>
    ${links.map(link=>`<div class="row flow"><span>
      <div class="row-title">${esc(link.title)}</div>
      <div class="row-sub">${link.kind==='blocks'?`эта задача ${esc(DEPENDENCY_WORD[link.direction])} её`:'рядом'} · ${esc(TASK_STATUS[link.status]||link.status)}</div></span>
      <button type="button" class="button small secondary pressable" data-link-open="${esc(link.id)}">Открыть</button></div>`).join('')}
  </div>`:''}`;
}

function taskDetailModal(task){
  const evidence=task.evidence||[],acceptances=task.acceptances||[],audit=task.audit||[];
  // Labels are read when the card opens: the list screen would need one
  // request per row to show them, and that is not worth the round trips.
  api(`/api/v1/labelled/task/${task.id}`).then(({items})=>{
    const slot=$('[data-task-label-slot]');
    if(slot)slot.innerHTML=labelChips(items);
  }).catch(()=>{
    // Без Postgres запрос за метками не дойдёт до сервера вовсе — не
    // оставляем «загружаем…» висеть так, будто оно ещё в пути.
    const slot=$('[data-task-label-slot]');
    if(slot)slot.innerHTML='<span class="muted">Метки доступны в режиме с базой данных</span>';
  });
  modal(task.title,`<div class="stack">
    <div class="row"><span class="task-status"></span><span><div class="section-title">${esc(TASK_STATUS[task.status]||task.status)}</div><div class="row-sub"><span>Версия</span> ${Number(task.version||1)} · <span>${esc(TASK_PRIORITY[task.priority]||task.priority||'обычный')}</span></div></span><span class="chip">${esc(dateTime(task.promisedAt))}</span></div>
    <div><div class="section-title">Метки <button class="text-button" data-task-labels data-skip-autofocus>изменить</button></div>
      <div class="person-chips" data-task-label-slot><span class="muted">загружаем…</span></div></div>
    ${task.sourceMessageId?`<div class="row"><span><div class="section-title">Из сообщения</div><div class="row-sub">Обсуждение, из которого выросла эта задача</div></span><button class="button small secondary pressable" data-task-source="${esc(task.sourceMessageId)}">Открыть</button></div>`:''}
    <div class="surface"><div class="section-title">Ожидаемый результат</div><p class="muted">${task.outcome?esc(task.outcome):'Не задан. Пока его нет, «сделано» решается спором, а не проверкой.'}</p><div class="row-sub"><span>Ответственный:</span> ${esc(name(task.ownerId))} <span>· Принимает:</span> ${esc(name(task.acceptorId))} <span>· Поставил:</span> ${esc(name(task.requesterId))}</div></div>
    <div><div class="section-title">Время</div><div id="task-time-slot"><span class="muted">загружаем…</span></div></div>
    <div><div class="section-title">Следующее действие</div>${task.status==='in_progress'&&!evidence.length?'<p class="muted" style="margin:6px 0 0">Чтобы сдать работу на проверку, приложите хотя бы одно доказательство — форма ниже.</p>':''}<div class="inline-actions" style="margin-top:8px">${(task.allowedTransitions||[]).map(to=>`<button class="button ${to==='accepted_result'||to==='closed'?'primary':'secondary'} small" data-task-transition="${esc(to)}" data-skip-autofocus>${esc(taskActionLabel(task,to))}</button>`).join('')||'<span class="muted">Доступных переходов сейчас нет.</span>'}</div></div>
    <form id="task-evidence-form" class="form-stack"><div class="section-title">Добавить результат / доказательство</div><label>Тип<select name="type" class="field"><option value="note">Комментарий / результат</option><option value="url">Ссылка</option><option value="metric">Метрика</option><option value="message">Ссылка на сообщение</option><option value="file">Идентификатор файла</option></select></label><label>Данные<textarea name="value" rows="3" required placeholder="Что сделано, где результат или чем это подтверждается"></textarea></label><button class="button secondary">Добавить доказательство</button></form>
    <button data-task-favour class="button secondary">${S.favourites?.has('task:'+task.id)?'Убрать из избранного':'В избранное'}</button><button data-task-remind class="button secondary">Напомнить о задаче</button>${canReassignTask(task)?'<button data-task-reassign class="button secondary">Передать задачу</button>':''}${canRescheduleTask(task)?'<button class="button secondary" data-task-reschedule>Изменить срок / прогноз</button>':''}
    ${taskStructureSection(task)}
    <div><div class="section-title"><span>Доказательства ·</span> ${evidence.length}</div>${evidence.length?evidence.map(e=>`<div class="row"><span>↗</span><span><div class="section-title">${esc(EVIDENCE_LABEL[e.type]||e.type)}</div><div class="row-sub">${esc(e.value)}</div></span><span class="time">${esc(dateTime(e.createdAt))}</span></div>`).join(''):'<div class="empty">Пока нет. Без доказательства результат нельзя отправить на проверку.</div>'}</div>
    ${acceptances.length?`<div><div class="section-title">Проверка результата</div>${acceptances.map(a=>`<div class="row"><span>${a.decision==='accepted'?'✓':'↩'}</span><span><div class="section-title">${a.decision==='accepted'?'Результат принят':'Возвращено на доработку'}</div><div class="row-sub">${esc(a.comment||'')}</div></span><span class="time">${esc(dateTime(a.createdAt))}</span></div>`).join('')}</div>`:''}
    ${audit.length?`<details><summary><span>История изменений ·</span> ${audit.length}</summary><div class="stack" style="margin-top:8px">${audit.map(a=>`<div class="row-sub">${esc(dateTime(a.createdAt))} · <span>${esc(TASK_EVENT[a.eventType]||a.eventType)}</span>${a.payload?.reason?` — «${esc(a.payload.reason)}»`:''}</div>`).join('')}</div></details>`:''}
  </div>`);
  renderTaskTimeSlot(task);
  // Шаги, помощники и связи: всё перерисовывает карточку из ответа
  // сервера, а не правит разметку на месте — счётчики и права считает он.
  const reopen=async()=>{closeModal();await openTask(task.id)};
  const stepForm=$('#task-step-form');
  if(stepForm)stepForm.onsubmit=async(event)=>{
    event.preventDefault();
    const title=new FormData(stepForm).get('title')?.toString().trim();
    if(!title)return;
    try{await api(`/api/v1/tasks/${task.id}/checklist`,{method:'POST',body:JSON.stringify({title})});await reopen()}
    catch(error){toast(error.message)}
  };
  $$('[data-step-toggle]').forEach(box=>box.onchange=async()=>{
    try{await api(`/api/v1/tasks/${task.id}/checklist/${box.dataset.stepToggle}`,{method:'PATCH',body:JSON.stringify({done:box.checked})});await reopen()}
    catch(error){box.checked=!box.checked;toast(error.message)}
  });
  $$('[data-step-remove]').forEach(b=>b.onclick=async()=>{
    try{await api(`/api/v1/tasks/${task.id}/checklist/${b.dataset.stepRemove}`,{method:'DELETE'});await reopen()}
    catch(error){toast(error.message)}
  });
  const helperAdd=$('[data-helper-add]');
  if(helperAdd)helperAdd.onclick=()=>{
    const busy=new Set([task.ownerId,...(task.collaborators||[]).map(x=>x.userId)]);
    const candidates=colleagues().filter(p=>!busy.has(p.userId));
    if(!candidates.length)return toast('Звать больше некого.');
    modal('Кто поможет',`<div class="stack">${candidates.map(p=>`<button class="row pressable" data-helper-pick="${esc(p.userId)}" style="width:100%;text-align:left">
      ${personAvatar(p)}
      <span><div class="row-title">${esc(p.displayName||p.email)}</div><div class="row-sub">${esc(p.title||roleWord(p.role))}</div></span></button>`).join('')}</div>`,()=>{
      $$('[data-helper-pick]').forEach(b=>b.onclick=async()=>{
        try{await api(`/api/v1/tasks/${task.id}/collaborators`,{method:'POST',body:JSON.stringify({userId:b.dataset.helperPick})});closeModal();await reopen()}
        catch(error){toast(error.message)}
      });
    });
  };
  $$('[data-helper-remove]').forEach(b=>b.onclick=async()=>{
    try{await api(`/api/v1/tasks/${task.id}/collaborators/${b.dataset.helperRemove}`,{method:'DELETE'});await reopen()}
    catch(error){toast(error.message)}
  });
  $$('[data-link-open]').forEach(b=>b.onclick=()=>{closeModal();openTask(b.dataset.linkOpen)});
  $$('[data-task-transition]').forEach(b=>b.onclick=()=>taskTransition(task,b.dataset.taskTransition));
  $('[data-task-labels]').onclick=()=>labelPicker('task',task.id,{title:`Метки: ${task.title}`});
  const form=$('#task-evidence-form');if(form)form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);try{const r=await api(`/api/v1/tasks/${task.id}/evidence`,{method:'POST',body:JSON.stringify({type:f.get('type'),value:f.get('value'),expectedVersion:task.version})});upsertTask(r.task);toast('Доказательство добавлено');await openTask(task.id);if(S.view==='tasks'){await loadTaskPage();render()}}catch(error){toast(error.message);if(error.code==='STALE_TASK_ACTION')await openTask(task.id)}};
  $('[data-task-favour]')?.addEventListener('click',async()=>{await toggleFavourite('task',task.id);resumeTop()});
  $('[data-task-remind]')?.addEventListener('click',()=>remindAboutModal(task.title,{sourceType:'task',sourceId:task.id}));
  $('[data-task-reassign]')?.addEventListener('click',()=>taskReassignModal(task));
  $('[data-task-reschedule]')?.addEventListener('click',()=>taskRescheduleModal(task));
  // Связь задача ↔ сообщение хранилась и отдавалась с первого дня, но
  // открыть обсуждение из задачи было нельзя: его искали руками.
  $('[data-task-source]')?.addEventListener('click',async()=>{
    const messageId=task.sourceMessageId;
    const conversationId=S.conversations.find(c=>(S.messages.get(c.id)||[]).some(m=>m.id===messageId))?.id;
    closeModal();
    if(conversationId)await openChatAtMessage(conversationId,messageId);
    else toast('Это сообщение в беседе, которая сейчас не открыта');
  });
}
function taskTransition(task,to){if(taskReasonRequired(task,to)){modal(taskActionLabel(task,to),`<form id="task-transition-form" class="form-stack"><p class="muted">Причина будет сохранена в истории задачи.</p><label>Причина<textarea name="reason" rows="4" required></textarea></label><button class="button primary">${esc(taskActionLabel(task,to))}</button></form>`);$('#task-transition-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await executeTaskTransition(task,to,f.get('reason'))};return}executeTaskTransition(task,to,null)}
async function executeTaskTransition(task,to,reason){try{const{task:updated}=await api(`/api/v1/tasks/${task.id}/transitions`,{method:'POST',body:JSON.stringify({to,reason,expectedVersion:task.version})});upsertTask(updated);toast(TASK_STATUS[updated.status]||'Задача обновлена');await openTask(task.id);if(S.view==='tasks')await loadTaskPage();render()}catch(error){toast(error.message);if(error.code==='STALE_TASK_ACTION')await openTask(task.id)}}
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
        closeModal();
        if(S.view==='tasks')await loadTaskPage();
        render();
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

function taskRescheduleModal(task){modal('Изменить срок',`<form id="task-reschedule-form" class="form-stack"><label>Обещанный срок<input name="promisedAt" type="datetime-local" value="${esc(toLocalInput(task.promisedAt))}"></label><label>Прогноз<input name="forecastAt" type="datetime-local" value="${esc(toLocalInput(task.forecastAt))}"></label><label>Причина<textarea name="reason" rows="3" required placeholder="Почему срок или прогноз изменился"></textarea></label><button class="button primary">Сохранить изменение</button></form>`);$('#task-reschedule-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const{task:updated}=await api(`/api/v1/tasks/${task.id}/schedule`,{method:'PATCH',body:JSON.stringify({promisedAt:f.get('promisedAt')?new Date(f.get('promisedAt')).toISOString():null,forecastAt:f.get('forecastAt')?new Date(f.get('forecastAt')).toISOString():null,reason:f.get('reason'),expectedVersion:task.version})});upsertTask(updated);toast('Срок обновлён');await openTask(task.id);if(S.view==='tasks')await loadTaskPage();render()}catch(error){toast(error.message);if(error.code==='STALE_TASK_ACTION')await openTask(task.id)}}}
/**
 * A meeting is people plus a time. The form asked only for the time: the
 * invitations had to be added through the API afterwards, which is no use to
 * anyone. It also swallowed refusals — an end before the start rejected on
 * the server and the screen said nothing at all — and left the calendar
 * where it was, so an event made for another week looked like nothing had
 * happened.
 */
/**
 * Повторение встречи.
 *
 * Правило хранится строкой RFC 5545 — на нём говорят все календари, и
 * его можно отдать наружу, не выдумывая своего. Человеку строка не
 * нужна: он выбирает из четырёх понятных вариантов.
 */
const REPEAT_CHOICES=[['','Не повторять'],['daily','Каждый день'],['weekdays','По будням'],['weekly','Каждую неделю'],['biweekly','Раз в две недели'],['monthly','Каждый месяц']];
const WEEKDAY_CODES=['SU','MO','TU','WE','TH','FR','SA'];
function repeatRule(choice,startAt){
  const day=WEEKDAY_CODES[new Date(startAt).getDay()];
  return({
    daily:'FREQ=DAILY',
    weekdays:'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    weekly:`FREQ=WEEKLY;BYDAY=${day}`,
    biweekly:`FREQ=WEEKLY;INTERVAL=2;BYDAY=${day}`,
    monthly:'FREQ=MONTHLY',
  })[choice]??null;
}

// Виды события — те же семь, что понимает сервер (схема
// `calendar_events.kind`), а форма предлагала четыре из семи: завести
// «Работу над задачей», «Веху» или просто «Событие» можно было только
// в обход экрана.
const EVENT_KIND_CHOICES=[
  ['meeting','Встреча'],['focus','Фокус-время'],['task_block','Работа над задачей'],
  ['deadline','Дедлайн'],['reminder','Напоминание'],['milestone','Веха'],['other','Событие'],
];
// Встреча, фокус-время и работа над задачей требуют времени окончания —
// это правило схемы (`CHECK (kind NOT IN (...) OR end_at IS NOT NULL)`),
// и раньше человек узнавал о нём фразой из базы, если снимал галочку.
const EVENT_KINDS_NEEDING_END=new Set(['meeting','focus','task_block']);

function eventModal(prefill=''){
  const start=new Date(Date.now()+3600000);start.setMinutes(0,0,0);
  const end=new Date(start.getTime()+3600000);
  modal('Новое событие',`<form id="event-form" class="form-stack">
    <label>Название<input name="title" required maxlength="240" value="${esc(prefill)}"></label>
    <label>Тип<select name="kind" class="field">
      ${EVENT_KIND_CHOICES.map(([value,caption])=>`<option value="${value}">${caption}</option>`).join('')}
    </select></label>
    <label class="switch-row"><input type="checkbox" name="allDay">
      <span><span class="section-title">Весь день</span><span class="row-sub">Без конкретного часа — на день или на несколько дней подряд</span></span></label>
    <label>Начало<input name="start" type="datetime-local" required value="${esc(toLocalInput(start.toISOString()))}"></label>
    <label id="event-end-row">Окончание<input name="end" type="datetime-local" value="${esc(toLocalInput(end.toISOString()))}"></label>
    <label>Видимость<select name="visibility" class="field">
      <option value="participants">Только участникам</option>
      <option value="workspace">Вся компания видит, что время занято</option>
      <option value="private">Только мне</option>
    </select></label>
    <label>Описание<textarea name="description" rows="2" maxlength="2000"></textarea></label>
    <label>Повторять<select name="repeat" class="field">
      ${REPEAT_CHOICES.map(([value,caption])=>`<option value="${esc(value)}">${caption}</option>`).join('')}
    </select></label>
    ${S.boot?.storageMode==='memory'?'':`<div><div class="section-title">Кого позвать</div>
      <div class="row-sub">Каждый получит приглашение и подтвердит участие</div>
      <div style="margin-top:8px">${participantChecks([], 'guest', {openRoom:true})}</div></div>`}
    <button class="button primary">Создать</button>
  </form>`,()=>{
    const form=$('#event-form');
    const kindField=form.querySelector('[name="kind"]');
    const allDayField=form.querySelector('[name="allDay"]');
    const startField=form.querySelector('[name="start"]');
    const endField=form.querySelector('[name="end"]');
    // Дата и час — одно поле, пока не отмечено «весь день»: тип поля
    // переключается на дату без времени, а не прячется рядом с ним.
    const syncFields=()=>{
      const wholeDay=allDayField.checked;
      const type=wholeDay?'date':'datetime-local';
      for(const field of [startField,endField]){
        if(field.type===type)continue;
        const value=field.value?new Date(field.value):null;
        field.type=type;
        if(value)field.value=wholeDay?value.toISOString().slice(0,10):toLocalInput(value.toISOString());
      }
      // «Окончание» обязательно только для тех видов, где обязательно на
      // сервере — иначе человек либо видит лишнюю звёздочку, либо не
      // видит нужную.
      endField.required=EVENT_KINDS_NEEDING_END.has(kindField.value);
    };
    allDayField.onchange=syncFields;
    kindField.onchange=syncFields;
    syncFields();
    form.onsubmit=async(submitEvent)=>{
      submitEvent.preventDefault();
      const data=new FormData(submitEvent.currentTarget);
      const wholeDay=allDayField.checked;
      const parseField=(value,endOfDay)=>{
        if(!value)return null;
        if(!wholeDay)return new Date(value);
        const day=new Date(`${value}T00:00:00`);
        if(endOfDay)day.setHours(23,59,59,999);
        return day;
      };
      const startAt=parseField(data.get('start'),false);
      const endAt=parseField(data.get('end'),true);
      if(endAt&&endAt<=startAt)return toast('Окончание должно быть позже начала');
      const invited=data.getAll('guest');
      try{
        // Встреча и приглашения — одним запросом, без половинчатого результата.
        await api('/api/v1/calendar-events',{method:'POST',body:JSON.stringify({
          title:data.get('title'),kind:data.get('kind'),allDay:wholeDay,
          visibility:data.get('visibility'),
          description:data.get('description')||null,
          startAt:startAt.toISOString(),endAt:endAt?endAt.toISOString():null,
          timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
          // «Каждую неделю» без дня недели значило бы «в тот же день, что
          // и первая встреча» — но человек выбирает день, ставя дату
          // начала, и правило обязано её повторить, а не гадать.
          recurrenceRule:repeatRule(data.get('repeat'),startAt),
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
function participantChecks(selected=[],name='participant',{openRoom=false}={}){const chosen=new Set(selected);return S.people.filter(p=>p.userId!==me().userId&&p.active!==false&&(!openRoom||p.role!=='guest')).map(p=>`<label class="row candidate-row" style="cursor:pointer"><input type="checkbox" name="${name}" value="${p.userId}" ${chosen.has(p.userId)?'checked':''}>${personAvatar(p)}<span><div class="row-title">${esc(p.displayName||p.email)}</div><div class="row-sub">${esc(p.title||roleWord(p.role))}</div></span></label>`).join('')||'<div class="empty">Сначала пригласите сотрудников.</div>'}

function groupModal(){modal('Новая группа',`<form id="group-form" class="form-stack"><label>Название группы<input name="title" required maxlength="120"></label><div><div class="section-title">Участники</div><div class="row-sub">Выберите минимум одного коллегу</div><div style="margin-top:8px">${participantChecks()}</div></div><button class="button primary">Создать группу</button></form>`);$('#group-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,ids=[...form.querySelectorAll('input[name="participant"]:checked')].map(x=>x.value);if(ids.length<1)return toast('Для группового чата выберите минимум одного коллегу.');try{const f=new FormData(form),{conversation}=await api('/api/v1/conversations',{method:'POST',body:JSON.stringify({kind:'group',title:f.get('title'),participantIds:ids})});rememberConversation(conversation);openChatFromSheet(conversation.id)}catch(error){toast(error.message)}}}

function channelModal(){modal('Новый канал',`<form id="channel-form" class="form-stack"><label>Название<input name="title" required></label><label>Описание<input name="purpose"></label><label>Доступ<select name="visibility" class="field"><option value="workspace">Вся компания</option><option value="private">Только участники</option></select></label><label class="row" style="cursor:pointer"><input type="checkbox" name="announcementOnly"><span><div class="section-title">Только объявления</div><div class="row-sub">Публиковать смогут владелец, модераторы и управляющие каналами</div></span></label><div><div class="section-title">Участники закрытого канала</div><div class="row-sub">Для общего канала список не ограничивает доступ</div><div style="margin-top:8px">${participantChecks()}</div></div><button class="button primary">Создать</button></form>`);$('#channel-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form),ids=[...form.querySelectorAll('input[name="participant"]:checked')].map(x=>x.value);try{const{conversation}=await api('/api/v1/conversations',{method:'POST',body:JSON.stringify({kind:'channel',title:f.get('title'),purpose:f.get('purpose'),visibility:f.get('visibility'),participantIds:ids,announcementOnly:f.get('announcementOnly')==='on'})});rememberConversation(conversation);openChatFromSheet(conversation.id)}catch(error){toast(error.message)}}}

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
/**
 * Звонки: позвонить сейчас и назначить на потом.
 *
 * Позвонить можно было только «всей беседе»: в канале на двадцать
 * человек это означало поднять двадцать телефонов ради разговора с
 * одним. Назначить разговор было нельзя вовсе — столбец `scheduled_for`
 * лежал в схеме с самого начала и не читался ни одной строкой кода, так
 * что «созвонимся в четверг в десять» жило словами в переписке и там же
 * терялось.
 */
/** Как называется беседа этого вида — в строке под её названием. */
const ROOM_WORD={channel:'Канал',group:'Группа',direct:'Личный диалог',team:'Команда',project:'Проект',external:'Комната с внешним участником'};

async function callsModal(){
  const rooms=S.conversations.filter(c=>!c.archivedAt);
  if(!rooms.length)return toast('Сначала начните беседу — звонок идёт в неё.');
  let scheduled=[];
  let scheduledError=null;
  try{scheduled=(await api('/api/v1/calls/scheduled')).items||[]}
  catch(error){scheduledError=error.message}

  const roomLine=(c)=>`${roomAvatar(c)}
    <span><div class="row-title">${esc(c.title||'Диалог')}</div><div class="row-sub">${esc(ROOM_WORD[c.kind]||'')}</div></span>`;

  modal('Звонки',`
    ${scheduledError?`<div class="empty"><strong>Назначенные звонки недоступны</strong>${esc(scheduledError)}</div>`
      :scheduled.length?`<div class="section-head"><div><h3>Назначенные</h3>
        <p class="muted">Разговор стоит в календаре у всех приглашённых — с темой и материалами.</p></div></div>
      ${scheduled.map(call=>`<div class="row">
        <span class="avatar dark">${call.mode==='audio'?'☎':'▤'}</span>
        <span><div class="row-title">${esc(call.title||'Звонок')}</div>
          <div class="row-sub">${esc(dateTime(call.scheduledFor))} · ${call.mode==='audio'?'аудио':'видео'} · ${call.participants.length} ${pluralIn(call.participants.length,['участник','участника','участников'],['participant','participants'])}${call.files.length?` · ${call.files.length} ${pluralIn(call.files.length,['документ','документа','документов'],['document','documents'])}`:''}</div>
          ${call.description?`<div class="row-sub">${esc(call.description)}</div>`:''}
          ${call.files.map(f=>`<div class="row-sub"><a href="/api/v1/files/${esc(f.id)}/content">${esc(f.name)}</a></div>`).join('')}</span>
        <span class="inline-actions">
          <button class="button small secondary pressable" data-join="${esc(call.id)}">Присоединиться</button>
          ${call.createdBy===me().userId?`<button class="button small danger pressable" data-cancel="${esc(call.id)}">Отменить</button>`:''}
        </span></div>`).join('')}`
      :'<p class="muted">Назначенных звонков нет.</p>'}

    <div class="section-head" style="margin-top:16px"><div><h3>Позвонить сейчас</h3>
      <p class="muted">Звонок идёт в беседу: её участники увидят приглашение. В группе можно позвать не всех, а выбранных.</p></div></div>
    ${rooms.map(c=>`<div class="row">${roomLine(c)}
      <span class="inline-actions">
        <button class="button small secondary pressable" data-call="audio" data-room="${c.id}">Аудио</button>
        <button class="button small secondary pressable" data-call="video" data-room="${c.id}">Видео</button>
        ${c.kind==='direct'?'':`<button class="button small ghost pressable" data-pick="${c.id}">Выбрать кого</button>`}
      </span></div>`).join('')}

    <div class="section-head" style="margin-top:16px"><div><h3>Назначить звонок</h3>
      <p class="muted">Тема, время и документы, которые надо прочитать до разговора.</p></div></div>
    <form id="schedule-call" class="form-stack">
      <label>Беседа<select name="conversationId" class="field">${rooms.map(c=>`<option value="${c.id}">${esc(c.title||'Диалог')}</option>`).join('')}</select></label>
      <label>Тема<input name="title" maxlength="240" placeholder="О чём говорим" required></label>
      <label>Повестка<textarea name="agenda" rows="2" maxlength="4000" placeholder="Что нужно решить"></textarea></label>
      <div class="row flow">
        <label style="flex:1">Когда<input name="startAt" type="datetime-local" required></label>
        <label style="flex:1">Сколько минут<input name="minutes" type="number" min="5" max="480" step="5" value="30"></label>
      </div>
      <label>Как<select name="mode" class="field"><option value="video">Видео</option><option value="audio">Аудио</option></select></label>
      <label>Документы<input name="files" type="file" multiple></label>
      <p class="muted" style="margin:0;font-size:12px">Материалы лягут в карточку встречи — их увидят все приглашённые.</p>
      <button class="button primary pressable" type="submit">Назначить</button>
    </form>
  `,()=>{
    $$('[data-call]').forEach(button=>button.onclick=async()=>{
      const{call,room}=button.dataset;
      closeModal();
      openChat(room);
      // startOutgoing читает открытую беседу со страницы, поэтому звонок
      // ждёт тот экран, про который его спросили.
      await new Promise(resolve=>setTimeout(resolve,120));
      try{await window.ChatCalls?.startOutgoing?.(call)}catch(error){toast(ERROR_MESSAGE[error.code]||error.message)}
    });
    $$('[data-pick]').forEach(button=>button.onclick=()=>pickCallParticipants(button.dataset.pick));
    $$('[data-join]').forEach(button=>button.onclick=async()=>{
      closeModal();
      try{await window.ChatCalls?.joinExisting?.(button.dataset.join)}
      catch(error){toast(ERROR_MESSAGE[error.code]||error.message)}
    });
    $$('[data-cancel]').forEach(button=>button.onclick=async()=>{
      button.disabled=true;
      try{await api(`/api/v1/calls/${button.dataset.cancel}/cancel`,{method:'POST',body:'{}'});toast('Звонок отменён');closeModal();callsModal()}
      catch(error){button.disabled=false;toast(error.message)}
    });

    const form=$('#schedule-call');
    form.onsubmit=async(event)=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      button.disabled=true;
      const data=new FormData(form);
      try{
        // Документы загружаем до создания: звонок без обещанных
        // материалов хуже, чем ошибка при назначении.
        const fileIds=[];
        for(const file of form.querySelector('[name="files"]').files){
          const response=await fetch('/api/v1/files',{method:'POST',credentials:'same-origin',
            headers:{'content-type':file.type||'application/octet-stream','x-file-name':encodeURIComponent(file.name)},body:file});
          const payload=await response.json();
          if(!response.ok)throw new Error(payload?.error?.message||`Не удалось загрузить ${file.name}`);
          fileIds.push(payload.file.id);
        }
        await api('/api/v1/calls/scheduled',{method:'POST',body:JSON.stringify({
          conversationId:data.get('conversationId'),
          title:data.get('title'),
          agenda:data.get('agenda')||null,
          startAt:new Date(data.get('startAt')).toISOString(),
          minutes:Number(data.get('minutes'))||30,
          mode:data.get('mode'),
          fileIds,
        })});
        toast('Звонок назначен');
        closeModal();
        callsModal();
      }catch(error){button.disabled=false;toast(ERROR_MESSAGE[error.code]||error.message)}
    };
  });
}

/**
 * Позвать не всех.
 *
 * В канале на двадцать человек «позвонить» означало поднять двадцать
 * телефонов ради разговора с одним — и люди просто переставали звонить
 * отсюда.
 */
async function pickCallParticipants(conversationId){
  let members=[];
  try{members=(await api(`/api/v1/conversations/${conversationId}/members`)).items||[]}
  catch(error){return toast(error.message)}
  const others=members.filter(m=>m.userId!==me().userId);
  if(!others.length)return toast('В беседе больше никого нет.');
  modal('Кого позвать',`
    <form id="pick-call" class="form-stack">
      <div>${others.map(m=>`<label class="row candidate-row" style="cursor:pointer">
        <input type="checkbox" name="who" value="${esc(m.userId)}">
        ${personAvatar(m)}
        <span><div class="row-title">${esc(m.displayName||m.email)}</div>
          <div class="row-sub">${esc(m.title||roleWord(m.workspaceRole))}</div></span></label>`).join('')}</div>
      <label>Как<select name="mode" class="field"><option value="video">Видео</option><option value="audio">Аудио</option></select></label>
      <button class="button primary pressable" type="submit">Позвонить</button>
    </form>
  `,()=>{
    $('#pick-call').onsubmit=async(event)=>{
      event.preventDefault();
      const form=event.currentTarget;
      const who=[...form.querySelectorAll('input[name="who"]:checked')].map(x=>x.value);
      if(!who.length)return toast('Выберите, кого позвать.');
      const button=form.querySelector('button[type="submit"]');
      button.disabled=true;
      try{
        const created=await api(`/api/v1/conversations/${conversationId}/calls`,{method:'POST',
          body:JSON.stringify({mode:form.querySelector('[name="mode"]').value,participantIds:who})});
        closeModal();
        await window.ChatCalls?.joinExisting?.(created.call.id);
      }catch(error){button.disabled=false;toast(ERROR_MESSAGE[error.code]||error.message)}
    };
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

/**
 * Загрузить снимок и вернуть его идентификатор.
 *
 * Фотография идёт тем же путём, что и любое вложение: одно хранилище,
 * одни проверки, одно место, где файл потом искать.
 */
async function uploadPicture(file){
  const response=await fetch('/api/v1/files',{method:'POST',credentials:'same-origin',
    headers:{'content-type':file.type||'application/octet-stream','x-file-name':encodeURIComponent(file.name)},body:file});
  const payload=await response.json();
  if(!response.ok)throw new Error(payload?.error?.message||'Не удалось загрузить снимок');
  return payload.file.id;
}

function conversationEditModal(c){
  modal('Настроить беседу',`<form id="conv-form" class="form-stack">
    <label>Название<input name="title" required maxlength="120" value="${esc(c.title??'')}"></label>
    <label>Описание<input name="purpose" maxlength="500" value="${esc(c.purpose??'')}"></label>
    <div class="row">${roomAvatar(c)}
      <span><div class="section-title">Фотография беседы</div>
        <div class="row-sub">По ней группу узнают в списке быстрее, чем по названию: в узкой колонке оно обрезается.</div></span></div>
    <label>Новая фотография<input name="avatar" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label>
    ${c.avatarUrl?'<label class="row" style="cursor:pointer"><input type="checkbox" name="dropAvatar"><span><div class="section-title">Убрать фотографию</div><div class="row-sub">Останется знак вида беседы</div></span></label>':''}
    ${c.kind==='channel'?`<label class="row" style="cursor:pointer"><input type="checkbox" name="announcementOnly" ${c.announcementOnly?'checked':''}>
      <span><div class="section-title">Только объявления</div><div class="row-sub">Публиковать смогут владелец, модераторы и управляющие каналами</div></span></label>`:''}
    <button class="button primary">Сохранить</button>
  </form>`,()=>{
    $('#conv-form').onsubmit=async(event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      // Номер версии, с которой открыли окно: если беседу успели
      // поправить в другой вкладке, правка не ляжет поверх чужой молча.
      const body={title:form.get('title'),purpose:form.get('purpose')||null,expectedVersion:c.version};
      if(c.kind==='channel')body.announcementOnly=form.get('announcementOnly')==='on';
      try{
        const picked=event.currentTarget.querySelector('[name="avatar"]').files[0];
        if(picked)body.avatarFileId=await uploadPicture(picked);
        else if(form.get('dropAvatar')==='on')body.avatarFileId=null;
        const{conversation}=await api(`/api/v1/conversations/${c.id}`,{method:'PATCH',body:JSON.stringify(body)});
        const i=S.conversations.findIndex(x=>x.id===c.id);
        if(i>=0)S.conversations[i]={...S.conversations[i],...conversation};
        toast('Беседа обновлена');closeModal();render();
      }catch(error){toast(error.message)}
    };
  });
}

async function membersModal(){const conversation=S.conversations.find(x=>x.id===S.selected);if(!conversation)return toast('Сначала откройте группу или канал.');try{const payload=await api(`/api/v1/conversations/${conversation.id}/members`),members=payload.items||[],orphaned=conversation.kind!=='direct'&&!members.some(x=>x.role==='owner')&&['owner','admin','manager'].includes(me().role),memberIds=new Set(members.map(x=>x.userId)),available=S.people.filter(p=>p.userId!==me().userId&&p.active!==false&&!memberIds.has(p.userId));modal('Участники',`<div class="stack"><div>${members.map(m=>`<div class="row" data-member-row="${m.userId}">${personAvatar(m)}<span><div class="row-title">${esc(m.displayName||m.email)}</div><div class="row-sub">${esc(m.title||roleWord(m.workspaceRole))}</div></span>${payload.canManage?`<span class="inline-actions"><select class="field" data-member-role="${m.userId}" style="min-width:120px">${m.workspaceRole==='guest'?'':`<option value="owner" ${m.role==='owner'?'selected':''}>Владелец</option><option value="moderator" ${m.role==='moderator'?'selected':''}>Модератор</option>`}<option value="member" ${m.role==='member'?'selected':''}>Участник</option><option value="guest" ${m.role==='guest'?'selected':''}>Гость</option></select><button type="button" class="close-button" data-member-remove="${m.userId}" title="Удалить">×</button></span>`:`<span class="chip">${esc(m.role)}</span>`}</div>`).join('')}</div>${orphaned?`<div class="stack" style="margin:12px 0"><p class="muted">У беседы не осталось владельца: настраивать её и вести список участников некому.</p><button type="button" data-conv-claim class="button secondary">Стать владельцем</button></div>`:''}${payload.canManage&&available.length?`<form id="add-members-form" class="form-stack"><div><div class="section-title">Добавить участников</div><div style="margin-top:8px">${available.filter(p=>!['workspace','organization'].includes(conversation.visibility)||p.role!=='guest').map(p=>`<label class="row candidate-row" style="cursor:pointer"><input type="checkbox" name="candidate" value="${p.userId}">${personAvatar(p)}<span><div class="row-title">${esc(p.displayName||p.email)}</div><div class="row-sub">${esc(p.title||roleWord(p.role))}</div></span></label>`).join('')}</div></div><button class="button secondary">Добавить выбранных</button></form>`:''}</div>`);const claimButton=$('[data-conv-claim]');if(claimButton)claimButton.onclick=async()=>{try{await api(`/api/v1/conversations/${conversation.id}/claim`,{method:'POST'});const i=S.conversations.findIndex(x=>x.id===conversation.id);if(i>=0)S.conversations[i]={...S.conversations[i],memberRole:'owner'};toast('Вы стали владельцем беседы');await membersModal();render()}catch(error){toast(error.message)}};if(payload.canManage){$$('[data-member-role]').forEach(select=>select.onchange=async()=>{try{await api(`/api/v1/conversations/${conversation.id}/members/${select.dataset.memberRole}`,{method:'PATCH',body:JSON.stringify({role:select.value})});toast('Роль обновлена');await membersModal()}catch(error){toast(error.message);await membersModal()}});$$('[data-member-remove]').forEach(button=>button.onclick=async()=>{try{await api(`/api/v1/conversations/${conversation.id}/members/${button.dataset.memberRemove}`,{method:'DELETE'});toast('Участник удалён');await membersModal()}catch(error){toast(error.message)}});const form=$('#add-members-form');if(form)form.onsubmit=async e=>{e.preventDefault();const ids=[...form.querySelectorAll('input[name="candidate"]:checked')].map(x=>x.value);if(!ids.length)return toast('Выберите участников.');try{await api(`/api/v1/conversations/${conversation.id}/members`,{method:'POST',body:JSON.stringify({userIds:ids})});toast('Участники добавлены');await membersModal()}catch(error){toast(error.message)}}}}catch(error){toast(error.message)}}

function directModal(){const others=S.people.filter(p=>p.userId!==me().userId);modal('Новое сообщение',others.map(p=>`<button class="conversation-card" data-person="${p.userId}">${personAvatar(p)}<span><strong>${esc(p.displayName||p.email)}</strong><div class="preview">${esc(p.title||roleWord(p.role))}</div></span></button>`).join('')||'<div class="empty">Сначала пригласите сотрудников.</div>');$$('[data-person]').forEach(b=>b.onclick=async()=>{const p=person(b.dataset.person),{conversation}=await api('/api/v1/conversations',{method:'POST',body:JSON.stringify({kind:'direct',title:p?.displayName||null,participantIds:[b.dataset.person]})});rememberConversation(conversation);openChatFromSheet(conversation.id)})}
/**
 * Приглашение списком.
 *
 * Компания приходит со штатом: сорок человек уже есть в таблице. Форма
 * на одного — это сорок форм и десяток опечаток, поэтому здесь принимают
 * то, что вставили из таблицы: по строке на человека, адрес и роль через
 * запятую, табуляцию или точку с запятой. Роли нет — значит сотрудник.
 */
function parseStaffList(text){
  const ROLE={'владелец':'owner','админ':'admin','администратор':'admin','руководитель':'manager','менеджер':'manager',
    'сотрудник':'member','гость':'guest',owner:'owner',admin:'admin',manager:'manager',member:'member',guest:'guest'};
  return String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
    const parts=line.split(/[,;\t]+/).map(x=>x.trim()).filter(Boolean);
    const email=parts.find(x=>x.includes('@'))??parts[0]??'';
    const rest=parts.filter(x=>x!==email);
    // Роль узнаётся по слову, остальное — название подразделения: так в
    // таблице и пишут, «ivanov@…, руководитель, Отдел аналитики».
    const role=rest.map(x=>ROLE[x.toLowerCase()]).find(Boolean)??'member';
    const unit=rest.find(x=>!ROLE[x.toLowerCase()])??'';
    return {email,role,unit};
  });
}

const BULK_STATUS={invited:'приглашён',already:'уже здесь',duplicate:'повтор в списке',no_seats:'мест не осталось',
  invalid_email:'не адрес',invalid_role:'неизвестная роль',role_too_high:'права выше ваших',
  unknown_unit:'нет такого подразделения',unit_forbidden:'не ваше подразделение',failed:'не вышло'};

function bulkInviteModal(){
  modal('Пригласить списком',`<form id="bulk-form" class="form-stack">
    <label>Файл CSV из HR/Excel<input type="file" name="csvFile" accept=".csv,text/csv"></label>
    <label>Список сотрудников<textarea name="list" rows="8" required
      placeholder="ivanov@granit.ru, руководитель, Отдел аналитики&#10;petrova@granit.ru, сотрудник, Снабжение&#10;sidorov@granit.ru"></textarea></label>
    <p class="muted" style="margin:-4px 0 0;font-size:12px">По строке на человека: адрес, через запятую роль и подразделение. Роль — владелец, админ, руководитель, сотрудник или гость; нет роли — значит сотрудник. Подразделение по названию, как в схеме; в закрытое можно звать, только если вы в нём состоите. За раз до 200 строк. <span>Файл CSV подставит строки в поле ниже — можно поправить перед отправкой.</span></p>
    <button class="button primary">Разослать приглашения</button>
  </form><div id="bulk-result"></div>`,()=>{
    // Файл только подставляет текст в то же поле — человек видит, что
    // на самом деле уйдёт на сервер, и может поправить строку до
    // отправки, а не отправляет файл вслепую.
    $('#bulk-form [name="csvFile"]').onchange=async(event)=>{
      const file=event.currentTarget.files?.[0];
      if(!file)return;
      try{
        const text=await file.text();
        const lines=String(text||'').replace(/^﻿/,'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
        // Первая строка часто заголовок («email,role,department») —
        // без слова с «@» это не человек, а подпись столбца.
        const body=lines.length&&!lines[0].includes('@')?lines.slice(1):lines;
        $('#bulk-form [name="list"]').value=body.join('\n');
        toast(body.length?'Строки из файла подставлены — проверьте и отправьте':'В файле не нашлось ни одной строки с почтой');
      }catch(error){toast('Не удалось прочитать файл')}
    };
    $('#bulk-form').onsubmit=async(event)=>{
      event.preventDefault();
      const items=parseStaffList(new FormData(event.currentTarget).get('list'));
      if(!items.length)return toast('В списке нет ни одной строки');
      try{
        const answer=await api('/api/v1/invitations/bulk',{method:'POST',body:JSON.stringify({items})});
        // Показываем построчно и в том же порядке: человек сверяет ответ
        // со своей таблицей глазами, а не ищет в ней адреса.
        $('#bulk-result').innerHTML=`<h3 class="person-section"><span>Разослано</span> ${answer.invited} <span>из</span> ${answer.total}</h3>
          <div class="person-feed">${answer.results.map(row=>`<div class="person-event">
            <span>${esc(row.email)}${row.unit?`<span class="row-sub">${esc(row.unit)}</span>`:''}</span>
            <span class="inline-actions">${row.foreignDomain?'<span class="chip warm">чужой домен</span>':''}<span class="chip ${row.status==='invited'?'good':row.status==='already'?'':'warm'}">${esc(BULK_STATUS[row.status]||row.status)}</span></span>
          </div>`).join('')}</div>`;
        // Приглашённые появятся в списке людей только после того, как
        // войдут, но счётчики и каталог обновить стоит сразу.
        S.people=(await api('/api/v1/bootstrap')).people||S.people;
      }catch(error){toast(error.message)}
    };
  });
}

/**
 * Кого уже позвали.
 *
 * Позвав сорок человек списком, узнать, кто дошёл, было неоткуда:
 * приглашения жили только в письмах. Через неделю пригласивший не
 * помнит, кому слать повторно, и зовёт заново всех — а человек получает
 * второе письмо и думает, что первое было подделкой.
 */
async function renderPendingInvites(){
  const box=$('#invite-pending');
  if(!box)return;
  try{
    const{items}=await api('/api/v1/invitations');
    const seats=S.boot?.company?.seatLimit
      ?`<p class="muted" style="margin:10px 0 0;font-size:12px"><span>Мест</span> ${S.boot.company.seatLimit}, <span>занято</span> ${S.boot.company.seatsUsed} <span>людьми и</span> ${items.length} <span>неотвеченными приглашениями.</span> <span>Гости мест не занимают.</span></p>`
      :'';
    if(!items.length){box.innerHTML=seats;return}
    box.innerHTML=`<h3 class="person-section">Ждут ответа — ${items.length}</h3>
      <div class="person-feed">${items.map(i=>`<div class="person-event">
        <span><div class="row-title">${esc(i.email)}</div>
          <div class="row-sub">${esc(ROLE_LABEL[i.role]||i.role)}${i.unitName?` · ${esc(i.unitName)}`:i.unitClosed?' · закрытое подразделение':''}${i.invitedByName?` · позвал ${esc(i.invitedByName)}`:''}</div></span>
        <span class="inline-actions">${i.expired?'<span class="chip warm">срок вышел</span>':''}
          <button type="button" class="text-button" data-resend="${esc(i.id)}">позвать заново</button>
          <button type="button" class="text-button" data-revoke="${esc(i.id)}">отозвать</button></span>
      </div>`).join('')}</div>${seats}`;
    $$('[data-resend]').forEach(b=>b.onclick=async()=>{
      // Старая ссылка при этом закрывается: две живые ссылки на один
      // адрес — это два входа, и закрывать потом придётся обе.
      try{
        const{mail}=await api(`/api/v1/invitations/${b.dataset.resend}/resend`,{method:'POST',body:'{}'});
        toast((mail?.willSend??mail?.queued)?'Письмо отправлено заново':'Почта не настроена — передайте ссылку сами');
        await renderPendingInvites();
      }catch(error){toast(error.message)}
    });
    $$('[data-revoke]').forEach(b=>b.onclick=async()=>{
      try{await api(`/api/v1/invitations/${b.dataset.revoke}`,{method:'DELETE'});toast('Приглашение отозвано');await renderPendingInvites()}
      catch(error){toast(error.message)}
    });
  }catch{box.innerHTML=''}
}

const ROLE_LABEL={owner:'владелец',admin:'администратор',manager:'руководитель',member:'сотрудник',guest:'гость'};

function inviteModal(){modal('Пригласить сотрудника',`<div class="stack" style="margin-bottom:14px"><button type="button" data-bulk class="button secondary pressable">Пригласить списком — сразу весь отдел</button></div><form id="invite-form" class="form-stack"><label>Email<input name="email" type="email" required></label><label>Роль<select name="role" class="field"><option value="member">Сотрудник</option><option value="manager">Руководитель</option><option value="admin">Администратор</option><option value="guest">Гость</option></select></label>
    <label id="invite-unit-field" hidden>Подразделение<select name="unitId" class="field"><option value="">без подразделения</option></select></label>
    <p class="muted" id="invite-domain-hint" style="margin:-4px 0 0;font-size:12px" hidden></p>
    <label id="invite-until-field" hidden>Доступ до<input name="accessUntil" type="datetime-local"></label>
    <p class="muted" id="invite-until-hint" style="margin:-4px 0 0;font-size:12px" hidden>Проект закончится, а доступ к переписке и файлам останется — срок закроет его сам.</p><button class="button primary">Создать приглашение</button></form><div id="invite-pending"></div>`);
  // Срок доступа спрашиваем только у гостя: сотрудник здесь работает, и
  // предлагать ему дату окончания — странный приём на работу.
  $('[data-bulk]').onclick=()=>replaceModal(bulkInviteModal);
  renderPendingInvites();
  const roleSelect=$('#invite-form [name="role"]');
  const untilField=$('#invite-until-field'),untilHint=$('#invite-until-hint');
  const unitField=$('#invite-unit-field'),unitSelect=unitField.querySelector('select');
  const domainHint=$('#invite-domain-hint'),emailInput=$('#invite-form [name="email"]');

  // Подразделения, куда этот человек вправе звать. Список тот же, что у
  // добавления вручную: приглашение не должно быть обходом — в закрытый
  // отдел письмом не заводят так же, как не заводят кнопкой.
  (async()=>{
    try{
      const data=await api('/api/v1/org/units');
      const managed=new Set(data.managedUnitIds||[]);
      const wide=Boolean(data.canManage);
      const allowed=(data.items||[]).filter(u=>u.closed?u.inside:(wide||managed.has(u.id)));
      if(!allowed.length)return;
      unitSelect.insertAdjacentHTML('beforeend',allowed.map(u=>
        `<option value="${esc(u.id)}">${u.closed?'⊘ ':''}${esc(u.name)}</option>`).join(''));
      syncGuest();
    }catch{/* без оргструктуры поле просто не появится */}
  })();

  // Гостя в оргструктуру не ставят: он чужой сотрудник, и схема компании
  // врала бы про то, кто здесь работает.
  function syncGuest(){
    const guest=roleSelect.value==='guest';
    untilField.hidden=!guest;untilHint.hidden=!guest;
    unitField.hidden=guest||unitSelect.options.length<2;
    checkDomain();
  }
  // Адрес не на домене компании — повод присмотреться, а не отказ: у
  // гостя он чужой по определению.
  function checkDomain(){
    const domain=String(S.boot?.company?.emailDomain||'').toLowerCase();
    const value=String(emailInput.value||'').toLowerCase();
    const foreign=domain&&roleSelect.value!=='guest'&&value.includes('@')&&!value.endsWith('@'+domain);
    domainHint.hidden=!foreign;
    if(foreign)domainHint.textContent=`Адрес не на домене компании (@${domain}). Проверьте, тот ли это человек — или пригласите его гостем.`;
  }
  emailInput.oninput=checkDomain;
  roleSelect.onchange=syncGuest;syncGuest();
  $('#invite-form').onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    try{
      const until=f.get('accessUntil');
      const{invitation,mail}=await api('/api/v1/invitations',{method:'POST',body:JSON.stringify({
        email:f.get('email'),role:f.get('role'),unitId:f.get('unitId')||null,
        // Срок ставится только гостю: сотрудник здесь работает, и
        // напоминать ему об увольнении датой в форме незачем.
        accessUntil:f.get('role')==='guest'&&until?new Date(until).toISOString():null,
      })});
      // Ушло письмо или нет — разные дела: во втором случае ссылку
      // действительно надо передать руками, и человек должен это знать,
      // а не гадать, почему коллега не приходит.
      const posted=mail?.willSend??mail?.queued
        ?`<p class="muted">Приглашение отправлено на ${esc(f.get('email'))}. Ссылка действует 7 дней — её можно передать и самому.</p>`
        :`<p class="muted">Почтовый канал не настроен, поэтому письмо не ушло: передайте ссылку сами. Она действует 7 дней.</p>`;
      modal('Приглашение готово',`${posted}
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
function teamModal(){modal('Команда',S.people.map(p=>`<button class="row pressable" data-person="${esc(p.userId)}" style="width:100%;text-align:left">${personAvatar(p)}<span><div class="row-title">${esc(p.displayName||p.email)}${p.active===false?' · уволен':''}</div><div class="row-sub">${availabilityNote(p.presence)||esc(p.title||roleWord(p.role))}</div></span><span class="presence-dot ${esc(p.presence?.state||'offline')}"></span></button>`).join(''),()=>{
  $$('[data-person]').forEach(b=>{b.onclick=()=>personPage(b.dataset.person)});
})}
/**
 * Профиль и безопасность.
 *
 * Здесь были три строки: имя, кнопка push и «Выйти». Сменить пароль
 * изнутри было нельзя вовсе — только через «я забыл пароль», то есть
 * выйти и ждать письма. Список входов не показывался нигде, и утёкший
 * сеанс отозвать было нечем: украденный ноутбук оставался внутри до
 * истечения срока.
 */
/**
 * Переключатели уведомлений — по смыслу, а не по типам событий: человек
 * думает «меня позвали» и «сроки», а не «message.mentioned» и
 * «task.rescheduled».
 */
/**
 * Черновики сообщений.
 *
 * Набранный и неотправленный текст пропадал при переходе в другую
 * беседу — а это самая обидная потеря из возможных: человек только что
 * его придумал.
 *
 * Черновик лежит в браузере, а не на сервере, и намеренно. Неотправленный
 * текст — самое личное, что есть у человека в рабочем пространстве:
 * передумал, стёр, переписал. Отправлять его в чужую базу ради
 * синхронизации между устройствами — плохой обмен.
 *
 * Хранилище может быть недоступно (приватное окно, запрет на сайт), и
 * тогда всё просто работает как раньше: черновик не сохраняется, но
 * ничего не ломается.
 */
/** Что показать в списке: неотправленный текст важнее последнего сообщения. */
const previewOf=(conversation,fallback)=>{
  const draft=readDraft(conversation.id);
  return draft?`<span class="draft-mark">Черновик:</span> ${esc(draft.slice(0,80))}`:fallback;
};
const draftKey=(conversationId)=>`chat:draft:${me()?.workspaceId??'-'}:${conversationId}`;
function readDraft(conversationId){
  try{return localStorage.getItem(draftKey(conversationId))||''}catch{return ''}
}
function writeDraft(conversationId,text){
  try{
    const value=String(text??'');
    if(value.trim())localStorage.setItem(draftKey(conversationId),value);
    else localStorage.removeItem(draftKey(conversationId));
  }catch{}
  // Список бесед показывает, где остался неотправленный текст: иначе о
  // черновике вспоминают, только снова открыв беседу.
  // Карточки беседы рисуются двумя разными функциями и помечаются
  // разными атрибутами — подрисовываем обе, иначе в одном списке
  // черновик виден, а в другом нет.
  const draft=readDraft(conversationId);
  if(!draft)return;
  const selector=`.conversation-card[data-open="${CSS.escape(conversationId)}"] .preview,`
    +`.conversation-card[data-conversation="${CSS.escape(conversationId)}"] .preview`;
  for(const card of document.querySelectorAll(selector)){
    card.innerHTML=`<span class="draft-mark">Черновик:</span> ${esc(draft.slice(0,80))}`;
  }
}

const NOTIFY_SWITCHES=[
  ['mentions','Меня упомянули','Когда вас назвали по имени в переписке.'],
  ['direct','Личные сообщения','Переписка один на один и входящие звонки.'],
  ['channels','Сообщения в каналах','Всё остальное в беседах, где вы состоите.'],
  ['tasks','Обязательства','Вам поручили, передали задачу или изменили срок.'],
  ['calendar','Календарь','Приглашения, переносы и отмены встреч.'],
  ['meetings','Итоги встреч','Когда расшифровка и решения готовы.'],
];
const HOURS=Array.from({length:24},(_,h)=>h);

const deviceName=(agent)=>{
  const value=String(agent||'');
  if(!value)return 'Неизвестное устройство';
  const os=/iphone|ipad/i.test(value)?'iPhone':/android/i.test(value)?'Android'
    :/mac os|macintosh/i.test(value)?'Mac':/windows/i.test(value)?'Windows'
    :/linux/i.test(value)?'Linux':null;
  const browser=/edg\//i.test(value)?'Edge':/chrome|crios/i.test(value)?'Chrome'
    :/firefox|fxios/i.test(value)?'Firefox':/safari/i.test(value)?'Safari':null;
  return [os,browser].filter(Boolean).join(' · ')||value.slice(0,40);
};
/**
 * Запасные коды показываются ровно один раз.
 *
 * Хранить их в базе открытыми — это тот же пароль, записанный десять
 * раз, поэтому второго шанса посмотреть не будет, и об этом надо
 * сказать прямо, а не мелким шрифтом.
 */
function recoveryCodesModal(codes){
  modal('Запасные коды',`
    <p class="muted">Каждый код работает один раз. Сохраните их там, где найдёте без телефона: если телефон потерян или сломан, войти можно будет только по ним.</p>
    <pre class="mono recovery-codes">${codes.map(c=>esc(c)).join('\n')}</pre>
    <p class="muted">Показываем один раз: в базе хранятся только отпечатки, и восстановить список нельзя — можно лишь выпустить новый.</p>
    <div class="stack"><button class="button secondary pressable" data-copy>Скопировать</button></div>
  `,()=>{
    $('[data-copy]').onclick=async()=>{
      try{await navigator.clipboard.writeText(codes.join('\n'));toast('Коды скопированы')}
      catch{toast('Браузер не дал доступ к буферу — перепишите вручную')}
    };
  });
}

/**
 * Настройка второго множителя.
 *
 * Секрет показываем и строкой: не у всех есть чем сканировать
 * изображение с того же экрана, на котором оно нарисовано.
 */
function twoFactorSetupModal(started,done){
  modal('Второй множитель',`
    <p class="muted">Откройте приложение-аутентификатор и добавьте новую учётную запись. Можно перейти по ссылке с этого же устройства или ввести ключ руками.</p>
    <div class="stack">
      <a class="button secondary pressable" href="${esc(started.otpauth)}">Добавить в приложение</a>
      <!-- Блок с переносом, а не поле: в узкое поле на телефоне ключ из
           тридцати двух знаков не помещается, а переписывают его руками
           ровно там, где нечем сканировать. -->
      <div><div class="row-sub">Ключ</div><pre class="mono recovery-codes" data-secret>${esc(started.secret.replace(/(.{4})/g,'$1 ').trim())}</pre></div>
      <button type="button" class="button secondary pressable" data-copy-secret>Скопировать ключ</button>
    </div>
    <p class="muted">Пока код не подтверждён, вход не меняется: ошибка в настройке не запрёт вас снаружи.</p>
    <form id="two-factor-confirm" class="form-stack">
      <label>Код из приложения<input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" required></label>
      <button class="button primary pressable" type="submit">Включить</button>
    </form>
  `,()=>{
    $('[data-copy-secret]').onclick=async()=>{
      try{await navigator.clipboard.writeText(started.secret);toast('Ключ скопирован')}
      catch{toast('Браузер не дал доступ к буферу — перепишите вручную')}
    };
    const form=$('#two-factor-confirm');
    form.onsubmit=async(event)=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      button.disabled=true;
      try{
        const r=await api('/api/v1/auth/two-factor/confirm',{method:'POST',body:JSON.stringify({code:new FormData(form).get('code')})});
        closeModal();
        // Сначала обновляем то, что под нами, и только потом показываем
        // коды: обновление переписывает верхнее окно, и коды, которые
        // видно ровно один раз, исчезали, не успев попасть человеку в
        // руки.
        await done?.();
        recoveryCodesModal(r.recoveryCodes);
      }catch(error){button.disabled=false;toast(error.code==='TWO_FACTOR_BAD_CODE'?'Код не подошёл — проверьте время на телефоне':error.message)}
    };
  });
}

/**
 * Установка на устройство.
 *
 * Chrome даёт предложение сам, но один раз и молча; Safari не даёт
 * вовсе — там это делается через «Поделиться». Поэтому в настройках
 * либо кнопка, либо строчка о том, куда нажать: «установите приложение»
 * без объяснения, где, — это не подсказка.
 */
const standalone=()=>window.matchMedia?.('(display-mode: standalone)')?.matches||window.navigator.standalone===true;
const iOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
function installHint(){
  if(standalone())return 'Уже установлено: вы открыли его как приложение.';
  if(S.installPrompt)return 'Откроется в своём окне, без адресной строки, и будет в общем списке приложений.';
  if(iOS())return 'В Safari нажмите «Поделиться» и выберите «На экран „Домой“» — приложение появится рядом с остальными.';
  return 'Ваш браузер ставит приложения из своего меню — обычно это «Установить приложение» рядом с адресной строкой.';
}

async function profileModal(){
  const build=async()=>{
    let sessions=[];
    let sessionsError=null;
    let settings={};
    try{sessions=(await api('/api/v1/auth/sessions')).items||[]}
    catch(error){sessionsError=error.message}
    try{settings=(await api('/api/v1/notification-preferences')).preferences||{}}
    catch{settings={}}
    let second=null;
    try{second=await api('/api/v1/auth/two-factor')}
    catch{second=null}
    return{
      title:'Профиль и безопасность',
      body:`<div class="row">${personAvatar(me().userId,me().displayName)}
        <span><div class="row-title">${esc(me().displayName)}</div>
          <div class="row-sub">${esc(me().email)} · <span>${esc(roleWord(me().role))}</span></div></span></div>

      <div class="section-head" style="margin-top:16px"><div><h3>Фотография</h3>
        <p class="muted">Помогает отличать вас от тёзок и коллег с похожими инициалами — без фото все видят один и тот же серый кружок.</p></div></div>
      <form id="avatar-form" class="form-stack">
        <label>Новая фотография<input name="avatar" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" required></label>
        <button class="button secondary pressable" type="submit">Поставить фотографию</button>
        ${person(me().userId)?.avatarUrl?'<button type="button" class="button ghost pressable" data-drop-avatar>Убрать фотографию</button>':''}
      </form>

      <div class="section-head" style="margin-top:16px"><div><h3>Пароль</h3>
        <p class="muted">Старый пароль спрашиваем не для порядка: без него всякий, кто дошёл до незапертого ноутбука, запрёт вас снаружи.</p></div></div>
      <form id="password-form" class="form-stack">
        <label>Текущий пароль<input name="currentPassword" type="password" autocomplete="current-password" required></label>
        <label>Новый пароль<input name="password" type="password" autocomplete="new-password" minlength="12" placeholder="Не менее 12 символов и цифра" required></label>
        <button class="button primary pressable" type="submit">Сменить пароль</button>
      </form>

      ${second?`<div class="section-head" style="margin-top:16px"><div><h3>Второй множитель</h3>
        <p class="muted">${second.available
          ?'Код из приложения-аутентификатора в дополнение к паролю. Подсмотренного или подобранного пароля тогда мало, чтобы войти в переписку компании и сейф паролей.'
          :'Недоступен: на сервере не настроен ключ шифрования, а хранить секрет второго множителя в открытом виде нельзя.'}</p></div></div>
      ${second.available?(second.enabled
        ?`<div class="row flow"><span><div class="section-title">Включён</div>
            <div class="row-sub"><span>Запасных кодов осталось:</span> ${second.recoveryCodesLeft}${second.lastUsedAt?` · <span>последний раз</span> ${esc(dateTime(second.lastUsedAt))}`:''}</div></span>
            <button type="button" class="button small secondary pressable" data-2fa-codes>Новые запасные коды</button>
            <button type="button" class="button small danger pressable" data-2fa-off>Выключить</button></div>`
        :`<div class="stack"><button type="button" class="button secondary pressable" data-2fa-on>Включить второй множитель</button></div>`)
      :''}`:''}

      <div class="section-head" style="margin-top:16px"><div><h3>Где вы вошли</h3>
        <p class="muted">Смена пароля закрывает все остальные входы.</p></div>
        ${sessions.length>1?'<button class="button small secondary pressable" data-revoke-others>Выйти везде</button>':''}</div>
      ${sessionsError?`<div class="empty"><strong>Список входов недоступен</strong>${esc(sessionsError)}</div>`
        :sessions.map(x=>`<div class="row flow">
          <span><div class="row-title">${esc(deviceName(x.userAgent))}</div>
            <div class="row-sub">${x.current?'<span>это устройство</span> · ':''}${esc(x.ipAddress||'адрес неизвестен')} · <span>заходили</span> ${esc(dateTime(x.lastSeenAt))}</div></span>
          ${x.current?'':`<button type="button" class="button small secondary pressable" data-revoke="${esc(x.id)}">Выйти</button>`}
        </div>`).join('')}

      <div class="section-head" style="margin-top:16px"><div><h3>Что присылать</h3>
        <p class="muted">Касается только push — того, что прерывает. Список уведомлений внутри приложения остаётся полным.</p>
        ${S.boot?.push?.enabled?'':'<p class="warn-text">На этом сервере push пока не подключён, поэтому переключатели ниже ни на что не влияют: всё приходит только в список уведомлений. Настройки сохранятся и заработают, когда push включат.</p>'}</div></div>
      <form id="notify-form" class="form-stack">
        ${NOTIFY_SWITCHES.map(([name,caption,hint])=>`<label class="switch-row">
          <input type="checkbox" name="${name}" ${settings[name]===false?'':'checked'}>
          <span><span class="section-title">${caption}</span><span class="row-sub">${hint}</span></span></label>`).join('')}
        <label class="switch-row"><input type="checkbox" name="quiet" ${settings.quietFrom===null||settings.quietFrom===undefined?'':'checked'}>
          <span><span class="section-title">Тихие часы</span><span class="row-sub">В выбранные часы push не приходит. Одинаковые «с» и «до» означают, что тихих часов нет.</span></span></label>
        <div class="quiet-row" ${settings.quietFrom===null||settings.quietFrom===undefined?'hidden':''}>
          <label>С<select name="quietFrom" class="field">${HOURS.map(h=>`<option value="${h}" ${(settings.quietFrom??22)===h?'selected':''}>${String(h).padStart(2,'0')}:00</option>`).join('')}</select></label>
          <label>До<select name="quietTo" class="field">${HOURS.map(h=>`<option value="${h}" ${(settings.quietTo??8)===h?'selected':''}>${String(h).padStart(2,'0')}:00</option>`).join('')}</select></label>
        </div>
        <label class="switch-row" ${settings.quietFrom===null||settings.quietFrom===undefined?'hidden':''} data-quiet-exception>
          <input type="checkbox" name="quietAllowMentions" ${settings.quietAllowMentions===false?'':'checked'}>
          <span><span class="section-title">Кроме личных обращений</span><span class="row-sub">Если вас позвали по имени, уведомление придёт и в тихий час.</span></span></label>
        <label class="switch-row"><input type="checkbox" name="dailyDigest" ${settings.dailyDigest?'checked':''}>
          <span><span class="section-title">Сводка письмом раз в день</span>
            <span class="row-sub">Что случилось без вас — на почту. Полезно тем, кто днями на объекте и в приложение не заходит.</span></span></label>
        <div class="quiet-row" ${settings.dailyDigest?'':'hidden'} data-digest-hour>
          <label>Присылать в<select name="digestHour" class="field">${HOURS.map(h=>`<option value="${h}" ${Number(settings.digestHour??8)===h?'selected':''}>${String(h).padStart(2,'0')}:00</option>`).join('')}</select></label>
        </div>
        <p class="muted" style="font-size:12px"><span>Время считается по вашему поясу:</span> ${esc(settings.timezone||'UTC')}.</p>
        <button class="button primary pressable" type="submit">Сохранить</button>
      </form>

      <div class="section-head" style="margin-top:16px"><div><h3>Приложение на устройстве</h3>
        <p class="muted">${installHint()}</p></div></div>
      <div class="stack">${S.installPrompt?'<button type="button" data-install class="button secondary pressable">Установить приложение</button>':''}</div>

      <div class="stack" style="margin-top:16px">
        <button data-push class="button secondary">Включить push</button>
        <button data-logout class="button danger">Выйти</button>
      </div>`,
      after:()=>{
        $('[data-push]').onclick=enablePush;
        const install=$('[data-install]');
        if(install)install.onclick=async()=>{
          const prompt=S.installPrompt;
          if(!prompt)return;
          install.disabled=true;
          prompt.prompt();
          const {outcome}=await prompt.userChoice;
          // Предложение одноразовое: второй раз браузер его не отдаст.
          S.installPrompt=null;
          toast(outcome==='accepted'?'Приложение устанавливается':'Хорошо, не ставим');
          await refresh();
        };
        $('[data-logout]').onclick=logout;
        const notify=$('#notify-form');
        const quietBox=notify.querySelector('[name="quiet"]');
        const quietRow=notify.querySelector('.quiet-row');
        const quietException=notify.querySelector('[data-quiet-exception]');
        quietBox.onchange=()=>{quietRow.hidden=!quietBox.checked;quietException.hidden=!quietBox.checked};
        const digestBox=notify.querySelector('[name="dailyDigest"]');
        const digestRow=notify.querySelector('[data-digest-hour]');
        digestBox.onchange=()=>{digestRow.hidden=!digestBox.checked};
        notify.onsubmit=async(event)=>{
          event.preventDefault();
          const data=new FormData(notify);
          const quiet=data.get('quiet')==='on';
          const body={
            ...Object.fromEntries(NOTIFY_SWITCHES.map(([name])=>[name,data.get(name)==='on'])),
            quietFrom:quiet?Number(data.get('quietFrom')):null,
            quietTo:quiet?Number(data.get('quietTo')):null,
            quietAllowMentions:data.get('quietAllowMentions')==='on',
            dailyDigest:data.get('dailyDigest')==='on',
            digestHour:Number(data.get('digestHour')),
          };
          try{await api('/api/v1/notification-preferences',{method:'PUT',body:JSON.stringify(body)});toast('Настройки сохранены')}
          catch(error){toast(error.message)}
        };
        const saveAvatar=async(fileId)=>{
          await api(`/api/v1/people/${me().userId}`,{method:'PATCH',body:JSON.stringify({avatarFileId:fileId})});
          // Своё лицо человек видит в трёх местах сразу — в карточке
          // сбоку, в списке людей и в собственных сообщениях, — поэтому
          // перечитываем список, а не правим одну строку.
          S.people=(await api('/api/v1/bootstrap')).people||S.people;
          shell();render();await refresh();
        };
        const avatarForm=$('#avatar-form');
        avatarForm.onsubmit=async(event)=>{
          event.preventDefault();
          const file=avatarForm.querySelector('[name="avatar"]').files[0];
          if(!file)return toast('Выберите снимок.');
          const button=avatarForm.querySelector('button[type="submit"]');
          button.disabled=true;
          try{await saveAvatar(await uploadPicture(file));toast('Фотография обновлена')}
          catch(error){button.disabled=false;toast(ERROR_MESSAGE[error.code]||error.message)}
        };
        const dropAvatar=$('[data-drop-avatar]');
        if(dropAvatar)dropAvatar.onclick=async()=>{
          dropAvatar.disabled=true;
          try{await saveAvatar(null);toast('Фотография убрана')}
          catch(error){dropAvatar.disabled=false;toast(error.message)}
        };
        const askPassword=(what)=>{
          // Сеанс бывает украден: шаг, снимающий защиту, подтверждается
          // паролем, а не одним лишь тем, что вкладка открыта.
          const value=prompt(`${what}\n\nПодтвердите паролем:`);
          return value===null?null:value;
        };
        const on=$('[data-2fa-on]');
        if(on)on.onclick=async()=>{
          on.disabled=true;
          try{
            const started=await api('/api/v1/auth/two-factor',{method:'POST'});
            twoFactorSetupModal(started,refresh);
          }catch(error){on.disabled=false;toast(error.message)}
        };
        const off=$('[data-2fa-off]');
        if(off)off.onclick=async()=>{
          const password=askPassword('Второй множитель будет выключен, запасные коды перестанут действовать.');
          if(password===null)return;
          off.disabled=true;
          try{await api('/api/v1/auth/two-factor',{method:'DELETE',body:JSON.stringify({password})});toast('Второй множитель выключен');await refresh()}
          catch(error){off.disabled=false;toast(error.code==='WRONG_PASSWORD'?'Пароль не подошёл':error.message)}
        };
        const codes=$('[data-2fa-codes]');
        if(codes)codes.onclick=async()=>{
          const password=askPassword('Прежние запасные коды перестанут действовать.');
          if(password===null)return;
          codes.disabled=true;
          try{const r=await api('/api/v1/auth/two-factor/recovery-codes',{method:'POST',body:JSON.stringify({password})});await refresh();recoveryCodesModal(r.recoveryCodes)}
          catch(error){codes.disabled=false;toast(error.code==='WRONG_PASSWORD'?'Пароль не подошёл':error.message)}
        };
        const form=$('#password-form');
        form.onsubmit=async(event)=>{
          event.preventDefault();
          const button=form.querySelector('button[type="submit"]');
          button.disabled=true;
          const data=new FormData(form);
          try{
            const result=await api('/api/v1/auth/password',{method:'POST',body:JSON.stringify({
              currentPassword:data.get('currentPassword'),password:data.get('password')})});
            toast(result.sessionsRevoked
              ?`Пароль сменён, другие входы закрыты: ${result.sessionsRevoked}`
              :'Пароль сменён');
            await refresh();
          }catch(error){
            button.disabled=false;
            toast(error.code==='WRONG_PASSWORD'?'Текущий пароль не подошёл':error.message);
          }
        };
        const others=$('[data-revoke-others]');
        if(others)others.onclick=async()=>{
          others.disabled=true;
          try{const r=await api('/api/v1/auth/sessions/revoke-others',{method:'POST'});toast(`Закрыто входов: ${r.revoked}`);await refresh()}
          catch(error){others.disabled=false;toast(error.message)}
        };
        $$('[data-revoke]').forEach(b=>b.onclick=async()=>{
          b.disabled=true;
          try{await api(`/api/v1/auth/sessions/${b.dataset.revoke}`,{method:'DELETE'});toast('Вход закрыт');await refresh()}
          catch(error){b.disabled=false;toast(error.message)}
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
  modal(first.title,first.body,first.after,()=>build());
}
async function logout(){await api('/api/v1/auth/logout',{method:'POST'}).catch(()=>{});S.ws?.close();S.boot=null;closeModal();auth()}
async function enablePush(){try{if(!S.boot?.push?.enabled)return toast('На сервере ещё не настроены VAPID-ключи.');if(!S.swReady)return toast('Браузер не разрешил фоновый сценарий — push здесь недоступен.');if(await Notification.requestPermission()!=='granted')return toast('Push не разрешён.');const r=await navigator.serviceWorker.ready;let sub=await r.pushManager.getSubscription();if(!sub)sub=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(S.boot.push.publicKey)});await api('/api/v1/push-subscriptions',{method:'POST',body:JSON.stringify(sub)});toast('Push включён')}catch(e){toast(e.message)}}
function key(v){const s=(v+'='.repeat((4-v.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(s);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}
function connect(){S.ws?.close();const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);S.ws=ws;ws.onmessage=async e=>{try{const p=JSON.parse(e.data),d=p.data;if(p.event==='game.updated'){if(S.gameWatch&&d?.gameId===S.gameWatch)resumeTop();return}if(p.event==='message.created'){
  // Ответ в ветке не падает в общую ленту — там стоит корень со
  // счётчиком, и он должен вырасти сам, без перезагрузки экрана.
  if(d.message.threadRootId){
    const list=S.messages.get(d.conversationId);
    const root=list?.find(x=>x.id===d.message.threadRootId);
    if(root){root.replyCount=(root.replyCount||0)+1;root.lastReplyAt=d.message.createdAt}
  }else append(d.conversationId,d.message);
  if(S.view==='chats')render()}if(p.event==='message.reaction'){for(const list of S.messages.values()){const m=list.find(x=>x.id===d.messageId);if(m)m.reactions=d.reactions}if(S.view==='chats')render()}if(p.event==='message.updated'){updateMessage(d.message.id,d.message);if(S.view==='chats')render()}if(p.event==='message.deleted'){updateMessage(d.message.id,d.message);if(S.view==='chats')render()}if(p.event==='message.pin'){updateMessage(d.messageId,{pinned:d.pinned});if(S.view==='chats')render()}if(p.event==='conversation.created'){rememberConversation(d);shell();if(S.view==='chats')render()}if(p.event==='presence.updated'){const x=person(d.userId);if(x)x.presence=d.presence;lists()}if(p.event==='task.created'&&!S.tasks.some(x=>x.id===d.id)){S.tasks.unshift(d);if(['today','tasks'].includes(S.view))render()}if(p.event==='task.updated'){upsertTask(d);if(S.view==='tasks')await loadTaskPage();if(['today','tasks'].includes(S.view))render()}if(p.event==='calendar.created'&&!S.calendar.some(x=>x.id===d.id)){S.calendar.push(d);if(['today','calendar'].includes(S.view))render()}if(p.event==='typing.start'||p.event==='typing.stop'){if(d.conversationId===S.selected&&$('#typing'))$('#typing').textContent=p.event.endsWith('start')?`${name(d.userId)} печатает…`:''}}catch{}};ws.onclose=()=>S.boot&&setTimeout(connect,1600)}
async function voice(){if(S.recorder?.state==='recording'){S.recorder.stop();return}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true}),chunks=[],r=new MediaRecorder(stream);S.recorder=r;S.recordingAt=Date.now();r.ondataavailable=e=>e.data.size&&chunks.push(e.data);r.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:r.mimeType||'audio/webm'}),duration=Date.now()-S.recordingAt;S.recorder=null;const resp=await fetch(`/api/v1/conversations/${S.selected}/voice?durationMs=${duration}`,{method:'POST',credentials:'same-origin',headers:{'content-type':blob.type},body:blob}),p=await resp.json();if(resp.ok){append(S.selected,p.message);render()}else toast(p?.error?.message||'Ошибка записи')};r.start(250);toast('Запись началась — нажмите ещё раз, чтобы отправить.')}catch{toast('Нет доступа к микрофону.')}}
$('#file-picker').onchange=async e=>{for(const file of e.target.files){const r=await fetch('/api/v1/files',{method:'POST',credentials:'same-origin',headers:{'content-type':file.type||'application/octet-stream','x-file-name':encodeURIComponent(file.name)},body:file}),p=await r.json();if(!r.ok){toast(p?.error?.message||'Ошибка загрузки');continue}const{message}=await api(`/api/v1/conversations/${S.selected}/messages`,{method:'POST',body:JSON.stringify({kind:'file',metadata:{fileId:p.file.id,name:file.name,mimeType:file.type,size:file.size,contentUrl:p.file.contentUrl}})});append(S.selected,message)}e.target.value='';render()};
$$('[data-auth-mode]').forEach(b=>b.onclick=()=>setAuth(b.dataset.authMode));/**
 * Вход со вторым множителем.
 *
 * Поле кода появляется только после того, как сервер его попросил:
 * большинству входов оно не нужно, а пустая строка под паролем каждый
 * раз — это лишний вопрос на самом видном экране продукта.
 */
$('#login-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const code=String(f.get('code')||'').trim();try{await api('/api/v1/auth/login',{method:'POST',body:JSON.stringify({email:f.get('email'),password:f.get('password'),...(code?{code}:{})})});bootstrap()}catch(x){
  if(x.code==='TWO_FACTOR_REQUIRED'||x.code==='TWO_FACTOR_BAD_CODE'){
    const row=$('#login-code-row');row.hidden=false;const input=row.querySelector('input');input.value='';input.focus();
    $('#auth-error').textContent=x.code==='TWO_FACTOR_REQUIRED'?'Введите код из приложения-аутентификатора или запасной код.':x.message;
    return;
  }
  $('#auth-error').textContent=x.message}};$('#join-toggle').onclick=()=>{
  // Показываем одну форму вместо другой: две подряд на одном экране —
  // это вопрос «а куда вводить».
  $('.segmented').hidden=true;$('#login-form').hidden=true;$('#demo-access').hidden=true;
  $('#join-form').hidden=false;$('#auth-title').textContent='Войти по рабочей почте';
  $('#auth-error').textContent='';$('#auth-error').classList.remove('notice');
};
$('#join-back').onclick=()=>{$('#join-form').hidden=true;$('#demo-access').hidden=false;
  $('#auth-error').textContent='';$('#auth-error').classList.remove('notice');setAuth('login')};
$('#join-form').onsubmit=async e=>{
  e.preventDefault();
  const f=new FormData(e.currentTarget);
  try{
    const answer=await api('/api/v1/auth/join',{method:'POST',body:JSON.stringify({email:f.get('email')})});
    // Ответ одинаковый и когда компания нашлась, и когда нет: иначе
    // этот экран превращается в справочник «кто здесь есть». И это не
    // отказ, поэтому не красным: человек всё сделал правильно.
    $('#auth-error').textContent=answer.message;
    $('#auth-error').classList.add('notice');
  }catch(x){$('#auth-error').classList.remove('notice');$('#auth-error').textContent=x.message}
};
$('#register-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/v1/auth/register-company',{method:'POST',body:JSON.stringify({companyName:f.get('companyName'),ownerName:f.get('ownerName'),email:f.get('email'),password:f.get('password')})});
      // Реквизиты необязательные, поэтому идут вторым шагом: пространство
      // уже создано, и неудача здесь не должна отменить регистрацию.
      const details={legalName:f.get('legalName'),taxId:f.get('taxId'),emailDomain:f.get('emailDomain')};
      if(Object.values(details).some(v=>String(v||'').trim())){
        await api('/api/v1/workspace',{method:'PATCH',body:JSON.stringify(details)}).catch(()=>{});
      }
      bootstrap()}catch(x){$('#auth-error').textContent=x.message}};$('#accept-invite-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/v1/invitations/accept',{method:'POST',body:JSON.stringify({token:e.currentTarget.dataset.token,displayName:f.get('displayName'),password:f.get('password')})});history.replaceState({},'',location.pathname);bootstrap()}catch(x){$('#auth-error').textContent=x.message}};
window.CHAT_ERRORS=ERROR_MESSAGE;
// Соседним модулям нужен переход к сообщению: раньше они искали строку в
// разметке двенадцать раз подряд и молча сдавались.
// Поиск живёт в отдельном файле и не видит внутренностей приложения:
// всё, чем он открывает найденное, проходит через эту дверь.
window.ChatApp={openChatAtMessage,role:()=>me()?.role??null,openPerson:personPage,openTask,openEvent:eventPage,openTaskFilter};
// Предложение установки приходит один раз и до того, как человек
// откроет настройки: держим его, пока оно не понадобится.
window.addEventListener('beforeinstallprompt',(event)=>{event.preventDefault();S.installPrompt=event});
window.addEventListener('appinstalled',()=>{S.installPrompt=null});
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').then(()=>{S.swReady=true}).catch(error=>{S.swError=error?.message||String(error)});bootstrap();
