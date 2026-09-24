import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('мост с Telegram в интерфейсе живёт в модалке интеграций и говорит с governed API', () => {
  assert.match(app, /\/api\/v1\/integrations\/telegram/);
  assert.match(app, /telegramBridgeFormModal/);
  assert.match(app, /data-new-bridge/);
  assert.match(app, /data-drop-bridge/);
});

test('форма моста никогда не просит вводить секрет вебхука или показывать токен второй раз', () => {
  assert.doesNotMatch(app, /webhookSecret/);
  assert.match(app, /он будет храниться зашифрованным и больше нигде не покажется/);
});
