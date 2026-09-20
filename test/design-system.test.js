import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const SHEETS = ['public/styles.css', 'public/daily-work.css', 'public/meeting-intelligence.css',
  'public/calls.css', 'public/preferences.css'];

// Нажатие подтверждается в момент нажатия, а не тем, что экран потом
// меняется. Раньше это умели только элементы с классом .pressable.
test('any button answers the press itself', async () => {
  const css = await read('public/styles.css');
  assert.match(css, /button:active:not\(\[disabled\]\)/, 'кнопка не отзывается на нажатие');
  const rule = css.match(/button:active:not\(\[disabled\]\)[^{]*\{([^}]*)\}/)[1];
  assert.match(rule, /transform:scale\(/, 'нажатие ничем не видно');
  assert.match(rule, /transition-duration:40ms/, 'отклик приходит с задержкой анимации');
  assert.doesNotMatch(css, /scale\(\.968\)/, 'осталось второе, расходящееся значение нажатия');
});

// Шкала радиусов: четыре ступени и пилюля, а не полтора десятка значений.
test('every radius comes from the scale', async () => {
  for (const sheet of SHEETS) {
    const css = await read(sheet);
    const literals = [...css.matchAll(/border-radius:(\d+)px/g)].map((m) => Number(m[1]));
    const stray = literals.filter((value) => value < 99);
    assert.deepEqual(stray, [], `${sheet}: радиусы мимо шкалы — ${stray.join(', ')}`);
  }
  const tokens = await read('public/styles.css');
  for (const token of ['--r-1:', '--r-2:', '--r-3:', '--r-4:']) {
    assert.ok(tokens.includes(token), `нет ступени ${token}`);
  }
});

// Кегли и начертания тоже шкала: 11/13/15/16/17/21/27 и 600/700/800.
test('type comes from one scale', async () => {
  const allowedSizes = new Set([11, 13, 15, 16, 17, 21, 27]);
  const allowedWeights = new Set([400, 600, 700, 800]);
  for (const sheet of SHEETS) {
    const css = await read(sheet);
    for (const [, value] of css.matchAll(/font-size:(\d+)px/g)) {
      assert.ok(allowedSizes.has(Number(value)), `${sheet}: кегль ${value}px мимо шкалы`);
    }
    for (const [, value] of css.matchAll(/font-weight:(\d+)/g)) {
      assert.ok(allowedWeights.has(Number(value)), `${sheet}: начертание ${value} мимо шкалы`);
    }
  }
});

// Палец шире курсора, и движение нужно не всем.
test('small controls are reachable by finger, and motion can be switched off', async () => {
  const css = await read('public/styles.css');
  assert.match(css, /@media \(pointer:coarse\)/, 'нет расширенной зоны нажатия под палец');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, 'движение нельзя отключить');
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)[1];
  assert.match(reduced, /transition-duration:\.001ms!important/, 'переходы остаются при отключённом движении');
});

// Иконки были россыпью редких типографских знаков: ⌸, ◍, ⌑, ⚿. Половину
// человек видит впервые, и ни один не объясняет, что за ним. Нижняя
// навигация уже была нарисована штриховыми SVG — остальное пришло к ней.
test('icons speak one language', async () => {
  const app = await read('public/app.js');
  assert.match(app, /const tileIcon=\{/, 'у плиток нет своего набора иконок');
  assert.match(app, /const roomIcon=\{/, 'у шапки беседы нет своего набора иконок');
  for (const glyph of ['⌸', '◍', '⌑', '⚿', '◔', '☏', '▣', '⊘']) {
    assert.ok(!app.includes(`class="module-icon">${glyph}`), `плитка снова рисуется знаком ${glyph}`);
  }
  // Подстановка в обычной строке не работает: такую кнопку человек видит
  // с текстом шаблона вместо иконки.
  assert.ok(!app.includes("'<button data-action=\"members\""), 'иконка участников снова в обычной строке');

  const css = await read('public/styles.css');
  assert.match(css, /\.module-card \.module-icon\{[^}]*display:grid/,
    'правило .module-card span снова перебивает плашку иконки');
  assert.match(css, /\.module-card \.module-icon svg\{/, 'иконка плитки без размера');
});

// Три поломки форм, которые видно сразу: флажок растягивался на всю
// ширину и на пятьдесят пикселей, текстовая область оставалась
// браузерной рядом со стилизованными полями, а один класс .field носил
// два смысла — сам орган и обёртка с подписью, — и обёртка перебивала
// орган: выпадающие списки выходили мельче и бледнее полей рядом.
test('a form looks like one set of controls', async () => {
  const css = await read('public/styles.css');
  assert.match(css, /\.form-stack input:not\(\[type=checkbox\]\):not\(\[type=radio\]\)/,
    'флажок снова считается полем ввода');
  assert.match(css, /\.form-stack textarea\{[^}]*resize:vertical/, 'у текстовой области нет своего правила');
  assert.doesNotMatch(css, /\n\.field\{display:flex/, 'класс .field снова носит два смысла');
  assert.match(css, /\.field-group\{display:flex/, 'обёртка с подписью осталась без имени');

  const app = await read('public/app.js');
  assert.doesNotMatch(app, /<label class="field">/, 'обёртка снова называется как орган');
});

// В светлой теме кольцо фокуса было белым: на белой поверхности контраст
// единица, и клавиатурная навигация там слепая.
test('focus is visible in both themes', async () => {
  const css = await read('public/styles.css');
  const light = await read('public/preferences.css');
  assert.match(css, /outline:2px solid var\(--focus\)/, 'обводка фокуса снова задана литералом');
  assert.match(css, /--focus:/, 'нет токена фокуса');
  assert.match(light, /html\[data-theme="light"\]\{--focus:/, 'в светлой теме фокус остался белым');
  for (const rule of ['.nav-badge', '.day-chip.today', '.modal', '.composer-button.recording']) {
    assert.ok(light.includes(`html[data-theme="light"] ${rule}`), `${rule} без пары в светлой теме`);
  }
});

// Отмена движения проигрывала по весу правилу нажатия: для кнопок без
// класса .pressable масштабирование оставалось.
test('reduced motion actually wins', async () => {
  const css = await read('public/styles.css');
  const block = css.match(/@media \(prefers-reduced-motion: reduce\)\{\n\s*button:active[^}]*\}/);
  assert.ok(block, 'нет правила, отменяющего нажатие при отключённом движении');
  assert.match(block[0], /transform:none!important/, 'отмена движения снова слабее правила нажатия');
});
