import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createChatServer } from '../src/server.js';
import { MemoryStore } from '../src/persistence/store.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function startServer() {
  const app = await createChatServer({ store: new MemoryStore(), startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  return { call: (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init), close: () => app.close() };
}

test('navigation items carry real icons, not placeholder glyphs', async () => {
  const source = await read('public/app.js');
  assert.match(source, /const navIcon=\{/);
  for (const key of ['today', 'chats', 'tasks', 'calendar', 'more']) {
    assert.match(source, new RegExp(`${key}:svg\\(`), `${key} needs a drawn icon`);
  }
  assert.match(source, /stroke="currentColor"/, 'icons must follow the theme, not a fixed colour');
  assert.doesNotMatch(source, /\['chats','●'/, "'●' named nothing and rendered as a grey blob");
  assert.doesNotMatch(source, /\['calendar','□'/);
});

test('the unread badge sits on the icon inside the bottom bar', async () => {
  const css = await read('public/styles.css');
  assert.match(css, /\.mobile-nav \.nav-item \.dwc-inline-badge\{[^}]*position:absolute/);
  assert.match(css, /\.mobile-nav \.nav-item\{[^}]*position:relative/);
  // margin-left:auto is the sidebar-row layout; in this column it pushed the
  // badge below the caption and out of the bar.
  const scoped = css.slice(css.indexOf('.mobile-nav .nav-item .dwc-inline-badge'));
  assert.match(scoped.slice(0, 260), /margin:0 0 0 5px/);
});

test('the bottom bar follows the theme instead of hardcoding dark colours', async () => {
  const css = await read('public/styles.css');
  const rule = css.slice(css.lastIndexOf('.mobile-nav{'));
  assert.match(rule.slice(0, 200), /background:var\(--surface\)/);
  assert.match(rule.slice(0, 200), /border-top:1px solid var\(--line\)/);
  assert.match(css, /\.mobile-nav \.nav-item\{color:var\(--muted\)/);
});

test('static assets revalidate instead of going stale after a deploy', async (t) => {
  const { call, close } = await startServer();
  t.after(close);

  const first = await call('/app.js');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-cache');
  const etag = first.headers.get('etag');
  assert.ok(etag, 'an unhashed asset needs a validator');

  const second = await call('/app.js', { headers: { 'if-none-match': etag } });
  assert.equal(second.status, 304, 'an unchanged asset must cost a 304, not a full body');

  const changed = await call('/app.js', { headers: { 'if-none-match': 'W/"stale"' } });
  assert.equal(changed.status, 200, 'a stale validator must serve the new body');

  const html = await call('/');
  assert.equal(html.headers.get('cache-control'), 'no-store', 'the shell must never be cached');
});

test('a screen does not repeat its own name as the first heading', async () => {
  const source = await read('public/app.js');
  // The app bar already names the screen; repeating it wastes the most
  // valuable line on a phone and reads as a rendering bug.
  assert.doesNotMatch(source, /<div class="section-head"><div><h2>Задачи<\/h2>/);
  assert.doesNotMatch(source, /<div class="section-head"><div><h2>Сегодня<\/h2>/);
  assert.doesNotMatch(source, /<div class="conversation-pane-header"><h2>Сообщения<\/h2>/);
  assert.match(source, /<h2>Расписание дня<\/h2>/, 'the schedule section keeps a name of its own');
  assert.match(source, /<h2>Диалоги<\/h2>/);
});

test('file sizes carry units in the interface language', async () => {
  const source = await read('public/daily-work.js');
  assert.match(source, /SIZE_UNITS=\{ru:\['Б','КБ','МБ','ГБ'\],en:\['B','KB','MB','GB'\]\}/);
  assert.doesNotMatch(source, /return`\$\{n\} B`/, "'124 B' in a Russian sentence reads as volts");
});

test('the top bar buttons all have handlers', async () => {
  const [html, app] = await Promise.all([read('public/index.html'), read('public/app.js')]);
  const wired = [...app.matchAll(/(?:^|[,{])\s*'?([a-z-]+)'?\s*:/gm)].map((m) => m[1]);
  for (const match of html.matchAll(/data-action="([a-z-]+)"/g)) {
    assert.ok(wired.includes(match[1]), `data-action="${match[1]}" has no entry in the action map`);
  }
  assert.doesNotMatch(html, /data-action="quick-create"/, 'the markup said quick-create while the map said quick, so the button did nothing');
});

test('preferences compares what it wrote, not what the DOM serialises back', async () => {
  const source = await read('public/preferences.js');
  // innerHTML round-trips through the browser's normaliser — a valueless
  // attribute comes back as name="" — so comparing against it never matches
  // and the write repeats on every observer batch.
  assert.match(source, /const lastMarkup = new WeakMap\(\)/);
  assert.match(source, /if \(!element \|\| lastMarkup\.get\(element\) === markup\) return;/);
  assert.doesNotMatch(source, /element\.innerHTML !== markup/);
});

test('overlays keep a stack so a person can step back the way they came', async () => {
  const source = await read('public/app.js');
  assert.match(source, /const overlayStack=\[\]/);
  assert.match(source, /history\.pushState\(\{overlay:overlayStack\.length\}/);
  assert.match(source, /window\.addEventListener\('popstate'/);
  assert.match(source, /data-back/, 'a stacked overlay offers back, not only close');
});

test('closing a sheet cannot swallow the one that opens next', async () => {
  const source = await read('public/app.js');
  // closeModal unwinds history asynchronously; the deferred popstate used to
  // pop the overlay opened in the meantime, which killed every card in the
  // «Создать» sheet.
  assert.match(source, /function replaceModal\(open\)\{if\(overlayStack\.length\)overlayStack\.pop\(\);open\(\)\}/);
  assert.match(source, /if\(unwinding>0\)\{unwinding-=1;return\}/);
  assert.doesNotMatch(source, /const x=b\.dataset\.q;closeModal\(\)/, 'the quick sheet must swap, not close and reopen');
});

test('a modal is a dialog: focused, trapped, and closed by Escape', async () => {
  const source = await read('public/app.js');
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="modal-heading"/);
  assert.match(source, /if\(event\.key==='Escape'\)\{event\.preventDefault\(\);closeModal\(\)/);
  assert.match(source, /event\.key!=='Tab'/, 'Tab has to stay inside the sheet');
});

test('the translator replaces whole words, not pieces of them', async () => {
  const source = await read('public/preferences.js');
  // A global substring replace over two-letter day abbreviations turned
  // «Почта» into «ПоThuа» and «Встреча» into «Sunтреча».
  assert.match(source, /const looksLikeDate = \/\\d\/\.test\(value\)/);
  assert.match(source, /if \(ru\.length <= 3 && !looksLikeDate\) continue;/);
  assert.match(source, /\\\\p\{L\}\\\\p\{N\}/, 'word boundaries must be unicode-aware');
  assert.doesNotMatch(source, /translated\.replace\(new RegExp\(escaped, 'gi'\)/);
});

test('controls that look pressable have handlers, and icons have names', async () => {
  const [app, html] = await Promise.all([read('public/app.js'), read('public/index.html')]);
  assert.match(app, /\$\('#workspace-switcher'\)\.onclick/);
  assert.match(app, /\$\('#profile-card'\)\.onclick/);
  assert.match(app, /data-quick-form/, 'the quick capture bar must do something with what is typed');
  for (const action of ['attach', 'voice', 'send']) {
    assert.match(app, new RegExp(`data-action="${action}"[^>]*aria-label=`), `${action} is icon-only and needs a name`);
  }
  assert.match(html, /id="top-avatar"[^>]*aria-label=/);
});

test('the answer-needed marker survives a phone screen', async () => {
  const css = await read('public/styles.css');
  // The mobile rule hides a calendar row's trailing chip, which is also where
  // «нужен ответ» lives.
  assert.match(css, /@media \(max-width: 980px\) \{\s*\.calendar-event > \.chip\.pulse \{ display: inline-grid; \}/);
});
