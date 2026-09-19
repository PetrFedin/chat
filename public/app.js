const S={view:'today',boot:null,conversations:[],people:[],tasks:[],calendar:[],selected:null,messages:new Map(),ws:null,mobileChat:false,reply:null,recorder:null,recordingAt:0,labels:null,plan:[],planFilter:'open',labelsUnavailable:false,planUnavailable:false};
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
const nav=[['today',navIcon.today,'Сегодня'],['chats',navIcon.chats,'Сообщения'],['tasks',navIcon.tasks,'Задачи'],['calendar',navIcon.calendar,'Календарь'],['more',navIcon.more,'Ещё']];
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
  NOT_A_MEMBER:'Вы видите этот канал по его открытости — выходить не из чего, уберите его в архив.',
  DIRECT_CANNOT_LEAVE:'Личный диалог нельзя покинуть — его можно убрать в архив.',
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
  LABEL_NOT_FOUND:'Метка недоступна.',
  TARGET_NOT_FOUND:'Объект недоступен.',
};

async function api(path,o={}){const r=await fetch(path,{credentials:'same-origin',...o,headers:{...(typeof o.body==='string'?{'content-type':'application/json'}:{}),...(o.headers||{})}});if(r.status===204)return null;const p=(r.headers.get('content-type')||'').includes('json')?await r.json():await r.text();if(!r.ok){const code=p?.error?.code;const e=new Error(ERROR_MESSAGE[code]||p?.error?.message||`HTTP ${r.status}`);e.status=r.status;e.code=code;e.serverMessage=p?.error?.message;throw e}return p}
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

async function bootstrap(){try{const b=await api('/api/v1/bootstrap');S.boot=b;S.conversations=b.conversations||[];S.people=b.people||[];S.selected=S.selected||S.conversations[0]?.id||null;await Promise.all([loadTasks(),loadCalendar(),loadPlan()]);$('#auth-view').hidden=true;$('#app-view').hidden=false;shell();render();startClock();connect();await routeFromHash()}catch(e){if(e.status===401)auth();else{auth();$('#auth-error').textContent=e.message}}}
async function routeFromHash(){if(!S.boot)return;const raw=location.hash.replace(/^#\/?/,''),[pathPart,query='']=raw.split('?'),parts=pathPart.split('/').filter(Boolean),params=new URLSearchParams(query);if(parts[0]==='tasks'&&parts[1]){S.view='tasks';render();await openTask(parts[1]);return}if(parts[0]==='chats'&&parts[1]){await openChatAtMessage(parts[1],params.get('message'));return}}
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
async function loadMessages(id){if(id&&!S.messages.has(id))S.messages.set(id,(await api(`/api/v1/conversations/${id}/messages`)).items||[])}
function shell(){const s=me();$('#workspace-switcher').innerHTML=`<span class="avatar">${esc(initials(s.organizationName))}</span><span><strong>${esc(s.organizationName)}</strong><small>${esc(s.workspaceName)}</small></span><span class="muted">⌄</span>`;$('#profile-card').innerHTML=`<span class="avatar dark">${esc(initials(s.displayName))}</span><span><strong>${esc(s.displayName)}</strong><small>${esc(s.role)}</small></span><span class="presence-dot online"></span>`;$('#top-avatar').textContent=initials(s.displayName);
  // Both of these carry a chevron and a press animation, so they promise an
  // action; neither had a handler of any kind.
  $('#workspace-switcher').onclick=()=>workspaceModal();
  $('#profile-card').onclick=()=>personPage(me().userId);
  navs();lists()}

/** What the workspace actually is, since the switcher implies there is more than one. */
function workspaceModal(){
  const s=me();
  modal(s.organizationName||'Организация',`
    <div class="person-fields">
      <div class="person-field"><span>Пространство</span><strong>${esc(s.workspaceName)}</strong></div>
      <div class="person-field"><span>Ваша роль</span><strong>${esc(s.role)}</strong></div>
      <div class="person-field"><span>Сотрудников</span><strong>${S.people.length}</strong></div>
      <div class="person-field"><span>Бесед</span><strong>${S.conversations.length}</strong></div>
    </div>
    <p class="muted" style="margin-top:12px">Переключение между несколькими пространствами пока не поддерживается: аккаунт живёт в одном.</p>
    <div class="stack" style="margin-top:14px"><button data-action-org class="button secondary">Оргструктура</button><button data-action-team class="button secondary">Команда</button></div>
  `,()=>{
    $('[data-action-org]').onclick=()=>replaceModal(orgModal);
    $('[data-action-team]').onclick=()=>replaceModal(teamModal);
  });
}
function navs(){const html=nav.map(([id,i,l])=>`<button class="nav-item pressable ${S.view===id?'active':''}" data-nav="${id}"><span class="nav-icon">${i}</span><span>${l}</span></button>`).join('');$('#desktop-nav').innerHTML=$('#mobile-nav').innerHTML=html}
function lists(){const channels=S.conversations.filter(c=>['channel','team','project'].includes(c.kind)),dm=S.conversations.filter(c=>['direct','group'].includes(c.kind));$('#channel-list').innerHTML=channels.map(c=>side(c,'#')).join('');$('#direct-list').innerHTML=dm.map(c=>side(c,'')).join('')}
function side(c,prefix){return `<button class="sidebar-row pressable ${S.selected===c.id?'active':''}" data-conversation="${c.id}"><span>${prefix||'<span class="presence-dot online"></span>'}</span><span class="label">${esc(c.title||'Диалог')}</span></button>`}
function render(){navs();lists();$('#screen-title').textContent=nav.find(x=>x[0]===S.view)?.[2]||'Chat';$('#eyebrow').textContent=(me()?.organizationName||'Компания').toUpperCase();$('#screen').innerHTML=({today,chats,tasks,calendar,more})[S.view]();bind();bindCalendar()}
function today(){const active=S.tasks.filter(t=>!['closed','accepted_result','cancelled'].includes(t.status)),events=S.calendar.filter(e=>Date.parse(e.startAt)>Date.now()-3600000).slice(0,4);return `<div class="page-grid"><div class="stack"><section class="surface greeting"><p class="kicker" id="now-line" data-prefs-owned>${esc(nowLine())}</p><h2><span id="greeting-word">${greetingFor(new Date())}</span>, ${esc((me().displayName||'').split(' ')[0])}</h2><form class="quick-bar" data-quick-form><input name="quick" placeholder="Сообщение, задача или встреча…" aria-label="Быстрый захват"><button type="submit" class="button primary small pressable">Создать</button></form></section><section class="surface"><div class="section-head"><div><h2>Расписание дня</h2><p class="muted">Встречи и рабочее время</p></div><button data-action="event" class="button secondary small pressable">＋ Событие</button></div>${events.length?events.map(e=>`<div class="agenda-row"><span class="agenda-time">${time(e.startAt)}</span><span><div class="row-title">${esc(e.title)}</div><div class="row-sub">${esc(e.kind)}</div></span><span class="chip warm">${e.kind==='meeting'?'Встреча':'В плане'}</span></div>`).join(''):'<div class="empty"><strong>Свободный день</strong>Добавьте встречу или фокус-время.</div>'}</section><section class="surface"><div class="section-head"><h2>Мои задачи</h2><button data-action="task" class="button secondary small pressable">＋ Задача</button></div>${active.slice(0,5).map(taskRow).join('')||'<div class="empty"><strong>Задач пока нет</strong>Создайте задачу вручную или из сообщения.</div>'}</section>${planSection()}</div><div class="stack"><div class="metric-grid"><div class="metric-card"><strong>${active.length}</strong><span>${plural(active.length,'активная задача','активные задачи','активных задач')}</span></div><div class="metric-card"><strong>${S.people.length}</strong><span>${plural(S.people.length,'сотрудник','сотрудника','сотрудников')}</span></div><div class="metric-card"><strong>${S.conversations.length}</strong><span>${plural(S.conversations.length,'диалог','диалога','диалогов')}</span></div></div><section class="surface"><div class="section-head"><h3>Последние сообщения</h3></div>${S.conversations.slice(0,6).map(c=>convRow(c)).join('')||'<div class="empty">Создайте первый канал.</div>'}</section></div></div>`}
/**
 * The personal list, on the screen where the day is planned. A commitment
 * belongs to «Мои задачи» above; this is the work nobody promised to anybody.
 */
/**
 * «3 активных задач» is not Russian. The form depends on the number: one,
 * two-to-four, and the rest — with the teens taking the last form whatever
 * their last digit says.
 */
function plural(n,one,few,many){
  const count=Math.abs(Number(n)||0),last=count%10,tail=count%100;
  if(tail>=11&&tail<=14)return many;
  if(last===1)return one;
  if(last>=2&&last<=4)return few;
  return many;
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

function convRow(c){return `<button class="conversation-card pressable" data-open="${c.id}"><span class="avatar dark">${c.kind==='channel'?'#':esc(initials(c.title||'D'))}</span><span><strong>${esc(c.title||'Диалог')}</strong><div class="preview">${esc(c.lastMessage?.body||kindLabel(c.lastMessage?.kind)||c.purpose||'Открыть разговор')}</div></span><span class="time">${time(c.lastMessage?.createdAt)}</span></button>`}
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
function taskRow(t){return `<button class="task-card pressable" data-task-open="${t.id}"><span class="task-status"></span><span><div class="task-title">${esc(t.title)}</div><div class="task-meta"><span>${esc(TASK_STATUS[t.status]||t.status)}</span><span>·</span><span>${esc(dateTime(t.promisedAt))}</span><span>·</span><span>${esc(name(t.ownerId))}</span></div></span><span class="chip ${['high','urgent'].includes(t.priority)?'danger':''}">${esc(t.priority||'normal')}</span></button>`}
function kindLabel(k){return({voice:'Голосовое сообщение',file:'Файл',call:'Звонок',task:'Задача',calendar:'Событие'})[k]||''}
function chats(){const c=S.conversations.find(x=>x.id===S.selected),messages=S.messages.get(c?.id)||[],muted=c?.mutedUntil&&Date.parse(c.mutedUntil)>Date.now();return `<div class="chat-shell"><aside class="conversation-pane ${S.mobileChat?'hidden-mobile':''}"><div class="conversation-pane-header"><h2>Диалоги</h2><button data-action="dm" class="round-button pressable" aria-label="Новый чат">＋</button></div>${S.conversations.map(x=>`<button class="conversation-card pressable ${x.id===S.selected?'active':''}" data-conversation="${x.id}"><span class="avatar dark">${x.kind==='channel'?'#':esc(initials(x.title||'D'))}</span><span><strong>${esc(x.title||'Диалог')}</strong><div class="preview">${esc(x.lastMessage?.body||kindLabel(x.lastMessage?.kind)||'Нет сообщений')}</div></span><span class="time">${time(x.lastMessage?.createdAt)}</span></button>`).join('')}</aside><section class="message-pane ${!S.mobileChat?'hidden-mobile':''}">${c?`<header class="message-header"><div class="inline-actions"><button data-action="back" class="round-button pressable mobile-back" aria-label="Назад к списку">‹</button><div><h2>${esc(c.kind==='channel'?'# '+c.title:(c.title||'Диалог'))}</h2><p>${esc(c.purpose||'Рабочая переписка')}${muted?' · уведомления выключены':''}</p></div></div><div class="inline-actions"><button data-action="pins" class="round-button pressable" title="Закреплённые">⌖</button><button data-action="mute" class="round-button pressable" title="${muted?'Включить уведомления':'Отключить на 8 часов'}">${muted?'🔔':'🔕'}</button><button data-action="archive" class="round-button pressable" title="Архивировать">⌑</button><button data-action="conversation" class="round-button pressable" title="О беседе">⚙</button>${c.kind!=='direct'?'<button data-action="members" class="round-button pressable" title="Участники">◎</button>':''}<button data-action="audio" class="round-button pressable" title="Аудиозвонок">⌕</button><button data-action="video" class="round-button pressable" title="Видеозвонок">◉</button></div></header><div id="message-stream" class="message-stream">${messages.map(message).join('')||'<div class="empty"><strong>Начните разговор</strong></div>'}</div><div id="typing" class="typing"></div><div class="composer-wrap">${S.reply?`<div class="reply-preview visible"><span>Ответ на: ${esc(S.reply.body||kindLabel(S.reply.kind))}</span><button data-action="cancel-reply" class="close-button">×</button></div>`:''}<div class="composer"><button data-action="attach" class="composer-button pressable" aria-label="Прикрепить файл">＋</button><textarea id="message-input" rows="1" placeholder="Сообщение"></textarea><button data-action="voice" class="composer-button pressable" aria-label="Голосовое сообщение">◖</button><button data-action="send" class="composer-button send pressable" aria-label="Отправить">↑</button></div></div>`:'<div class="empty"><strong>Выберите разговор</strong></div>'}</section></div>`}
function message(m){const reactions=(m.reactions||[]).reduce((a,r)=>(a[r.reaction]=(a[r.reaction]||0)+1,a),{}),deleted=Boolean(m.deletedAt),canDelete=m.authorId===me().userId||can('message.delete.any');return `<article class="message-item" data-message-row="${m.id}"><span class="avatar dark">${esc(initials(name(m.authorId)))}</span><div><div class="message-meta"><span class="message-author">${esc(m.authorId===me().userId?'Вы':name(m.authorId))}</span><span class="message-time">${time(m.createdAt)}${m.editedAt?' · изменено':''}${m.pinned?' · закреплено':''}${m.saved?' · сохранено':''}</span></div>${m.forwardedFrom?(m.forwardedFrom.restricted?'<div class="row-sub">↪ Пересланное сообщение</div>':`<button class="reaction-button" data-forward-origin-conversation="${m.forwardedFrom.conversationId}" data-forward-origin-message="${m.forwardedFrom.messageId}">↪ Переслано от ${esc(name(m.forwardedFrom.authorId))}${m.forwardedFrom.conversationTitle?' · '+esc(m.forwardedFrom.conversationTitle):''}</button>`):''}${deleted?'<p class="muted">Сообщение удалено</p>':m.kind==='voice'?`<div class="voice-card"><button class="voice-play">▶</button><div class="waveform"></div><span>${Math.round((m.metadata?.durationMs||0)/1000)}с</span></div>`:m.kind==='file'?`<div class="voice-card"><span>↗</span><div><strong>${esc(m.metadata?.name||'Файл')}</strong><div class="row-sub">${esc(m.metadata?.mimeType||'Вложение')}</div></div></div>`:`<p class="message-body">${esc(m.body||kindLabel(m.kind))}</p>`}${deleted?'':`<button class="msg-more pressable" data-message-actions="${m.id}" aria-label="Действия с сообщением" aria-expanded="false">⋯</button><div class="inline-actions msg-actions">${Object.entries(reactions).map(([e,n])=>`<button class="reaction-button" data-react="${esc(e)}" data-message="${m.id}">${esc(e)} ${n}</button>`).join('')}<button class="reaction-button" data-react="👍" data-message="${m.id}">＋👍</button><button class="reaction-button" data-reply="${m.id}">Ответить</button><button class="reaction-button" data-message-save="${m.id}" data-saved="${m.saved?'1':'0'}">${m.saved?'Убрать из сохранённых':'Сохранить'}</button><button class="reaction-button" data-message-forward="${m.id}">Переслать</button><button class="reaction-button" data-message-label="${m.id}">Метка</button><button class="reaction-button" data-message-pin="${m.id}" data-pinned="${m.pinned?'1':'0'}">${m.pinned?'Открепить':'Закрепить'}</button><button class="reaction-button" data-task-message="${m.id}">В задачу</button>${m.authorId===me().userId&&m.kind==='text'&&!m.forwarded?`<button class="reaction-button" data-message-edit="${m.id}">Изменить</button>`:''}${canDelete?`<button class="reaction-button" data-message-delete="${m.id}">Удалить</button>`:''}</div>`}</div></article>`}
function tasks(){return `<section class="surface"><div class="section-head"><div><p class="muted">Ответственность → выполнение → доказательство → проверка → закрытие</p></div><button data-action="task" class="button primary small pressable">＋ Задача</button></div><div class="task-list">${S.tasks.map(taskRow).join('')||'<div class="empty"><strong>Ничего не потеряется</strong>Создайте задачу вручную или из сообщения.</div>'}</div></section>`}
function calendar(){
  const c=S.cal||(S.cal={view:'week',cursor:new Date(),selected:null});
  const base=new Date(c.cursor);
  const fmt=(o)=>new Intl.DateTimeFormat('ru',o);
  const sameDay=(a,b)=>a.toDateString()===b.toDateString();
  const today=new Date();
  const dayKey=(d)=>`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const eventsOn=(d)=>(S.calendar||[]).filter(e=>sameDay(new Date(e.startAt),d));
  // An event still awaiting this person's answer pulses: the grid is where a
  // missed invitation actually costs something.
  const dot=(e)=>`<i class="cal-dot ${e.needsMyAnswer?'pending':esc(e.kind)}"></i>`;
  const header=()=>{
    const label=c.view==='day'?fmt({day:'numeric',month:'long',year:'numeric'}).format(base)
      :c.view==='week'?`${fmt({day:'numeric',month:'short'}).format(weekStart())} — ${fmt({day:'numeric',month:'short',year:'numeric'}).format(new Date(weekStart().getTime()+6*864e5))}`
      :fmt({month:'long',year:'numeric'}).format(base);
    return `<div class="calendar-toolbar">
      <div><p class="kicker">КАЛЕНДАРЬ</p><h2>${esc(label)}</h2></div>
      <button data-action="event" class="button primary small pressable">＋ Событие</button>
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
    grid=`<div class="cal-month">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=>`<span class="cal-weekday">${d}</span>`).join('')}
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
    const d=new Date(e.startAt);
    if(c.view==='day')return sameDay(d,base);
    if(c.view==='week'){const s0=weekStart();return d>=s0&&d<new Date(s0.getTime()+7*864e5)}
    return d.getMonth()===base.getMonth()&&d.getFullYear()===base.getFullYear();
  };
  const shown=(S.calendar||[]).filter(e=>c.selected?dayKey(new Date(e.startAt))===c.selected:inPeriod(e));
  const heading=c.selected?'Выбранный день':(c.view==='day'?'События дня':c.view==='week'?'События недели':'События месяца');
  const rows=shown.length?shown.map(e=>`<button class="calendar-event pressable ${e.needsMyAnswer?'needs-answer':''}" data-cal-event="${esc(e.id)}">
      <strong>${e.allDay?'весь день':esc(time(e.startAt))}</strong><span class="event-line"></span>
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
    ? event.participants.map(p=>`<div class="person-event"><span>${esc(p.displayName||'—')}${p.optional?' · необязательно':''}${p.note?` — ${esc(p.note)}`:''}</span><span class="chip ${p.response==='invited'?'pulse':'warm'}">${esc(RESPONSE_LABEL[p.response])}</span></div>`).join('')
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
  `,()=>{
    $$('[data-answer]').forEach(b=>b.onclick=async()=>{
      try{
        await api(`/api/v1/calendar-events/${id}/respond`,{method:'POST',body:JSON.stringify({response:b.dataset.answer})});
        toast('Ответ отправлен');
        history.back();
        await loadCalendarRange();render();
      }catch(error){toast(error.message)}
    });
  });
}

function more(){return `<div class="module-grid"><button class="module-card pressable" data-action="saved"><span class="module-icon">☆</span><strong>Сохранённые</strong><span>Личные сообщения для возврата к работе</span></button><button class="module-card pressable" data-action="archived"><span class="module-icon">⌑</span><strong>Архив чатов</strong><span>Скрытые только для вас разговоры</span></button><button class="module-card pressable" data-action="team"><span class="module-icon">◎</span><strong>Команда</strong><span>${S.people.length} сотрудников, роли и статусы</span></button><button class="module-card pressable" data-action="org"><span class="module-icon">⌸</span><strong>Оргструктура</strong><span>Департаменты, отделы, штат и руководители</span></button><button class="module-card pressable" data-action="contacts"><span class="module-icon">☏</span><strong>Контакты</strong><span>Кто вам пишет и кто с вами в подразделении</span></button><button class="module-card pressable" data-action="plan"><span class="module-icon">✓</span><strong>Личные дела</strong><span>Список, заметки, приоритеты и сроки</span></button><button class="module-card pressable" data-action="labels"><span class="module-icon">◈</span><strong>Метки</strong><span>Важность, теги и папки для всего</span></button><button class="module-card pressable" data-action="invite"><span class="module-icon">＋</span><strong>Пригласить</strong><span>Добавить сотрудника</span></button><button class="module-card pressable" data-action="files"><span class="module-icon">↗</span><strong>Файлы</strong><span>Вложения из рабочих контекстов</span></button><button class="module-card pressable" data-action="calls"><span class="module-icon">◉</span><strong>Звонки</strong><span>Аудио, видео и демонстрация экрана</span></button><button class="module-card pressable" data-action="push"><span class="module-icon">◌</span><strong>Уведомления</strong><span>Push, упоминания и сроки</span></button><button class="module-card pressable" data-action="profile"><span class="module-icon">⚙</span><strong>Настройки</strong><span>Профиль и безопасность</span></button></div>`}
function bind(){
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
  $$('[data-nav]').forEach(b=>b.onclick=()=>go(b.dataset.nav));$$('[data-conversation],[data-open]').forEach(b=>b.onclick=()=>openChat(b.dataset.conversation||b.dataset.open));$$('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));$$('[data-react]').forEach(b=>b.onclick=()=>react(b.dataset.message,b.dataset.react));$$('[data-reply]').forEach(b=>b.onclick=()=>{S.reply=(S.messages.get(S.selected)||[]).find(m=>m.id===b.dataset.reply);render()});$$('[data-message-save]').forEach(b=>b.onclick=()=>toggleSave(b.dataset.messageSave,b.dataset.saved!=='1'));$$('[data-message-actions]').forEach(b=>b.onclick=()=>{
  const item=b.closest('.message-item');
  const open=item.classList.toggle('actions-open');
  b.setAttribute('aria-expanded',String(open));
});$$('[data-message-label]').forEach(b=>b.onclick=()=>labelPicker('message',b.dataset.messageLabel,{title:'Метки сообщения'}));$$('[data-message-pin]').forEach(b=>b.onclick=()=>togglePin(b.dataset.messagePin,b.dataset.pinned!=='1'));$$('[data-message-forward]').forEach(b=>b.onclick=()=>forwardModal(b.dataset.messageForward));$$('[data-forward-origin-conversation]').forEach(b=>b.onclick=()=>openChatAtMessage(b.dataset.forwardOriginConversation,b.dataset.forwardOriginMessage));$$('[data-message-edit]').forEach(b=>b.onclick=()=>editMessageModal(b.dataset.messageEdit));$$('[data-message-delete]').forEach(b=>b.onclick=()=>deleteMessageModal(b.dataset.messageDelete));$$('[data-task-message]').forEach(b=>b.onclick=()=>taskModal(b.dataset.taskMessage));$$('[data-task-open]').forEach(b=>b.onclick=()=>openTask(b.dataset.taskOpen));const input=$('#message-input');if(input){input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};input.oninput=typing;requestAnimationFrame(()=>{$('#message-stream')?.scrollTo(0,999999)})}}
function go(v){
  S.view=v;
  if(v!=='chats')S.mobileChat=false;
  // A screen opened after scrolling another one started halfway down it: the
  // conversation header, the calendar toolbar and the day's greeting were all
  // above the fold before the person had touched anything.
  window.scrollTo(0,0);
  render();
}
async function openChat(id){S.selected=id;S.view='chats';S.mobileChat=true;await loadMessages(id);api(`/api/v1/conversations/${id}/read`,{method:'POST',body:JSON.stringify({messageId:S.messages.get(id)?.at(-1)?.id||null})}).catch(()=>{});render()}
async function openChatAtMessage(id,messageId=null){await openChat(id);if(messageId)requestAnimationFrame(()=>document.querySelector(`[data-message-row="${messageId}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}))}
const actions={quick:quick,task:()=>taskModal(),event:eventModal,dm:directModal,group:groupModal,members:membersModal,pins:pinsModal,mute:toggleMute,archive:archiveCurrent,saved:savedModal,archived:archivedModal,'new-direct':directModal,'new-channel':channelModal,back:()=>{S.mobileChat=false;render()},send,attach:()=>$('#file-picker').click(),voice:voice,'cancel-reply':()=>{S.reply=null;render()},invite:inviteModal,team:teamModal,org:orgModal,conversation:conversationModal,plan:()=>planModal(),labels:labelsModal,contacts:contactsModal,search:()=>window.ChatDailyWork?.openSearch?.(),profile:()=>personPage(me().userId),push:enablePush,files:()=>toast('Файлы доступны в связанных чатах; общий браузер — следующий экран.'),calls:()=>toast('Откройте диалог или канал и запустите аудио- или видеозвонок из его шапки.'),audio:()=>window.ChatCalls?.startOutgoing?.('audio'),video:()=>window.ChatCalls?.startOutgoing?.('video')};

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
    ${!person.isSelf&&can('member.invite')?'<div class="stack" style="margin-top:16px"><button data-reset class="button secondary">Выписать ссылку для смены пароля</button></div>':''}
    ${person.isSelf?'<div class="stack" style="margin-top:16px"><button data-edit class="button secondary">Редактировать карточку</button><button data-push class="button secondary">Включить push</button><button data-logout class="button danger">Выйти</button></div>':''}
  `,()=>{
    const reset=$('[data-reset]');
    if(reset)reset.onclick=()=>issueResetModal(person);
    if(!person.isSelf)return;
    $('[data-edit]').onclick=()=>editProfile(person);
    $('[data-push]').onclick=enablePush;
    $('[data-logout]').onclick=logout;
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
  const input=(name,label,value='')=>`<label class="field"><span>${esc(label)}</span><input name="${name}" value="${esc(value??'')}" maxlength="120"></label>`;
  modal('Редактировать карточку',`<form id="profile-form" class="stack">
    ${input('displayName','Имя и фамилия',person.displayName)}
    ${input('title','Должность',person.title)}
    ${input('department','Подразделение',person.department)}
    ${input('location','Город',person.location)}
    ${input('phone','Телефон',person.phone)}
    <label class="field"><span>О себе</span><textarea name="about" rows="3" maxlength="2000">${esc(person.about??'')}</textarea></label>
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
async function react(id,reaction){try{const{reactions}=await api(`/api/v1/messages/${id}/reactions`,{method:'POST',body:JSON.stringify({reaction})});for(const list of S.messages.values()){const m=list.find(x=>x.id===id);if(m)m.reactions=reactions}render()}catch(e){toast(e.message)}}
function updateMessage(id,patch){for(const list of S.messages.values()){const m=list.find(x=>x.id===id);if(m)Object.assign(m,patch)}}
async function toggleSave(id,saved){try{await api(`/api/v1/messages/${id}/save`,{method:saved?'POST':'DELETE'});updateMessage(id,{saved});render();toast(saved?'Сохранено':'Удалено из сохранённых')}catch(e){toast(e.message)}}
async function togglePin(id,pinned){try{await api(`/api/v1/messages/${id}/pin`,{method:pinned?'POST':'DELETE'});updateMessage(id,{pinned});render();toast(pinned?'Сообщение закреплено':'Сообщение откреплено')}catch(e){toast(e.message)}}
function forwardModal(id){const targets=S.conversations.filter(c=>!c.archivedAt);modal('Переслать сообщение',targets.map(c=>`<button class="conversation-card" data-forward-target="${c.id}"><span class="avatar dark">${c.kind==='channel'?'#':esc(initials(c.title||'D'))}</span><span><strong>${esc(c.title||'Диалог')}</strong><div class="preview">${esc(c.purpose||'Переслать сюда')}</div></span></button>`).join('')||'<div class="empty">Нет доступных разговоров.</div>');$$('[data-forward-target]').forEach(b=>b.onclick=async()=>{try{const{message}=await api(`/api/v1/messages/${id}/forward`,{method:'POST',body:JSON.stringify({conversationId:b.dataset.forwardTarget})});append(b.dataset.forwardTarget,message);closeModal();toast('Сообщение переслано')}catch(e){toast(e.message)}})}
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
function renderOverlay(){
  const top=overlayStack[overlayStack.length-1];
  if(!top){$('#modal-root').innerHTML='';return}
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
window.addEventListener('popstate',()=>{if(unwinding>0){unwinding-=1;return}if(overlayStack.length){overlayStack.pop();renderOverlay();resumeTop()}});
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
function quick(){modal('Создать',`<div class="module-grid"><button class="module-card" data-q="dm"><span class="module-icon">●</span><strong>Сообщение</strong></button><button class="module-card" data-q="group"><span class="module-icon">◎</span><strong>Группа</strong></button><button class="module-card" data-q="task"><span class="module-icon">✓</span><strong>Задача</strong></button><button class="module-card" data-q="event"><span class="module-icon">□</span><strong>Событие</strong></button><button class="module-card" data-q="channel"><span class="module-icon">#</span><strong>Канал</strong></button></div>`);$$('[data-q]').forEach(b=>b.onclick=()=>{const x=b.dataset.q;replaceModal(({dm:directModal,group:groupModal,task:()=>taskModal(),event:eventModal,channel:channelModal})[x])})}
function taskModal(sourceMessageId=null,prefill=''){modal('Новая задача',`<form id="task-form" class="form-stack"><label>Что нужно сделать<input name="title" required value="${esc(prefill)}"></label><label>Ожидаемый результат<textarea name="outcome" rows="3" placeholder="Как понять, что задача выполнена?"></textarea></label><label>Ответственный<select name="ownerId" class="field">${S.people.map(p=>`<option value="${p.userId}" ${p.userId===me().userId?'selected':''}>${esc(p.displayName||p.email)}</option>`).join('')}</select></label><label>Кто принимает результат<select name="acceptorId" class="field">${S.people.map(p=>`<option value="${p.userId}" ${p.userId===me().userId?'selected':''}>${esc(p.displayName||p.email)}</option>`).join('')}</select></label><label>Срок<input name="promisedAt" type="datetime-local"></label><label>Приоритет<select name="priority" class="field"><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option><option value="low">Низкий</option></select></label><button class="button primary">Создать</button></form>`);$('#task-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),{task}=await api('/api/v1/tasks',{method:'POST',body:JSON.stringify({title:f.get('title'),outcome:f.get('outcome')||undefined,ownerId:f.get('ownerId'),acceptorId:f.get('acceptorId'),priority:f.get('priority'),promisedAt:f.get('promisedAt')?new Date(f.get('promisedAt')).toISOString():null,sourceMessageId})});upsertTask(task);closeModal();render();toast('Задача создана')}}

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
    <div class="row"><span class="task-status"></span><span><div class="row-title">${esc(TASK_STATUS[task.status]||task.status)}</div><div class="row-sub">Версия ${Number(task.version||1)} · ${esc(task.priority||'normal')}</div></span><span class="chip">${esc(dateTime(task.promisedAt))}</span></div>
    <div><div class="row-title">Метки <button class="text-button" data-task-labels>изменить</button></div>
      <div class="person-chips" data-task-label-slot><span class="muted">загружаем…</span></div></div>
    <div class="surface"><div class="row-title">Ожидаемый результат</div><p class="muted">${esc(task.outcome||task.title)}</p><div class="row-sub">Ответственный: ${esc(name(task.ownerId))} · Принимает: ${esc(name(task.acceptorId))} · Поставил: ${esc(name(task.requesterId))}</div></div>
    <div><div class="row-title">Следующее действие</div><div class="inline-actions" style="margin-top:8px">${(task.allowedTransitions||[]).map(to=>`<button class="button ${to==='accepted_result'||to==='closed'?'primary':'secondary'} small" data-task-transition="${esc(to)}">${esc(taskActionLabel(task,to))}</button>`).join('')||'<span class="muted">Доступных переходов сейчас нет.</span>'}</div></div>
    <form id="task-evidence-form" class="form-stack"><div class="row-title">Добавить результат / доказательство</div><label>Тип<select name="type" class="field"><option value="note">Комментарий / результат</option><option value="url">Ссылка</option><option value="metric">Метрика</option><option value="message">Ссылка на сообщение</option><option value="file">Идентификатор файла</option></select></label><label>Данные<textarea name="value" rows="3" required placeholder="Что сделано, где результат или чем это подтверждается"></textarea></label><button class="button secondary">Добавить доказательство</button></form>
    ${canReassignTask(task)?'<button data-task-reassign class="button secondary">Передать задачу</button>':''}${canRescheduleTask(task)?'<button class="button secondary" data-task-reschedule>Изменить срок / прогноз</button>':''}
    <div><div class="row-title">Доказательства · ${evidence.length}</div>${evidence.length?evidence.map(e=>`<div class="row"><span>↗</span><span><div class="row-title">${esc(e.type)}</div><div class="row-sub">${esc(e.value)}</div></span><span class="time">${esc(dateTime(e.createdAt))}</span></div>`).join(''):'<div class="empty">Пока нет. Без доказательства результат нельзя отправить на проверку.</div>'}</div>
    ${acceptances.length?`<div><div class="row-title">Проверка результата</div>${acceptances.map(a=>`<div class="row"><span>${a.decision==='accepted'?'✓':'↩'}</span><span><div class="row-title">${a.decision==='accepted'?'Результат принят':'Возвращено на доработку'}</div><div class="row-sub">${esc(a.comment||'')}</div></span><span class="time">${esc(dateTime(a.createdAt))}</span></div>`).join('')}</div>`:''}
    ${audit.length?`<details><summary>История изменений · ${audit.length}</summary><div class="stack" style="margin-top:8px">${audit.map(a=>`<div class="row-sub">${esc(dateTime(a.createdAt))} · <span>${esc(TASK_EVENT[a.eventType]||a.eventType)}</span>${a.payload?.reason?` — «${esc(a.payload.reason)}»`:''}</div>`).join('')}</div></details>`:''}
  </div>`);
  $$('[data-task-transition]').forEach(b=>b.onclick=()=>taskTransition(task,b.dataset.taskTransition));
  $('[data-task-labels]').onclick=()=>labelPicker('task',task.id,{title:`Метки: ${task.title}`});
  const form=$('#task-evidence-form');if(form)form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);try{const r=await api(`/api/v1/tasks/${task.id}/evidence`,{method:'POST',body:JSON.stringify({type:f.get('type'),value:f.get('value'),expectedVersion:task.version})});upsertTask(r.task);toast('Доказательство добавлено');await openTask(task.id)}catch(error){toast(error.message);if(error.code==='STALE_TASK_ACTION')await openTask(task.id)}};
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
function eventModal(prefill=''){modal('Новое событие',`<form id="event-form" class="form-stack"><label>Название<input name="title" required value="${esc(prefill)}"></label><label>Тип<select name="kind" class="field"><option value="meeting">Встреча</option><option value="focus">Фокус-время</option><option value="deadline">Дедлайн</option><option value="reminder">Напоминание</option></select></label><label>Начало<input name="start" type="datetime-local" required></label><label>Окончание<input name="end" type="datetime-local"></label><button class="button primary">Добавить</button></form>`);$('#event-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),{event}=await api('/api/v1/calendar-events',{method:'POST',body:JSON.stringify({title:f.get('title'),kind:f.get('kind'),startAt:new Date(f.get('start')).toISOString(),endAt:f.get('end')?new Date(f.get('end')).toISOString():null,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})});S.calendar.push(event);closeModal();render()}}
/**
 * `openRoom` leaves guests out: a company-wide room is exactly the one an
 * outsider must not be in, and the server refuses it — offering the name
 * would only produce a refusal.
 */
function participantChecks(selected=[],name='participant',{openRoom=false}={}){const chosen=new Set(selected);return S.people.filter(p=>p.userId!==me().userId&&(!openRoom||p.role!=='guest')).map(p=>`<label class="row candidate-row" style="cursor:pointer"><input type="checkbox" name="${name}" value="${p.userId}" ${chosen.has(p.userId)?'checked':''}><span class="avatar dark">${esc(initials(p.displayName||p.email))}</span><span><div class="row-title">${esc(p.displayName||p.email)}</div><div class="row-sub">${esc(p.title||p.role)}</div></span></label>`).join('')||'<div class="empty">Сначала пригласите сотрудников.</div>'}

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

async function membersModal(){const conversation=S.conversations.find(x=>x.id===S.selected);if(!conversation)return toast('Сначала откройте группу или канал.');try{const payload=await api(`/api/v1/conversations/${conversation.id}/members`),members=payload.items||[],memberIds=new Set(members.map(x=>x.userId)),available=S.people.filter(p=>p.userId!==me().userId&&!memberIds.has(p.userId));modal('Участники',`<div class="stack"><div>${members.map(m=>`<div class="row" data-member-row="${m.userId}"><span class="avatar dark">${esc(initials(m.displayName||m.email))}</span><span><div class="row-title">${esc(m.displayName||m.email)}</div><div class="row-sub">${esc(m.title||m.workspaceRole||'')}</div></span>${payload.canManage?`<span class="inline-actions"><select class="field" data-member-role="${m.userId}" style="min-width:120px"><option value="owner" ${m.role==='owner'?'selected':''}>Владелец</option><option value="moderator" ${m.role==='moderator'?'selected':''}>Модератор</option><option value="member" ${m.role==='member'?'selected':''}>Участник</option><option value="guest" ${m.role==='guest'?'selected':''}>Гость</option></select><button type="button" class="close-button" data-member-remove="${m.userId}" title="Удалить">×</button></span>`:`<span class="chip">${esc(m.role)}</span>`}</div>`).join('')}</div>${payload.canManage&&available.length?`<form id="add-members-form" class="form-stack"><div><div class="row-title">Добавить участников</div><div style="margin-top:8px">${available.filter(p=>!['workspace','organization'].includes(conversation.visibility)||p.role!=='guest').map(p=>`<label class="row candidate-row" style="cursor:pointer"><input type="checkbox" name="candidate" value="${p.userId}"><span class="avatar dark">${esc(initials(p.displayName||p.email))}</span><span><div class="row-title">${esc(p.displayName||p.email)}</div><div class="row-sub">${esc(p.title||p.role)}</div></span></label>`).join('')}</div></div><button class="button secondary">Добавить выбранных</button></form>`:''}</div>`);if(payload.canManage){$$('[data-member-role]').forEach(select=>select.onchange=async()=>{try{await api(`/api/v1/conversations/${conversation.id}/members/${select.dataset.memberRole}`,{method:'PATCH',body:JSON.stringify({role:select.value})});toast('Роль обновлена');await membersModal()}catch(error){toast(error.message);await membersModal()}});$$('[data-member-remove]').forEach(button=>button.onclick=async()=>{try{await api(`/api/v1/conversations/${conversation.id}/members/${button.dataset.memberRemove}`,{method:'DELETE'});toast('Участник удалён');await membersModal()}catch(error){toast(error.message)}});const form=$('#add-members-form');if(form)form.onsubmit=async e=>{e.preventDefault();const ids=[...form.querySelectorAll('input[name="candidate"]:checked')].map(x=>x.value);if(!ids.length)return toast('Выберите участников.');try{await api(`/api/v1/conversations/${conversation.id}/members`,{method:'POST',body:JSON.stringify({userIds:ids})});toast('Участники добавлены');await membersModal()}catch(error){toast(error.message)}}}}catch(error){toast(error.message)}}

function directModal(){const others=S.people.filter(p=>p.userId!==me().userId);modal('Новое сообщение',others.map(p=>`<button class="conversation-card" data-person="${p.userId}"><span class="avatar dark">${esc(initials(p.displayName||p.email))}</span><span><strong>${esc(p.displayName||p.email)}</strong><div class="preview">${esc(p.title||p.role)}</div></span></button>`).join('')||'<div class="empty">Сначала пригласите сотрудников.</div>');$$('[data-person]').forEach(b=>b.onclick=async()=>{const p=person(b.dataset.person),{conversation}=await api('/api/v1/conversations',{method:'POST',body:JSON.stringify({kind:'direct',title:p?.displayName||null,participantIds:[b.dataset.person]})});S.conversations.unshift(conversation);closeModal();openChat(conversation.id)})}
function inviteModal(){modal('Пригласить сотрудника',`<form id="invite-form" class="form-stack"><label>Email<input name="email" type="email" required></label><label>Роль<select name="role" class="field"><option value="member">Сотрудник</option><option value="manager">Руководитель</option><option value="admin">Администратор</option><option value="guest">Гость</option></select></label><button class="button primary">Создать приглашение</button></form>`);$('#invite-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),{invitation}=await api('/api/v1/invitations',{method:'POST',body:JSON.stringify({email:f.get('email'),role:f.get('role')})});modal('Приглашение готово',`<p class="muted">Ссылка действует 7 дней.</p><input id="invite-link" class="field" readonly value="${esc(invitation.inviteUrl)}"><button data-copy class="button primary" style="width:100%;margin-top:12px">Скопировать</button>`);$('[data-copy]').onclick=async()=>{await navigator.clipboard.writeText(invitation.inviteUrl);toast('Ссылка скопирована')}}}
function teamModal(){modal('Команда',S.people.map(p=>`<button class="row pressable" data-person="${esc(p.userId)}" style="width:100%;text-align:left"><span class="avatar dark">${esc(initials(p.displayName||p.email))}</span><span><div class="row-title">${esc(p.displayName||p.email)}</div><div class="row-sub">${esc(p.title||p.role)}</div></span><span class="presence-dot ${esc(p.presence?.state||'offline')}"></span></button>`).join(''),()=>{
  $$('[data-person]').forEach(b=>{b.onclick=()=>personPage(b.dataset.person)});
})}
function profileModal(){modal('Профиль и безопасность',`<div class="row"><span class="avatar">${esc(initials(me().displayName))}</span><span><div class="row-title">${esc(me().displayName)}</div><div class="row-sub">${esc(me().email)} · ${esc(me().role)}</div></span></div><div class="stack" style="margin-top:14px"><button data-push class="button secondary">Включить push</button><button data-logout class="button danger">Выйти</button></div>`);$('[data-push]').onclick=enablePush;$('[data-logout]').onclick=logout}
async function logout(){await api('/api/v1/auth/logout',{method:'POST'}).catch(()=>{});S.ws?.close();S.boot=null;closeModal();auth()}
async function enablePush(){try{if(!S.boot?.push?.enabled)return toast('На сервере ещё не настроены VAPID-ключи.');if(await Notification.requestPermission()!=='granted')return toast('Push не разрешён.');const r=await navigator.serviceWorker.ready;let sub=await r.pushManager.getSubscription();if(!sub)sub=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(S.boot.push.publicKey)});await api('/api/v1/push-subscriptions',{method:'POST',body:JSON.stringify(sub)});toast('Push включён')}catch(e){toast(e.message)}}
function key(v){const s=(v+'='.repeat((4-v.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(s);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}
function connect(){S.ws?.close();const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);S.ws=ws;ws.onmessage=e=>{try{const p=JSON.parse(e.data),d=p.data;if(p.event==='message.created'){append(d.conversationId,d.message);if(S.view==='chats')render()}if(p.event==='message.reaction'){for(const list of S.messages.values()){const m=list.find(x=>x.id===d.messageId);if(m)m.reactions=d.reactions}if(S.view==='chats')render()}if(p.event==='message.updated'){updateMessage(d.message.id,d.message);if(S.view==='chats')render()}if(p.event==='message.deleted'){updateMessage(d.message.id,d.message);if(S.view==='chats')render()}if(p.event==='message.pin'){updateMessage(d.messageId,{pinned:d.pinned});if(S.view==='chats')render()}if(p.event==='conversation.created'&&!S.conversations.some(x=>x.id===d.id)){S.conversations.unshift(d);shell();if(S.view==='chats')render()}if(p.event==='presence.updated'){const x=person(d.userId);if(x)x.presence=d.presence;lists()}if(p.event==='task.created'&&!S.tasks.some(x=>x.id===d.id)){S.tasks.unshift(d);if(['today','tasks'].includes(S.view))render()}if(p.event==='task.updated'){upsertTask(d);if(['today','tasks'].includes(S.view))render()}if(p.event==='calendar.created'&&!S.calendar.some(x=>x.id===d.id)){S.calendar.push(d);if(['today','calendar'].includes(S.view))render()}if(p.event==='typing.start'||p.event==='typing.stop'){if(d.conversationId===S.selected&&$('#typing'))$('#typing').textContent=p.event.endsWith('start')?`${name(d.userId)} печатает…`:''}}catch{}};ws.onclose=()=>S.boot&&setTimeout(connect,1600)}
async function voice(){if(S.recorder?.state==='recording'){S.recorder.stop();return}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true}),chunks=[],r=new MediaRecorder(stream);S.recorder=r;S.recordingAt=Date.now();r.ondataavailable=e=>e.data.size&&chunks.push(e.data);r.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:r.mimeType||'audio/webm'}),duration=Date.now()-S.recordingAt;S.recorder=null;const resp=await fetch(`/api/v1/conversations/${S.selected}/voice?durationMs=${duration}`,{method:'POST',credentials:'same-origin',headers:{'content-type':blob.type},body:blob}),p=await resp.json();if(resp.ok){append(S.selected,p.message);render()}else toast(p?.error?.message||'Ошибка записи')};r.start(250);toast('Запись началась — нажмите ещё раз, чтобы отправить.')}catch{toast('Нет доступа к микрофону.')}}
$('#file-picker').onchange=async e=>{for(const file of e.target.files){const r=await fetch('/api/v1/files',{method:'POST',credentials:'same-origin',headers:{'content-type':file.type||'application/octet-stream','x-file-name':encodeURIComponent(file.name)},body:file}),p=await r.json();if(!r.ok){toast(p?.error?.message||'Ошибка загрузки');continue}const{message}=await api(`/api/v1/conversations/${S.selected}/messages`,{method:'POST',body:JSON.stringify({kind:'file',metadata:{fileId:p.file.id,name:file.name,mimeType:file.type,size:file.size,contentUrl:p.file.contentUrl}})});append(S.selected,message)}e.target.value='';render()};
$$('[data-auth-mode]').forEach(b=>b.onclick=()=>setAuth(b.dataset.authMode));$('#login-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/v1/auth/login',{method:'POST',body:JSON.stringify({email:f.get('email'),password:f.get('password')})});bootstrap()}catch(x){$('#auth-error').textContent=x.message}};$('#register-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/v1/auth/register-company',{method:'POST',body:JSON.stringify({companyName:f.get('companyName'),ownerName:f.get('ownerName'),email:f.get('email'),password:f.get('password')})});bootstrap()}catch(x){$('#auth-error').textContent=x.message}};$('#accept-invite-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/api/v1/invitations/accept',{method:'POST',body:JSON.stringify({token:e.currentTarget.dataset.token,displayName:f.get('displayName'),password:f.get('password')})});history.replaceState({},'',location.pathname);bootstrap()}catch(x){$('#auth-error').textContent=x.message}};
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(console.error);bootstrap();
