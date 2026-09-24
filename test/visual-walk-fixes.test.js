import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// Found by walking the running app screen by screen rather than by reading it.

test('Russian counts agree with their number', async () => {
  const app = await read('public/app.js');
  const match = app.match(/function plural\(n,one,few,many\)\{[\s\S]*?\n\}/);
  assert.ok(match, 'plural не найдена');
  const plural = new Function('n', 'one', 'few', 'many', `${match[0]}\nreturn plural(n,one,few,many);`);
  const form = (n) => plural(n, 'активная задача', 'активные задачи', 'активных задач');

  assert.equal(form(3), 'активные задачи', '«3 активных задач» — не по-русски');
  assert.equal(form(1), 'активная задача');
  assert.equal(form(2), 'активные задачи');
  assert.equal(form(5), 'активных задач');
  assert.equal(form(0), 'активных задач');
  // The teens take the last form whatever their last digit says.
  for (const n of [11, 12, 13, 14]) assert.equal(form(n), 'активных задач', `${n} взяло не ту форму`);
  assert.equal(form(21), 'активная задача');
  assert.equal(form(22), 'активные задачи');
  assert.equal(form(101), 'активная задача');

  // The three tiles on the day screen were the visible case.
  assert.match(app, /plural\(active\.length,'активная задача'/);
  assert.match(app, /plural\(S\.people\.length,'сотрудник'/);
  assert.match(app, /plural\(S\.conversations\.length,'диалог'/);

  const prefs = await read('public/preferences.js');
  for (const word of ['активная задача', 'активные задачи', 'активных задач', 'сотрудника', 'диалога']) {
    assert.ok(prefs.includes(`    '${word}':`), `нет перевода для «${word}»`);
  }
});

// Nine buttons sat under every message, on every screen: the hover-reveal rule
// named .message-actions while the markup used .inline-actions, so it matched
// nothing and the conversation was buried in its own controls.
test('message controls never move the conversation', async () => {
  const [app, css] = await Promise.all([read('public/app.js'), read('public/styles.css')]);

  // Раньше ряд кнопок раскрывался под сообщением и раздвигал поток: при
  // наведении соседние сообщения уезжали вниз, а текст — из-под курсора.
  assert.doesNotMatch(app, /class="inline-actions msg-actions"/, 'ряд действий снова в потоке');
  assert.doesNotMatch(css, /actions-open/, 'осталось раскрытие в потоке');
  assert.match(app, /class="msg-toolbar"/, 'нет плавающей панели действий');
  assert.match(app, /data-message-menu="\$\{m\.id\}"/, 'нет кнопки «ещё»');
  assert.match(app, /function messageMenu\(messageId\)/, 'нет листа действий сообщения');

  // Панель вынута из потока и её появление ничего не двигает.
  assert.match(css, /\.msg-toolbar\{position:absolute/, 'панель осталась в потоке');
  assert.match(css, /\.msg-toolbar\{position:absolute;top:0;right:auto;left:calc\(100% \+ 6px\)\}/,
    'панель больше не висит у внешнего края пузыря');
  assert.match(css, /\.message-item\.mine \.msg-toolbar\{left:auto;right:calc\(100% \+ 6px\)\}/,
    'у своих сообщений панель не переехала на другую сторону');
  assert.match(css, /\.message-item:hover \.msg-toolbar,\.message-item:focus-within \.msg-toolbar\{opacity:1/,
    'панель не показывается по наведению и фокусу');
  assert.match(css, /@media \(hover:none\)\{[\s\S]*?\.msg-toolbar\{opacity:1/, 'на сенсорном экране панель не видна');

  // Иконкам нужны имена: кнопка без подписи должна называться голосом.
  for (const label of ['Поставить реакцию', 'Ответить на сообщение', 'Другие действия с сообщением']) {
    assert.ok(app.includes(`aria-label="${label}"`), `кнопка «${label}» без имени`);
  }
  assert.doesNotMatch(css, /\.message-actions\{/, 'правило снова целится в несуществующий класс');
});

test('a screen opens at its top', async () => {
  const app = await read('public/app.js');
  assert.match(app, /window\.scrollTo\(0,0\);\s*\n\s*render\(\);/, 'переключение экрана не сбрасывает прокрутку');
});

// On a phone the whole page scrolls, so the title, the back arrow and the call
// buttons scrolled away. And two groups totalling 492px sat side by side in a
// 402px header, so the buttons wrapped above the title.
//
// Кнопки тогда увели в отдельную строку и разрешили ей ехать вбок —
// выше заголовка они больше не поднимались, но за краем экрана
// оказывались звонки, и о том, что строку можно тянуть, никто не знал.
// Отдельная строка осталась; боковая прокрутка заменена переносом.
test('the conversation header stays put and fits', async () => {
  const css = await read('public/styles.css');
  const mobile = css.slice(css.indexOf('@media(max-width:980px)'));
  assert.match(mobile, /\.message-header\{[^}]*position:sticky/);
  assert.match(mobile, /\.message-header\{[^}]*display:grid/);
  assert.match(mobile, /\.message-header>\.inline-actions:first-child\{display:contents\}/);
  assert.match(mobile, /\.message-header h2\{[^}]*text-overflow:ellipsis/);

  // Ради чего всё это было: действия занимают собственную строку и
  // потому не могут подняться над заголовком.
  assert.match(css, /\.message-header>\.inline-actions:last-child\{grid-column:1\/-1/);
  // И больше не уезжают вбок, унося звонки за край экрана.
  assert.doesNotMatch(css, /\.message-header>\.inline-actions:last-child\{[^}]*overflow-x:auto/);
});

// Browsing a week and then asking for a day landed on the last day of that
// week — 27 September when the person had been looking at the 21st.
test('the day view lands where a person expects', async () => {
  const app = await read('public/app.js');
  const handler = app.match(/\$\$\('\[data-cal-view\]'\)[\s\S]*?\n  \}\);/);
  assert.ok(handler, 'обработчик переключения вида не найден');
  assert.match(handler[0], /next==='day'&&c\.view!=='day'/);
  assert.match(handler[0], /now>=start&&now<=end\)\?now:start/, 'день не выбирается по правилу «сегодня, иначе начало»');
  assert.match(handler[0], /await loadCalendarRange\(\)/, 'диапазон не перечитывается при смене вида');
});

// The API answers in English because it is a contract; a refusal shown to a
// person should be a sentence in the interface language that says what to do
// next. «Conversation must keep at least one owner» told somebody trying to
// leave a room neither what went wrong nor how to get out.
test('actionable refusals are shown in the interface language', async () => {
  const [app, prefs] = await Promise.all([read('public/app.js'), read('public/preferences.js')]);

  const start = app.indexOf('const ERROR_MESSAGE={');
  assert.ok(start > 0, 'карты сообщений нет');
  const block = app.slice(start, app.indexOf('};', start));
  const messages = [...block.matchAll(/:'([^']+)',/g)].map((m) => m[1]);
  assert.ok(messages.length >= 20, `сообщений мало: ${messages.length}`);

  for (const message of messages) {
    assert.ok(prefs.includes(`    '${message}':`), `«${message.slice(0, 40)}…» не переведено`);
  }

  // The codes a person hits most often when a rule stops them.
  for (const code of ['LAST_CONVERSATION_OWNER', 'GUEST_NOT_IN_OPEN_ROOM', 'SEAT_LIMIT_REACHED',
                      'TASK_EVIDENCE_REQUIRED', 'STALE_TASK_ACTION', 'RESET_EXPIRED']) {
    assert.ok(block.includes(`${code}:`), `нет сообщения для ${code}`);
  }

  // The server's own wording is kept, not thrown away: a code nobody
  // translated still says something.
  assert.match(app, /e\.serverMessage=p\?\.error\?\.message/);
  assert.match(app, /ERROR_MESSAGE\[code\]\|\|p\?\.error\?\.message/);
});

// Built, tested and reachable only with curl: an administrator could not see
// whether anything was leaving the building, and presence was displayed
// everywhere while nobody could set their own.
test('features that existed only in the API have a way in', async () => {
  const app = await read('public/app.js');

  assert.match(app, /data-action="presence"/, 'статус нельзя выставить');
  assert.match(app, /function presenceModal\(\)/);
  assert.match(app, /'\/api\/v1\/presence'/);
  for (const state of ['online', 'away', 'busy', 'do_not_disturb', 'offline']) {
    assert.ok(app.includes(`'${state}'`), `нет состояния ${state}`);
  }

  assert.match(app, /data-action="integrations"/, 'интеграции по-прежнему только в curl');
  assert.match(app, /async function integrationsModal\(\)/);
  assert.match(app, /integrations\/deliveries/, 'журнал доставок не показан');
  // A door a person's role will refuse should not be drawn for them.
  assert.match(app, /can\('integration\.manage'\)\?'<button class="module-card pressable" data-action="integrations"/);

  // A <span> closed with </div> ended the template early and silently
  // swallowed the delivery log and the button under it.
  const row = app.slice(app.indexOf('const endpointRow='), app.indexOf('const deliveryRow='));
  assert.equal((row.match(/<span/g) || []).length, (row.match(/<\/span>/g) || []).length, 'теги span не сходятся');
  assert.equal((row.match(/<div/g) || []).length, (row.match(/<\/div>/g) || []).length, 'теги div не сходятся');
});

// Chess, draughts and battleship: the screen draws and the server decides.
test('games are reachable and decide nothing themselves', async () => {
  const app = await read('public/app.js');
  assert.match(app, /data-action="games"/);
  assert.match(app, /data-action="room-games"/, 'из беседы в игру не попасть');
  for (const kind of ['chess', 'checkers', 'battleship']) {
    assert.ok(app.includes(`'${kind}'`) || app.includes(`"${kind}"`), `нет игры ${kind}`);
  }
  // Every move goes to the server; nothing local decides legality.
  assert.match(app, /\/api\/v1\/games\/\$\{game\.id\}\/moves/);
  assert.doesNotMatch(app, /function legalMoves/, 'правила протекли в браузер');
  // The board follows the opponent without a reload.
  assert.match(app, /p\.event==='game\.updated'/);
});

// A refused request left the sheet open and said nothing at all: a duplicate
// email, a throttle, or a module that is not running all looked to a person
// like a dead button.
test('no form swallows a refusal', async () => {
  const app = await read('public/app.js');
  const unguarded = [];
  for (const match of app.matchAll(/\$\('#([a-z-]+)'\)\.onsubmit=async/g)) {
    // Окно взято с запасом: проверяем наличие catch в теле обработчика, а не
    // его длину — иначе лишний поясняющий комментарий «ломает» правило.
    const segment = app.slice(match.index, match.index + 3000);
    const end = segment.indexOf('\n  };');
    const body = segment.slice(0, end > 0 ? end : 2600);
    if (body.includes('api(') && !body.includes('catch')) unguarded.push(match[1]);
  }
  assert.deepEqual(unguarded, [], 'эти формы молчат при отказе сервера');
});

// A meeting is people plus a time; the form asked only for the time.
test('a meeting can be created with the people in it', async () => {
  const app = await read('public/app.js');
  const form = app.slice(app.indexOf('function eventModal('), app.indexOf('function participantChecks('));
  // `openRoom:true` исключает гостей из списка: сервер и так отказывает
  // им во встрече («Those people are not workspace staff»), а форма без
  // этого признака предлагала гостя к выбору — отметил его, и вся заявка
  // на встречу отказывалась целиком, без объяснения, кто именно лишний.
  assert.match(form, /participantChecks\(\[\], 'guest', \{openRoom:true\}\)/, 'форма события снова зовёт гостя, которого сервер не примет');
  // Событие и приглашения уходят одним запросом: половинчатый результат —
  // встреча, на которую никого не позвали, — больше не возможен.
  assert.match(form, /participantIds:invited/);
  // Validate before sending, and say what happened either way.
  assert.match(form, /Окончание должно быть позже начала/);
  assert.match(form, /toast\(invited\.length\?/);
  // Land where the event is, not where the calendar happened to be.
  assert.match(form, /S\.cal\.cursor=startAt/);
  // An affordance that cannot work is worse than none.
  assert.match(form, /S\.boot\?\.storageMode==='memory'\?''/);
});

// The server records every move and serves them at GET /games/{id}/moves;
// the board never showed them, so a player could not see how the game got
// where it is.
test('the board shows the recorded moves', async () => {
  const app = await read('public/app.js');
  assert.ok(app.includes('/moves`).catch(()=>({items:[]}))'), 'запись партии не запрашивается');
  assert.ok(app.includes('class="game-record"'), 'ходы негде показать');
  assert.ok(app.includes('${status}${board}${recordBlock}'), 'запись не попала на страницу партии');
  const css = await read('public/styles.css');
  assert.ok(css.includes('.game-moves{'), 'у списка ходов нет оформления');
});

// Two tiles in «Ещё» promised a screen and delivered a toast: «Звонки» told
// you to go and find the call buttons yourself, and «Уведомления», which
// advertises mentions and deadlines, asked the browser for push instead of
// opening the attention centre that already existed.
test('the calls and notifications tiles open something', async () => {
  const app = await read('public/app.js');
  assert.ok(!app.includes("calls:()=>toast("), 'плитка звонков всё ещё только ругается');
  assert.ok(app.includes('calls:callsModal'), 'плитка звонков никуда не ведёт');
  assert.ok(app.includes('function callsModal()'), 'нет экрана звонка');
  assert.ok(app.includes("push:()=>window.ChatDailyWork?.openNotifications?.()"), 'плитка уведомлений не открывает центр внимания');
  assert.ok(app.includes("MEDIA_PROVIDER_UNAVAILABLE:"), 'отказ звонков не переведён');
  const calls = await read('public/calls-ui.js');
  assert.ok(calls.includes('window.CHAT_ERRORS?.[error.code]'), 'модуль звонков сообщает отказы по-английски');
});

// Три вещи хранились на сервере и не доходили до экрана, а «Расписание дня»
// показывало завтрашнюю встречу как сегодняшнюю.
test('a reply looks like a reply, a label on a message is visible', async () => {
  const app = await read('public/app.js');
  assert.ok(app.includes('class="reply-quote"'), 'ответ не показывает, на что отвечают');
  assert.ok(app.includes("row.classList.add('flash')"), 'переход к исходному сообщению не подсвечивает его');
  assert.ok(app.includes('async function loadLabelTargets()'), 'карта меток не строится');
  assert.ok(app.includes("S.labelTargets?.get('message:'+m.id)"), 'метки сообщения не выводятся');
  const css = await read('public/styles.css');
  assert.ok(css.includes('.reply-quote{'), 'у цитаты ответа нет оформления');
});

test('the day agenda does not pass tomorrow off as today', async () => {
  const app = await read('public/app.js');
  assert.ok(app.includes("const agendaTitle=todays.length||!later.length?'Расписание дня':'Ближайшие встречи'"),
    'заголовок расписания не различает сегодня и потом');
  assert.ok(app.includes("dayEnd.setDate(dayEnd.getDate()+1)"), 'границы дня не вычисляются');
  assert.ok(app.includes('class="event-day"'), 'в списке недели и месяца у строк нет дня');
});

test('a task made from a message keeps the message', async () => {
  const app = await read('public/app.js');
  assert.ok(app.includes("taskModal(b.dataset.taskMessage,(source?.body||'').trim().slice(0,120))"),
    'задача из сообщения открывается с пустым названием');
});

// В «В работе» переход «сдать на проверку» открывается только после первого
// доказательства. Правило верное, но экран о нём молчал.
test('the evidence gate explains itself, and priority is a word', async () => {
  const app = await read('public/app.js');
  assert.ok(app.includes("task.status==='in_progress'&&!evidence.length"), 'нет подсказки о доказательстве');
  assert.ok(app.includes('Чтобы сдать работу на проверку'), 'подсказка не написана');
  assert.ok(app.includes("const TASK_PRIORITY={normal:'обычный'"), 'приоритет печатается сырым значением');
  assert.ok(!app.includes("esc(task.priority||'normal')"), 'в карточке остался сырой приоритет');
});

// Напоминание: своя сущность, а не задача без ответственного.
test('reminders are offered where a person needs them', async () => {
  const app = await read('public/app.js');
  assert.ok(app.includes('async function remindersModal('), 'нет листа напоминаний');
  assert.ok(app.includes('function remindAboutModal('), 'нельзя напомнить о сообщении или задаче');
  assert.ok(app.includes('data-action="reminders"'), 'нет плитки напоминаний');
  assert.ok(app.includes('data-message-remind'), 'в сообщении нет «Напомнить»');
  assert.ok(app.includes('data-task-remind'), 'в задаче нет «Напомнить»');
  assert.ok(app.includes("['Через час',hour]"), 'нет быстрых сроков');
  const daily = await read('public/daily-work.js');
  assert.ok(daily.includes("if(n.type==='calendar.reminder')return n.title||"),
    'центр внимания снова подменяет текст напоминания общим словом');
});

// Пароли люди всё равно где-то держат: в заметках, в переписке с самим
// собой. Место получше — часть рабочего пространства, а не отдельная
// программа, про которую надо помнить.
test('the vault is reachable and never leaks a secret into the list', async () => {
  const app = await read('public/app.js');
  assert.ok(app.includes('async function vaultModal()'), 'нет хранилища паролей');
  assert.ok(app.includes('data-action="vault"'), 'нет плитки паролей');
  assert.ok(app.includes("api(`/api/v1/vault/${b.dataset.vaultReveal}/secret`,{method:'POST'})"),
    'пароль раскрывается не отдельным запросом');
  assert.ok(app.includes('function generatePassword('), 'нет генератора пароля');
  assert.ok(app.includes("crypto.getRandomValues"), 'пароль придумывается небезопасным способом');
  // Показанный пароль не должен висеть на экране.
  assert.ok(app.includes('slot.hidden=true;slot.textContent=\'\';b.textContent=\'Показать\'}},30000)'),
    'показанный пароль не прячется сам');
  const css = await read('public/styles.css');
  assert.ok(css.includes('.vault-secret{'), 'у показанного пароля нет оформления');
});

// Звезда, маркер и заметка — личные пометки поверх чужих объектов, и все
// три бесполезны без одного места, куда можно вернуться.
test('favourites, highlights and notes are reachable in one place', async () => {
  const app = await read('public/app.js');
  assert.ok(app.includes('async function favouritesModal('), 'нет экрана избранного');
  for (const tab of ['conversation', 'message', 'task', 'highlight', 'note']) {
    assert.ok(app.includes(`['${tab}',`), `во вкладках избранного нет «${tab}»`);
  }
  assert.ok(app.includes("saved:()=>favouritesModal()"), 'плитка ведёт на старый список сохранённых');
  assert.ok(app.includes("data-action=\"favour-room\""), 'беседу нельзя отметить звездой');
  assert.ok(app.includes('data-task-favour'), 'задачу нельзя отметить звездой');
  assert.ok(app.includes('async function toggleFavourite(type,id)'), 'нет переключателя избранного');
});

test('the marker keeps the selection it was given', async () => {
  const app = await read('public/app.js');
  // Выделение пропадает от любого нажатия, поэтому цвет предлагается
  // сразу и рядом с выделенным текстом.
  assert.ok(app.includes("document.addEventListener('selectionchange'"), 'панель маркера не следит за выделением');
  assert.ok(app.includes("bar.addEventListener('mousedown',(event)=>event.preventDefault())"),
    'нажатие по панели снимает выделение');
  assert.ok(app.includes('function bodyWithHighlights(m)'), 'выделения не рисуются в тексте');
  // Смещения могли уехать после правки сообщения: цветное пятно посреди
  // чужой фразы хуже, чем отсутствие подсветки.
  assert.ok(app.includes('.filter(h=>text.slice(h.startOffset,h.endOffset)===h.quote)'),
    'выделение рисуется без проверки, что текст на месте');
  assert.ok(app.includes('function noteModal(message,existing=null)'), 'нет заметки на сообщение');
});

// Игра «в этой беседе» предлагала всех коллег, а сервер требует, чтобы
// соперник был в этой комнате: любой выбор «не отсюда» кончался отказом.
test('a game invite offers only people who can actually play here', async () => {
  const app = await read('public/app.js');
  assert.ok(app.includes('async function newGameModal(conversationId)'), 'форма игры не умеет ждать участников');
  assert.ok(app.includes('const inRoom=new Set((items||[]).map(m=>m.userId));'), 'список соперников не сверяется с комнатой');
  assert.ok(app.includes('В этой беседе больше никого нет'), 'нет объяснения, когда играть не с кем');
});

// Заголовок расписания обещал «Ближайшие встречи», а тело отвечало
// «Свободный день»: встреч не было вовсе.
test('the agenda heading never promises meetings that do not exist', async () => {
  const app = await read('public/app.js');
  assert.ok(app.includes("todays.length||!later.length?'Расписание дня':'Ближайшие встречи'"),
    'заголовок снова обещает ближайшие встречи при пустом календаре');
});

// Голосовое сообщение рисовалось кнопкой «▶» без обработчика и пустой
// полоской вместо волны: прослушать его было нельзя вовсе. Вложение
// печатало имя и тип, но не давало ссылки — скачать тоже было нельзя,
// хотя сервер и отдаёт файл, и умеет открыть картинку или PDF в окне.
test('a voice message plays and an attachment opens', async () => {
  const app = await read('public/app.js');
  assert.ok(app.includes("data-voice=\"${esc(m.metadata?.fileId??'')}\""), 'у голосового нет привязки к файлу');
  assert.ok(app.includes("$$('[data-voice]').forEach(card=>{"), 'нет обработчика проигрывания');
  assert.ok(app.includes('S.voice.audio.pause()'), 'два голосовых могут играть разом');
  assert.ok(app.includes('function voiceLength(ms)'), 'длительность печатается сырыми секундами');
  assert.ok(app.includes('class="voice-card file-card"'), 'вложение осталось без ссылки');
  assert.ok(app.includes('const fileHref=(meta)=>'), 'адрес вложения не строится');

  // Картинку и PDF открываем в окне, остальное отдаём на скачивание.
  assert.ok(app.includes("filePreviewable(m.metadata)?' target=\"_blank\" rel=\"noopener\"':' download'"),
    'вложение открывается одинаково независимо от вида');

  // SVG может нести сценарий: открытый на нашем домене, он ходит в наш
  // API от имени того, кто его открыл.
  const media = await read('src/http/media.js');
  assert.match(media, /image\\\/\(\?!svg\\\+xml\)/, 'SVG снова открывается в окне');
  assert.match(media, /audio\\\/\|video\\\//, 'звук и видео снова не открываются в окне');
});
