import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

/**
 * Черновики сообщений.
 *
 * Набранный и неотправленный текст пропадал при переходе в другую
 * беседу — самая обидная потеря из возможных: человек только что его
 * придумал.
 */
test('черновик сохраняется, возвращается и исчезает после отправки', () => {
  // Хранилище может быть недоступно — приватное окно, запрет на сайт.
  // Тогда всё работает как раньше: черновик не сохраняется, но ничего
  // не ломается.
  const source = app.slice(app.indexOf('const previewOf='), app.indexOf('const NOTIFY_SWITCHES='));
  const scope = { localStorage: null, document: { querySelector: () => null, querySelectorAll: () => [] },
    CSS: { escape: (x) => x }, esc: (x) => String(x) };
  const make = (store, session) => new Function('localStorage', 'document', 'CSS', 'esc', 'me',
    `${source}; return { readDraft, writeDraft, previewOf };`)(store, scope.document, scope.CSS, scope.esc, () => session);

  const memory = (() => {
    const map = new Map();
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k), map };
  })();
  const drafts = make(memory, { workspaceId: 'w1' });

  drafts.writeDraft('c1', 'Недописанная мысль');
  assert.equal(drafts.readDraft('c1'), 'Недописанная мысль');
  // Ключ включает рабочее пространство: два пространства в одном браузере
  // не должны показывать друг другу неотправленный текст.
  assert.equal([...memory.map.keys()][0], 'chat:draft:w1:c1');
  assert.equal(make(memory, { workspaceId: 'w2' }).readDraft('c1'), '', 'черновик протёк в чужое пространство');

  // Отправка стирает.
  drafts.writeDraft('c1', '');
  assert.equal(drafts.readDraft('c1'), '');
  // Пробелы — не черновик.
  drafts.writeDraft('c1', '   \n ');
  assert.equal(drafts.readDraft('c1'), '');

  // Недоступное хранилище не роняет ничего.
  const broken = { getItem: () => { throw new Error('заблокировано'); }, setItem: () => { throw new Error('заблокировано'); }, removeItem: () => {} };
  const safe = make(broken, { workspaceId: 'w1' });
  assert.equal(safe.readDraft('c1'), '');
  assert.doesNotThrow(() => safe.writeDraft('c1', 'текст'));

  // В списке бесед неотправленный текст важнее последнего сообщения:
  // иначе о черновике вспоминают, только снова открыв беседу.
  drafts.writeDraft('c2', 'Остался незаконченным');
  assert.match(drafts.previewOf({ id: 'c2' }, 'последнее сообщение'), /Черновик:.*Остался незаконченным/);
  assert.equal(drafts.previewOf({ id: 'нет-черновика' }, 'последнее сообщение'), 'последнее сообщение');
});

test('черновик вшит в отправку и в обе отрисовки списка', () => {
  // Отправка обязана стирать черновик, иначе он останется висеть в
  // списке рядом с уже отправленным сообщением.
  assert.match(app, /async function send\(\)\{[^}]*writeDraft\(S\.selected,''\)/);
  // Поле восстанавливается при каждой отрисовке беседы.
  assert.match(app, /if\(S\.selected&&!input\.value\)input\.value=readDraft\(S\.selected\)/);
  assert.match(app, /input\.oninput=e=>\{typing\(e\);if\(S\.selected\)writeDraft\(S\.selected,input\.value\)\}/);
  // Карточки беседы рисуются двумя функциями, и обе обязаны спрашивать
  // про черновик: иначе в одном списке он виден, а в другом нет.
  assert.match(app, /previewOf\(c,c\.lastMessage\?/, 'список бесед на «Сегодня» не знает про черновики');
  assert.match(app, /previewOf\(x,x\.lastMessage\?/, 'список бесед на экране «Сообщения» не знает про черновики');
  // И точечная подрисовка знает про оба вида карточек.
  assert.match(app, /data-open="\$\{CSS\.escape\(conversationId\)\}"\] \.preview/);
  assert.match(app, /data-conversation="\$\{CSS\.escape\(conversationId\)\}"\] \.preview/);
});
