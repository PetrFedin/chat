import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const channel = (value) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const tokenOf = (css, block, name) => {
  const scope = block ? css.slice(css.indexOf(block)) : css;
  const match = scope.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `токен --${name} не найден`);
  return match[1].toLowerCase();
};

// The quiet text tiers used to sit at 2.6:1–3.9:1, below the 4.5:1 that WCAG AA
// asks of body text. They carry real copy — kickers, timestamps, weekday
// headers — so they are held to the text bar, not the large-text one.
test('muted text tiers clear 4.5:1 on every ground they sit on', async () => {
  const [dark, light] = await Promise.all([read('public/styles.css'), read('public/preferences.css')]);

  const grounds = {
    dark: ['#151719', '#050505', '#1b1e21', '#222529'],
    light: ['#ffffff', '#f4f4f2', '#f0f0ed', '#e9e9e5'],
  };
  const tiers = [
    ['тёмная --muted', tokenOf(dark, null, 'muted'), grounds.dark],
    ['тёмная --muted-2', tokenOf(dark, null, 'muted-2'), grounds.dark],
    ['светлая --muted', tokenOf(light, 'html[data-theme="light"]', 'muted'), grounds.light],
    ['светлая --muted-2', tokenOf(light, 'html[data-theme="light"]', 'muted-2'), grounds.light],
  ];

  for (const [label, colour, backgrounds] of tiers) {
    for (const background of backgrounds) {
      const ratio = contrast(colour, background);
      assert.ok(ratio >= 4.5, `${label} (${colour}) на ${background}: ${ratio.toFixed(2)}:1`);
    }
  }

  // Two tiers that resolve to the same colour are one tier. The visual
  // hierarchy has to survive the contrast fix.
  assert.notEqual(tiers[0][1], tiers[1][1], 'тёмные --muted и --muted-2 совпали');
  assert.notEqual(tiers[2][1], tiers[3][1], 'светлые --muted и --muted-2 совпали');

  // The warm chip carries its own colour rather than a muted token, and it
  // sat at 4.49:1 on its own tinted ground after the tokens were fixed.
  const warmLight = light.match(/\.chip\.warm\{color:(#[0-9a-f]{6})\}/)[1];
  const warmSoftLight = tokenOf(light, 'html[data-theme="light"]', 'warm-soft');
  assert.ok(contrast(warmLight, warmSoftLight) >= 4.5,
    `светлая .chip.warm: ${contrast(warmLight, warmSoftLight).toFixed(2)}:1`);
  const warmDark = dark.match(/\.chip\.warm\{background:var\(--warm-soft\);color:(#[0-9a-f]{6})\}/)[1];
  const warmSoftDark = tokenOf(dark, null, 'warm-soft');
  assert.ok(contrast(warmDark, warmSoftDark) >= 4.5,
    `тёмная .chip.warm: ${contrast(warmDark, warmSoftDark).toFixed(2)}:1`);
});

const HOLE = '\u0000';

/**
 * Раньше `${...}` целиком заменялось одной дырой — и любой текст внутри
 * вложенного шаблонного литерала (`${cond?`<span>Текст</span>`:''}`,
 * ровно то, чем построена половина условных плиток «Ещё») становился
 * невидимым для проверки: строка без перевода пряталась внутри чужого
 * `${}` и тест зеленел, ничего не проверив. «База знаний» и «Журнал»
 * молчали по-русски при английской локали именно поэтому.
 *
 * Рекурсивный разбор находит вложенные шаблонные литералы внутри
 * интерполяции и продолжает искать текст в них тоже — дырой остаётся
 * только код выражения снаружи вложенных шаблонов (сам `cond?`, а не
 * то, что он выбирает).
 */
function skipTemplateLiteral(source, start) {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === '`') return i + 1;
    if (source[i] === '$' && source[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        if (source[i] === '`') { i = skipTemplateLiteral(source, i); continue; }
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') depth -= 1;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return i;
}

function processTemplateBody(body) {
  let out = '';
  let i = 0;
  while (i < body.length) {
    if (body[i] === '$' && body[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < body.length && depth > 0) {
        if (body[j] === '`') { j = skipTemplateLiteral(body, j); continue; }
        if (body[j] === '{') depth += 1;
        else if (body[j] === '}') depth -= 1;
        j += 1;
      }
      const expr = body.slice(i + 2, j - 1);
      out += HOLE + stripInterpolations(expr) + HOLE;
      i = j;
      continue;
    }
    out += body[i];
    i += 1;
  }
  return out;
}

const stripInterpolations = (source) => {
  let out = '';
  let i = 0;
  while (i < source.length) {
    if (source[i] === '`') {
      const end = skipTemplateLiteral(source, i);
      out += processTemplateBody(source.slice(i + 1, end - 1));
      i = end;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
};

/**
 * Стрелочная функция вне разметки (`()=>modal('Название', ...)`) даёт
 * голый `>`, который потом сходится с первым же `<` из настоящей
 * разметки внутри и тест читает JS-код как текст интерфейса. `=>`
 * никогда не встречается в самой прозе — снимается один раз перед
 * разбором, а не только внутри интерполяций, потому что такой код
 * бывает и снаружи всех шаблонных литералов файла.
 */
const stripArrows = (source) => source.replace(/=>/g, HOLE);

// Strings the dictionary must not swallow: a product name, or a single letter
// that is an avatar placeholder rather than prose.
const NOT_PROSE = new Set(['Chat', 'LIVE', 'Email', 'П']);

test('every Russian string the shell renders has an English counterpart', async () => {
  // meeting-intelligence.js и meeting-operations.js не входят сюда: они
  // переводятся своим tr(ru,en) на месте вызова, а не наблюдателем по
  // словарю, — и проверяются отдельным тестом ниже. Остальные экраны
  // (ежедневная работа, звонки, демо-режим, общий bootstrap) устроены
  // так же, как app.js, — и настолько же нуждаются в этой проверке;
  // до этой правки её не проходил ни один из них.
  const [prefs, app, html, dailyWork, callsUi, demo, sharedBootstrap] = await Promise.all([
    read('public/preferences.js'),
    read('public/app.js'),
    read('public/index.html'),
    read('public/daily-work.js'),
    read('public/calls-ui.js'),
    read('public/demo.js'),
    read('public/shared-bootstrap.js'),
  ]);

  const start = prefs.indexOf('const translations = new Map(Object.entries({');
  const dictionary = prefs.slice(start, prefs.indexOf('}));', start));
  const keys = [...dictionary.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)].map((m) => m[1]);
  assert.equal(new Set(keys).size, keys.length, 'в словаре есть дублирующиеся ключи');
  const known = new Set(keys);

  const cyrillic = /[А-Яа-яЁё]/;
  const missing = [];
  for (const [name, source] of [['app.js', app], ['index.html', html], ['daily-work.js', dailyWork], ['calls-ui.js', callsUi], ['demo.js', demo], ['shared-bootstrap.js', sharedBootstrap]]) {
    const text = stripArrows(stripInterpolations(source));
    const candidates = [
      ...[...text.matchAll(/>([^<>]*)</g)].map((m) => m[1]),
      ...[...text.matchAll(/(?:aria-label|title|placeholder)="([^"]*)"/g)].map((m) => m[1]),
      // Labels passed as arguments carry no tags around them, so the scan
      // above never sees them. The person card is built entirely this way.
      ...[...text.matchAll(/\bfield\('([^']*)'/g)].map((m) => m[1]),
    ];
    for (const raw of candidates) {
      const value = raw.trim();
      if (!value || value.includes(HOLE) || value.includes('\n')) continue;
      // A `>` in JS code (`=>`) opens a span the tag scanner reads as element
      // text. Prose in this shell never carries these characters.
      if (/[;{}`]/.test(value)) continue;
      if (!cyrillic.test(value) || known.has(value) || NOT_PROSE.has(value)) continue;
      missing.push(`${name}: ${value}`);
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'строки без перевода');
});

test('the Russian interface does not print English at the user', async () => {
  const [app, prefs, intelligence, operations] = await Promise.all([
    read('public/app.js'),
    read('public/preferences.js'),
    read('public/meeting-intelligence.js'),
    read('public/meeting-operations.js'),
  ]);

  for (const [name, source] of [['app.js', app], ['preferences.js', prefs]]) {
    assert.doesNotMatch(source, /screen share/i, `${name}: английский внутри русской копии`);
    assert.doesNotMatch(source, />Focus time</, `${name}: английский внутри русской копии`);
  }

  // The kickers were literal English headings above Russian titles.
  assert.doesNotMatch(intelligence, /"mi-kicker"[^>]*>MEETING/);
  assert.doesNotMatch(operations, /"mi-kicker">(MEETING|AUDIT)/);
  assert.match(intelligence, /data-mi-kicker="intelligence"/);
  // The operations panel used to find that header by its English text.
  assert.match(operations, /\[data-mi-kicker="intelligence"\]/);
  assert.doesNotMatch(operations, /kicker!=='MEETING INTELLIGENCE'/);

  // A raw server sentence must not outrank the localized copy in Russian.
  assert.match(operations, /locale\(\)==='en'&&worker\?\.reason\?worker\.reason:fallback/);
});

// Every activity sentence the server composes is shown verbatim on a person's
// page, so the client dictionary has to carry all of them.
/**
 * Подписи журнала — тоже текст для человека.
 *
 * Их сорок пять, они живут в коде оболочки списком, и переводились
 * раньше только четыре: в английском режиме журнал наполовину
 * оставался русским. Мимо общей проверки они проходят потому, что
 * лежат в массиве, а не между тегами.
 */
test('подписи журнала все переведены', async () => {
  const [app, prefs] = await Promise.all([read('public/app.js'), read('public/preferences.js')]);
  const block = app.slice(app.indexOf('const JOURNAL_EVENT={'));
  const labels = [...block.slice(0, block.indexOf('\n};')).matchAll(/^\s*'[a-z0-9_.]+':\['([^']+)'/gm)].map((m) => m[1]);
  assert.ok(labels.length >= 40, `подписей журнала найдено всего ${labels.length}`);
  for (const label of labels) {
    assert.ok(prefs.includes(`    '${label}':`), `нет перевода для «${label}»`);
  }
});

test('server-sent activity labels all have translations', async () => {
  const [repository, prefs] = await Promise.all([
    read('src/people/people-repository.js'),
    read('public/preferences.js'),
  ]);
  const block = repository.slice(repository.indexOf('ACTIVITY_LABEL'));
  const labels = [...block.slice(0, block.indexOf('};')).matchAll(/'[a-z.]+': '([^']+)'/g)].map((m) => m[1]);
  assert.ok(labels.length >= 6, 'метки активности не найдены');
  for (const label of labels) {
    assert.ok(prefs.includes(`    '${label}':`), `нет перевода для «${label}»`);
  }
});

// «3 участников» по-русски не говорят. Правило со вторым десятком:
// одиннадцать участников, но двадцать один участник.
test('counted nouns agree with their number everywhere', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const [app, meetings] = await Promise.all([read('public/app.js'), read('public/meeting-intelligence.js')]);

  assert.match(meetings, /const plural=\(n,one,few,many\)=>/, 'в модуле встреч нет правила склонения');
  assert.match(meetings, /plural\(\(call\.participants\|\|\[\]\)\.length,'участник','участника','участников'\)/);
  assert.match(meetings, /plural\(c\.decisions,'решение','решения','решений'\)/);
  assert.match(meetings, /plural\(c\.actions,'действие','действия','действий'\)/);

  // Правило второго десятка — то место, где обычно ошибаются.
  const rule = app.match(/function plural\(n,one,few,many\)\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(rule, /11|tens/, 'исключение для второго десятка потеряно');
});
