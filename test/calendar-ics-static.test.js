import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('подписка на календарь в интерфейсе говорит с governed API и предлагает перевыпуск ссылки', () => {
  assert.match(app, /calendarSubscribeModal/);
  assert.match(app, /data-action="calendar-subscribe"/);
  assert.match(app, /\/api\/v1\/calendar\/ics/);
  assert.match(app, /data-regenerate-ics/);
});

test('ссылка подписки показывается человеку, а не только копируется вслепую', () => {
  assert.match(app, /readonly rows="3"/);
});
