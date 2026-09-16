(() => {
  const THEME_KEY = 'chat.theme';
  const LOCALE_KEY = 'chat.locale';
  const THEMES = new Set(['dark', 'light']);
  const LOCALES = new Set(['ru', 'en']);

  const safeGet = (key, fallback) => {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  };
  const safeSet = (key, value) => {
    try { localStorage.setItem(key, value); } catch {}
  };

  let theme = THEMES.has(safeGet(THEME_KEY, 'dark')) ? safeGet(THEME_KEY, 'dark') : 'dark';
  let locale = LOCALES.has(safeGet(LOCALE_KEY, 'ru')) ? safeGet(LOCALE_KEY, 'ru') : 'ru';

  const translations = new Map(Object.entries({
    'Chat — рабочее пространство компании': ['Chat — рабочее пространство компании', 'Chat — company workspace'],
    'РАБОЧЕЕ ПРОСТРАНСТВО': ['РАБОЧЕЕ ПРОСТРАНСТВО', 'WORKSPACE'],
    'Войти в компанию': ['Войти в компанию', 'Sign in to company'],
    'Создать компанию': ['Создать компанию', 'Create company'],
    'Сообщения, задачи, календарь, файлы и встречи — в одном рабочем контексте.': ['Сообщения, задачи, календарь, файлы и встречи — в одном рабочем контексте.', 'Messages, tasks, calendar, files and meetings — in one work context.'],
    'Войти': ['Войти', 'Sign in'],
    'Компания': ['Компания', 'Company'],
    'Пароль': ['Пароль', 'Password'],
    'или сразу посмотреть наполненное пространство': ['или сразу посмотреть наполненное пространство', 'or open a populated workspace right away'],
    'Открыть готовое демо': ['Открыть готовое демо', 'Open ready demo'],
    'Открываем демо…': ['Открываем демо…', 'Opening demo…'],
    'Компания, сотрудники, каналы, задачи, календарь и история работы уже заполнены.': ['Компания, сотрудники, каналы, задачи, календарь и история работы уже заполнены.', 'Company, employees, channels, tasks, calendar and work history are already populated.'],
    'Ваше имя': ['Ваше имя', 'Your name'],
    'Рабочий email': ['Рабочий email', 'Work email'],
    'Создать пространство': ['Создать пространство', 'Create workspace'],
    'Присоединиться к компании': ['Присоединиться к компании', 'Join company'],
    'Новый пароль': ['Новый пароль', 'New password'],
    'Каналы': ['Каналы', 'Channels'],
    'Личные': ['Личные', 'Direct'],
    'Поиск': ['Поиск', 'Search'],
    'Создать': ['Создать', 'Create'],
    'Основная навигация': ['Основная навигация', 'Main navigation'],
    'Сегодня': ['Сегодня', 'Today'],
    'Сообщения': ['Сообщения', 'Messages'],
    'Задачи': ['Задачи', 'Tasks'],
    'Календарь': ['Календарь', 'Calendar'],
    'Ещё': ['Ещё', 'More'],
    'Сотрудник': ['Сотрудник', 'Employee'],
    'Диалог': ['Диалог', 'Conversation'],
    'Доброе утро': ['Доброе утро', 'Good morning'],
    'Добрый день': ['Добрый день', 'Good afternoon'],
    'Добрый вечер': ['Добрый вечер', 'Good evening'],
    'Встречи и рабочее время': ['Встречи и рабочее время', 'Meetings and work time'],
    '＋ Событие': ['＋ Событие', '＋ Event'],
    'Встреча': ['Встреча', 'Meeting'],
    'В плане': ['В плане', 'Planned'],
    'Свободный день': ['Свободный день', 'Free day'],
    'Добавьте встречу или focus time.': ['Добавьте встречу или focus time.', 'Add a meeting or focus time.'],
    'Мои задачи': ['Мои задачи', 'My tasks'],
    '＋ Задача': ['＋ Задача', '＋ Task'],
    'Задач пока нет': ['Задач пока нет', 'No tasks yet'],
    'Создайте задачу вручную или из сообщения.': ['Создайте задачу вручную или из сообщения.', 'Create a task manually or from a message.'],
    'Последние сообщения': ['Последние сообщения', 'Recent messages'],
    'Создайте первый канал.': ['Создайте первый канал.', 'Create the first channel.'],
    'Открыть разговор': ['Открыть разговор', 'Open conversation'],
    'Голосовое сообщение': ['Голосовое сообщение', 'Voice message'],
    'Файл': ['Файл', 'File'],
    'Звонок': ['Звонок', 'Call'],
    'Задача': ['Задача', 'Task'],
    'Событие': ['Событие', 'Event'],
    'Нет сообщений': ['Нет сообщений', 'No messages'],
    'Рабочая переписка': ['Рабочая переписка', 'Work conversation'],
    'Начните разговор': ['Начните разговор', 'Start the conversation'],
    'Ответ на:': ['Ответ на:', 'Reply to:'],
    'Сообщение': ['Сообщение', 'Message'],
    'Выберите разговор': ['Выберите разговор', 'Choose a conversation'],
    'Вы': ['Вы', 'You'],
    'Вложение': ['Вложение', 'Attachment'],
    'Ответить': ['Ответить', 'Reply'],
    'В задачу': ['В задачу', 'Create task'],
    'Ответственность, сроки и результат': ['Ответственность, сроки и результат', 'Ownership, deadlines and outcome'],
    'Ничего не потеряется': ['Ничего не потеряется', 'Nothing gets lost'],
    'НЕДЕЛЯ': ['НЕДЕЛЯ', 'WEEK'],
    'Календарь свободен': ['Календарь свободен', 'Calendar is clear'],
    'Команда': ['Команда', 'Team'],
    'Пригласить': ['Пригласить', 'Invite'],
    'Добавить сотрудника': ['Добавить сотрудника', 'Add employee'],
    'Файлы': ['Файлы', 'Files'],
    'Вложения из рабочих контекстов': ['Вложения из рабочих контекстов', 'Attachments from work contexts'],
    'Звонки': ['Звонки', 'Calls'],
    'Аудио, видео и screen share': ['Аудио, видео и screen share', 'Audio, video and screen sharing'],
    'Уведомления': ['Уведомления', 'Notifications'],
    'Push, упоминания и сроки': ['Push, упоминания и сроки', 'Push, mentions and deadlines'],
    'Настройки': ['Настройки', 'Settings'],
    'Профиль и безопасность': ['Профиль и безопасность', 'Profile and security'],
    'Создать': ['Создать', 'Create'],
    'Канал': ['Канал', 'Channel'],
    'Новая задача': ['Новая задача', 'New task'],
    'Что нужно сделать': ['Что нужно сделать', 'What needs to be done'],
    'Ответственный': ['Ответственный', 'Owner'],
    'Срок': ['Срок', 'Due date'],
    'Приоритет': ['Приоритет', 'Priority'],
    'Обычный': ['Обычный', 'Normal'],
    'Высокий': ['Высокий', 'High'],
    'Срочный': ['Срочный', 'Urgent'],
    'Задача создана': ['Задача создана', 'Task created'],
    'Новое событие': ['Новое событие', 'New event'],
    'Название': ['Название', 'Title'],
    'Тип': ['Тип', 'Type'],
    'Focus time': ['Focus time', 'Focus time'],
    'Дедлайн': ['Дедлайн', 'Deadline'],
    'Напоминание': ['Напоминание', 'Reminder'],
    'Начало': ['Начало', 'Start'],
    'Окончание': ['Окончание', 'End'],
    'Добавить': ['Добавить', 'Add'],
    'Новый канал': ['Новый канал', 'New channel'],
    'Описание': ['Описание', 'Description'],
    'Доступ': ['Доступ', 'Access'],
    'Вся компания': ['Вся компания', 'Entire company'],
    'Только участники': ['Только участники', 'Participants only'],
    'Новое сообщение': ['Новое сообщение', 'New message'],
    'Сначала пригласите сотрудников.': ['Сначала пригласите сотрудников.', 'Invite employees first.'],
    'Пригласить сотрудника': ['Пригласить сотрудника', 'Invite employee'],
    'Роль': ['Роль', 'Role'],
    'Руководитель': ['Руководитель', 'Manager'],
    'Администратор': ['Администратор', 'Administrator'],
    'Гость': ['Гость', 'Guest'],
    'Создать приглашение': ['Создать приглашение', 'Create invitation'],
    'Приглашение готово': ['Приглашение готово', 'Invitation is ready'],
    'Ссылка действует 7 дней.': ['Ссылка действует 7 дней.', 'The link is valid for 7 days.'],
    'Скопировать': ['Скопировать', 'Copy'],
    'Ссылка скопирована': ['Ссылка скопирована', 'Link copied'],
    'Включить push': ['Включить push', 'Enable push'],
    'Выйти': ['Выйти', 'Sign out'],
    'На сервере ещё не настроены VAPID-ключи.': ['На сервере ещё не настроены VAPID-ключи.', 'VAPID keys are not configured on the server yet.'],
    'Push не разрешён.': ['Push не разрешён.', 'Push permission was not granted.'],
    'Push включён': ['Push включён', 'Push enabled'],
    'Запись началась — нажмите ещё раз, чтобы отправить.': ['Запись началась — нажмите ещё раз, чтобы отправить.', 'Recording started — tap again to send.'],
    'Нет доступа к микрофону.': ['Нет доступа к микрофону.', 'Microphone access is unavailable.'],
    'Ошибка записи': ['Ошибка записи', 'Recording error'],
    'Ошибка загрузки': ['Ошибка загрузки', 'Upload error'],
    'Файлы доступны в связанных чатах; общий браузер — следующий экран.': ['Файлы доступны в связанных чатах; общий браузер — следующий экран.', 'Files are available in linked chats; the unified file browser is the next screen.'],
    'WebRTC/SFU медиаслой — следующий технический этап.': ['WebRTC/SFU медиаслой — следующий технический этап.', 'The WebRTC/SFU media layer is the next technical stage.'],
    'Аудиозвонок будет подключён к WebRTC signaling.': ['Аудиозвонок будет подключён к WebRTC signaling.', 'Audio calling will use WebRTC signaling.'],
    'Видеозвонок будет подключён к WebRTC/SFU.': ['Видеозвонок будет подключён к WebRTC/SFU.', 'Video calling will use WebRTC/SFU.'],
    'Входящий звонок': ['Входящий звонок', 'Incoming call'],
    'Корпоративный звонок': ['Корпоративный звонок', 'Company call'],
    'Войти': ['Войти', 'Join'],
    'Не сейчас': ['Не сейчас', 'Not now'],
    'Аудиозвонок': ['Аудиозвонок', 'Audio call'],
    'Видеозвонок': ['Видеозвонок', 'Video call'],
    'Подключение…': ['Подключение…', 'Connecting…'],
    'Подключаем защищённую медиасессию…': ['Подключаем защищённую медиасессию…', 'Connecting secure media session…'],
    'Микрофон': ['Микрофон', 'Microphone'],
    'Камера': ['Камера', 'Camera'],
    'Демонстрация экрана': ['Демонстрация экрана', 'Screen sharing'],
    'Запись': ['Запись', 'Recording'],
    'Завершить': ['Завершить', 'Leave call'],
    'Согласие отправлено. Ждём остальных участников.': ['Согласие отправлено. Ждём остальных участников.', 'Consent sent. Waiting for the other participants.'],
    'Запись встречи началась': ['Запись встречи началась', 'Meeting recording started'],
    'Все согласия получены. Запись может запустить руководитель.': ['Все согласия получены. Запись может запустить руководитель.', 'All consents are collected. A manager can start the recording.'],
    'Запись остановлена и обрабатывается': ['Запись остановлена и обрабатывается', 'Recording stopped and is processing'],
    'Не удалось изменить состояние звонка': ['Не удалось изменить состояние звонка', 'Could not change call state'],
    'Восстанавливаем связь…': ['Восстанавливаем связь…', 'Reconnecting…'],
    'Связь восстановлена': ['Связь восстановлена', 'Connection restored'],
    'Соединение завершено': ['Соединение завершено', 'Connection ended'],
    'Подключено': ['Подключено', 'Connected'],
    'Сначала откройте диалог или канал': ['Сначала откройте диалог или канал', 'Open a conversation or channel first'],
    'Не удалось открыть демо': ['Не удалось открыть демо', 'Could not open demo'],
    'Authentication required': ['Требуется вход', 'Authentication required'],
    'Invalid email or password': ['Неверный email или пароль', 'Invalid email or password'],
    'Email already registered': ['Этот email уже зарегистрирован', 'Email already registered'],
    'owner': ['Владелец', 'Owner'],
    'admin': ['Администратор', 'Administrator'],
    'manager': ['Руководитель', 'Manager'],
    'member': ['Сотрудник', 'Member'],
    'guest': ['Гость', 'Guest'],
    'inbox': ['Входящие', 'Inbox'],
    'clarify': ['Уточнение', 'Clarify'],
    'proposed': ['Предложено', 'Proposed'],
    'accepted': ['Принято', 'Accepted'],
    'scheduled': ['Запланировано', 'Scheduled'],
    'in_progress': ['В работе', 'In progress'],
    'blocked': ['Заблокировано', 'Blocked'],
    'in_review': ['На проверке', 'In review'],
    'accepted_result': ['Результат принят', 'Result accepted'],
    'closed': ['Закрыто', 'Closed'],
    'rejected': ['Отклонено', 'Rejected'],
    'cancelled': ['Отменено', 'Cancelled'],
    'deferred': ['Отложено', 'Deferred'],
    'normal': ['Обычный', 'Normal'],
    'high': ['Высокий', 'High'],
    'urgent': ['Срочный', 'Urgent'],
    'meeting': ['Встреча', 'Meeting'],
    'focus': ['Фокус', 'Focus'],
    'deadline': ['Дедлайн', 'Deadline'],
    'reminder': ['Напоминание', 'Reminder'],
    'online': ['В сети', 'Online'],
    'away': ['Отошёл', 'Away'],
    'busy': ['Занят', 'Busy'],
    'do_not_disturb': ['Не беспокоить', 'Do not disturb'],
    'offline': ['Не в сети', 'Offline'],
    'Без срока': ['Без срока', 'No due date']
  }));

  const attributes = ['placeholder', 'aria-label', 'title'];
  const originals = new WeakMap();
  const attributeOriginals = new WeakMap();
  const pendingText = new WeakMap();

  const userContentSelector = [
    '.message-body',
    '.task-title',
    '.row-title',
    '.conversation-card strong',
    '.conversation-card .preview',
    '.sidebar-row .label',
    '.workspace-card strong',
    '.workspace-card small',
    '.profile-card strong',
    '.message-author',
    '.participant-label span:first-child',
    '[data-prefs-owned]'
  ].join(',');

  const monthWords = {
    'январь':'January','января':'January','янв.':'Jan',
    'февраль':'February','февраля':'February','февр.':'Feb',
    'март':'March','марта':'March','мар.':'Mar',
    'апрель':'April','апреля':'April','апр.':'Apr',
    'май':'May','мая':'May',
    'июнь':'June','июня':'June','июн.':'Jun',
    'июль':'July','июля':'July','июл.':'Jul',
    'август':'August','августа':'August','авг.':'Aug',
    'сентябрь':'September','сентября':'September','сент.':'Sep',
    'октябрь':'October','октября':'October','окт.':'Oct',
    'ноябрь':'November','ноября':'November','нояб.':'Nov',
    'декабрь':'December','декабря':'December','дек.':'Dec',
    'понедельник':'Monday','вторник':'Tuesday','среда':'Wednesday','четверг':'Thursday','пятница':'Friday','суббота':'Saturday','воскресенье':'Sunday',
    'пн':'Mon','вт':'Tue','ср':'Wed','чт':'Thu','пт':'Fri','сб':'Sat','вс':'Sun'
  };

  function caseLike(source, replacement) {
    if (source === source.toUpperCase()) return replacement.toUpperCase();
    if (source[0] === source[0]?.toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
    return replacement;
  }

  function translateDynamic(value) {
    if (locale === 'ru') return value;
    let match = value.match(/^(\d+) активных задач$/);
    if (match) return `${match[1]} active tasks`;
    match = value.match(/^(\d+) сотрудников$/);
    if (match) return `${match[1]} employees`;
    match = value.match(/^(\d+) диалогов$/);
    if (match) return `${match[1]} conversations`;
    match = value.match(/^(\d+) сотрудников, роли и статусы$/);
    if (match) return `${match[1]} employees, roles and statuses`;
    match = value.match(/^(.+) печатает…$/);
    if (match) return `${match[1]} is typing…`;
    let translated = value;
    for (const [ru, en] of Object.entries(monthWords)) {
      const escaped = ru.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      translated = translated.replace(new RegExp(escaped, 'gi'), (found) => caseLike(found, en));
    }
    translated = translated.replace(/\sг\.$/, '');
    return translated;
  }

  function translateCore(original) {
    const pair = translations.get(original);
    if (pair) return locale === 'en' ? pair[1] : pair[0];
    return translateDynamic(original);
  }

  function shouldSkip(node) {
    const parent = node.parentElement;
    return Boolean(parent?.closest(userContentSelector));
  }

  function translateTextNode(node, refreshOriginal = false) {
    if (!node || node.nodeType !== Node.TEXT_NODE || shouldSkip(node)) return;
    if (refreshOriginal || !originals.has(node)) originals.set(node, node.nodeValue || '');
    const original = originals.get(node) || '';
    const leading = original.match(/^\s*/)?.[0] || '';
    const trailing = original.match(/\s*$/)?.[0] || '';
    const core = original.trim();
    if (!core) return;
    const next = `${leading}${translateCore(core)}${trailing}`;
    if (node.nodeValue !== next) {
      pendingText.set(node, next);
      node.nodeValue = next;
    }
  }

  function translateAttributes(element) {
    if (!(element instanceof Element) || element.closest('[data-prefs-owned]')) return;
    let record = attributeOriginals.get(element);
    if (!record) { record = {}; attributeOriginals.set(element, record); }
    for (const attribute of attributes) {
      if (!element.hasAttribute(attribute)) continue;
      if (!(attribute in record)) record[attribute] = element.getAttribute(attribute) || '';
      const next = translateCore(record[attribute]);
      if (element.getAttribute(attribute) !== next) element.setAttribute(attribute, next);
    }
  }

  function translateSubtree(root = document) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) translateTextNode(root);
    if (root instanceof Element) translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateAttributes(node);
    }
    document.title = locale === 'en' ? 'Chat — company workspace' : 'Chat — рабочее пространство компании';
  }

  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
    const color = theme === 'light' ? '#f4f4f2' : '#050505';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    refreshOwnedUi();
  }

  function applyLocale() {
    document.documentElement.lang = locale;
    translateSubtree(document);
    refreshOwnedUi();
  }

  function setTheme(next) {
    if (!THEMES.has(next)) return;
    theme = next;
    safeSet(THEME_KEY, theme);
    applyTheme();
    window.dispatchEvent(new CustomEvent('chat:themechange', { detail:{ theme } }));
  }

  function setLocale(next) {
    if (!LOCALES.has(next)) return;
    locale = next;
    safeSet(LOCALE_KEY, locale);
    applyLocale();
    window.dispatchEvent(new CustomEvent('chat:localechange', { detail:{ locale } }));
  }

  function copy() {
    return locale === 'en' ? {
      preferences:'Appearance & language', theme:'Theme', black:'Black', white:'White', language:'Language', close:'Close'
    } : {
      preferences:'Оформление и язык', theme:'Тема', black:'Чёрная', white:'Белая', language:'Язык', close:'Закрыть'
    };
  }

  function preferenceControls() {
    const c = copy();
    return `<div class="prefs-settings" data-prefs-owned>
      <div class="prefs-setting-row"><span><strong>${c.theme}</strong></span><div class="prefs-segmented" role="group" aria-label="${c.theme}">
        <button type="button" class="prefs-choice ${theme === 'dark' ? 'active' : ''}" data-theme-choice="dark">${c.black}</button>
        <button type="button" class="prefs-choice ${theme === 'light' ? 'active' : ''}" data-theme-choice="light">${c.white}</button>
      </div></div>
      <div class="prefs-setting-row"><span><strong>${c.language}</strong></span><div class="prefs-segmented" role="group" aria-label="${c.language}">
        <button type="button" class="prefs-choice ${locale === 'ru' ? 'active' : ''}" data-locale-choice="ru">Русский</button>
        <button type="button" class="prefs-choice ${locale === 'en' ? 'active' : ''}" data-locale-choice="en">English</button>
      </div></div>
    </div>`;
  }

  function ensureAuthLauncher() {
    const auth = document.querySelector('#auth-view');
    if (!auth || auth.querySelector('[data-prefs-launcher]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'prefs-auth-launcher pressable';
    button.dataset.prefsLauncher = '1';
    button.dataset.prefsOwned = '1';
    auth.append(button);
    updateLauncher(button);
  }

  function updateLauncher(button) {
    if (!button) return;
    button.innerHTML = `<span>${locale.toUpperCase()}</span><span aria-hidden="true">${theme === 'dark' ? '●' : '○'}</span>`;
    button.setAttribute('aria-label', copy().preferences);
    button.setAttribute('title', copy().preferences);
  }

  function openPanel() {
    document.querySelector('.prefs-panel')?.remove();
    const c = copy();
    const panel = document.createElement('section');
    panel.className = 'prefs-panel';
    panel.dataset.prefsOwned = '1';
    panel.innerHTML = `<div class="prefs-panel-head"><div><span class="kicker">CHAT</span><h2>${c.preferences}</h2></div><button type="button" class="prefs-close" data-prefs-close aria-label="${c.close}">×</button></div>${preferenceControls()}`;
    document.body.append(panel);
  }

  function ensureProfileSettings() {
    const modal = document.querySelector('#modal-root .modal');
    if (!modal || !modal.querySelector('[data-logout]')) return;
    let block = modal.querySelector('[data-profile-preferences]');
    if (!block) {
      block = document.createElement('div');
      block.dataset.profilePreferences = '1';
      block.dataset.prefsOwned = '1';
      block.className = 'prefs-profile-block';
      const actions = modal.querySelector('.stack');
      if (actions) modal.insertBefore(block, actions);
      else modal.append(block);
    }
    block.innerHTML = preferenceControls();
  }

  function refreshOwnedUi() {
    document.querySelectorAll('[data-prefs-launcher]').forEach(updateLauncher);
    ensureProfileSettings();
    const panel = document.querySelector('.prefs-panel');
    if (panel) openPanel();
  }

  document.addEventListener('click', (event) => {
    const launcher = event.target.closest('[data-prefs-launcher]');
    if (launcher) { event.preventDefault(); openPanel(); return; }
    const themeButton = event.target.closest('[data-theme-choice]');
    if (themeButton) { event.preventDefault(); setTheme(themeButton.dataset.themeChoice); return; }
    const localeButton = event.target.closest('[data-locale-choice]');
    if (localeButton) { event.preventDefault(); setLocale(localeButton.dataset.localeChoice); return; }
    if (event.target.closest('[data-prefs-close]')) { document.querySelector('.prefs-panel')?.remove(); return; }
  }, true);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const node = mutation.target;
        if (pendingText.get(node) === node.nodeValue) { pendingText.delete(node); continue; }
        translateTextNode(node, true);
      }
      for (const added of mutation.addedNodes || []) translateSubtree(added);
    }
    ensureAuthLauncher();
    ensureProfileSettings();
  });

  function init() {
    applyTheme();
    ensureAuthLauncher();
    translateSubtree(document);
    observer.observe(document.documentElement, { subtree:true, childList:true, characterData:true });
  }

  window.ChatPreferences = {
    get theme() { return theme; },
    get locale() { return locale; },
    setTheme,
    setLocale,
    translate: (value) => translateCore(String(value ?? '')),
    translateSubtree,
  };

  init();
})();
