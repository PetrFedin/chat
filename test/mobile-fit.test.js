import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

/**
 * Продукт должен помещаться в экран телефона.
 *
 * Проверки здесь буквальные — это правила, каждое из которых поставлено
 * на найденное переполнение, измеренное в браузере на 375 точках.
 * Статическая проверка не заменяет взгляда на экран, но она ловит
 * возврат ровно тех правок, которые эти переполнения убрали: вёрстку
 * никто не открывает на телефоне до жалобы.
 */
test('колонки не растягиваются по содержимому', async () => {
  const css = await read('styles.css');

  // Колонка размера auto растягивается до самого широкого ребёнка.
  // Длинная строка внутри .row распирала карточку до 594 точек при
  // экране в 375 — содержимое уезжало за край.
  assert.match(css, /\.stack\{display:grid;grid-template-columns:minmax\(0,1fr\)/,
    'у .stack снова колонка по содержимому');

  // То же самое внутри строки: без min-width:0 колонка auto считает
  // ширину по `.row-sub`, который не переносится.
  assert.match(css, /\.row>\*\{min-width:0\}/, 'строка снова растягивается по самой длинной надписи');
});

/**
 * Боковой прокрутки не должно быть нигде и ни при какой ширине.
 *
 * Полоса прокрутки вбок — это спрятанная часть интерфейса: человек не
 * знает, что там что-то есть, и не узнает. В шапке беседы за краем
 * оказывались кнопки звонка, в рядах фильтров — последний фильтр.
 */
test('вбок не прокручивается ничто', async () => {
  const css = await read('styles.css');

  // Колонка 1fr не сжимается ниже min-content своего содержимого:
  // длинное слово в плитке распирало сетку шире экрана на 320 точках.
  assert.doesNotMatch(css, /repeat\(\d,1fr\)/, 'вернулась сетка из колонок 1fr без minmax');
  assert.match(css, /\.module-card\{min-height:142px;padding:17px;overflow-wrap:anywhere/);

  // Полосы, которые раньше уезжали вбок, теперь переносятся.
  assert.match(css, /\.conversation-pane-header \.chip-row\{margin-bottom:0;flex:1;min-width:0;flex-wrap:wrap\}/);
  assert.match(css, /\.message-header>\.inline-actions:last-child\{grid-column:1\/-1;flex-wrap:wrap\}/);
  assert.doesNotMatch(css, /\.week-strip\{overflow:auto/);

  // И страховка: карточка не прокручивается вбок, что бы в неё ни попало.
  assert.match(css, /\.modal\{width:min\(100%,480px\);max-height:min\(780px,90dvh\);overflow-y:auto;overflow-x:hidden/);

  const dailyWork = await read('daily-work.css');
  for (const box of ['.dwc-list', '.dwc-results']) {
    assert.match(dailyWork, new RegExp(`\\${box}\\{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden`),
      `${box} снова может уехать вбок`);
  }
  const intelligence = await read('meeting-intelligence.css');
  assert.match(intelligence, /\.mi-body\{flex:1;overflow-y:auto;overflow-x:hidden/);
});

test('на узком экране действия переносятся, а не прячутся', async () => {
  const css = await read('styles.css');
  const start = css.indexOf('@media(max-width:560px){');
  assert.ok(start > 0, 'пропал блок правил для узкого экрана');
  let depth = 0;
  let end = start;
  while (end < css.length) {
    if (css[end] === '{') depth += 1;
    else if (css[end] === '}' && (depth -= 1) === 0) break;
    end += 1;
  }
  const mobile = css.slice(start, end + 1);

  // Кнопки в строке не помещались рядом с текстом и вылезали за экран,
  // утаскивая за собой горизонтальную прокрутку всей страницы.
  assert.match(mobile, /\.row>\.inline-actions\{grid-column:1\/-1/);
  assert.match(mobile, /\.row\.flow\{flex-wrap:wrap\}/);

  // На телефоне фильтры бесед занимают отдельную строку целиком: рядом
  // с заголовком им места нет. Сам перенос — в основных правилах.
  assert.match(mobile, /\.conversation-pane-header \.chip-row\{flex:1 1 100%\}/);

  // Подпись строки на телефоне занимает две строки вместо многоточия:
  // иначе от записи журнала остаётся половина.
  assert.match(mobile, /\.row-sub\{white-space:normal;display:-webkit-box;-webkit-line-clamp:2/);
});

test('ряды фильтров переносятся, а не уезжают вбок', async () => {
  // Боковая прокрутка у ряда «таблеток» — это спрятанный за жестом
  // фильтр, о котором человеку никто не сказал.
  const intelligence = await read('meeting-intelligence.css');
  assert.match(intelligence, /\.mi-filters\{display:flex;flex-wrap:wrap/);
  assert.doesNotMatch(intelligence, /\.mi-filters\{[^}]*overflow:auto/);

  const dailyWork = await read('daily-work.css');
  assert.match(dailyWork, /\.dwc-filter-row\{display:flex;flex-wrap:wrap/);
  assert.doesNotMatch(dailyWork, /\.dwc-filter-row\{[^}]*overflow:auto/);
});

test('лист диалога не выше экрана и не шире его', async () => {
  const css = await read('styles.css');
  // dvh, а не vh: на телефоне адресная строка съедает часть экрана, и
  // окно, посчитанное в vh, уезжает под неё нижней кнопкой.
  assert.match(css, /\.modal\{width:100%;[^}]*max-height:88dvh\}/);
  assert.match(css, /\.modal-backdrop\{align-items:end;padding:0\}/);
});

test('длинная ссылка не растягивает переписку', async () => {
  const css = await read('styles.css');
  // Неразрывное слово или ссылка без пробелов — самый частый способ
  // получить горизонтальную прокрутку в чате.
  assert.match(css, /overflow-wrap:anywhere|word-break:break-word|overflow-wrap:break-word/,
    'в переписке нечему переносить длинную ссылку');
});
