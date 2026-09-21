import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

/**
 * Четыре модуля просили стартовый ответ по отдельности: на первой
 * отрисовке уходило три одинаковых запроса по шесть килобайт, а на
 * медленной связи это три ожидания подряд вместо одного.
 */
test('стартовый ответ запрашивается один раз на всех', () => {
  const shared = read('shared-bootstrap.js');
  assert.match(shared, /window\.ChatBootstrap/);
  assert.match(shared, /inflight/, 'нет общего обещания — одновременные вызовы снова уйдут по сети');

  for (const name of ['app.js', 'daily-work.js', 'meeting-operations.js', 'meeting-intelligence.js']) {
    const source = read(name);
    if (!source.includes('/api/v1/bootstrap')) continue;
    assert.match(source, /window\.ChatBootstrap\?\.(get|put)/,
      `${name} снова ходит за стартовым ответом сам`);
  }
  assert.match(read('index.html'), /shared-bootstrap\.js/, 'общий кэш не подключён');
});

/**
 * Сетевой запрос стоял внутри оформления, а оформление вызывается из
 * наблюдателя за разметкой: сто уведомлений тянулись при каждой
 * перерисовке — восемнадцать запросов за минуту спокойной работы.
 */
test('наблюдатель за разметкой не ходит в сеть на каждую перерисовку', () => {
  const source = read('meeting-intelligence.js');
  assert.match(source, /let notificationsSyncedAt=0/);
  assert.match(source, /Date\.now\(\)-notificationsSyncedAt<5000/, 'нет ограничения по времени');
  assert.match(source, /document\.querySelector\('\[data-dwc-notification\]'\)/,
    'запрос уходит, даже когда связывать нечего');
  assert.match(source, /observerTimer=setTimeout/, 'наблюдатель снова дёргает сеть без задержки');
});
