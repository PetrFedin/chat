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
    'Добавьте встречу или фокус-время.': ['Добавьте встречу или фокус-время.', 'Add a meeting or focus time.'],
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
    'Аудио, видео и демонстрация экрана': ['Аудио, видео и демонстрация экрана', 'Audio, video and screen sharing'],
    'Уведомления': ['Уведомления', 'Notifications'],
    'Push, упоминания и сроки': ['Push, упоминания и сроки', 'Push, mentions and deadlines'],
    'Настройки': ['Настройки', 'Settings'],
    'Профиль и безопасность': ['Профиль и безопасность', 'Profile and security'],
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
    'Фокус-время': ['Фокус-время', 'Focus time'],
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
    'Присоединиться': ['Присоединиться', 'Join'],
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
    'Диалоги': ['Диалоги', 'Conversations'],
    'Расписание дня': ['Расписание дня', 'Day schedule'],
    'События дня': ['События дня', 'Events of the day'],
    'События недели': ['События недели', 'Events of the week'],
    'События месяца': ['События месяца', 'Events of the month'],
    'Выбранный день': ['Выбранный день', 'Selected day'],
    'КАЛЕНДАРЬ': ['КАЛЕНДАРЬ', 'CALENDAR'],
    'Назад': ['Назад', 'Back'],
    'Вперёд': ['Вперёд', 'Forward'],
    'Закрыть': ['Закрыть', 'Close'],
    'Новый чат': ['Новый чат', 'New chat'],
    'Быстрый захват': ['Быстрый захват', 'Quick capture'],
    'Сообщение, задача или встреча…': ['Сообщение, задача или встреча…', 'Message, task or meeting…'],
    'Архив чатов': ['Архив чатов', 'Chat archive'],
    'Скрытые только для вас разговоры': ['Скрытые только для вас разговоры', 'Conversations hidden for you only'],
    'Сохранённые': ['Сохранённые', 'Saved'],
    'Сохранённые сообщения': ['Сохранённые сообщения', 'Saved messages'],
    'Личные сообщения для возврата к работе': ['Личные сообщения для возврата к работе', 'Personal bookmarks to come back to'],
    'Закреплённые сообщения': ['Закреплённые сообщения', 'Pinned messages'],
    'Оргструктура': ['Оргструктура', 'Org structure'],
    'Департаменты, отделы, штат и руководители': ['Департаменты, отделы, штат и руководители', 'Departments, units, headcount and heads'],
    'Организация': ['Организация', 'Organization'],
    'Пространство': ['Пространство', 'Workspace'],
    'Ваша роль': ['Ваша роль', 'Your role'],
    'Сотрудников': ['Сотрудников', 'Employees'],
    'Бесед': ['Бесед', 'Conversations'],
    'Переключение между несколькими пространствами пока не поддерживается: аккаунт живёт в одном.': ['Переключение между несколькими пространствами пока не поддерживается: аккаунт живёт в одном.', 'Switching between several workspaces is not supported yet: an account lives in one.'],
    'Здесь пусто': ['Здесь пусто', 'Nothing here'],
    'Архив пуст.': ['Архив пуст.', 'The archive is empty.'],
    'Сохранённых сообщений пока нет.': ['Сохранённых сообщений пока нет.', 'No saved messages yet.'],
    'Закреплённых сообщений пока нет.': ['Закреплённых сообщений пока нет.', 'No pinned messages yet.'],
    'Нет доступных разговоров.': ['Нет доступных разговоров.', 'No conversations available.'],
    'Вложений нет.': ['Вложений нет.', 'No attachments.'],
    'Действий пока не записано.': ['Действий пока не записано.', 'No activity recorded yet.'],
    'Участники не приглашены.': ['Участники не приглашены.', 'No participants invited.'],
    'задач нет': ['задач нет', 'no tasks'],
    'не назначено': ['не назначено', 'not assigned'],
    'не состоит в подразделениях': ['не состоит в подразделениях', 'not a member of any unit'],
    'Откройте чат.': ['Откройте чат.', 'Open a conversation.'],
    'Сначала откройте группу или канал.': ['Сначала откройте группу или канал.', 'Open a group or channel first.'],
    'Откройте диалог или канал и запустите аудио- или видеозвонок из его шапки.': ['Откройте диалог или канал и запустите аудио- или видеозвонок из его шапки.', 'Open a conversation or channel and start an audio or video call from its header.'],
    'Структура ещё не заведена. Владелец или администратор создаёт департаменты и отделы через': ['Структура ещё не заведена. Владелец или администратор создаёт департаменты и отделы через', 'No structure yet. An owner or administrator creates departments and units via'],
    'Подразделения': ['Подразделения', 'Units'],
    'Подчиняется': ['Подчиняется', 'Reports to'],
    'История действий': ['История действий', 'Activity history'],
    'О себе': ['О себе', 'About'],
    'Редактировать карточку': ['Редактировать карточку', 'Edit profile'],
    'Карточка обновлена': ['Карточка обновлена', 'Profile updated'],
    'Работа над задачей': ['Работа над задачей', 'Work on a task'],
    'Личные карточки доступны в режиме с базой данных': ['Личные карточки доступны в режиме с базой данных', 'Personal profiles require database mode'],
    'Оргструктура доступна в режиме с базой данных': ['Оргструктура доступна в режиме с базой данных', 'Org structure requires database mode'],
    'Детали встречи доступны в режиме с базой данных': ['Детали встречи доступны в режиме с базой данных', 'Event details require database mode'],
    'Ожидает принятия': ['Ожидает принятия', 'Awaiting acceptance'],
    'Принята': ['Принята', 'Accepted'],
    'Запланирована': ['Запланирована', 'Scheduled'],
    'В работе': ['В работе', 'In progress'],
    'Заблокирована': ['Заблокирована', 'Blocked'],
    'На проверке': ['На проверке', 'In review'],
    'Результат принят': ['Результат принят', 'Result accepted'],
    'Закрыта': ['Закрыта', 'Closed'],
    'Отклонена': ['Отклонена', 'Rejected'],
    'Отменена': ['Отменена', 'Cancelled'],
    'Отложена': ['Отложена', 'Deferred'],
    'Нужно уточнение': ['Нужно уточнение', 'Needs clarification'],
    'Входящая': ['Входящая', 'Inbox'],
    'Принять ответственность': ['Принять ответственность', 'Take ownership'],
    'Отказаться': ['Отказаться', 'Decline'],
    'Запросить уточнение': ['Запросить уточнение', 'Ask for clarification'],
    'Запланировать': ['Запланировать', 'Schedule'],
    'Начать работу': ['Начать работу', 'Start work'],
    'Есть блокировка': ['Есть блокировка', 'Report a blocker'],
    'Отправить на проверку': ['Отправить на проверку', 'Send for review'],
    'Принять результат': ['Принять результат', 'Accept the result'],
    'Отложить': ['Отложить', 'Defer'],
    'Отменить': ['Отменить', 'Cancel'],
    'Ожидаемый результат': ['Ожидаемый результат', 'Expected outcome'],
    'Как понять, что задача выполнена?': ['Как понять, что задача выполнена?', 'How will we know it is done?'],
    'Кто принимает результат': ['Кто принимает результат', 'Who accepts the result'],
    'Следующее действие': ['Следующее действие', 'Next action'],
    'Добавить результат / доказательство': ['Добавить результат / доказательство', 'Add a result / evidence'],
    'Добавить доказательство': ['Добавить доказательство', 'Add evidence'],
    'Доказательство добавлено': ['Доказательство добавлено', 'Evidence added'],
    'Комментарий / результат': ['Комментарий / результат', 'Comment / result'],
    'Ссылка': ['Ссылка', 'Link'],
    'Метрика': ['Метрика', 'Metric'],
    'Ссылка на сообщение': ['Ссылка на сообщение', 'Message link'],
    'Идентификатор файла': ['Идентификатор файла', 'File identifier'],
    'Данные': ['Данные', 'Data'],
    'Текст': ['Текст', 'Text'],
    'Что сделано, где результат или чем это подтверждается': ['Что сделано, где результат или чем это подтверждается', 'What was done, where the result is, what proves it'],
    'Причина': ['Причина', 'Reason'],
    'Причина будет сохранена в истории задачи.': ['Причина будет сохранена в истории задачи.', 'The reason is kept in the task history.'],
    'Изменить срок': ['Изменить срок', 'Change the date'],
    'Обещанный срок': ['Обещанный срок', 'Promised date'],
    'Прогноз': ['Прогноз', 'Forecast'],
    'Почему срок или прогноз изменился': ['Почему срок или прогноз изменился', 'Why the date or forecast changed'],
    'Сохранить изменение': ['Сохранить изменение', 'Save the change'],
    'Срок обновлён': ['Срок обновлён', 'Date updated'],
    'Задача обновлена': ['Задача обновлена', 'Task updated'],
    'Низкий': ['Низкий', 'Low'],
    'Ответственность → выполнение → доказательство → проверка → закрытие': ['Ответственность → выполнение → доказательство → проверка → закрытие', 'Ownership → delivery → evidence → review → closure'],
    'Изменить сообщение': ['Изменить сообщение', 'Edit message'],
    'Сообщение изменено': ['Сообщение изменено', 'Message edited'],
    'Удалить сообщение': ['Удалить сообщение', 'Delete message'],
    'Сообщение удалено': ['Сообщение удалено', 'Message deleted'],
    'Сообщение останется в истории как удалённое, но его содержимое больше не будет показываться.': ['Сообщение останется в истории как удалённое, но его содержимое больше не будет показываться.', 'The message stays in history as deleted, but its content is no longer shown.'],
    'Переслать сообщение': ['Переслать сообщение', 'Forward message'],
    'Сообщение переслано': ['Сообщение переслано', 'Message forwarded'],
    'Сообщение закреплено': ['Сообщение закреплено', 'Message pinned'],
    'Сообщение откреплено': ['Сообщение откреплено', 'Message unpinned'],
    'Открепить': ['Открепить', 'Unpin'],
    'Откреплено': ['Откреплено', 'Unpinned'],
    'Удалить': ['Удалить', 'Delete'],
    'Сохранено': ['Сохранено', 'Saved'],
    'Удалено из сохранённых': ['Удалено из сохранённых', 'Removed from saved'],
    'Чат перемещён в личный архив': ['Чат перемещён в личный архив', 'Conversation moved to your archive'],
    'Чат возвращён': ['Чат возвращён', 'Conversation restored'],
    'Вернуть': ['Вернуть', 'Restore'],
    'Уведомления включены': ['Уведомления включены', 'Notifications on'],
    'Уведомления отключены на 8 часов': ['Уведомления отключены на 8 часов', 'Notifications muted for 8 hours'],
    'Новая группа': ['Новая группа', 'New group'],
    'Название группы': ['Название группы', 'Group name'],
    'Создать группу': ['Создать группу', 'Create group'],
    'Группа': ['Группа', 'Group'],
    'Участники': ['Участники', 'Participants'],
    'Участники добавлены': ['Участники добавлены', 'Participants added'],
    'Участник удалён': ['Участник удалён', 'Participant removed'],
    'Роль обновлена': ['Роль обновлена', 'Role updated'],
    'Выберите минимум одного коллегу': ['Выберите минимум одного коллегу', 'Choose at least one colleague'],
    'Выберите участников.': ['Выберите участников.', 'Choose participants.'],
    'Для группового чата выберите минимум одного коллегу.': ['Для группового чата выберите минимум одного коллегу.', 'A group chat needs at least one colleague.'],
    'Участники закрытого канала': ['Участники закрытого канала', 'Members of a private channel'],
    'Для общего канала список не ограничивает доступ': ['Для общего канала список не ограничивает доступ', 'For a workspace channel this list does not restrict access'],
    'Только объявления': ['Только объявления', 'Announcements only'],
    'Публиковать смогут владелец, модераторы и управляющие каналами': ['Публиковать смогут владелец, модераторы и управляющие каналами', 'Only the owner, moderators and channel managers can post'],
    'Когда': ['Когда', 'When'],
    'Организатор': ['Организатор', 'Organizer'],
    'Материалы': ['Материалы', 'Materials'],
    'Ответ отправлен': ['Ответ отправлен', 'Answer sent'],
    'придёт': ['придёт', 'attending'],
    'не придёт': ['не придёт', 'not attending'],
    'под вопросом': ['под вопросом', 'tentative'],
    'ждёт ответа': ['ждёт ответа', 'awaiting answer'],
    'Веха': ['Веха', 'Milestone'],
    'Фокус': ['Фокус', 'Focus'],
    'компания': ['компания', 'company'],
    'департамент': ['департамент', 'department'],
    'отдел': ['отдел', 'division'],
    'группа': ['группа', 'team'],
    'офис': ['офис', 'office'],
    'сообщество': ['сообщество', 'guild'],
    'ожидает принятия': ['ожидает принятия', 'awaiting acceptance'],
    'принята': ['принята', 'accepted'],
    'запланирована': ['запланирована', 'scheduled'],
    'в работе': ['в работе', 'in progress'],
    'заблокирована': ['заблокирована', 'blocked'],
    'на проверке': ['на проверке', 'in review'],
    'результат принят': ['результат принят', 'result accepted'],
    'закрыта': ['закрыта', 'closed'],
    'отклонена': ['отклонена', 'rejected'],
    'отменена': ['отменена', 'cancelled'],
    'отложена': ['отложена', 'deferred'],
    'в сети': ['в сети', 'online'],
    'отошёл': ['отошёл', 'away'],
    'занят': ['занят', 'busy'],
    'не беспокоить': ['не беспокоить', 'do not disturb'],
    'не в сети': ['не в сети', 'offline'],
    'активных задач': ['активных задач', 'active tasks'],
    'сотрудников': ['сотрудников', 'employees'],
    'диалогов': ['диалогов', 'conversations'],
    'Сохранить': ['Сохранить', 'Save'],
    'КБ': ['КБ', 'KB'],
    'МБ': ['МБ', 'MB'],
    'ГБ': ['ГБ', 'GB'],
    'Имя и фамилия': ['Имя и фамилия', 'Full name'],
    'Название компании': ['Название компании', 'Company name'],
    'Не менее 12 символов и цифра': ['Не менее 12 символов и цифра', 'At least 12 characters and a digit'],
    'Моя карточка': ['Моя карточка', 'My profile'],
    'Новый личный чат': ['Новый личный чат', 'New direct chat'],
    'Создать канал': ['Создать канал', 'Create channel'],
    'Почта': ['Почта', 'Email'],
    'Роль в системе': ['Роль в системе', 'System role'],
    'Город': ['Город', 'City'],
    'Телефон': ['Телефон', 'Phone'],
    'В команде с': ['В команде с', 'With the team since'],
    'Часовой пояс': ['Часовой пояс', 'Time zone'],
    'Должность не указана': ['Должность не указана', 'No position set'],
    'Подразделение не указано': ['Подразделение не указано', 'No unit set'],
    'руководитель': ['руководитель', 'head'],
    'администратор': ['администратор', 'administrator'],
    'Задачи в работе': ['Задачи в работе', 'Tasks in progress'],
    'поставил(а) задачу': ['поставил(а) задачу', 'created a task'],
    'перевёл(а) задачу': ['перевёл(а) задачу', 'moved a task'],
    'приложил(а) доказательство': ['приложил(а) доказательство', 'attached evidence'],
    'перенёс(ла) срок': ['перенёс(ла) срок', 'rescheduled'],
    'создал(а) беседу': ['создал(а) беседу', 'created a conversation'],
    'присоединился(ась)': ['присоединился(ась)', 'joined'],
    'День': ['День', 'Day'],
    'Неделя': ['Неделя', 'Week'],
    'Месяц': ['Месяц', 'Month'],
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
    // Rewriting substrings turned «Почта» into «ПоThuа» and «Встреча» into
    // «Sunтреча»: the map holds two-letter day abbreviations, and «чт» and
    // «вс» live inside ordinary Russian words. Only whole words are replaced,
    // and a short abbreviation only where the string reads as a date.
    const looksLikeDate = /\d/.test(value);
    let translated = value;
    for (const [ru, en] of Object.entries(monthWords)) {
      if (ru.length <= 3 && !looksLikeDate) continue;
      const escaped = ru.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const boundary = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])`, 'giu');
      translated = translated.replace(boundary, (whole, before, found) => before + caseLike(found, en));
    }
    translated = translated.replace(/\sг\.$/, '');
    return translated;
  }

  function translateCore(original) {
    const pair = translations.get(original);
    if (pair) return locale === 'en' ? pair[1] : pair[0];
    return translateDynamic(original);
  }

  const NON_PROSE = new Set(['TITLE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

  function shouldSkip(node) {
    const parent = node.parentElement;
    if (!parent) return false;
    // <title> is written by applyDocumentTitle, not walked: rewriting it here
    // replaces the element's text node, which is a childList mutation that
    // re-enters this observer forever.
    if (NON_PROSE.has(parent.tagName)) return true;
    return Boolean(parent.closest(userContentSelector));
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
    applyDocumentTitle();
  }

  function applyDocumentTitle() {
    const next = locale === 'en' ? 'Chat — company workspace' : 'Chat — рабочее пространство компании';
    // Assigning an unchanged title still replaces the text node under <title>,
    // so the equality check is what stops the observer feeding itself.
    if (document.title !== next) document.title = next;
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

  // Every writer below compares before it writes. These run from the mutation
  // observer, so an unconditional write is a childList mutation that calls the
  // observer again — the page then never reaches idle.
  // Compare what we last wrote, not what the DOM serialises back. The browser
  // normalises markup — a valueless `data-prefs-owned` comes back as
  // `data-prefs-owned=""` — so an innerHTML comparison never matches and the
  // write repeats on every observer batch, which pins the main thread for as
  // long as the panel is open.
  const lastMarkup = new WeakMap();

  function setMarkup(element, markup) {
    if (!element || lastMarkup.get(element) === markup) return;
    lastMarkup.set(element, markup);
    element.innerHTML = markup;
  }

  function setAttributeIfChanged(element, name, value) {
    if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  function updateLauncher(button) {
    if (!button) return;
    setMarkup(button, `<span>${locale.toUpperCase()}</span><span aria-hidden="true">${theme === 'dark' ? '●' : '○'}</span>`);
    setAttributeIfChanged(button, 'aria-label', copy().preferences);
    setAttributeIfChanged(button, 'title', copy().preferences);
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
    setMarkup(block, preferenceControls());
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
