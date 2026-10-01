const D={attention:null,conversations:[],people:[],notifications:[],notificationFilter:'all',searchType:'all',searchFrom:'',searchTo:'',searchPeriod:'any',files:[],fileCursor:null,fileMime:null,fileQuery:'',mentionIndex:0,mentionItems:[],refreshing:false,lastRefresh:0};
const $=(q,r=document)=>r.querySelector(q),$$=(q,r=document)=>[...r.querySelectorAll(q)];
const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const locale=()=>window.ChatPreferences?.locale==='en'?'en':'ru';
const tr=(ru,en)=>locale()==='en'?en:ru;
/**
 * Склонение по числу.
 *
 * «2 непрочитанных сообщений» и «1 упоминаний» — не по-русски, а на этих
 * четырёх карточках и держится вся сводка внимания. Форма зависит от
 * числа: одно, два-четыре и остальные, причём одиннадцать-четырнадцать
 * идут по последней форме, что бы ни стояло в последнем разряде.
 */
const plural=(n,one,few,many)=>{
  const count=Math.abs(Number(n)||0),last=count%10,tail=count%100;
  if(tail>=11&&tail<=14)return many;
  if(last===1)return one;
  if(last>=2&&last<=4)return few;
  return many;
};
const countOf=(n,ru,en)=>locale()==='en'
  ? (Math.abs(Number(n)||0)===1?en[0]:en[1])
  : plural(n,...ru);
const initials=(v='?')=>String(v).split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join('')||'?';
const formatTime=(v)=>v?new Intl.DateTimeFormat(locale()==='en'?'en':'ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'';
const SIZE_UNITS={ru:['Б','КБ','МБ','ГБ'],en:['B','KB','MB','GB']};
// Units follow the interface language: 'B' in a Russian sentence reads as volts.
const formatSize=(v)=>{const n=Number(v||0),u=SIZE_UNITS[(window.ChatPreferences?.locale)==='en'?'en':'ru'];if(n<1024)return`${n} ${u[0]}`;if(n<1024**2)return`${(n/1024).toFixed(n<10*1024?1:0)} ${u[1]}`;if(n<1024**3)return`${(n/1024**2).toFixed(n<10*1024**2?1:0)} ${u[2]}`;return`${(n/1024**3).toFixed(1)} ${u[3]}`};

async function api(path,options={}){const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}});const payload=response.status===204?null:await response.json().catch(()=>null);if(!response.ok){const error=new Error(payload?.error?.message||`HTTP ${response.status}`);error.status=response.status;error.code=payload?.error?.code;throw error}return payload}

function appVisible(){const app=$('#app-view');return Boolean(app&&!app.hidden)}

async function refreshPeople(){if(D.people.length)return;try{const boot=await (window.ChatBootstrap?.get()??api('/api/v1/bootstrap'));D.people=boot.people||[]}catch{}}

async function refreshAttention(force=false){if(!appVisible()||D.refreshing)return;// Перерисовка экрана — не повод идти в сеть: опрос по таймеру и по фокусу и так есть.
  if(!force&&Date.now()-D.lastRefresh<10000)return;D.refreshing=true;try{const [attention,conversations]=await Promise.all([api('/api/v1/attention'),api('/api/v1/conversations')]);D.attention=attention.attention;D.conversations=conversations.items||[];D.lastRefresh=Date.now();decorate()}catch{}finally{D.refreshing=false}}

function ensureBell(){const actions=$('.top-actions');if(!actions||$('#dwc-bell'))return;const button=document.createElement('button');button.id='dwc-bell';button.className='round-button pressable dwc-bell';button.type='button';button.setAttribute('aria-label',tr('Центр уведомлений','Notification center'));button.innerHTML='<span aria-hidden="true">◎</span><span class="dwc-badge" hidden>0</span>';const avatar=actions.querySelector('#top-avatar');actions.insertBefore(button,avatar||null);button.onclick=()=>openNotifications()}

// These run from a body-wide MutationObserver. Writing a value that already
// matches is still a mutation, which calls the observer again and pins the
// main thread, so every writer below compares first.
const setText=(el,value)=>{if(el&&el.textContent!==value)el.textContent=value};
const setHtml=(el,value)=>{if(el&&el.innerHTML!==value)el.innerHTML=value};
const setHidden=(el,value)=>{if(el&&el.hidden!==value)el.hidden=value};
function setCountBadge(root,count){if(!root)return;let badge=root.querySelector('.dwc-inline-badge');if(!count){badge?.remove();return}if(!badge){badge=document.createElement('span');badge.className='dwc-inline-badge';root.append(badge)}setText(badge,count>99?'99+':String(count))}

function applyUnreadBadges(){const total=D.conversations.reduce((sum,c)=>sum+Number(c.unreadCount||0),0);for(const row of $$('[data-conversation]')){const c=D.conversations.find(x=>x.id===row.dataset.conversation);if(!c)continue;setCountBadge(row,Number(c.unreadCount||0));let dot=row.querySelector('.dwc-mention-dot');if(c.mentionCount>0&&!dot){dot=document.createElement('span');dot.className='dwc-mention-dot';row.append(dot)}else if(!c.mentionCount)dot?.remove()}// Значок непрочитанного — для пунктов меню, а не для всего, что ведёт в
// беседы. Карточка-счётчик на главной тоже помечена `data-nav="chats"`, и
// значок в ней растягивался во всю ширину поверх собственного числа.
for(const nav of $$('[data-nav="chats"]:not(.metric-card)'))setCountBadge(nav,total);const bell=$('#dwc-bell .dwc-badge'),count=Number(D.attention?.unreadNotifications||0);if(bell){setHidden(bell,!count);setText(bell,count>99?'99+':String(count))}}

// Два счётчика задач у гостя показывают вечные нули: задач компании он
// не видит и завести не может. Строка внимания при этом сжимается до
// двух карточек, которые ему и адресованы.
const taskCountsVisible=()=>window.ChatApp?.role?.()!=='guest';
function ensureAttentionStrip(){const screen=$('#screen');if(!screen||!D.attention)return;const today=$('[data-nav="today"].active');if(!today){screen.querySelector('.dwc-attention-strip')?.remove();return}let strip=screen.querySelector('.dwc-attention-strip');if(!strip){strip=document.createElement('div');strip.className='dwc-attention-strip';screen.prepend(strip)}const a=D.attention;setHtml(strip,`
<button class="dwc-attention-card pressable" data-dwc-attention="unread"><strong>${Number(a.unreadMessages||0)}</strong><span>${countOf(a.unreadMessages,['непрочитанное сообщение','непрочитанных сообщения','непрочитанных сообщений'],['unread message','unread messages'])}</span></button>
<button class="dwc-attention-card pressable warm" data-dwc-attention="mentions"><strong>${Number(a.mentions||0)}</strong><span>${countOf(a.mentions,['упоминание','упоминания','упоминаний'],['mention','mentions'])}</span></button>
${taskCountsVisible()?`<button class="dwc-attention-card pressable ${a.overdueTasks?'hot':''}" data-dwc-attention="overdue"><strong>${Number(a.overdueTasks||0)}</strong><span>${countOf(a.overdueTasks,['просроченная задача','просроченные задачи','просроченных задач'],['overdue task','overdue tasks'])}</span></button>
<button class="dwc-attention-card pressable" data-dwc-attention="soon"><strong>${Number(a.dueSoonTasks||0)}</strong><span>${tr('срок в 24 часа','due in 24 hours')}</span></button>
<button class="dwc-attention-card pressable ${a.awaitingMyDecision?'warm':''}" data-dwc-attention="decide"><strong>${Number(a.awaitingMyDecision||0)}</strong><span>${countOf(a.awaitingMyDecision,['ждёт вашего решения','ждут вашего решения','ждут вашего решения'],['awaits your decision','await your decision'])}</span></button>`:''}`)}

function decorate(){ensureBell();applyUnreadBadges();ensureAttentionStrip()}

function closeOverlay(){document.querySelector('.dwc-overlay')?.remove();hideMentionPicker()}

function notificationTitle(n){if(n.type==='message.mentioned')return tr(`Упоминание${n.actorName?` · ${n.actorName}`:''}`,`Mention${n.actorName?` · ${n.actorName}`:''}`);if(n.type==='message.created')return tr(`Новое сообщение${n.actorName?` · ${n.actorName}`:''}`,`New message${n.actorName?` · ${n.actorName}`:''}`);if(n.type==='task.assigned')return tr(`Новая задача${n.actorName?` · ${n.actorName}`:''}`,`New task${n.actorName?` · ${n.actorName}`:''}`);if(n.type==='task.due')return tr('Срок задачи','Task due');// Название встречи и приглашение звонившего доходят от сервера в
// `n.title`/`n.actorName` с первого дня, но заголовок был захардкожен
// как общая фраза — карточка читалась одинаково для любой встречи, а
// пропущенный звонок не называл, кто звонил, хотя знает.
if(n.type==='calendar.invited')return tr(`${n.title||'Встреча'}${n.actorName?` · ${n.actorName}`:''}`,`${n.title||'Meeting'}${n.actorName?` · ${n.actorName}`:''}`);if(n.type==='calendar.reminder')return n.title||tr('Напоминание','Reminder');if(n.type==='call.missed')return n.actorName?tr(`Пропущенный звонок · ${n.actorName}`,`Missed call · ${n.actorName}`):(n.title||tr('Пропущенный звонок','Missed call'));return n.title||tr('Уведомление','Notification')}
function notificationIcon(n){return n.type==='message.mentioned'?'@':n.type.startsWith('message.')?'●':n.type.startsWith('task.')?'✓':n.type==='calendar.reminder'?'◔':n.type.startsWith('calendar.')?'□':n.type.startsWith('call.')?'☎':'◎'}

async function loadNotifications(){
  const type=D.notificationFilter==='mentions'?'mentions':null;
  const params=new URLSearchParams({limit:'80'});
  if(type)params.set('type',type);
  // «Архив» — это место, а не состояние прочтения.
  if(D.notificationFilter==='archived')params.set('status','archived');
  const payload=await api(`/api/v1/notifications?${params}`);
  D.notifications=payload.items||[];
  renderNotificationList();
}

function renderNotificationList(){const list=$('#dwc-notification-list');if(!list)return;if(!D.notifications.length){list.innerHTML=`<div class="dwc-empty"><strong>${tr('Всё разобрано','You are all caught up')}</strong>${tr('Новых элементов, требующих внимания, нет.','There is nothing new requiring your attention.')}</div>`;return}list.innerHTML=D.notifications.map(n=>`<button class="dwc-notification ${n.status==='unread'?'unread':''}" data-dwc-notification="${n.id}"><span class="dwc-notification-icon">${notificationIcon(n)}</span><span><strong>${esc(notificationTitle(n))}</strong><p>${esc(n.body||'')}</p>${n.conversationTitle?`<span class="dwc-result-meta">${esc(n.conversationTitle)}</span>`:''}</span><span>${n.status==='unread'?'<i class="dwc-unread-dot"></i>':`<time>${esc(formatTime(n.createdAt))}</time>`}</span></button>`).join('')}

async function openNotifications(filter='all'){D.notificationFilter=filter;closeOverlay();const root=document.createElement('div');root.className='dwc-overlay';root.innerHTML=`<section class="dwc-drawer"><header class="dwc-head"><div><p class="kicker">${tr('ВХОДЯЩИЕ','INBOX')}</p><h2>${tr('Центр внимания','Attention center')}</h2></div><div class="dwc-head-actions"><button class="dwc-text-button" data-dwc-read-all>${tr('Прочитать всё','Mark all read')}</button><button class="dwc-text-button" data-dwc-archive-read>${tr('Убрать прочитанное','Archive read')}</button><button class="dwc-icon-button" data-dwc-close>×</button></div></header><div class="dwc-tabs"><button class="dwc-tab ${filter==='all'?'active':''}" data-dwc-notification-filter="all">${tr('Все','All')}</button><button class="dwc-tab ${filter==='mentions'?'active':''}" data-dwc-notification-filter="mentions">${tr('Упоминания','Mentions')}</button><button class="dwc-tab ${filter==='archived'?'active':''}" data-dwc-notification-filter="archived">${tr('Архив','Archive')}</button></div><div id="dwc-notification-list" class="dwc-list"><div class="dwc-empty">${tr('Загружаем…','Loading…')}</div></div></section>`;document.body.append(root);root.onclick=e=>{if(e.target===root)closeOverlay()};await loadNotifications().catch(error=>{const list=$('#dwc-notification-list');if(list)list.innerHTML=`<div class="dwc-empty"><strong>${tr('Не удалось загрузить','Could not load')}</strong>${esc(String(error?.message??error))}</div>`})}

function highlightMessage(messageId,attempt=0){
  if(!messageId)return;
  const row=document.querySelector(`[data-message-row="${CSS.escape(messageId)}"]`);
  if(!row){if(attempt<12)setTimeout(()=>highlightMessage(messageId,attempt+1),250);return}
  row.scrollIntoView({block:'center',behavior:'smooth'});
  row.classList.remove('flash');void row.offsetWidth;row.classList.add('flash');
}
function openConversation(conversationId,messageId){
  closeOverlay();
  // Приложение умеет открыть ленту окном вокруг сообщения; двенадцать
  // попыток найти его в DOM и молча сдаться — это прежний способ.
  // Через приложение, а не поиском строки в разметке: строки может не быть на экране
  // (карточка «непрочитанных» тогда не делала ничего).
  if(window.ChatApp?.openChatAtMessage){
    closeOverlay();
    window.ChatApp.openChatAtMessage(conversationId,messageId||null);
    return;
  }
  if(messageId)setTimeout(()=>highlightMessage(messageId),450);const target=document.querySelector(`.sidebar-row[data-conversation="${CSS.escape(conversationId)}"]`)||document.querySelector(`.conversation-card[data-conversation="${CSS.escape(conversationId)}"]`);if(target){target.click();setTimeout(()=>refreshAttention(true),650);return}const chats=$('[data-nav="chats"]');chats?.click();setTimeout(()=>document.querySelector(`[data-conversation="${CSS.escape(conversationId)}"]`)?.click(),80)}
function openNav(name,{taskFilter=null}={}){
  closeOverlay();
  // Карточка «ждут вашего решения» ведёт не просто на экран задач, а на
  // ту вкладку, ради которой человек нажал: иначе он приходит в «В работе»
  // и заново ищет глазами то, что карточка уже сосчитала.
  if(taskFilter&&window.ChatApp?.openTaskFilter)window.ChatApp.openTaskFilter(taskFilter);
  else document.querySelector(`[data-nav="${name}"]`)?.click();
}

/**
 * Открыть то, о чём известили.
 *
 * У извещения с первого дня проставлен адрес — `/#/tasks/{id}`,
 * `/#/calendar/{id}`, — и маршруты под него в приложении разобраны. Но
 * читался не адрес, а вид связи: «результат отправлен на проверку» вело
 * в общий список задач, а приглашение на планёрку — в календарь на
 * месяц, и человек искал нужное глазами. Для бесед это давно починено;
 * теперь и для остальных.
 */
async function openNotificationItem(id){
  const n=D.notifications.find(x=>x.id===id);
  if(!n)return;
  if(n.status==='unread')await api(`/api/v1/notifications/${id}/read`,{method:'POST',body:'{}'}).catch(()=>{});
  if(n.conversationId)return openConversation(n.conversationId,n.messageId);
  if(n.commitmentId&&window.ChatApp?.openTask){closeOverlay();return window.ChatApp.openTask(n.commitmentId)}
  if(n.calendarEventId&&window.ChatApp?.openEvent){closeOverlay();return window.ChatApp.openEvent(n.calendarEventId)}
  if(n.commitmentId)return openNav('tasks');
  if(n.calendarEventId)return openNav('calendar');
  await refreshAttention(true);
}

const SEARCH_FILTERS=[['all','Все','All'],['message','Сообщения','Messages'],['task','Задачи','Tasks'],['file','Файлы','Files'],['person','Люди','People'],['conversation','Каналы','Conversations'],['event','Календарь','Calendar']];
/**
 * Отрезок времени для поиска.
 *
 * Сервер принимал `from` и `to` с первого дня, но задать их было нечем:
 * человек, помнящий «это было где-то в марте», листал сорок результатов
 * подряд. Пресеты покрывают обычный случай, два поля — точный.
 */
const SEARCH_PERIODS=[['any','За всё время','Any time'],['7','7 дней','7 days'],['30','30 дней','30 days'],['365','Год','A year'],['custom','Свой период','Custom']];
function searchRange(){
  if(D.searchPeriod==='custom')return{
    from:D.searchFrom?new Date(`${D.searchFrom}T00:00:00`).toISOString():'',
    to:D.searchTo?new Date(`${D.searchTo}T23:59:59.999`).toISOString():''};
  const days=Number(D.searchPeriod);
  if(!days)return{from:'',to:''};
  return{from:new Date(Date.now()-days*86400000).toISOString(),to:''};
}
let searchTimer;
async function runSearch(){const input=$('#dwc-search-input'),results=$('#dwc-search-results');if(!input||!results)return;const q=input.value.trim();if(q.length<2){results.innerHTML=`<div class="dwc-empty"><strong>${tr('Поиск по всему рабочему пространству','Search the whole workspace')}</strong>${tr('Сообщения, задачи, файлы, люди, каналы и календарь.','Messages, tasks, files, people, conversations and calendar.')}</div>`;return}results.innerHTML=`<div class="dwc-empty">${tr('Ищем…','Searching…')}</div>`;const params=new URLSearchParams({q,limit:'40'});if(D.searchType!=='all')params.set('types',D.searchType);const range=searchRange();if(range.from)params.set('from',range.from);if(range.to)params.set('to',range.to);try{const payload=await api(`/api/v1/search?${params}`);renderSearchResults(payload.items||[])}catch(e){results.innerHTML=`<div class="dwc-empty">${esc(e.message)}</div>`}}
function typeLabel(type){return({message:tr('сообщение','message'),conversation:tr('канал','conversation'),task:tr('задача','task'),file:tr('файл','file'),person:tr('сотрудник','person'),event:tr('событие','event')})[type]||type}
function typeIcon(type){return({message:'●',conversation:'#',task:'✓',file:'↗',person:'◎',event:'□'})[type]||'⌕'}
/**
 * Кусок текста из файла с выделенным словом.
 *
 * Сервер размечает найденное управляющими символами: сначала
 * экранируем всё, потом ставим разметку — иначе угловая скобка из
 * чужого документа становится разметкой.
 */
const marked=(value)=>esc(value).replaceAll('\u0002','<mark>').replaceAll('\u0003','</mark>');

function renderSearchResults(items){const root=$('#dwc-search-results');if(!root)return;if(!items.length){root.innerHTML=`<div class="dwc-empty"><strong>${tr('Ничего не найдено','No results')}</strong>${tr('Попробуйте другое слово или другой тип данных.','Try another query or content type.')}</div>`;return}root.innerHTML=items.map((item,index)=>`<button class="dwc-result" data-dwc-search-result="${index}"><span class="dwc-result-icon">${typeIcon(item.type)}</span><span><strong>${esc(item.title||'')}</strong><p>${marked(item.snippet||'')}</p><span class="dwc-result-meta">${esc(typeLabel(item.type))}${item.authorName?` · ${esc(item.authorName)}`:''}</span></span><time>${esc(formatTime(item.createdAt))}</time></button>`).join('');root._items=items}
async function activateSearchResult(index){const root=$('#dwc-search-results'),item=root?._items?.[Number(index)];if(!item)return;if(['message','conversation'].includes(item.type)&&item.conversationId)return openConversation(item.conversationId,item.type==='message'?item.id:null);if(item.type==='task'){
    // Раньше находка-задача вела на список всех задач, и найденное
    // приходилось искать заново. Открываем именно её.
    closeOverlay();
    if(window.ChatApp?.openTask)return window.ChatApp.openTask(item.id);
    return openNav('tasks');
  }if(item.type==='event'){
    closeOverlay();
    if(window.ChatApp?.openEvent)return window.ChatApp.openEvent(item.id);
    return openNav('calendar');
  }if(item.type==='file'){const url=item.previewUrl||item.contentUrl;if(url)window.open(url,'_blank','noopener');return}if(item.type==='person'){closeOverlay();if(window.ChatApp?.openPerson)return window.ChatApp.openPerson(item.id);return openNav('more')}}
function openSearch(){closeOverlay();D.searchPeriod='any';D.searchFrom='';D.searchTo='';const root=document.createElement('div');root.className='dwc-overlay';root.innerHTML=`<section class="dwc-drawer wide"><header class="dwc-head"><div><p class="kicker">${tr('ГЛОБАЛЬНЫЙ ПОИСК','GLOBAL SEARCH')}</p><h2>${tr('Найти что угодно','Find anything')}</h2></div><button class="dwc-icon-button" data-dwc-close>×</button></header><div class="dwc-search-shell"><div class="dwc-search-box"><span>⌕</span><input id="dwc-search-input" autocomplete="off" placeholder="${tr('Сообщение, задача, файл, сотрудник…','Message, task, file, person…')}"></div><div class="dwc-filter-row">${SEARCH_FILTERS.map(([id,ru,en])=>`<button class="dwc-filter ${id==='all'?'active':''}" data-dwc-search-type="${id}">${tr(ru,en)}</button>`).join('')}</div><div class="dwc-filter-row">${SEARCH_PERIODS.map(([id,ru,en])=>`<button class="dwc-filter ${id===D.searchPeriod?'active':''}" data-dwc-search-period="${id}">${tr(ru,en)}</button>`).join('')}</div><div class="dwc-date-row" ${D.searchPeriod==='custom'?'':'hidden'}><label>${tr('с','from')}<input type="date" id="dwc-search-from" value="${esc(D.searchFrom)}"></label><label>${tr('по','to')}<input type="date" id="dwc-search-to" value="${esc(D.searchTo)}"></label></div></div><div id="dwc-search-results" class="dwc-results"><div class="dwc-empty"><strong>${tr('Поиск по всему рабочему пространству','Search the whole workspace')}</strong>${tr('Введите минимум два символа.','Enter at least two characters.')}</div></div></section>`;document.body.append(root);root.onclick=e=>{if(e.target===root)closeOverlay()};setTimeout(()=>$('#dwc-search-input')?.focus(),30)}

async function loadFiles(){const list=$('#dwc-files-list');if(!list)return;list.innerHTML=`<div class="dwc-empty">${tr('Загружаем файлы…','Loading files…')}</div>`;const params=new URLSearchParams({limit:'80'});if(D.fileQuery)params.set('q',D.fileQuery);if(D.fileMime)params.set('mime',D.fileMime);if(D.fileCursor)params.set('cursor',D.fileCursor);try{const payload=await api(`/api/v1/files?${params}`);D.files=D.fileCursor?[...D.files,...(payload.items||[])]:(payload.items||[]);D.fileCursor=payload.nextCursor||null;renderFiles()}catch(e){list.innerHTML=`<div class="dwc-empty">${esc(e.message)}</div>`}}
function fileIcon(mime=''){if(mime.startsWith('image/'))return'▧';if(mime.startsWith('audio/'))return'◖';if(mime==='application/pdf')return'PDF';if(mime.startsWith('text/'))return'≡';return'↗'}
function renderFiles(){const list=$('#dwc-files-list');if(!list)return;if(!D.files.length&&(D.fileQuery||D.fileMime)){list.innerHTML=`<div class="dwc-empty"><strong>${tr('Ничего не найдено','Nothing found')}</strong>${tr('Поиск идёт по названиям файлов.','The filter matches file names only.')}</div>`;return}if(!D.files.length){list.innerHTML=`<div class="dwc-empty"><strong>${tr('Файлов пока нет','No files yet')}</strong>${tr('Загруженные в рабочие чаты файлы появятся здесь автоматически.','Files uploaded in work conversations will appear here automatically.')}</div>`;return}list.innerHTML=`<div class="dwc-file-grid">${D.files.map((f,index)=>`<article class="dwc-file"><div class="dwc-file-preview">${f.previewUrl&&String(f.mimeType).startsWith('image/')?`<img src="${esc(f.previewUrl)}" alt="">`:`<span>${fileIcon(f.mimeType)}</span>`}</div><div class="dwc-file-body"><strong title="${esc(f.name)}">${esc(f.name)}</strong><p>${esc(formatSize(f.sizeBytes))}${f.context?.conversationTitle?` · ${esc(f.context.conversationTitle)}`:''}</p><div class="dwc-file-actions"><button data-dwc-file-open="${index}">${tr('Открыть','Open')}</button>${(f.uploadedBy===window.ChatApp?.userId?.()||['admin','owner'].includes(window.ChatApp?.role?.()))?`<button class="danger" data-dwc-file-delete="${index}">${tr('Удалить','Delete')}</button>`:''}${f.context?.conversationId?`<button data-dwc-file-context="${index}">${tr('Контекст','Context')}</button>`:''}</div></div></article>`).join('')}</div>${D.fileCursor?`<button class="dwc-text-button" data-dwc-files-more style="margin-top:12px">${tr('Показать ещё','Show more')}</button>`:''}`}
function openFiles(){closeOverlay();D.fileMime=null;D.fileQuery='';D.fileCursor=null;D.files=[];const root=document.createElement('div');root.className='dwc-overlay';root.innerHTML=`<section class="dwc-drawer wide"><header class="dwc-head"><div><p class="kicker">${tr('РАБОЧИЕ МАТЕРИАЛЫ','WORK FILES')}</p><h2>${tr('Файлы','Files')}</h2></div><button class="dwc-icon-button" data-dwc-close>×</button></header><div class="dwc-search-shell"><div class="dwc-search-box"><span>⌕</span><input id="dwc-file-search" autocomplete="off" placeholder="${tr('Поиск по имени файла','Search file names')}"></div><div class="dwc-filter-row"><button class="dwc-filter active" data-dwc-file-mime="">${tr('Все','All')}</button><button class="dwc-filter" data-dwc-file-mime="image/">${tr('Изображения','Images')}</button><button class="dwc-filter" data-dwc-file-mime="video/">${tr('Видео','Video')}</button><button class="dwc-filter" data-dwc-file-mime="application/pdf">PDF</button><button class="dwc-filter" data-dwc-file-mime="audio/">${tr('Аудио','Audio')}</button><button class="dwc-filter" data-dwc-file-mime="text/">${tr('Текст','Text')}</button></div></div><div id="dwc-files-list" class="dwc-list"></div></section>`;document.body.append(root);root.onclick=e=>{if(e.target===root)closeOverlay()};loadFiles()}

function mentionHandle(person){return String(person.email||'').split('@')[0].replace(/[^\p{L}\p{N}._-]/gu,'').toLowerCase()||String(person.displayName||'').toLowerCase().replace(/\s+/g,'.')}
function hideMentionPicker(){document.querySelector('.dwc-mention-picker')?.remove();D.mentionItems=[];D.mentionIndex=0}
function updateMentionPicker(input){const before=input.value.slice(0,input.selectionStart),match=before.match(/(?:^|\s)@([^\s@]{0,40})$/u);if(!match){hideMentionPicker();return}const q=match[1].toLowerCase(),meEmail=$('#profile-card small')?.textContent;const people=D.people.filter(p=>p.email!==meEmail).filter(p=>{const handle=mentionHandle(p),name=String(p.displayName||'').toLowerCase();return!q||handle.includes(q)||name.includes(q)}).slice(0,6);if(!people.length){hideMentionPicker();return}D.mentionItems=people;D.mentionIndex=Math.min(D.mentionIndex,people.length-1);let picker=document.querySelector('.dwc-mention-picker');if(!picker){picker=document.createElement('div');picker.className='dwc-mention-picker';input.closest('.composer-wrap')?.append(picker)}picker.innerHTML=people.map((p,i)=>`<button type="button" class="dwc-mention-option ${i===D.mentionIndex?'active':''}" data-dwc-mention="${i}"><span class="avatar dark">${esc(initials(p.displayName||p.email))}</span><span><strong>${esc(p.displayName||p.email)}</strong><small>@${esc(mentionHandle(p))}${p.title?` · ${esc(p.title)}`:''}</small></span></button>`).join('')}
function chooseMention(index){const input=$('#message-input'),person=D.mentionItems[Number(index)];if(!input||!person)return;const start=input.selectionStart,before=input.value.slice(0,start),after=input.value.slice(input.selectionEnd),match=before.match(/(?:^|\s)@([^\s@]{0,40})$/u);if(!match)return;const tokenStart=start-match[0].length+(match[0].startsWith(' ')?1:0),prefix=input.value.slice(0,tokenStart),mention=`@${mentionHandle(person)} `;input.value=prefix+mention+after;const caret=(prefix+mention).length;input.setSelectionRange(caret,caret);input.focus();hideMentionPicker();input.dispatchEvent(new Event('input',{bubbles:true}))}

function scheduleRefresh(){clearTimeout(scheduleRefresh.timer);scheduleRefresh.timer=setTimeout(()=>{decorate();refreshAttention()},120)}

document.addEventListener('click',async(event)=>{const target=event.target;
  if(target.closest('[data-action="search"]')){event.preventDefault();event.stopImmediatePropagation();openSearch();return}
  if(target.closest('[data-action="files"]')){event.preventDefault();event.stopImmediatePropagation();openFiles();return}
  if(target.closest('[data-dwc-close]')){closeOverlay();return}
  const attention=target.closest('[data-dwc-attention]');if(attention){const type=attention.dataset.dwcAttention;if(type==='mentions')return openNotifications('mentions');if(type==='unread'){const c=D.conversations.find(x=>x.unreadCount>0);if(c)return openConversation(c.id);closeOverlay();return openNav('chats')}if(type==='decide')return openNav('tasks',{taskFilter:'mine'});if(type==='overdue'&&window.ChatApp?.openTaskFilter){closeOverlay();return window.ChatApp.openTaskFilter('overdue')}if(['overdue','soon'].includes(type)){closeOverlay();return window.ChatApp?.openTaskFilter?window.ChatApp.openTaskFilter('active'):openNav('tasks')}return}
  const filter=target.closest('[data-dwc-notification-filter]');if(filter){D.notificationFilter=filter.dataset.dwcNotificationFilter;$$('[data-dwc-notification-filter]').forEach(b=>b.classList.toggle('active',b===filter));await loadNotifications();return}
  if(target.closest('[data-dwc-read-all]')){await api('/api/v1/notifications/read-all',{method:'POST',body:JSON.stringify({type:D.notificationFilter==='mentions'?'mentions':null})}).catch(()=>{});await Promise.all([loadNotifications(),refreshAttention(true)]);return}
  if(target.closest('[data-dwc-files-more]')){await loadFiles();return}
  if(target.closest('[data-dwc-archive-read]')){await api('/api/v1/notifications/archive-read',{method:'POST',body:'{}'}).catch(()=>{});await Promise.all([loadNotifications(),refreshAttention(true)]);return}
  const notification=target.closest('[data-dwc-notification]');if(notification){await openNotificationItem(notification.dataset.dwcNotification);return}
  const searchType=target.closest('[data-dwc-search-type]');if(searchType){D.searchType=searchType.dataset.dwcSearchType;$$('[data-dwc-search-type]').forEach(b=>b.classList.toggle('active',b===searchType));runSearch();return}
  const period=target.closest('[data-dwc-search-period]');if(period){D.searchPeriod=period.dataset.dwcSearchPeriod;$$('[data-dwc-search-period]').forEach(b=>b.classList.toggle('active',b===period));const row=document.querySelector('.dwc-date-row');if(row)row.hidden=D.searchPeriod!=='custom';runSearch();return}
  const result=target.closest('[data-dwc-search-result]');if(result){await activateSearchResult(result.dataset.dwcSearchResult);return}
  const mime=target.closest('[data-dwc-file-mime]');if(mime){D.fileMime=mime.dataset.dwcFileMime||null;D.fileCursor=null;$$('[data-dwc-file-mime]').forEach(b=>b.classList.toggle('active',b===mime));loadFiles();return}
  const delFile=target.closest('[data-dwc-file-delete]');
  if(delFile){
    const f=D.files[Number(delFile.dataset.dwcFileDelete)];
    if(!f)return;
    // Два нажатия: первое просит подтверждения прямо на кнопке (окно поверх ящика здесь не к месту).
    if(delFile.dataset.armed!=='1'){delFile.dataset.armed='1';delFile.textContent=tr('Точно удалить?','Really delete?');setTimeout(()=>{if(delFile.isConnected){delFile.dataset.armed='';delFile.textContent=tr('Удалить','Delete')}},4000);return}
    delFile.disabled=true;
    try{await api(`/api/v1/files/${f.id}`,{method:'DELETE'});D.files.splice(Number(delFile.dataset.dwcFileDelete),1);renderFiles()}
    catch(error){delFile.disabled=false;delFile.textContent=tr('Удалить','Delete')}
    return;
  }
  const openFile=target.closest('[data-dwc-file-open]');if(openFile){const f=D.files[Number(openFile.dataset.dwcFileOpen)],url=f?.previewUrl||f?.contentUrl;if(url)window.open(url,'_blank','noopener');return}
  const context=target.closest('[data-dwc-file-context]');if(context){const f=D.files[Number(context.dataset.dwcFileContext)];if(f?.context?.conversationId)openConversation(f.context.conversationId);return}
  const mention=target.closest('[data-dwc-mention]');if(mention){event.preventDefault();chooseMention(mention.dataset.dwcMention);return}
  if(target.closest('[data-conversation],[data-open]'))setTimeout(()=>refreshAttention(true),700);
},true);

document.addEventListener('change',event=>{if(event.target.id==='dwc-search-from'||event.target.id==='dwc-search-to'){if(event.target.id==='dwc-search-from')D.searchFrom=event.target.value;else D.searchTo=event.target.value;runSearch()}},true);
document.addEventListener('input',event=>{if(event.target.id==='message-input')updateMentionPicker(event.target);if(event.target.id==='dwc-search-input'){clearTimeout(searchTimer);searchTimer=setTimeout(runSearch,220)}if(event.target.id==='dwc-file-search'){clearTimeout(searchTimer);searchTimer=setTimeout(()=>{D.fileQuery=event.target.value.trim();D.fileCursor=null;loadFiles()},220)}},true);
document.addEventListener('keydown',event=>{if(event.target.id==='message-input'&&D.mentionItems.length){if(event.key==='ArrowDown'){event.preventDefault();D.mentionIndex=(D.mentionIndex+1)%D.mentionItems.length;updateMentionPicker(event.target)}else if(event.key==='ArrowUp'){event.preventDefault();D.mentionIndex=(D.mentionIndex-1+D.mentionItems.length)%D.mentionItems.length;updateMentionPicker(event.target)}else if(event.key==='Enter'){event.preventDefault();event.stopImmediatePropagation();chooseMention(D.mentionIndex)}else if(event.key==='Escape')hideMentionPicker()}if(event.key==='Escape'&&document.querySelector('.dwc-overlay'))closeOverlay()},true);

const observer=new MutationObserver(scheduleRefresh);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});
window.addEventListener('focus',()=>refreshAttention(true));document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAttention(true)});window.addEventListener('chat:localechange',()=>{closeOverlay();decorate()});navigator.serviceWorker?.addEventListener('message',()=>refreshAttention(true));
setInterval(()=>{if(!document.hidden)refreshAttention(true)},12000);

// The top bar needs to open these; without an export its search button had
// no handler at all and simply did nothing when tapped.
window.ChatDailyWork={openSearch,openFiles,openNotifications,refresh:()=>refreshAttention(true)};

(async function start(){await refreshPeople();await refreshAttention(true);decorate()})();
