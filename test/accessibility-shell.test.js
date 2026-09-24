import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

/**
 * Три вещи, которых не хватало человеку за клавиатурой и экранным
 * диктором. Каждая проверена вживую, здесь — чтобы не вернулись.
 */
test('открытый раздел слышно, а не только видно', () => {
  // Подсветка active говорит глазу; диктору нужно aria-current.
  assert.match(app, /data-nav="\$\{id\}"\$\{S\.view===id\?' aria-current="page"':''\}/);
});

test('фокус возвращается тому, кто открыл окно', () => {
  assert.match(app, /openerBeforeOverlay=document\.activeElement/);
  assert.match(app, /if\(opener\?\.isConnected\)opener\.focus\?\.\(\{preventScroll:true\}\)/);
  // Не через кадр анимации: в фоновой вкладке кадры не рисуются.
  assert.doesNotMatch(app, /requestAnimationFrame\(\(\)=>opener\.focus/);
});

test('до содержимого можно дойти, не проходя всю панель', () => {
  assert.match(html, /class="skip-link" href="#screen"/);
  assert.match(css, /\.skip-link\{position:absolute;left:-9999px/);
  assert.match(css, /\.skip-link:focus\{left:8px\}/);
});

test('окно остаётся диалогом со своим именем и ловушкой фокуса', () => {
  assert.match(app, /role="dialog" aria-modal="true" aria-labelledby="modal-heading"/);
  assert.match(app, /event\.key==='Escape'/);
  assert.match(app, /event\.key!=='Tab'/);
});
