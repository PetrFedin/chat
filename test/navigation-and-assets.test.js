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
