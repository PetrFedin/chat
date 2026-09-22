import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { extractPdfText } from '../src/search/pdf-text.js';
import { extractText, indexable } from '../src/search/file-text.js';

/**
 * PDF собираем здесь руками, а не берём готовым файлом.
 *
 * Готовый файл в наборе — это чёрный ящик: когда разбор сломается,
 * из «не совпало» не будет видно, что именно. Здесь каждый кусок
 * написан явно, и падение показывает пальцем.
 */
function pdf(objects, { trailer = '' } = {}) {
  const raw = (part) => (Buffer.isBuffer(part) ? part : Buffer.from(String(part), 'latin1'));
  const parts = [raw('%PDF-1.7\n')];
  // Тело объекта склеиваем буферами, а не строками: сжатый поток —
  // двоичный, и подстановка в шаблон перекодирует его в UTF-8.
  objects.forEach((body, index) => parts.push(
    raw(`${index + 1} 0 obj\n`), raw(body), raw('\nendobj\n')));
  parts.push(raw(`trailer\n<< /Root 1 0 R ${trailer} >>\n%%EOF\n`));
  return Buffer.concat(parts);
}

const stream = (dict, data) => Buffer.concat([
  Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'),
  Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1'),
  Buffer.from('\nendstream', 'latin1'),
]);

/** Страница с одним потоком рисования и одним шрифтом. */
const page = (fontRef = 4) => `<< /Type /Page /Parent 2 0 R /Contents 5 0 R `
  + `/Resources << /Font << /F1 ${fontRef} 0 R >> >> >>`;

/**
 * Латинский договор в простом шрифте.
 *
 * Простой шрифт не объявляет соответствия кодов символам: байты в
 * строке — это и есть буквы. Проверяем заодно, что разбор отличает
 * просвет между словами от поджатых букв: -400 это пробел, -50 —
 * кернинг внутри слова.
 */
test('простой шрифт: пробел ставится по просвету, а не по любому сдвигу', () => {
  const content = 'BT /F1 12 Tf 72 720 Td [(Act) -400 (of) -400 (work)] TJ '
    + '0 -14 Td [(SG-1) -50 (14)] TJ ET';
  const file = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    page(),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('', content),
  ]);
  assert.equal(extractPdfText(file), 'Act of work SG-114');
});

/** Коды из ToUnicode и ширины из /W — тот случай, ради которого всё затевалось. */
const CMAP = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
6 beginbfchar
<0001> <0410>
<0002> <043A>
<0003> <0442>
<0004> <043F>
<0005> <0440>
<0006> <0438>
endbfchar
endcmap end end`;

function cyrillic(content) {
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    page(),
    '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /ToUnicode 6 0 R '
      + '/DescendantFonts [7 0 R] >>',
    stream('', content),
    stream('', CMAP),
    '<< /Type /Font /Subtype /CIDFontType2 /DW 1000 /W [1 6 500] >>',
  ]);
}

test('русский текст читается через ToUnicode, строка и колонка дают пробел', () => {
  // «Акт», ниже строкой «при», и в той же строке через широкий просвет — «тир».
  const content = 'BT /F1 12 Tf 72 720 Td <000100020003> Tj '
    + '0 -14 Td <000400050006> Tj 40 0 Td <000300060005> Tj ET';
  assert.equal(extractPdfText(cyrillic(content)), 'Акт при тир');
});

test('код, которого нет в таблице шрифта, не превращается в мусор', () => {
  const content = 'BT /F1 12 Tf 72 720 Td <0001009900020003> Tj ET';
  assert.equal(extractPdfText(cyrillic(content)), 'Акт');
});

/**
 * Современный PDF прячет словари в сжатый контейнер, а поток рисования
 * сжимает. Без разбора и того и другого не находится ни одной страницы.
 */
test('сжатый поток и объекты внутри контейнера разбираются', () => {
  // Страница и шрифт лежат не в файле, а внутри объекта 3: номера у
  // них свои (5 и 6), и снаружи этих объектов нет вовсе.
  const inside = '<< /Type /Page /Parent 2 0 R /Contents 4 0 R '
    + '/Resources << /Font << /F1 6 0 R >> >> >>';
  const offsets = `5 0 6 ${inside.length + 1}`;
  const first = offsets.length + 1;
  const packed = deflateSync(Buffer.from(
    `${offsets}\n${inside}\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`, 'latin1'));
  const file = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
    stream(`/Type /ObjStm /N 2 /First ${first} /Filter /FlateDecode`, packed),
    stream('/Filter /FlateDecode', deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td (Packed) Tj ET', 'latin1'))),
  ]);
  assert.equal(extractPdfText(file), 'Packed');
});

/**
 * Скан — это страница с картинкой и без единой буквы. Такой файл не
 * должен ни падать, ни делать вид, что что-то нашёл: пустой ответ и
 * есть честный.
 */
test('скан без текстового слоя остаётся без текста', () => {
  const file = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Contents 5 0 R /Resources << /XObject << /Im0 4 0 R >> >> >>',
    stream('/Type /XObject /Subtype /Image /Width 8 /Height 8', Buffer.alloc(64, 0xff)),
    stream('', 'q 595 0 0 842 0 0 cm /Im0 Do Q'),
  ]);
  assert.equal(extractPdfText(file), null);
});

/**
 * Файл под паролем. Потоки в нём зашифрованы, и развернуть их нечем:
 * выдать оттуда «текст» значит засыпать поиск двоичным мусором.
 */
test('файл под паролем не индексируется', () => {
  const file = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    page(),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('', 'BT /F1 12 Tf 72 720 Td (Secret) Tj ET'),
    '<< /Filter /Standard /V 2 /R 3 >>',
  ], { trailer: '/Encrypt 6 0 R' });
  assert.equal(extractPdfText(file), null);
});

/**
 * Битый файл — это файл без текста в поиске, а не отказ его загрузить.
 * Ни один из этих вызовов не вправе бросить.
 */
test('обрывки и подделки не роняют разбор', () => {
  const good = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    page(),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('', 'BT /F1 12 Tf 72 720 Td (Half) Tj ET'),
  ]);
  assert.equal(extractPdfText(null), null);
  assert.equal(extractPdfText(Buffer.alloc(0)), null);
  assert.equal(extractPdfText(Buffer.from('это вовсе не pdf')), null);
  assert.equal(extractPdfText(Buffer.from('%PDF-1.7\n')), null);
  // Оборванная половина: заголовок на месте, объекты кончились посередине.
  assert.equal(extractPdfText(good.subarray(0, Math.floor(good.length / 2))), null);
  // Незакрытые скобки и словари внутри объекта.
  assert.equal(extractPdfText(Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Page /Contents (\nendobj\n')), null);
});

/**
 * Разбор идёт в обработчике загрузки, а сервер однопоточный: без
 * предела по времени толстый файл задержал бы всех остальных.
 */
test('разбор укладывается в отведённое время', () => {
  const file = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    page(),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    // Много страниц текста в одном потоке — столько, что за нулевое
    // время его не прочесть.
    stream('', `BT /F1 12 Tf ${'72 720 Td (Line of a long contract) Tj '.repeat(20_000)}ET`),
  ]);
  const started = Date.now();
  assert.equal(extractPdfText(file, { deadline: started - 1 }), null, 'вышедшее время не остановило разбор');
  assert.ok(Date.now() - started < 1000, `разбор занял ${Date.now() - started} мс вместо отведённого`);
  // Со временем тот же файл читается целиком.
  assert.match(extractPdfText(file), /Line of a long contract/);
});

test('PDF признан разбираемым и проходит через общий вход', () => {
  assert.equal(indexable('application/pdf', 'акт.pdf'), 'pdf');
  assert.equal(indexable(null, 'акт.PDF'), 'pdf');
  const file = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    page(),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('', 'BT /F1 12 Tf 72 720 Td (Contract) Tj ET'),
  ]);
  assert.equal(extractText(file, { mimeType: 'application/pdf', name: 'акт.pdf' }), 'Contract');
  assert.equal(extractText(Buffer.from('не pdf'), { mimeType: 'application/pdf', name: 'акт.pdf' }), null);
});
