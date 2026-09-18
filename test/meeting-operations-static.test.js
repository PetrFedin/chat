import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html,js,meetingJs,css,sw]=await Promise.all([
  readFile(new URL('../public/index.html',import.meta.url),'utf8'),
  readFile(new URL('../public/meeting-operations.js',import.meta.url),'utf8'),
  readFile(new URL('../public/meeting-intelligence.js',import.meta.url),'utf8'),
  readFile(new URL('../public/meeting-intelligence.css',import.meta.url),'utf8'),
  readFile(new URL('../public/sw.js',import.meta.url),'utf8'),
]);

test('Meeting Operations browser module parses and is loaded after Meeting Intelligence',()=>{
  assert.doesNotThrow(()=>new Function(js));
  assert.doesNotThrow(()=>new Function(meetingJs));
  const intelligence=html.indexOf('/meeting-intelligence.js');
  const operations=html.indexOf('/meeting-operations.js');
  const daily=html.indexOf('/daily-work.js');
  assert.ok(intelligence>=0&&operations>intelligence&&daily>operations);
});

test('Meeting Operations UI is permission gated and uses only governed admin APIs',()=>{
  assert.match(js,/meeting\.ops\.manage/);
  assert.match(js,/meeting\.cost\.read/);
  assert.match(js,/meeting\.cost\.manage/);
  assert.match(js,/\/api\/v1\/admin\/meeting-jobs/);
  assert.match(js,/\/api\/v1\/admin\/meeting-costs/);
  assert.match(js,/\/api\/v1\/admin\/meeting-prices/);
  assert.doesNotMatch(js,/providerRequestId/);
});

test('manual recovery requires a reason and preserves bounded retry controls',()=>{
  assert.match(js,/Укажите причину повторной обработки/);
  assert.match(js,/reason,extraAttempts/);
  assert.match(js,/value="1">1<\/option><option value="2">2<\/option><option value="3">3/);
  assert.match(js,/Прошлые попытки сохраняются/);
});

test('cost surface distinguishes full rollup from limited details and explicit unpriced states',()=>{
  assert.match(js,/Итог считается по всему выбранному периоду/);
  assert.match(js,/usage_unavailable/);
  assert.match(js,/usage_schema_mismatch/);
  assert.match(js,/no_price_version/);
  assert.match(js,/limit=100/);
  assert.match(js,/Неуспешная попытка учитывается/);
});

test('pricing form creates a new effective version without default money values',()=>{
  assert.match(js,/НОВАЯ ВЕРСИЯ ТАРИФА/);
  assert.match(js,/effectiveFrom/);
  assert.match(js,/unitQuantity/);
  assert.match(js,/unitPrice/);
  assert.doesNotMatch(js,/name="unitPrice"[^>]*value=/);
  assert.doesNotMatch(js,/name="currency"[^>]*value=/);
});

test('Meeting Review and Meeting Operations own separate overlay lifecycles',()=>{
  assert.match(js,/mio-overlay/);
  assert.match(js,/O\.permissions=new Set\(\)/);
  assert.match(js,/location\.hash==='#\/meeting-operations'/);
  assert.ok(meetingJs.includes('.mi-overlay:not(.mio-overlay)'),'Meeting Review Escape handler must ignore the operations overlay');
});

test('Meeting Operations has responsive themed styles and is cached by the PWA shell',()=>{
  for(const selector of ['.mio-health','.mio-kpis','.mio-call-row','.mio-price-row','.mio-entry'])assert.ok(css.includes(selector));
  assert.match(sw,/chat-shell-v8/);
  assert.ok(sw.includes('/meeting-operations.js'));
});
