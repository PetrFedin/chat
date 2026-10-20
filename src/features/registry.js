/**
 * Реестр функций, которые компания может включать и отключать.
 *
 * Ядро (сообщения, люди, профиль, уведомления, файлы) выключить нельзя. Остальное — по желанию, но функции
 * связаны: «Отчёт по времени» без «Задач» не имеет смысла. Поэтому у функции есть `requires`: выключение
 * функции выключает и всё, что от неё зависит, а включение зависимой сначала включает то, что ей нужно.
 */
export const FEATURES = Object.freeze([
  { id: 'tasks', group: 'work', ru: 'Задачи и обязательства', en: 'Tasks and commitments',
    descRu: 'Задачи с ответственным, доказательствами и приёмкой результата.', descEn: 'Tasks with an owner, evidence and result acceptance.', requires: [] },
  { id: 'time_tracking', group: 'work', ru: 'Учёт времени', en: 'Time tracking',
    descRu: 'Таймер на задачах и отчёт по часам.', descEn: 'Timers on tasks and the hours report.', requires: ['tasks'] },
  { id: 'dashboard', group: 'work', ru: 'Дашборд и отчёты', en: 'Dashboard and reports',
    descRu: 'Тренды по задачам и времени, отчёт по обязательствам.', descEn: 'Task and time trends, the commitments report.', requires: ['tasks'] },
  { id: 'projects', group: 'work', ru: 'Проекты', en: 'Projects',
    descRu: 'Цели, вехи, команда и исполнение на канонических задачах.', descEn: 'Goals, milestones, team and execution over canonical tasks.', requires: ['tasks'] },
  { id: 'requests', group: 'work', ru: 'Заявки и согласования', en: 'Requests and approvals',
    descRu: 'Отпуск, покупка, доступ — по шаблону и с цепочкой согласования.', descEn: 'Time off, purchases, access — by template with an approval chain.', requires: [] },
  { id: 'plan', group: 'work', ru: 'Личные дела', en: 'Personal to-dos',
    descRu: 'Личный список дел, заметки, приоритеты и сроки.', descEn: 'A personal list of to-dos, notes, priorities and due dates.', requires: [] },
  { id: 'reminders', group: 'work', ru: 'Напоминания', en: 'Reminders',
    descRu: 'Напоминания в назначенный час.', descEn: 'Reminders at the chosen hour.', requires: [] },
  { id: 'labels', group: 'work', ru: 'Метки', en: 'Labels',
    descRu: 'Важность, теги и папки для сообщений, задач и событий.', descEn: 'Importance, tags and folders for messages, tasks and events.', requires: [] },

  { id: 'calendar', group: 'time', ru: 'Календарь', en: 'Calendar',
    descRu: 'События, повторения, приглашения и ответы.', descEn: 'Events, recurrence, invitations and replies.', requires: [] },
  { id: 'calls', group: 'time', ru: 'Звонки', en: 'Calls',
    descRu: 'Аудио, видео и демонстрация экрана.', descEn: 'Audio, video and screen sharing.', requires: [] },
  { id: 'meetings', group: 'time', ru: 'Итоги встреч', en: 'Meeting intelligence',
    descRu: 'Расшифровки, итоги и предложения задач по записи звонков.', descEn: 'Transcripts, summaries and proposed tasks from recorded calls.', requires: ['calls', 'calendar'] },
  { id: 'decisions', group: 'time', ru: 'Решения', en: 'Decisions',
    descRu: 'Общий список решений, принятых на встречах.', descEn: 'A shared list of decisions made in meetings.', requires: ['meetings'] },

  { id: 'topics', group: 'chat', ru: 'Ветки в беседах', en: 'Topics inside conversations',
    descRu: 'Внутри канала — отдельные ветки-разговоры по темам.', descEn: 'Separate topic threads inside a channel.', requires: [] },
  { id: 'stories', group: 'chat', ru: 'Сторис', en: 'Stories',
    descRu: 'Короткие фото-обновления на сутки.', descEn: 'Short 24-hour photo updates.', requires: [] },
  { id: 'games', group: 'chat', ru: 'Игры', en: 'Games',
    descRu: 'Шахматы, шашки и морской бой с коллегами.', descEn: 'Chess, checkers and battleship with colleagues.', requires: [] },
  { id: 'assistant', group: 'chat', ru: 'ИИ-помощник в беседах', en: 'AI assistant in chats',
    descRu: 'Краткий обзор беседы и варианты ответа.', descEn: 'A conversation overview and reply suggestions.', requires: [] },

  { id: 'wiki', group: 'knowledge', ru: 'Вики', en: 'Wiki',
    descRu: 'Совместные страницы, которые пишет любой сотрудник.', descEn: 'Shared pages any staff member can write.', requires: [] },
  { id: 'knowledge', group: 'knowledge', ru: 'База знаний', en: 'Knowledge base',
    descRu: 'Статьи компании и HR-бот.', descEn: 'Company articles and the HR bot.', requires: [] },
  { id: 'org_structure', group: 'knowledge', ru: 'Оргструктура', en: 'Org structure',
    descRu: 'Подразделения, штат и руководители.', descEn: 'Departments, headcount and heads.', requires: [] },

  { id: 'vault', group: 'admin', ru: 'Хранилище паролей', en: 'Password vault',
    descRu: 'Зашифрованное личное хранилище.', descEn: 'Encrypted personal storage.', requires: [] },
  { id: 'integrations', group: 'admin', ru: 'Интеграции', en: 'Integrations',
    descRu: 'Подписки на события и журнал доставок.', descEn: 'Event subscriptions and the delivery log.', requires: [] },
  { id: 'api_keys', group: 'admin', ru: 'API-ключи', en: 'API keys',
    descRu: 'Личный доступ к API от вашего имени.', descEn: 'Personal API access on your behalf.', requires: [] },
]);

export const GROUPS = Object.freeze({
  work: { ru: 'Работа', en: 'Work' }, time: { ru: 'Время и встречи', en: 'Time and meetings' },
  chat: { ru: 'Общение', en: 'Communication' }, knowledge: { ru: 'Знания и структура', en: 'Knowledge and structure' },
  admin: { ru: 'Администрирование', en: 'Administration' },
});

const BY_ID = new Map(FEATURES.map((f) => [f.id, f]));
export const featureById = (id) => BY_ID.get(id) ?? null;

/** Кто зависит от функции (прямо и через других): выключение её выключает и их. */
export function dependentsOf(id) {
  const out = new Set();
  const visit = (current) => {
    for (const f of FEATURES) if (f.requires.includes(current) && !out.has(f.id)) { out.add(f.id); visit(f.id); }
  };
  visit(id);
  return [...out];
}

/** Что нужно функции (прямо и через других): включение её сначала включает это. */
export function requirementsOf(id) {
  const out = new Set();
  const visit = (current) => {
    for (const need of BY_ID.get(current)?.requires ?? []) if (!out.has(need)) { out.add(need); visit(need); }
  };
  visit(id);
  return [...out];
}

/**
 * Что изменится от переключения. `state` — Map id → { enabled, cascadeFrom }.
 * Возвращает список изменений [{ id, enabled, cascadeFrom }], не считая «ничего не изменилось».
 */
export function planChange(state, id, enable) {
  if (!BY_ID.has(id)) throw Object.assign(new Error('Неизвестная функция'), { code: 'UNKNOWN_FEATURE', statusCode: 404, expose: true });
  const isOn = (key) => state.get(key)?.enabled !== false;
  const changes = [];
  if (!enable) {
    if (isOn(id)) changes.push({ id, enabled: false, cascadeFrom: null });
    for (const dep of dependentsOf(id)) if (isOn(dep)) changes.push({ id: dep, enabled: false, cascadeFrom: id });
    return changes;
  }
  // Включаем: сначала то, без чего функция не работает.
  for (const need of requirementsOf(id)) if (!isOn(need)) changes.push({ id: need, enabled: true, cascadeFrom: null, because: id });
  if (!isOn(id)) changes.push({ id, enabled: true, cascadeFrom: null });
  // И возвращаем то, что выключилось вместе с ней и теперь снова может работать.
  const nowOn = new Set([...FEATURES.map((f) => f.id).filter(isOn), ...changes.filter((c) => c.enabled).map((c) => c.id)]);
  for (const [key, value] of state) {
    if (changes.some((c) => c.id === key)) continue;
    if (value.enabled === false && value.cascadeFrom && (value.cascadeFrom === id || changes.some((c) => c.id === value.cascadeFrom && c.enabled))) {
      if ((BY_ID.get(key)?.requires ?? []).every((need) => nowOn.has(need))) { changes.push({ id: key, enabled: true, cascadeFrom: null, restored: true }); nowOn.add(key); }
    }
  }
  return changes;
}

/**
 * Маршрут → функция. Порядок важен: частные правила раньше общих. Пути без сессии (ICS по токену, вход) сюда не попадают.
 */
const ROUTES = [
  // A Page relation must obey BOTH the source feature and the target feature.
  // Otherwise a disabled Calendar/Meeting module remains writable via Wiki.
  [/^\/api\/v1\/wiki\/pages\/[^/]+\/calendar-meetings(\/|$)/, ['wiki','calendar']],
  [/^\/api\/v1\/wiki\/pages\/[^/]+\/calls(\/|$)/, ['wiki','meetings']],
  [/^\/api\/v1\/wiki\/pages\/[^/]+\/projects(\/|$)/, ['wiki','projects']],
  [/^\/api\/v1\/wiki\/pages\/[^/]+\/tasks(\/|$)/, ['wiki','tasks']],
  [/^\/api\/v1\/wiki\/(pages\/[^/]+\/decisions|decisions\/[^/]+\/pages)(\/|$)/, ['wiki','decisions']],
  [/^\/api\/v1\/projects\/[^/]+\/tasks(\/|$)/, ['projects','tasks']],
  [/^\/api\/v1\/projects\/[^/]+\/decisions(\/|$)/, ['projects','decisions']],
  [/^\/api\/v1\/projects(\/|$)/, 'projects'],
  [/^\/api\/v1\/(time-entries)(\/|$)|^\/api\/v1\/tasks\/[^/]+\/time-entries/, 'time_tracking'],
  [/^\/api\/v1\/dashboard(\/|$)|^\/api\/v1\/tasks\/report(\/|$)/, 'dashboard'],
  [/^\/api\/v1\/tasks(\/|$)/, 'tasks'],
  [/^\/api\/v1\/meetings\/decisions\/execution$/, ['decisions','tasks']],
  [/^\/api\/v1\/meetings\/decisions\/[^/]+\/tasks(\/|$)/, ['decisions','tasks']],
  [/^\/api\/v1\/meetings\/decisions(\/|$)/, 'decisions'],
  [/^\/api\/v1\/(meetings|meeting-proposals)(\/|$)|^\/api\/v1\/admin\/meeting-|^\/api\/v1\/calls\/[^/]+\/meeting(\/|$)/, 'meetings'],
  [/^\/api\/v1\/calls(\/|$)|^\/api\/v1\/conversations\/[^/]+\/calls(\/|$)/, 'calls'],
  [/^\/api\/v1\/(calendar-events|calendar-invitations)(\/|$)/, 'calendar'],
  [/^\/api\/v1\/conversations\/[^/]+\/assistant\//, 'assistant'],
  [/^\/api\/v1\/conversations\/[^/]+\/topics(\/|$)|^\/api\/v1\/messages\/[^/]+\/topic$/, 'topics'],
  [/^\/api\/v1\/stories(\/|$)/, 'stories'],
  [/^\/api\/v1\/games(\/|$)|^\/api\/v1\/conversations\/[^/]+\/games(\/|$)/, 'games'],
  [/^\/api\/v1\/wiki(\/|$)/, 'wiki'],
  [/^\/api\/v1\/knowledge(\/|$)/, 'knowledge'],
  [/^\/api\/v1\/org(\/|$)/, 'org_structure'],
  [/^\/api\/v1\/vault(\/|$)/, 'vault'],
  [/^\/api\/v1\/integrations(\/|$)/, 'integrations'],
  [/^\/api\/v1\/api-keys(\/|$)/, 'api_keys'],
  [/^\/api\/v1\/personal-items(\/|$)/, 'plan'],
  [/^\/api\/v1\/reminders(\/|$)/, 'reminders'],
  [/^\/api\/v1\/(labels|labelled)(\/|$)/, 'labels'],
  [/^\/api\/v1\/(requests|request-templates)(\/|$)/, 'requests'],
];
export const featuresForPath = (path) => {
  for (const [pattern, ids] of ROUTES) if (pattern.test(path)) return Array.isArray(ids) ? ids : [ids];
  return [];
};

// Compatibility helper for callers that only need the primary feature.
export const featureForPath = (path) => featuresForPath(path)[0] ?? null;
