import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatServer } from '../src/server.js';
import { createZipWriter } from '../src/export/zip.js';
import { listZip, readZipFile } from '../src/export/unzip.js';
import { extractText, indexable } from '../src/search/file-text.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Собираем настоящий docx: zip с одним XML внутри. */
async function makeDocx(paragraphs) {
  const chunks = [];
  const sink = { write(chunk) { chunks.push(Buffer.from(chunk)); return true; }, on() {}, once() {} };
  const zip = createZipWriter(sink);
  await zip.add('[Content_Types].xml', '<Types/>');
  await zip.add('word/document.xml',
    `<w:document><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  await zip.finish();
  return Buffer.concat(chunks);
}

/**
 * Настоящий PDF с текстовым слоем.
 *
 * Буквы в PDF лежат номерами начертаний, а что значит номер — знает
 * только таблица ToUnicode. Собираем её здесь по самому тексту: так
 * файл выходит такой же, какой даёт любой печатающий в PDF.
 */
function makePdf(text) {
  const codes = [...text];
  const cmap = `begincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n`
    + `${codes.length} beginbfchar\n`
    + codes.map((char, at) => `<${(at + 1).toString(16).padStart(4, '0')}> `
      + `<${char.codePointAt(0).toString(16).padStart(4, '0')}>`).join('\n')
    + `\nendbfchar\nendcmap`;
  const show = codes.map((_, at) => (at + 1).toString(16).padStart(4, '0')).join('');
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>',
    '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /ToUnicode 6 0 R /DescendantFonts [7 0 R] >>',
    `<< /Length 60 >>\nstream\nBT /F1 12 Tf 72 720 Td <${show}> Tj ET\nendstream`,
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
    '<< /Type /Font /Subtype /CIDFontType2 /DW 500 >>',
  ];
  return Buffer.from(`%PDF-1.7\n${bodies.map((body, at) => `${at + 1} 0 obj\n${body}\nendobj\n`).join('')}`
    + 'trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');
}

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'idempotency-key': crypto.randomUUID(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

/** Читаем свой же архив: если писатель и читатель разойдутся, поиск ослепнет молча. */
test('читатель ZIP разбирает то, что пишет писатель', async () => {
  const docx = await makeDocx(['Акт приёмки щебня']);
  const names = listZip(docx).map((entry) => entry.name);
  assert.deepEqual(names, ['[Content_Types].xml', 'word/document.xml']);
  assert.match(readZipFile(docx, 'word/document.xml').toString('utf8'), /щебня/);
  assert.equal(readZipFile(docx, 'нет-такого.xml'), null);
});

test('текст достаётся из docx и простого текста, и не достаётся из картинки', async () => {
  const docx = await makeDocx(['Акт приёмки щебня', 'Объём 40 кубов']);
  // Границы абзацев — это границы слов: иначе «щебняОбъём».
  assert.equal(extractText(docx, { mimeType: DOCX, name: 'акт.docx' }), 'Акт приёмки щебня Объём 40 кубов');
  assert.equal(extractText(Buffer.from('Смета   по\nСГ-114'), { mimeType: 'text/plain', name: 'a.txt' }), 'Смета по СГ-114');

  assert.equal(indexable('application/pdf', 'акт.pdf'), 'pdf');
  // Скан — тот же PDF, но без букв: он остаётся без текста, и это
  // проверяется отдельно, в test/pdf-text.test.js.
  assert.equal(indexable('image/tiff', 'скан.tif'), null, 'скан не должен притворяться разобранным');
  assert.equal(extractText(Buffer.from('89504e470d0a1a0a', 'hex'), { mimeType: 'image/png', name: 'a.png' }), null);
  // Двоичное, назвавшееся текстом: нулевой байт — верный признак.
  assert.equal(extractText(Buffer.from([0x41, 0x00, 0x42]), { mimeType: 'text/plain', name: 'a.txt' }), null);
  // Сломанный архив не должен ронять загрузку файла.
  assert.equal(extractText(Buffer.from('это не zip'), { mimeType: DOCX, name: 'x.docx' }), null);
});

/**
 * Поиск видел только имена файлов: «акт.docx» находился, слово
 * «щебень» из него — нет. В компании, где договоры и акты и есть
 * работа, это значит искать памятью.
 */
test('слово из документа находится, и находка показывает, где именно',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const uploads = await mkdtemp(join(tmpdir(), 'search-'));
  const app = await createChatServer({ databaseUrl: DATABASE_URL, uploadsRoot: uploads, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(uploads, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const word = `щебень${suffix}`;

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Поиск ${suffix}`, ownerName: 'Владелец', email: `fs-${suffix}@t.test`, password: 'OwnerPassword42' },
  });

  const upload = (name, type, body) => fetch(`${base}/api/v1/files`, {
    method: 'POST',
    headers: { cookie: owner.cookie, 'content-type': type, 'x-file-name': encodeURIComponent(name) },
    body,
  }).then((response) => response.json().then((payload) => ({ status: response.status, file: payload.file })));

  const docx = await makeDocx([`Акт приёмки ${word} фракции 20-40`, 'Объект СГ-114']);
  const act = await upload('скан-сентябрь.docx', DOCX, docx);
  assert.equal(act.status, 201);
  // Картинку тоже кладём: она не должна найтись по слову.
  await upload('фото.png', 'image/png', Buffer.from('89504e470d0a1a0a', 'hex'));

  // И договор в PDF — с тем же словом внутри и ничего не говорящим именем.
  const contract = await upload('doc-2026-09.pdf', 'application/pdf',
    makePdf(`Договор поставки ${word} объёмом 40 кубов`));
  assert.equal(contract.status, 201);

  const hits = (await request(base, `/api/v1/search?q=${encodeURIComponent(word)}`, { cookie: owner.cookie }))
    .payload.items.filter((item) => item.type === 'file');
  assert.equal(hits.length, 2, 'по слову внутри нашлись не оба документа');
  const found = hits.filter((item) => item.id === act.file.id);
  assert.equal(found.length, 1, 'документ не нашёлся по слову внутри');
  assert.equal(found[0].insideFile, true);

  // PDF — тот случай, ради которого всё и затевалось: по имени
  // «doc-2026-09.pdf» понять, тот ли это договор, нельзя.
  const pdfHit = hits.find((item) => item.id === contract.file.id);
  assert.ok(pdfHit, 'PDF не нашёлся по слову внутри');
  assert.equal(pdfHit.insideFile, true);
  assert.match(pdfHit.snippet, new RegExp(word));
  // Кусок текста вокруг слова: по имени «скан-сентябрь.docx» понять, то
  // ли это, нельзя.
  assert.match(found[0].snippet, new RegExp(word));
  assert.match(found[0].snippet, /\u0002/, 'найденное слово не размечено');
  assert.equal(found[0].contentUrl, `/api/v1/files/${act.file.id}/content`);

  // Один файл — одна находка, даже когда совпало и имя, и содержимое.
  const both = (await request(base, '/api/v1/search?q=сентябрь', { cookie: owner.cookie }))
    .payload.items.filter((item) => item.type === 'file' && item.id === act.file.id);
  assert.equal(both.length, 1, 'файл показан дважды');
});

/**
 * После установки приложение не должно выглядеть пустым квадратом.
 *
 * iOS манифест не читает вовсе: значок и полноэкранный режим он берёт
 * из разметки страницы.
 */
test('манифест и разметка обещают ровно те файлы, что лежат рядом', async () => {
  const root = fileURLToPath(new URL('../public/', import.meta.url));
  const manifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'нет растровых иконок нужных размеров');
  assert.ok(manifest.icons.some((icon) => String(icon.purpose).includes('maskable')));

  for (const icon of manifest.icons) {
    const file = await readFile(join(root, icon.src.replace(/^\//, '')));
    assert.ok(file.length > 0, `${icon.src} пустой`);
    if (icon.type === 'image/png') {
      assert.deepEqual([...file.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${icon.src} не PNG`);
      const [width, height] = [file.readUInt32BE(16), file.readUInt32BE(20)];
      assert.equal(`${width}x${height}`, icon.sizes, `${icon.src} обещает не тот размер`);
    }
  }

  const html = await readFile(join(root, 'index.html'), 'utf8');
  assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  const apple = await readFile(join(root, 'apple-touch-icon.png'));
  assert.equal(apple.readUInt32BE(16), 180);

  // Всё, что обещает оболочка, должно быть на диске: не найденный файл
  // в списке рушит установку служебного сценария целиком.
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  for (const path of sw.match(/const SHELL=\[([^\]]*)\]/)[1].split(',').map((s) => s.trim().replace(/'/g, ''))) {
    if (path === '/') continue;
    await readFile(join(root, path.replace(/^\//, '')));
  }

  // В кэш кладём только удачное. Иначе один 404 — скажем, в секунду
  // перезапуска сервера — оседает там навсегда, и значок приходит
  // пустым квадратом каждый раз, когда моргнула сеть.
  assert.match(sw, /if\(response\.ok&&response\.type==='basic'\)/,
    'служебный сценарий снова кэширует любой ответ, включая 404');
  // И страницу подставляем только переходу по адресу: картинка,
  // получившая в ответ HTML, — та же поломка с другой стороны.
  assert.match(sw, /request\.mode==='navigate'\?caches\.match\('\/'\)/,
    'страница снова отдаётся в ответ на любой запрос');
  // Chrome на Android не рисует SVG в уведомлении.
  assert.match(sw, /icon:'\/icon-192\.png'/, 'значок уведомления снова векторный');
});

/**
 * Поиск по-русски.
 *
 * Всё искалось словарём, который не знает словоформ: «выручку»
 * находилось, «выручка» — нет. В русскоязычном продукте это значит,
 * что человек должен угадать ту самую форму, в которой написал
 * коллега, — то есть поиском не пользуются, а листают.
 */
test('слово находится в любой своей форме — и в сообщении, и внутри документа',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const uploads = await mkdtemp(join(tmpdir(), 'morph-'));
  const app = await createChatServer({ databaseUrl: DATABASE_URL, uploadsRoot: uploads, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(uploads, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Формы ${suffix}`, ownerName: 'Владелец', email: `ms-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST', body: { body: `Возвраты за август провели сентябрём, расхождение ${suffix}` },
  });

  const docx = await makeDocx([`Сверка выручки за квартал ${suffix}`]);
  await fetch(`${base}/api/v1/files`, {
    method: 'POST',
    headers: { cookie: owner.cookie, 'content-type': DOCX, 'x-file-name': encodeURIComponent('сверка.docx') },
    body: docx,
  });

  const find = async (query) => (await request(base, `/api/v1/search?q=${encodeURIComponent(query)}`, { cookie: owner.cookie }))
    .payload.items.map((item) => item.type);

  // Слово из сообщения — в трёх падежах, и все три должны находить его.
  for (const form of ['возвраты', 'возврат', 'возвратов']) {
    assert.ok((await find(form)).includes('message'), `«${form}» не нашло сообщение`);
  }
  // Слово из документа — тоже.
  for (const form of ['выручка', 'выручки', 'выручку']) {
    assert.ok((await find(form)).includes('file'), `«${form}» не нашло документ`);
  }
  // Латиница не ломается: английские слова тоже приводятся к основе.
  assert.ok((await find(suffix)).length > 0, 'случайное слово перестало находиться');
});

/**
 * Имя файла из заголовка.
 *
 * В заголовке HTTP нельзя ничего, кроме латиницы, поэтому клиент
 * кодирует имя процентами. Голый `decodeURIComponent` спотыкался на
 * двух обычных случаях, и оба стоили загрузки файла целиком.
 */
test('имя файла переживает и процент в себе, и клиента, который не кодирует', async () => {
  const { fileNameFromHeader } = await import('../src/http/media.js');

  // Обычная работа: клиент закодировал.
  assert.equal(fileNameFromHeader(encodeURIComponent('смета №12.txt')), 'смета №12.txt');
  assert.equal(fileNameFromHeader('akt.txt'), 'akt.txt');

  // «Скидка -50%.pdf» — не ошибка клиента, а нормальное имя отчёта.
  // Раньше на нём падало «URI malformed», и файл не загружался вовсе.
  assert.equal(fileNameFromHeader('skidka -50%.txt'), 'skidka -50%.txt');
  assert.equal(fileNameFromHeader('100%.pdf'), '100%.pdf');

  // Чужой скрипт или curl не кодируют ничего: байты UTF-8, прочитанные
  // как latin-1. «акт.txt» приезжал как «Ð°ÐºÑ.txt».
  const raw = Buffer.from('акт-приёмки.txt', 'utf8').toString('latin1');
  assert.equal(fileNameFromHeader(raw), 'акт-приёмки.txt');

  // Заголовка нет вовсе — имя по умолчанию, а не пустота.
  assert.equal(fileNameFromHeader(undefined), 'file');
});
