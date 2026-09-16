import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('theme and locale preference assets are syntactically valid and wired into the shell', async () => {
  const [html, js, css, sw] = await Promise.all([
    read('public/index.html'),
    read('public/preferences.js'),
    read('public/preferences.css'),
    read('public/sw.js'),
  ]);

  assert.doesNotThrow(() => new Function(js));
  assert.match(html, /data-theme="dark"/);
  assert.match(html, /\/preferences\.css/);
  assert.match(html, /<script src="\/preferences\.js"><\/script>[\s\S]*<script src="\/vendor\/livekit-client\.js"><\/script>/);
  assert.match(js, /chat\.theme/);
  assert.match(js, /chat\.locale/);
  assert.match(js, /new Set\(\['dark', 'light'\]\)/);
  assert.match(js, /new Set\(\['ru', 'en'\]\)/);
  assert.match(css, /html\[data-theme="light"\]/);
  assert.match(css, /\.prefs-setting-row/);
  assert.match(sw, /chat-shell-v5/);
  assert.match(sw, /preferences\.css/);
  assert.match(sw, /preferences\.js/);
});
