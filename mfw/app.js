(function(){
  'use strict';

  var demoEvents = [
    {id:'e1',time:'17:00',name:'MFW Opening Runway',type:'Показ',venue:'Манеж · Зал 1',status:'LIVE',access:'OPEN'},
    {id:'e2',time:'18:00',name:'New Names: Moscow',type:'Показ',venue:'Манеж · Зал 2',status:'REGISTRATION',access:'OPEN'},
    {id:'e3',time:'19:00',name:'Ваш бренд глазами байера',type:'Лекция',venue:'Лекторий',status:'OPEN',access:'OPEN'},
    {id:'e4',time:'20:30',name:'International Exchange Show',type:'Показ',venue:'Манеж · Зал 1',status:'WAITLIST',access:'REQUEST ACCESS'},
    {id:'e5',time:'21:30',name:'Private Industry Reception',type:'B2B',venue:'Partner Lounge',status:'INVITE ONLY',access:'INVITE ONLY'}
  ];
  var brands = [
    {id:'b1',name:'MFW / NEW 01',city:'Москва',tag:'Emerging · Womenswear',desc:'Демонстрационная карточка бренда для проверки UX. Здесь будут история бренда, дизайнер, коллекции и точки продаж.'},
    {id:'b2',name:'MFW / STUDIO 02',city:'Санкт-Петербург',tag:'Contemporary · Unisex',desc:'Пример brand profile с коллекциями, replay, сохранением и профессиональными B2B-действиями.'},
    {id:'b3',name:'MFW / ATELIER 03',city:'Казань',tag:'Heritage · Couture',desc:'Пример участника с editorial-подачей, медиаматериалами и showroom-механикой.'},
    {id:'b4',name:'MFW / LAB 04',city:'Москва',tag:'Tech · Accessories',desc:'Пример brand discovery для молодой марки и новых форматов взаимодействия.'}
  ];
  var state = {
    tab:'today',
    discoverTab:'brands',
    role:localStorage.getItem('mfwRole') || 'Visitor',
    name:localStorage.getItem('mfwName') || 'Пётр Федин',
    savedLooks:JSON.parse(localStorage.getItem('mfwSavedLooks') || '["look-07"]'),
    savedBrands:JSON.parse(localStorage.getItem('mfwSavedBrands') || '[]'),
    myEvents:JSON.parse(localStorage.getItem('mfwMyEvents') || '["e2","e3"]'),
    connections:2,
    meeting:false,
    voted:false,
    scannerState:'idle',
    onboarding:localStorage.getItem('mfwOnboarded') === '1'
  };

  function persist(){
    localStorage.setItem('mfwRole',state.role);
    localStorage.setItem('mfwName',state.name);
    localStorage.setItem('mfwSavedLooks',JSON.stringify(state.savedLooks));
    localStorage.setItem('mfwSavedBrands',JSON.stringify(state.savedBrands));
    localStorage.setItem('mfwMyEvents',JSON.stringify(state.myEvents));
  }

  function esc(s){
    return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c];});
  }

  function badge(status){
    var cls = status==='LIVE'?'live':status==='OPEN'?'open':status.indexOf('WAIT')>=0?'wait':status.indexOf('INVITE')>=0?'invite':'';
    return '<span class="badge '+cls+'">'+esc(status)+'</span>';
  }

  function topbar(){
    return '<div class="topbar"><div class="wordmark"><span>MOSCOW</span><span>FASHION WEEK</span></div><div class="top-actions"><button class="icon-btn" data-action="notifications">●</button><button class="icon-btn pass" data-tab="me">QR</button></div></div>';
  }

  function nav(){
    var items=[
      ['today','◐','Сегодня'],
      ['schedule','▦','Программа'],
      ['live','▶','LIVE'],
      ['discover','◇','Открыть'],
      ['me','◎','Я']
    ];
    return '<nav class="bottom-nav">'+items.map(function(x){
      return '<button class="nav-btn '+(state.tab===x[0]?'active':'')+'" data-tab="'+x[0]+'"><b>'+x[1]+'</b>'+x[2]+'</button>';
    }).join('')+'</nav>';
  }

  function demoNote(){
    return '<div class="demo-note"><b>CONCEPT DEMO.</b> Программа, бренды и права доступа на этом стенде — демонстрационные данные. Архитектура интерфейса предназначена для подключения к официальным данным MFW.</div>';
  }

  function today(){
    return '<main>'+
      '<div class="eyebrow" style="margin-top:18px">26 сентября · День 1</div>'+
      '<h1>СЕГОДНЯ<br>В MFW</h1>'+
      demoNote()+
      '<section class="hero" style="margin-top:16px">'+
        '<div><span class="live-tag"><span class="dot"></span> LIVE NOW</span></div>'+
        '<div><div class="hero-title">OPENING<br>RUNWAY</div><div class="hero-meta">Манеж · Зал 1 · LOOK 14 / 32</div>'+
        '<div class="action-row"><button class="action light" data-tab="live">Смотреть LIVE</button><button class="action ghost" data-action="save-look" data-look="look-14">'+(state.savedLooks.indexOf('look-14')>=0?'♥ Сохранено':'♡ Сохранить образ')+'</button></div></div>'+
      '</section>'+
      '<div class="section-head"><h2>Дальше у вас</h2><span class="link" data-tab="schedule">Вся программа</span></div>'+
      '<div class="timeline">'+demoEvents.slice(1,4).map(eventRow).join('')+'</div>'+
      '<div class="section-head"><h2>Trending looks</h2><span class="link" data-action="saved-looks">Сохранённые</span></div>'+
      '<div class="scroll-row">'+[1,2,3,4,5].map(function(n){
        var id='look-0'+n; var saved=state.savedLooks.indexOf(id)>=0;
        return '<div class="look '+(saved?'saved':'')+'" data-action="save-look" data-look="'+id+'"><span>LOOK 0'+n+'</span></div>';
      }).join('')+'</div>'+
    '</main>';
  }

  function eventRow(e){
    return '<div class="event" data-action="event" data-id="'+e.id+'"><div class="time">'+e.time+'</div><div><h3>'+esc(e.name)+'</h3><div class="meta">'+esc(e.venue)+' · '+esc(e.type)+'</div></div>'+badge(e.status)+'</div>';
  }

  function schedule(){
    return '<main>'+
      '<div class="eyebrow" style="margin-top:18px">Ваш персональный календарь</div><h1>ПРОГРАММА</h1>'+
      '<div class="filters">'+['26 SEP','27','28','29','30','01 OCT'].map(function(x,i){return '<button class="chip '+(i===0?'active':'')+'">'+x+'</button>';}).join('')+'</div>'+
      '<div class="filters">'+['Все','Мои','Показы','Лекции','B2B','Онлайн','Доступно мне'].map(function(x,i){return '<button class="chip '+(i===0?'active':'')+'">'+x+'</button>';}).join('')+'</div>'+
      demoEvents.map(function(e){
        var mine=state.myEvents.indexOf(e.id)>=0;
        return '<div class="card event-card" data-action="event" data-id="'+e.id+'"><div class="event-top"><div><div class="eyebrow">'+e.time+' · '+esc(e.type)+'</div><div class="event-name">'+esc(e.name)+'</div><div class="event-details">'+esc(e.venue)+' · '+esc(e.access)+'</div></div>'+badge(e.status)+'</div><div class="mini-actions"><button class="action '+(mine?'ghost':'primary')+'" data-action="toggle-event" data-id="'+e.id+'">'+(mine?'✓ В моей программе':'+ Добавить')+'</button><button class="action ghost" data-action="route" data-id="'+e.id+'">Маршрут</button></div></div>';
      }).join('')+
    '</main>';
  }

  function live(){
    var saved=state.savedLooks.indexOf('look-14')>=0;
    return '<main><div class="eyebrow" style="margin-top:18px">Live runway</div><h1>СЕЙЧАС<br>В ЭФИРЕ</h1>'+
      '<div class="live-player"><div class="overlay"><div class="eyebrow">MFW OPENING RUNWAY · DEMO</div><div class="look-index">LOOK 14 / 32</div><div class="sub">Structured live metadata synced with runway timeline.</div><div class="player-controls"><button class="action primary" data-action="save-look" data-look="look-14">'+(saved?'♥ Сохранено':'♡ Сохранить')+'</button><button class="action ghost" data-action="brand" data-id="b1">Бренд</button></div></div></div>'+
      '<div class="section-head"><h2>Далее</h2><span class="link">Все эфиры</span></div>'+
      '<div class="card"><div class="eyebrow">18:00 · UP NEXT</div><div class="event-name">New Names: Moscow</div><div class="sub">Напомним за 10 минут</div><div class="action-row"><button class="action primary" data-action="toggle-event" data-id="e2">Добавить</button></div></div>'+
      '<h2>Replay</h2><div class="card"><div class="eyebrow">Вчера · 24 MIN</div><div class="event-name">Fashion Film Selection</div><button class="action ghost" data-action="toast" data-message="Replay открыт в demo-режиме">▶ Смотреть запись</button></div>'+
    '</main>';
  }

  function discover(){
    var tabs=['brands','speakers','people','market','map'];
    var labels={brands:'Бренды',speakers:'Спикеры',people:'Люди',market:'Маркет',map:'Карта'};
    var content='';
    if(state.discoverTab==='brands'){
      content='<input class="input" placeholder="Поиск бренда, дизайнера, категории" />'+
      '<div class="grid2" style="margin-top:14px">'+brands.map(function(b){
        return '<div class="brand-tile" data-action="brand" data-id="'+b.id+'"><div class="brand-tag">'+esc(b.tag)+'</div><h3>'+esc(b.name)+'</h3><div class="sub">'+esc(b.city)+'</div></div>';
      }).join('')+'</div>';
    } else if(state.discoverTab==='speakers'){
      content='<div class="card"><div class="eyebrow">Retail · Buying</div><div class="event-name">Анна · Buyer Perspective</div><div class="sub">Демонстрационный профиль спикера. Сессия: «Ваш бренд глазами байера».</div><div class="action-row"><button class="action primary" data-action="questions">Задать вопрос</button><button class="action ghost" data-action="toggle-event" data-id="e3">В программу</button></div></div>'+
      '<div class="card"><div class="eyebrow">Technology · Fashion</div><div class="event-name">AI в fashion-команде</div><div class="sub">Пример профиля с записью, материалами и Q&A.</div><button class="action ghost" data-action="toast" data-message="Материалы будут доступны после сессии">Материалы</button></div>';
    } else if(state.discoverTab==='people'){
      content='<div class="filters">'+['Buyer','Designer','Retail','Media','Stylist','Creator'].map(function(x,i){return '<button class="chip '+(i===0?'active':'')+'">'+x+'</button>';}).join('')+'</div>'+
      '<div class="card"><div class="profile-head"><div class="avatar"></div><div><h3>Мария · Buyer</h3><div class="sub">Premium Womenswear · Moscow</div></div></div><div class="action-row"><button class="action primary" data-action="connect">Connect</button><button class="action ghost" data-action="toast" data-message="QR exchange готов к сканированию">QR exchange</button></div></div>';
    } else if(state.discoverTab==='market'){
      content='<div class="card"><div class="eyebrow">MARKET DISCOVERY</div><div class="event-name">Сканируйте QR бренда на стенде</div><div class="sub">Откроется профиль, коллекция, точки продаж и кнопка Follow.</div><button class="action primary" data-action="brand" data-id="b2">Открыть пример</button></div>'+
      '<div class="grid2" style="margin-top:10px">'+brands.slice(0,2).map(function(b){return '<div class="brand-tile" data-action="brand" data-id="'+b.id+'"><h3>'+esc(b.name)+'</h3><div class="sub">'+esc(b.tag)+'</div></div>';}).join('')+'</div>';
    } else {
      content='<div class="card"><div class="eyebrow">MFW MAP · DEMO</div><div class="event-name">Манеж</div><div class="sub">Hall 1 · Hall 2 · Hall 3 · Lecture Hall · Showroom · Market · VIP · Media · Cloakroom</div></div>'+
      '<div class="card"><div class="eyebrow">Следующее событие</div><div class="event-name">18:00 · New Names: Moscow</div><div class="sub">Hall 2 · ориентировочно 4 минуты пешком</div><button class="action primary" data-action="route">Построить маршрут</button></div>';
    }
    return '<main><div class="eyebrow" style="margin-top:18px">Discover MFW</div><h1>ОТКРЫТЬ</h1><div class="filters">'+tabs.map(function(t){return '<button class="chip '+(state.discoverTab===t?'active':'')+'" data-discover="'+t+'">'+labels[t]+'</button>';}).join('')+'</div>'+content+'</main>';
  }

  function me(){
    var roleContent='';
    if(state.role==='Buyer'){
      roleContent=buyerPanel();
    } else if(state.role==='Media'){
      roleContent='<h2>Press mode</h2><div class="card"><div class="eyebrow">APPROVED ASSETS</div><div class="event-name">Press kit · Opening Runway</div><div class="sub">Press release · 18 approved images · credits · press contact</div><button class="action primary" data-action="toast" data-message="Demo: пакет подготовлен к выгрузке">Получить press kit</button></div>';
    } else if(state.role==='Designer'){
      roleContent='<h2>Brand dashboard</h2><div class="stat-grid"><div class="stat"><b>82%</b><small>Профиль</small></div><div class="stat"><b>148</b><small>Сохранения</small></div><div class="stat"><b>17</b><small>Buyer interest</small></div></div><div class="card" style="margin-top:10px"><h3>До показа</h3><div class="sub">Нужно загрузить 4 look metadata и проверить порядок выхода.</div><button class="action primary" data-action="toast" data-message="Demo: открыта подготовка коллекции">Продолжить подготовку</button></div>';
    } else if(state.role==='Staff'){
      roleContent=staffPanel();
    }

    return '<main><div class="eyebrow" style="margin-top:18px">MFW ID</div><h1>ВАШ<br>ПРОФИЛЬ</h1>'+
      '<div class="profile-head"><div class="avatar"></div><div><h3>'+esc(state.name)+'</h3><div class="role">'+esc(state.role.toUpperCase())+'</div><div class="sub">Demo account</div></div></div>'+
      '<div class="pass-card"><div class="pass-top"><div><div class="pass-title">MOSCOW FASHION WEEK</div><div class="pass-role">'+esc(state.role)+' PASS · DEMO</div></div><b>01</b></div><div id="qr" class="qr" aria-label="Demo QR"></div><div class="pass-top"><div><b>26 SEP — 01 OCT</b><div style="font-size:11px;margin-top:5px">Entitlements: '+entitlementText()+'</div></div><div class="offline"><span class="okdot"></span> Offline ready</div></div></div>'+
      '<h2>Demo role</h2><div class="role-switcher">'+['Visitor','Buyer','Media','Designer','Staff'].map(function(r){return '<button class="role-btn '+(state.role===r?'active':'')+'" data-role="'+r+'">'+r+'</button>';}).join('')+'</div>'+
      '<div class="stat-grid"><div class="stat"><b>'+state.myEvents.length+'</b><small>События</small></div><div class="stat"><b>'+state.savedLooks.length+'</b><small>Образы</small></div><div class="stat"><b>'+state.connections+'</b><small>Контакты</small></div></div>'+
      roleContent+
      '<h2>MFW Passport</h2><div class="progress"><span style="width:60%"></span></div><div class="passport" style="margin-top:10px"><div class="stamp done"><div class="symbol">✓</div><b>Первый показ</b><div class="sub">Получено</div></div><div class="stamp done"><div class="symbol">◇</div><b>Открыть бренд</b><div class="sub">Получено</div></div><div class="stamp"><div class="symbol">□</div><b>Fashion Film</b><div class="sub">Ещё не получено</div></div><div class="stamp done"><div class="symbol">◎</div><b>Лекция</b><div class="sub">Получено</div></div></div>'+
      '<h2>Настройки</h2><div class="card"><div class="event" style="grid-template-columns:1fr auto;padding-top:0"><div><h3>Уведомления</h3><div class="meta">Критические · LIVE · персональные</div></div><span class="badge open">ON</span></div><button class="action ghost" data-action="restart-onboarding">Перезапустить onboarding</button></div>'+
    '</main>';
  }

  function entitlementText(){
    if(state.role==='Buyer') return 'Showroom · B2B · selected shows';
    if(state.role==='Media') return 'Media · Press Zone · selected shows';
    if(state.role==='Designer') return 'Backstage · Brand Zone · assigned show';
    if(state.role==='Staff') return 'Gate · Operations';
    return 'Public programme · registered events';
  }

  function buyerPanel(){
    return '<h2>Buyer workspace</h2>'+
      '<div class="card"><div class="eyebrow">SHORTLIST</div><div class="event-name">3 бренда для просмотра</div><div class="sub">Подборка на основе demo-интересов: premium womenswear / emerging designers.</div><div class="action-row"><button class="action primary" data-action="brand" data-id="b1">Открыть shortlist</button><button class="action ghost" data-action="line-sheet">Line sheets</button></div></div>'+
      '<div class="card"><div class="eyebrow">MEETING</div><div class="event-name">'+(state.meeting?'14:30 · MFW / NEW 01':'Запросить встречу')+'</div><div class="sub">'+(state.meeting?'Showroom Meeting Point 4 · подтверждено':'Выберите бренд и доступный слот.')+'</div><button class="action '+(state.meeting?'ghost':'primary')+'" data-action="meeting">'+(state.meeting?'Добавить private note':'Выбрать слот')+'</button></div>';
  }

  function staffPanel(){
    var result='';
    if(state.scannerState==='valid') result='<div class="access-result valid">VALID · HALL 1 · 21:00</div>';
    if(state.scannerState==='no') result='<div class="access-result no">NO ACCESS · entitlement missing</div>';
    return '<h2>Gate scanner</h2><div class="scanner" data-action="scan"></div>'+result+'<div class="action-row"><button class="action primary" data-action="scan-valid">Сканировать VALID</button><button class="action danger" data-action="scan-no">Сценарий NO ACCESS</button></div>';
  }

  function render(){
    var app=document.getElementById('app');
    if(!state.onboarding){
      app.innerHTML=onboarding();
      bind();
      return;
    }
    var screen=state.tab==='today'?today():state.tab==='schedule'?schedule():state.tab==='live'?live():state.tab==='discover'?discover():me();
    app.innerHTML='<div class="app">'+topbar()+screen+nav()+'</div>';
    if(state.tab==='me') generateQR();
    bind();
  }

  function onboarding(){
    return '<div class="app"><main style="padding-top:48px"><div class="eyebrow">MOSCOW FASHION WEEK · CONCEPT DEMO</div><h1>ОДИН ID.<br>ВСЯ НЕДЕЛЯ<br>МОДЫ.</h1><p class="sub">Показы, пропуск, LIVE, бренды, networking и личная программа — в одном мобильном опыте.</p>'+demoNote()+
      '<div class="card" style="margin-top:24px"><label class="eyebrow">Ваше имя</label><input id="onboard-name" class="input" style="margin-top:8px" value="'+esc(state.name)+'" /><div class="eyebrow" style="margin-top:18px">Роль для демо</div><div class="role-switcher">'+['Visitor','Buyer','Media','Designer'].map(function(r){return '<button class="role-btn '+(state.role===r?'active':'')+'" data-onboard-role="'+r+'">'+r+'</button>';}).join('')+'</div><div class="eyebrow" style="margin-top:18px">Интересы</div><div class="filters" style="margin-left:0;margin-right:0;padding:0">'+['Russian design','Luxury','Emerging','Retail','Technology'].map(function(x,i){return '<button class="chip '+(i<3?'active':'')+'">'+x+'</button>';}).join('')+'</div><button class="action primary" style="width:100%;margin-top:12px" data-action="finish-onboarding">Войти в MFW</button></div>'+
      '<p class="sub" style="font-size:11px;margin-top:16px">Продолжая, вы видите демонстрационный интерфейс. Реальные согласия и обработка данных будут подключаться отдельными юридическими сущностями.</p></main></div>';
  }

  function generateQR(){
    var el=document.getElementById('qr'); if(!el) return;
    var seed=(state.name+state.role+'MFW').split('').reduce(function(a,c){return a+c.charCodeAt(0);},0);
    var html='';
    for(var i=0;i<441;i++){
      var x=i%21,y=Math.floor(i/21);
      var finder=((x<7&&y<7)||(x>13&&y<7)||(x<7&&y>13));
      var border=finder && (x%7===0||x%7===6||y%7===0||y%7===6);
      var center=finder && x%7>=2&&x%7<=4&&y%7>=2&&y%7<=4;
      var on=border||center||(((i*17+seed*13+i*i)%23)<10);
      html+='<i class="'+(on?'on':'')+'"></i>';
    }
    el.innerHTML=html;
  }

  function openEvent(id){
    var e=demoEvents.filter(function(x){return x.id===id;})[0]; if(!e)return;
    var mine=state.myEvents.indexOf(id)>=0;
    openSheet('<div class="eyebrow">'+e.time+' · '+esc(e.type)+'</div><h1 style="font-size:42px">'+esc(e.name)+'</h1><p class="sub">'+esc(e.venue)+' · '+esc(e.access)+'</p>'+badge(e.status)+'<div class="action-row"><button class="action primary" data-action="toggle-event" data-id="'+e.id+'">'+(mine?'✓ В моей программе':'+ Добавить в программу')+'</button><button class="action ghost" data-action="route">Маршрут</button></div><h2>Доступ</h2><div class="card"><b>Credential → Entitlement → Event</b><p class="sub">В production решение о входе будет приниматься серверной моделью прав, а не названием роли пользователя.</p></div>');
  }

  function openBrand(id){
    var b=brands.filter(function(x){return x.id===id;})[0]; if(!b)return;
    var saved=state.savedBrands.indexOf(id)>=0;
    var pro=(state.role==='Buyer'||state.role==='Media');
    openSheet('<div class="eyebrow">'+esc(b.city)+' · '+esc(b.tag)+'</div><h1 style="font-size:44px">'+esc(b.name)+'</h1><div class="hero" style="min-height:250px;margin:14px 0"></div><p class="sub">'+esc(b.desc)+'</p><div class="action-row"><button class="action primary" data-action="save-brand" data-id="'+b.id+'">'+(saved?'✓ Following':'Follow')+'</button><button class="action ghost" data-action="toast" data-message="Demo: открыта коллекция">Коллекция</button></div><h2>Последний показ</h2><div class="scroll-row">'+[1,2,3].map(function(n){return '<div class="look" data-action="save-look" data-look="'+b.id+'-look-'+n+'"><span>LOOK 0'+n+'</span></div>';}).join('')+'</div>'+(pro?'<h2>Для профессионалов</h2><div class="card"><div class="action-row"><button class="action primary" data-action="line-sheet">Line sheet</button><button class="action ghost" data-action="meeting">Запросить встречу</button></div></div>':''));
  }

  function questions(){
    openSheet('<div class="eyebrow">LIVE Q&A · DEMO</div><h1 style="font-size:42px">ВОПРОСЫ<br>СПИКЕРУ</h1><div class="question"><button class="vote" data-action="upvote">▲ 127</button><b>Что байер оценивает в первые пять минут встречи?</b></div><div class="question"><button class="vote" data-action="upvote">▲ 84</button><b>Какие ошибки чаще всего мешают бренду получить заказ?</b></div><input class="input" style="margin-top:16px" placeholder="Ваш вопрос" /><button class="action primary" style="margin-top:10px" data-action="toast" data-message="Вопрос отправлен модератору">Отправить</button>');
  }

  function notifications(){
    openSheet('<div class="eyebrow">Notification center</div><h1 style="font-size:42px">СЕГОДНЯ</h1><div class="card"><b>Критическое</b><p class="sub">Demo: при переносе зала или времени уведомление появится здесь и в push.</p></div><div class="card"><b>LIVE</b><p class="sub">Opening Runway уже в эфире.</p></div><div class="card"><b>Персональное</b><p class="sub">До сохранённой вами лекции 45 минут.</p></div>');
  }

  function openSheet(html){
    closeSheet();
    var wrap=document.createElement('div');wrap.className='modal';wrap.id='modal';
    wrap.innerHTML='<div class="sheet"><div class="sheet-head"><div class="eyebrow">MFW</div><button class="close" data-action="close">×</button></div>'+html+'</div>';
    document.body.appendChild(wrap);bind();
  }
  function closeSheet(){var m=document.getElementById('modal');if(m)m.remove();}

  function toast(msg){
    var old=document.querySelector('.toast');if(old)old.remove();
    var t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);
    setTimeout(function(){if(t.parentNode)t.remove();},1800);
  }

  function setRole(r){state.role=r;persist();render();toast('Demo role: '+r);}
  function toggleEvent(id){
    var i=state.myEvents.indexOf(id);
    if(i>=0){state.myEvents.splice(i,1);toast('Удалено из программы');}
    else{state.myEvents.push(id);toast('Добавлено в вашу программу');}
    persist();closeSheet();render();
  }
  function saveLook(id){
    var i=state.savedLooks.indexOf(id);
    if(i>=0){state.savedLooks.splice(i,1);toast('Образ удалён из сохранённых');}
    else{state.savedLooks.push(id);toast('Образ сохранён');}
    persist();render();
  }
  function saveBrand(id){
    var i=state.savedBrands.indexOf(id);
    if(i>=0){state.savedBrands.splice(i,1);toast('Подписка снята');}
    else{state.savedBrands.push(id);toast('Бренд добавлен');}
    persist();closeSheet();render();
  }
  function meeting(){
    if(state.role!=='Buyer' && state.role!=='Media'){toast('В demo встреча доступна профессиональным ролям');return;}
    if(state.meeting){openSheet('<div class="eyebrow">PRIVATE NOTE</div><h1 style="font-size:40px">MFW / NEW 01</h1><textarea class="input" style="height:120px" placeholder="Private buyer note"></textarea><button class="action primary" style="margin-top:10px" data-action="toast" data-message="Private note сохранена">Сохранить</button>');return;}
    openSheet('<div class="eyebrow">REQUEST MEETING</div><h1 style="font-size:40px">ВЫБЕРИТЕ<br>СЛОТ</h1><div class="action-row"><button class="action ghost" data-action="confirm-meeting">14:10</button><button class="action primary" data-action="confirm-meeting">14:30</button><button class="action ghost" data-action="confirm-meeting">15:20</button></div>');
  }

  function bind(){
    document.querySelectorAll('[data-tab]').forEach(function(el){el.onclick=function(){state.tab=el.getAttribute('data-tab');closeSheet();render();window.scrollTo(0,0);};});
    document.querySelectorAll('[data-discover]').forEach(function(el){el.onclick=function(){state.discoverTab=el.getAttribute('data-discover');render();};});
    document.querySelectorAll('[data-role]').forEach(function(el){el.onclick=function(){setRole(el.getAttribute('data-role'));};});
    document.querySelectorAll('[data-onboard-role]').forEach(function(el){el.onclick=function(){state.role=el.getAttribute('data-onboard-role');render();};});
    document.querySelectorAll('[data-action]').forEach(function(el){el.onclick=function(ev){
      ev.stopPropagation();
      var a=el.getAttribute('data-action');
      if(a==='close')closeSheet();
      else if(a==='event')openEvent(el.getAttribute('data-id'));
      else if(a==='toggle-event')toggleEvent(el.getAttribute('data-id'));
      else if(a==='save-look')saveLook(el.getAttribute('data-look'));
      else if(a==='brand')openBrand(el.getAttribute('data-id'));
      else if(a==='save-brand')saveBrand(el.getAttribute('data-id'));
      else if(a==='notifications')notifications();
      else if(a==='questions')questions();
      else if(a==='meeting')meeting();
      else if(a==='confirm-meeting'){state.meeting=true;closeSheet();render();toast('Встреча подтверждена: 14:30');}
      else if(a==='connect'){state.connections+=1;render();toast('Запрос на связь отправлен');}
      else if(a==='line-sheet')toast('Demo: line sheet открыт');
      else if(a==='route')toast('Demo: маршрут построен');
      else if(a==='toast')toast(el.getAttribute('data-message')||'Готово');
      else if(a==='saved-looks'){state.tab='me';render();}
      else if(a==='scan'||a==='scan-valid'){state.scannerState='valid';render();}
      else if(a==='scan-no'){state.scannerState='no';render();}
      else if(a==='restart-onboarding'){localStorage.removeItem('mfwOnboarded');state.onboarding=false;render();}
      else if(a==='finish-onboarding'){
        var input=document.getElementById('onboard-name'); if(input&&input.value.trim())state.name=input.value.trim();
        state.onboarding=true;localStorage.setItem('mfwOnboarded','1');persist();render();toast('MFW ID создан в demo-режиме');
      }
      else if(a==='upvote')toast('Голос учтён в demo');
    };});
  }

  if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}
  render();
})();