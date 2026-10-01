import { inflateSync } from 'node:zlib';

/**
 * Потолок на развёрнутый поток. Сжатый размер файла ограничен, а развёрнутый — нет: «бомба»
 * из нескольких мегабайт раскрывалась в гигабайты синхронным inflate и вешала весь сервер.
 */
const MAX_INFLATED = 32 * 1024 * 1024;

/**
 * Текст из PDF — без зависимостей.
 *
 * Договоры, акты и счета в компании ходят именно в PDF, и до сих пор
 * поиск видел у них только имя файла. Тянуть ради этого чужой
 * разбиратель в продукт с шестью зависимостями не хочется: в PDF с
 * текстовым слоем всё нужное лежит открыто — сжатый поток с командами
 * рисования и таблица соответствия кодов символам у каждого шрифта.
 *
 * Что умеем: PDF, в котором текст есть текстом. Что не умеем и чем не
 * притворяемся: сканы и файлы под паролем. В первом вместо букв
 * картинка, во втором потоки зашифрованы — такой файл честно остаётся
 * без текста в поиске.
 *
 * Оглавление (xref) не разбираем вовсе, а находим объекты перебором по
 * файлу. Так выходит короче, и заодно читаются файлы с побитым
 * оглавлением — их дописывают наживую чаще, чем кажется.
 */

/** Границы, за которые разбор не выходит: индексация не должна класть загрузку. */
const MAX_OBJECTS = 20_000;
const MAX_STREAM_BYTES = 40 * 1024 * 1024;
const MAX_CHARS = 400_000;
/**
 * Сколько времени разбор вправе занять.
 *
 * Разбираем прямо в обработчике загрузки, пока файл в руках, а сервер
 * однопоточный: договор на два десятка мегабайт держал бы всех
 * остальных секунды. Кончилось время — кладём в поиск то, что успели:
 * половина договора находится, а сервер не встаёт.
 *
 * Полсекунды хватает документу мегабайта на три — это все договоры,
 * акты и счета. Упираются в предел только многосотстраничные выгрузки
 * из бухгалтерских программ, и они попадают в поиск не целиком.
 */
const TIME_BUDGET_MS = 500;

/** Копим куски и их общую длину: складывать всё ради проверки длины — это квадрат. */
const keep = (parts, piece) => { parts.push(piece); return piece.length; };

const DELIMITER = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);
const isSpace = (char) => char === ' ' || char === '\n' || char === '\r'
  || char === '\t' || char === '\f' || char === '\0';

/** Пропускаем пробелы и комментарии: и то и другое между лексемами ничего не значит. */
function skip(text, at) {
  let i = at;
  for (;;) {
    while (i < text.length && isSpace(text[i])) i += 1;
    if (text[i] !== '%') return i;
    while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i += 1;
  }
}

/** Строка в скобках: вложенные скобки считаем, обратный слэш экранирует. */
function readLiteral(text, at) {
  const bytes = [];
  let depth = 1;
  let i = at + 1;
  while (i < text.length && depth > 0) {
    const char = text[i];
    if (char === '\\') {
      const next = text[i + 1];
      const escape = { n: 10, r: 13, t: 9, b: 8, f: 12 }[next];
      if (escape !== undefined) { bytes.push(escape); i += 2; continue; }
      if (next >= '0' && next <= '7') {
        let digits = '';
        i += 1;
        while (digits.length < 3 && text[i] >= '0' && text[i] <= '7') { digits += text[i]; i += 1; }
        bytes.push(parseInt(digits, 8) & 0xff);
        continue;
      }
      // Слэш перед переводом строки — перенос длинной строки, не символ.
      if (next === '\n') { i += 2; continue; }
      if (next === '\r') { i += text[i + 2] === '\n' ? 3 : 2; continue; }
      bytes.push(next.charCodeAt(0)); i += 2; continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') { depth -= 1; if (depth === 0) { i += 1; break; } }
    bytes.push(char.charCodeAt(0) & 0xff);
    i += 1;
  }
  return { value: { string: Buffer.from(bytes) }, next: i };
}

/** Строка в угловых скобках: те же байты, записанные шестнадцатерично. */
function readHex(text, at) {
  let digits = '';
  let i = at + 1;
  while (i < text.length && text[i] !== '>') {
    if (/[0-9a-fA-F]/.test(text[i])) digits += text[i];
    i += 1;
  }
  if (digits.length % 2) digits += '0';
  return { value: { string: Buffer.from(digits, 'hex') }, next: i + 1 };
}

/** Имя после косой черты; #41 внутри имени — это байт. */
function readName(text, at) {
  let i = at + 1;
  let name = '';
  while (i < text.length && !isSpace(text[i]) && !DELIMITER.has(text[i])) { name += text[i]; i += 1; }
  return { value: { name: name.replace(/#([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) }, next: i };
}

/**
 * Один объект языка PDF.
 *
 * Отдельный случай — ссылка «12 0 R»: она выглядит как два числа и
 * буква, и отличить её от просто двух чисел можно только заглянув
 * вперёд.
 */
function parseObject(text, at) {
  const i = skip(text, at);
  const char = text[i];
  if (i >= text.length) return { value: null, next: i };
  if (char === '/') return readName(text, i);
  if (char === '(') return readLiteral(text, i);
  if (char === '<' && text[i + 1] === '<') {
    const dict = {};
    let cursor = i + 2;
    for (;;) {
      cursor = skip(text, cursor);
      if (text[cursor] === '>' && text[cursor + 1] === '>') return { value: { dict }, next: cursor + 2 };
      if (cursor >= text.length) return { value: { dict }, next: cursor };
      const key = parseObject(text, cursor);
      if (!key.value?.name) return { value: { dict }, next: key.next + 1 };
      const value = parseObject(text, key.next);
      dict[key.value.name] = value.value;
      cursor = value.next;
    }
  }
  if (char === '<') return readHex(text, i);
  if (char === '[') {
    const items = [];
    let cursor = i + 1;
    for (;;) {
      cursor = skip(text, cursor);
      if (text[cursor] === ']') return { value: items, next: cursor + 1 };
      if (cursor >= text.length) return { value: items, next: cursor };
      const item = parseObject(text, cursor);
      if (item.next === cursor) return { value: items, next: cursor + 1 };
      items.push(item.value);
      cursor = item.next;
    }
  }
  const token = /^[+-]?[\d.]+/.exec(text.slice(i, i + 32));
  if (token) {
    const number = Number(token[0]);
    const rest = /^\s+(\d+)\s+R\b/.exec(text.slice(i + token[0].length, i + token[0].length + 24));
    if (rest && Number.isInteger(number) && number >= 0) {
      return { value: { ref: number }, next: i + token[0].length + rest[0].length };
    }
    return { value: Number.isNaN(number) ? 0 : number, next: i + token[0].length };
  }
  const word = /^[A-Za-z*'"]+/.exec(text.slice(i, i + 32));
  if (word) {
    const value = { true: true, false: false, null: null }[word[0]] ?? { op: word[0] };
    return { value, next: i + word[0].length };
  }
  return { value: null, next: i + 1 };
}

/**
 * Предсказатель PNG.
 *
 * Тот же приём, что и в самом PNG: строка хранится как разница с
 * соседями. Встречается у сжатых оглавлений и изредка у контейнеров
 * объектов — без него они разворачиваются в мусор.
 */
function unpredict(data, columns, colours) {
  const width = columns * colours;
  const rows = Math.floor(data.length / (width + 1));
  const out = Buffer.alloc(rows * width);
  let previous = Buffer.alloc(width);
  for (let row = 0; row < rows; row += 1) {
    const kind = data[row * (width + 1)];
    const line = Buffer.from(data.subarray(row * (width + 1) + 1, (row + 1) * (width + 1)));
    for (let at = 0; at < width; at += 1) {
      const left = at >= colours ? line[at - colours] : 0;
      const up = previous[at];
      const upLeft = at >= colours ? previous[at - colours] : 0;
      if (kind === 1) line[at] = (line[at] + left) & 0xff;
      else if (kind === 2) line[at] = (line[at] + up) & 0xff;
      else if (kind === 3) line[at] = (line[at] + ((left + up) >> 1)) & 0xff;
      else if (kind === 4) {
        const estimate = left + up - upLeft;
        const dl = Math.abs(estimate - left);
        const du = Math.abs(estimate - up);
        const dul = Math.abs(estimate - upLeft);
        line[at] = (line[at] + (dl <= du && dl <= dul ? left : du <= dul ? up : upLeft)) & 0xff;
      }
    }
    line.copy(out, row * width);
    previous = line;
  }
  return out;
}

/** Документ: карта «номер объекта → разобранное значение» плюс их потоки. */
function readDocument(buffer) {
  const text = buffer.toString('latin1');
  const objects = new Map();
  const pattern = /(\d+)\s+\d+\s+obj\b/g;
  let match;
  while ((match = pattern.exec(text)) && objects.size < MAX_OBJECTS) {
    const start = match.index + match[0].length;
    const parsed = parseObject(text, start);
    const after = skip(text, parsed.next);
    let stream = null;
    if (text.startsWith('stream', after)) {
      let from = after + 'stream'.length;
      if (text[from] === '\r') from += 1;
      if (text[from] === '\n') from += 1;
      const dict = parsed.value?.dict ?? {};
      const declared = typeof dict.Length === 'number' ? dict.Length : null;
      // Длину пишут и ссылкой на другой объект — тогда ищем конец потока
      // сами. Заявленной длине тоже верим не слепо: она врёт у файлов,
      // дописанных задним числом.
      const guess = text.indexOf('endstream', from);
      const end = declared !== null && declared > 0 && from + declared <= text.length
        && (guess < 0 || Math.abs(guess - (from + declared)) <= 4) ? from + declared : guess;
      if (end > from && end - from <= MAX_STREAM_BYTES) stream = buffer.subarray(from, end);
    }
    objects.set(Number(match[1]), { value: parsed.value, stream });
  }
  return { objects, text };
}

/** Разворачиваем поток: почти всегда это deflate, иногда с предсказателем. */
function inflate(entry) {
  if (!entry?.stream) return null;
  const dict = entry.value?.dict ?? {};
  const filters = [dict.Filter].flat().filter(Boolean).map((item) => item?.name);
  if (filters.length === 0) return entry.stream;
  if (!filters.every((name) => name === 'FlateDecode')) return null;
  let data;
  try {
    data = inflateSync(entry.stream, { maxOutputLength: MAX_INFLATED });
  } catch {
    // Обрезанный поток: разворачиваем то, что успели, — для поиска
    // половина договора лучше, чем ничего.
    try { data = inflateSync(entry.stream, { finishFlush: 2, maxOutputLength: MAX_INFLATED }); } catch { return null; }
  }
  const parms = [dict.DecodeParms].flat().find((item) => item?.dict)?.dict;
  const predictor = typeof parms?.Predictor === 'number' ? parms.Predictor : 1;
  if (predictor >= 10) {
    return unpredict(data, typeof parms.Columns === 'number' ? parms.Columns : 1,
      typeof parms.Colors === 'number' ? parms.Colors : 1);
  }
  return data;
}

/**
 * Объекты, сложенные внутрь других объектов.
 *
 * С версии 1.5 словари страниц и шрифтов чаще лежат не россыпью, а
 * пачкой в одном сжатом контейнере. Без его разбора у современного PDF
 * не находится ни одной страницы.
 */
function expandContainers(document) {
  for (const [, entry] of [...document.objects]) {
    if (entry.value?.dict?.Type?.name !== 'ObjStm') continue;
    const data = inflate(entry);
    if (!data) continue;
    const inner = data.toString('latin1');
    const count = entry.value.dict.N;
    const first = entry.value.dict.First;
    if (typeof count !== 'number' || typeof first !== 'number') continue;
    const header = inner.slice(0, first).trim().split(/\s+/).map(Number);
    for (let index = 0; index < count && index * 2 + 1 < header.length; index += 1) {
      const number = header[index * 2];
      const offset = header[index * 2 + 1];
      if (!Number.isInteger(number) || !Number.isInteger(offset)) continue;
      if (document.objects.has(number)) continue;
      document.objects.set(number, { value: parseObject(inner, first + offset).value, stream: null });
    }
  }
}

const resolve = (document, value) => (value && typeof value === 'object' && 'ref' in value
  ? document.objects.get(value.ref)?.value ?? null : value);

/**
 * Таблица «код → символ» из ToUnicode.
 *
 * Внутри потока рисования буквы записаны не буквами, а номерами
 * начертаний в шрифте: у одного файла «Акт» — это коды 3, 12, 5. Что
 * значит каждый код, знает только эта таблица, и без неё из PDF
 * вытаскивается набор случайных знаков.
 */
function readToUnicode(data) {
  const text = data.toString('latin1');
  const map = new Map();
  let wide = false;
  for (const range of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const item of range[1].matchAll(/<([0-9a-fA-F]+)>/g)) if (item[1].length > 2) wide = true;
  }
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const items = [...block[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((item) => item[1]);
    for (let at = 0; at + 1 < items.length; at += 2) {
      if (items[at].length > 2) wide = true;
      map.set(parseInt(items[at], 16), hexToText(items[at + 1]));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1];
    // Диапазон с перечислением: <00> <02> [<0410> <0411> <0412>].
    const listed = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g;
    const covered = [];
    let item;
    while ((item = listed.exec(body))) {
      covered.push([item.index, item.index + item[0].length]);
      if (item[1].length > 2) wide = true;
      const from = parseInt(item[1], 16);
      const list = [...item[3].matchAll(/<([0-9a-fA-F]+)>/g)];
      list.forEach((entry, shift) => map.set(from + shift, hexToText(entry[1])));
    }
    const plain = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    while ((item = plain.exec(body))) {
      if (covered.some(([start, end]) => item.index >= start && item.index < end)) continue;
      if (item[1].length > 2) wide = true;
      const from = parseInt(item[1], 16);
      const to = parseInt(item[2], 16);
      const base = hexToText(item[3]);
      const last = base.codePointAt(base.length - 1) ?? 0;
      for (let code = from; code <= to && code - from < 65_536; code += 1) {
        map.set(code, base.slice(0, -1) + String.fromCodePoint(last + (code - from)));
      }
    }
  }
  return { map, wide };
}

/** Значение в ToUnicode — это UTF-16BE, иногда из нескольких символов. */
function hexToText(hex) {
  const even = hex.length % 4 ? hex.padStart(Math.ceil(hex.length / 4) * 4, '0') : hex;
  let out = '';
  for (let at = 0; at + 3 < even.length; at += 4) out += String.fromCharCode(parseInt(even.slice(at, at + 4), 16));
  return out;
}

/**
 * Ширины начертаний, в тысячных долях кегля.
 *
 * Нужны не для вида, а чтобы понять, где в тексте пробел. В файле его
 * обычно нет: слова просто нарисованы на своих местах. Отличить «конец
 * слова» от «чуть поджали буквы» можно только зная, сколько места
 * буква должна была занять.
 */
function readWidths(document, font) {
  const widths = new Map();
  let fallback = 500;
  const descendant = resolve(document, [font.DescendantFonts].flat()[0]);
  const cid = resolve(document, descendant)?.dict;
  if (cid) {
    if (typeof cid.DW === 'number') fallback = cid.DW;
    else fallback = 1000;
    const list = resolve(document, cid.W);
    if (Array.isArray(list)) {
      for (let at = 0; at < list.length;) {
        const first = resolve(document, list[at]);
        const second = resolve(document, list[at + 1]);
        if (Array.isArray(second)) {
          second.forEach((width, shift) => {
            if (typeof width === 'number') widths.set(first + shift, width);
          });
          at += 2;
        } else if (typeof second === 'number' && typeof list[at + 2] === 'number') {
          for (let code = first; code <= second && code - first < 65_536; code += 1) widths.set(code, list[at + 2]);
          at += 3;
        } else at += 1;
      }
    }
    return { widths, fallback };
  }
  const list = resolve(document, font.Widths);
  const first = typeof font.FirstChar === 'number' ? font.FirstChar : 0;
  if (Array.isArray(list)) {
    list.forEach((width, shift) => {
      const value = resolve(document, width);
      if (typeof value === 'number') widths.set(first + shift, value);
    });
  }
  const descriptor = resolve(document, font.FontDescriptor)?.dict;
  if (typeof descriptor?.MissingWidth === 'number') fallback = descriptor.MissingWidth;
  return { widths, fallback };
}

/**
 * Шрифты страницы: имя в потоке рисования → как читать его коды.
 *
 * Без ToUnicode берём коды как байты латиницы — для английского
 * договора этого хватает, а для русского без таблицы взять нечего, и
 * такой шрифт мы пропускаем, чтобы не сыпать в поиск бессмыслицу.
 */
function readFonts(document, resources) {
  const fonts = new Map();
  const dictionary = resolve(document, resources)?.dict?.Font;
  const entries = resolve(document, dictionary)?.dict;
  if (!entries) return fonts;
  for (const [alias, reference] of Object.entries(entries)) {
    const font = resolve(document, reference)?.dict;
    if (!font) continue;
    const identity = font.Encoding?.name?.startsWith('Identity') ?? false;
    const target = font.ToUnicode && typeof font.ToUnicode === 'object' && 'ref' in font.ToUnicode
      ? document.objects.get(font.ToUnicode.ref) : null;
    const data = target ? inflate(target) ?? target.stream : null;
    const table = data ? readToUnicode(data) : null;
    fonts.set(alias, {
      map: table?.map ?? null,
      wide: (table?.wide ?? false) || identity,
      ...readWidths(document, font),
    });
  }
  return fonts;
}

/** Умножение на сдвиг слева: так PDF двигает перо и строку. */
const shift = (dx, dy, m) => [m[0], m[1], m[2], m[3],
  dx * m[0] + dy * m[2] + m[4], dx * m[1] + dy * m[3] + m[5]];

/**
 * Читаем поток рисования и собираем из него слова.
 *
 * Пробелов в PDF нет: каждое слово нарисовано на своём месте, а между
 * ними — сдвиг пера. Поэтому ведём перо сами: знаем, где оно стоит и
 * сколько занимает каждая буква, и ставим пробел, когда следующая
 * буква начинается заметно дальше, чем кончилась предыдущая.
 * Строкой ниже — тоже пробел.
 */
function readContent(data, fonts, deadline = Infinity) {
  const text = data.toString('latin1');
  const parts = [];
  const stack = [];
  let font = null;
  let size = 0;
  let charSpace = 0;
  let wordSpace = 0;
  let scale = 1;
  let leading = 0;
  let matrix = [1, 0, 0, 1, 0, 0];
  let line = [1, 0, 0, 1, 0, 0];
  let pen = null;
  let cursor = 0;
  let taken = 0;

  /** Пробел, если перо ушло от места, где кончилась прошлая буква. */
  const gap = () => {
    if (!pen) return;
    const unit = (size * (Math.hypot(matrix[0], matrix[1]) || 1)) || 1;
    const dy = matrix[5] - pen.y;
    const dx = matrix[4] - pen.x;
    // Вниз или вверх — новая строка. Вправо на пятую часть кегля — уже
    // просвет между словами, а не поджатые буквы. Назад — новая
    // колонка или перерисовка поверх.
    if (Math.abs(dy) > unit * 0.3 || dx > unit * 0.2 || dx < -unit * 0.5) taken += keep(parts, ' ');
  };

  const show = (bytes) => {
    if (!bytes?.length) return;
    gap();
    const step = font?.wide ? 2 : 1;
    for (let at = 0; at + step - 1 < bytes.length; at += step) {
      const code = step === 2 ? (bytes[at] << 8) | bytes[at + 1] : bytes[at];
      if (font?.map) {
        const mapped = font.map.get(code);
        // Код без соответствия — начертание, которое шрифт не объявил:
        // пропускаем, а не выдумываем.
        if (mapped !== undefined) taken += keep(parts, mapped);
      } else if (!font?.wide) taken += keep(parts, String.fromCharCode(code));
      const width = (font?.widths?.get(code) ?? font?.fallback ?? 500) / 1000;
      const advance = (width * size + charSpace + (code === 32 && step === 1 ? wordSpace : 0)) * scale;
      matrix = shift(advance, 0, matrix);
    }
    pen = { x: matrix[4], y: matrix[5] };
  };

  const nextLine = (dx, dy) => { line = shift(dx, dy, line); matrix = line.slice(); };

  let checked = 0;
  while (cursor < text.length && taken < MAX_CHARS) {
    // Часы дороги, чтобы смотреть на них после каждой лексемы.
    if ((checked += 1) % 4096 === 0 && Date.now() > deadline) break;
    const parsed = parseObject(text, cursor);
    if (parsed.next <= cursor) { cursor += 1; continue; }
    cursor = parsed.next;
    const operator = parsed.value?.op;
    if (!operator) {
      if (parsed.value !== null) stack.push(parsed.value);
      if (stack.length > 64) stack.shift();
      continue;
    }
    const number = (back) => (typeof stack[stack.length - back] === 'number' ? stack[stack.length - back] : 0);
    if (operator === 'Tf') { font = fonts.get(stack[stack.length - 2]?.name) ?? null; size = number(1); }
    else if (operator === 'Tc') charSpace = number(1);
    else if (operator === 'Tw') wordSpace = number(1);
    else if (operator === 'Tz') scale = (number(1) || 100) / 100;
    else if (operator === 'TL') leading = number(1);
    else if (operator === 'Td') nextLine(number(2), number(1));
    else if (operator === 'TD') { leading = -number(1); nextLine(number(2), number(1)); }
    else if (operator === 'T*') nextLine(0, -leading);
    else if (operator === 'Tm') {
      line = [number(6), number(5), number(4), number(3), number(2), number(1)];
      matrix = line.slice();
    } else if (operator === 'BT') { line = [1, 0, 0, 1, 0, 0]; matrix = line.slice(); pen = null; }
    else if (operator === 'Tj') show(stack[stack.length - 1]?.string);
    else if (operator === "'") { nextLine(0, -leading); show(stack[stack.length - 1]?.string); }
    else if (operator === '"') {
      wordSpace = number(3);
      charSpace = number(2);
      nextLine(0, -leading);
      show(stack[stack.length - 1]?.string);
    } else if (operator === 'TJ') {
      const items = stack[stack.length - 1];
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item?.string) show(item.string);
          // Сдвиг в тысячных долях кегля: двигаем перо, а пробел
          // поставится сам, если просвет окажется заметным.
          else if (typeof item === 'number') matrix = shift(-item / 1000 * size * scale, 0, matrix);
        }
      }
    } else if (operator === 'ET') { taken += keep(parts, ' '); pen = null; }
    stack.length = 0;
  }
  return parts.join('');
}

/**
 * Текст документа или null, если текста в нём нет.
 *
 * Пустой ответ здесь — это обычно скан: букв в файле нет, есть
 * картинка. Отдельного разговора он не требует, просто не находится по
 * содержимому.
 */
export function extractPdfText(buffer, { deadline = Date.now() + TIME_BUDGET_MS } = {}) {
  if (!buffer || buffer.length < 8 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return null;
  const document = readDocument(buffer);
  // Файл под паролем: потоки зашифрованы, и разворачивать их нечем.
  // Молча выдать мусор хуже, чем не выдать ничего.
  if ([...document.objects.values()].some((entry) => entry.value?.dict?.Encrypt)) return null;
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(document.text.slice(-4096))) return null;
  expandContainers(document);
  const pages = [...document.objects.entries()]
    .filter(([, entry]) => entry.value?.dict?.Type?.name === 'Page')
    .sort((left, right) => left[0] - right[0]);
  const parts = [];
  let taken = 0;
  for (const [, page] of pages) {
    if (taken > MAX_CHARS || Date.now() > deadline) break;
    const fonts = readFonts(document, page.value.dict.Resources);
    for (const reference of [page.value.dict.Contents].flat().filter(Boolean)) {
      const entry = typeof reference === 'object' && 'ref' in reference
        ? document.objects.get(reference.ref) : null;
      const data = inflate(entry);
      if (data) taken += keep(parts, readContent(data, fonts, deadline));
    }
  }
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
  return joined.length >= 2 ? joined : null;
}
