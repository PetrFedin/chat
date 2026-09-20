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
test('message controls stay out of the way until asked for', async () => {
  const [app, css] = await Promise.all([read('public/app.js'), read('public/styles.css')]);

  assert.match(app, /class="inline-actions msg-actions"/, 'ряд действий не помечен');
  assert.match(app, /data-message-actions="\$\{m\.id\}"/, 'нет кнопки, открывающей действия');
  assert.match(app, /classList\.toggle\('actions-open'\)/);
  assert.match(app, /aria-expanded/, 'состояние не объявлено для чтения с экрана');

  assert.match(css, /\.msg-actions\{display:none/);
  assert.match(css, /\.message-item\.actions-open \.msg-actions\{display:flex\}/);
  assert.match(css, /@media\(hover:hover\)\{[\s\S]*?\.message-item:hover \.msg-actions/);
  // The dead rule must not come back.
  assert.doesNotMatch(css, /\.message-actions\{/, 'правило снова целится в несуществующий класс');
});

test('a screen opens at its top', async () => {
  const app = await read('public/app.js');
  assert.match(app, /window\.scrollTo\(0,0\);\s*\n\s*render\(\);/, 'переключение экрана не сбрасывает прокрутку');
});

// On a phone the whole page scrolls, so the title, the back arrow and the call
// buttons scrolled away. And two groups totalling 492px sat side by side in a
// 402px header, so the buttons wrapped above the title.
test('the conversation header stays put and fits', async () => {
  const css = await read('public/styles.css');
  const mobile = css.slice(css.indexOf('@media(max-width:980px)'));
  assert.match(mobile, /\.message-header\{[^}]*position:sticky/);
  assert.match(mobile, /\.message-header\{[^}]*display:grid/);
  assert.match(mobile, /\.message-header>\.inline-actions:first-child\{display:contents\}/);
  assert.match(mobile, /\.message-header>\.inline-actions:last-child\{grid-column:1\/-1;flex-wrap:nowrap;overflow-x:auto/);
  assert.match(mobile, /\.message-header h2\{[^}]*text-overflow:ellipsis/);
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
    const segment = app.slice(match.index, match.index + 1600);
    const end = segment.indexOf('\n  };');
    const body = segment.slice(0, end > 0 ? end : 1200);
    if (body.includes('api(') && !body.includes('catch')) unguarded.push(match[1]);
  }
  assert.deepEqual(unguarded, [], 'эти формы молчат при отказе сервера');
});

// A meeting is people plus a time; the form asked only for the time.
test('a meeting can be created with the people in it', async () => {
  const app = await read('public/app.js');
  const form = app.slice(app.indexOf('function eventModal('), app.indexOf('function participantChecks('));
  assert.match(form, /participantChecks\(\[\], 'guest'\)/, 'из формы события некого позвать');
  assert.match(form, /calendar-events\/\$\{event\.id\}\/participants/);
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
  assert.ok(app.includes("const agendaTitle=todays.length?'Расписание дня':'Ближайшие встречи'"),
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
