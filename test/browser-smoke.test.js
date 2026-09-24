import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createChatServer } from '../src/server.js';

process.env.VAULT_KEY ||= randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

/**
 * Загрузить страницу по-настоящему.
 *
 * Каждый тест на интерфейс до сих пор разбирал `public/*.js` регулярными
 * выражениями — ни один не открывал страницу. Зелёный CI однажды уже
 * стоял рядом с зависшим на загрузке экраном: наблюдатель мутаций зациклил
 * сам себя, а строчные проверки этого не видят в принципе, потому что
 * смотрят на текст исходника, а не на то, что происходит после его
 * исполнения.
 *
 * Этот тест — не замена им, а недостающий этаж: заводит настоящий сервер
 * без базы (памяти достаточно — нужен сам факт, что страница поднимается
 * и реагирует на клик, а не глубина конкретной функции), открывает
 * headless-браузер, кликает по вкладке «Создать компанию», заполняет
 * форму так, как это делает человек, и проверяет, что после входа
 * появился рабочий экран, а не тишина. Отдельно ловит ошибки в консоли и
 * необработанные исключения страницы — сообщение об ошибке, которое
 * человек никогда не увидит сам, здесь останавливает тест.
 */
test('страница поднимается, форма регистрации работает, после входа виден рабочий экран', async (t) => {
  const app = await createChatServer({ startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();

  // Хром сам пишет в консоль строкой уровня «error» на любой не-2xx ответ
  // сети — в том числе честные 401 до входа и 503 для того, что без базы
  // недоступно (это не решение приложения, а поведение самого браузера).
  // Настоящий сигнал беды — необработанное исключение страницы или то,
  // что код сам вывел через console.error, а не разбор сетевого лога.
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/^Failed to load resource/.test(msg.text())) return;
    consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  // Не `networkidle`: приложение держит открытым WebSocket и опрашивает
  // сервер в фоне, так что тишины в сети не наступает никогда — ждём
  // конкретный элемент, как это делает человек, глядя на экран.
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-view').waitFor({ state: 'visible' });

  // Экран входа показан, а не пуст и не завис на «Загрузка…».
  await assert.doesNotReject(page.locator('#login-form').waitFor({ state: 'visible', timeout: 5000 }));

  // Вкладка «Создать компанию» — обычный клик, не подстановка значения в DOM.
  await page.locator('[data-auth-mode="register"]').click();
  await page.locator('#register-form').waitFor({ state: 'visible' });

  const suffix = randomUUID().slice(0, 8);
  await page.locator('#register-form [name="companyName"]').fill(`Смоук-тест ${suffix}`);
  await page.locator('#register-form [name="ownerName"]').fill('Проверяющий');
  await page.locator('#register-form [name="email"]').fill(`smoke-${suffix}@t.test`);
  await page.locator('#register-form [name="password"]').fill('SmokeTestPassword42');
  await page.locator('#register-form button[type="submit"]').click();

  // После входа виден рабочий экран, а не застрявшая форма и не пустой auth-error.
  await page.locator('#app-view').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#auth-view').waitFor({ state: 'hidden' });

  const greeting = await page.locator('#greeting-word').textContent().catch(() => null);
  assert.ok(greeting && greeting.trim().length > 0, 'экран «Сегодня» не показал приветствие — либо не тот экран, либо пусто');

  // Основные разделы открываются кликом, а не только по прямому переходу
  // по хешу: заголовок вкладки навигации должен реально смениться.
  for (const view of ['chats', 'tasks', 'calendar']) {
    await page.locator(`[data-nav="${view}"]`).first().click();
    await page.locator(`[data-nav="${view}"].active`).first().waitFor({ state: 'visible', timeout: 5000 });
  }

  assert.deepEqual(pageErrors, [], `необработанная ошибка на странице: ${pageErrors.join(' | ')}`);
  assert.deepEqual(consoleErrors, [], `ошибка в консоли браузера: ${consoleErrors.join(' | ')}`);
});
