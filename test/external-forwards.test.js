import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';
import { parseForwarded, prepareForward } from '../src/messaging/external-forward.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
  + '0000000a49444154789c6360000002000100ff03ff0000000049454e44ae426082', 'hex');

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
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

/**
 * Разбираем то, что кладёт в буфер сам мессенджер.
 *
 * Если формат не узнан, текст всё равно переносится: потерять слова
 * из-за неузнанной служебной строки хуже, чем не угадать автора.
 */
test('служебные строки WhatsApp и Telegram разбираются, остальное переносится как есть', () => {
  const whatsapp = parseForwarded('[21.09.2026, 19:40:12] Олег Прораб: Смету пересчитал\n'
    + 'Есть расхождение по бетону\n[21.09.2026, 19:41:03] Заказчик: Пришлите акт');
  assert.equal(whatsapp.length, 2);
  assert.equal(whatsapp[0].authorName, 'Олег Прораб');
  // Вторая строка — продолжение первого сообщения, а не новое.
  assert.equal(whatsapp[0].body, 'Смету пересчитал\nЕсть расхождение по бетону');
  assert.equal(whatsapp[1].authorName, 'Заказчик');

  const android = parseForwarded('21.09.2026, 19:40 - Олег: Буду в десять');
  assert.equal(android[0].authorName, 'Олег');
  assert.equal(android[0].body, 'Буду в десять');

  const telegram = parseForwarded('Олег Прораб, [21.09.2026 19:40]\nПодтверждаю');
  assert.equal(telegram[0].authorName, 'Олег Прораб');
  assert.equal(telegram[0].body, 'Подтверждаю');

  const plain = parseForwarded('просто вставленный текст');
  assert.equal(plain.length, 1);
  assert.equal(plain[0].authorName, null);
  assert.equal(plain[0].body, 'просто вставленный текст');
});

/**
 * Время из выгрузки — местное: пояса в ней нет.
 *
 * Считаем его поясом того, кто переносит, а в тексте показываем те
 * часы, которые он видел у себя, а не пересчитанные.
 */
test('время переносится в поясе того, кто переносит', () => {
  const { body, origin } = prepareForward({
    text: '[21.09.2026, 19:40:00] Олег: Буду', source: 'whatsapp', offsetMinutes: -180,
  });
  assert.equal(origin.sentAt.toISOString(), '2026-09-21T16:40:00.000Z');
  assert.match(body, /\(19:40\)/);
});

test('пустой перенос отклоняется', () => {
  assert.throws(() => prepareForward({ text: '   \n  ', source: 'telegram' }), /EMPTY_FORWARD|Нечего/);
});

/**
 * Половина работы приходит из WhatsApp и Telegram, и до сих пор её
 * копировали руками: в беседе оставалось «прислали смету», а через
 * месяц не сказать ни кто прислал, ни когда.
 */
test('перенос доходит до беседы с отметкой об источнике и виден в архиве',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);

  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Перенос ${suffix}`, ownerName: 'Владелец', email: `ex-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const conversation = (await request(base, '/api/v1/bootstrap', { cookie: owner.cookie })).payload.conversations[0];

  const made = await request(base, `/api/v1/conversations/${conversation.id}/external-forwards`, {
    cookie: owner.cookie, method: 'POST',
    body: {
      source: 'whatsapp', offsetMinutes: -180,
      text: '[21.09.2026, 19:40:12] Олег Прораб: Смету пересчитал\nЕсть расхождение\n'
        + '[21.09.2026, 19:41:03] Заказчик: Акт тут https://example.test/akt.pdf',
    },
  });
  assert.equal(made.status, 201);
  assert.equal(made.payload.message.externalOrigin.source, 'whatsapp');
  assert.equal(made.payload.message.externalOrigin.authorName, 'Олег Прораб');
  assert.equal(made.payload.message.externalOrigin.lineCount, 2);
  assert.match(made.payload.message.body, /Олег Прораб \(19:40\): Смету пересчитал/);

  // Отметка доезжает и до обычного чтения ленты, а не только до ответа
  // на запись: без этого она не видна никому, кроме того, кто перенёс.
  const flow = (await request(base, `/api/v1/conversations/${conversation.id}/messages`, { cookie: owner.cookie }))
    .payload.items.find((m) => m.id === made.payload.message.id);
  assert.equal(flow.externalOrigin.source, 'whatsapp');

  const photo = await fetch(`${base}/api/v1/files`, {
    method: 'POST',
    headers: { cookie: owner.cookie, 'content-type': 'image/png', 'x-file-name': encodeURIComponent('акт.png') },
    body: PNG,
  });
  const file = (await photo.json()).file;
  await request(base, `/api/v1/conversations/${conversation.id}/messages`, {
    cookie: owner.cookie, method: 'POST',
    body: { kind: 'file', metadata: { fileId: file.id, name: 'акт.png', mimeType: 'image/png', size: PNG.length } },
  });

  const archive = async (kind) => (await request(base,
    `/api/v1/conversations/${conversation.id}/archive?kind=${kind}`, { cookie: owner.cookie })).payload.items;

  assert.equal((await archive('photo')).length, 1);
  assert.equal((await archive('photo'))[0].fileName, 'акт.png');
  assert.equal((await archive('video')).length, 0);
  // Ссылка внутри перенесённого куска — тоже ссылка.
  assert.equal((await archive('link')).length, 1);
  assert.equal((await archive('external')).length, 1);
  assert.equal((await archive('all')).length, 2);

  const bySource = (await request(base,
    `/api/v1/conversations/${conversation.id}/archive?kind=external&source=telegram`, { cookie: owner.cookie })).payload.items;
  assert.equal(bySource.length, 0, 'перенос из WhatsApp нашёлся под Telegram');

  const wrongKind = await request(base, `/api/v1/conversations/${conversation.id}/archive?kind=что-то`, { cookie: owner.cookie });
  assert.equal(wrongKind.status, 400);
  assert.equal(wrongKind.code, 'INVALID_ARCHIVE_KIND');

  const wrongSource = await request(base,
    `/api/v1/conversations/${conversation.id}/archive?kind=external&source=icq`, { cookie: owner.cookie });
  assert.equal(wrongSource.status, 400);
  assert.equal(wrongSource.code, 'INVALID_SOURCE');
});
