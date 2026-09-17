import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('daily work client is syntactically valid and wired into the shell',async()=>{
  const[html,js,css,sw]=await Promise.all([
    read('public/index.html'),read('public/daily-work.js'),read('public/daily-work.css'),read('public/sw.js'),
  ]);
  assert.doesNotThrow(()=>new Function(js));
  assert.match(html,/\/daily-work\.css/);
  assert.match(html,/src="\/daily-work\.js"/);
  assert.match(js,/\/api\/v1\/attention/);
  assert.match(js,/\/api\/v1\/notifications/);
  assert.match(js,/\/api\/v1\/search/);
  assert.match(js,/\/api\/v1\/files/);
  assert.match(css,/\.dwc-attention-strip/);
  assert.match(css,/\.dwc-mention-picker/);
  assert.match(sw,/chat-shell-v\d+/);
  assert.match(sw,/daily-work\.css/);
  assert.match(sw,/daily-work\.js/);
});
