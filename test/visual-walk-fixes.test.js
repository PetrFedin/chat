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
