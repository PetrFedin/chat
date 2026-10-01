import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { checkOutboundUrl } from '../src/net/outbound-url.js';
import { readJson, cleanText, clientAddress, publicOrigin, cookies, ruPlural, validTimezone } from '../src/http/helpers.js';
import { russianMessage } from '../src/http/ru-errors.js';
import { buildIcsFeed } from '../src/calendar/ics-feed.js';
import { readZipEntry } from '../src/export/unzip.js';

const jsonBody = (text) => ({ rawBody: Buffer.from(text), headers: {} });
const nested = (depth) => '{"a":'.repeat(depth) + '1' + '}'.repeat(depth);

test('вебхук: любой способ записать внутренний адрес IPv6 отклоняется', () => {
  const blocked = [
    'http://[::127.0.0.1]/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/',
    'http://[0:0:0:0:0:0:7f00:1]/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/',
    'http://[fe80::1]/', 'http://[fd12:3456::1]/', 'http://[::10.0.0.5]/', 'http://[ff02::1]/',
    'http://127.0.0.1/', 'http://10.1.2.3/', 'http://169.254.169.254/', 'http://localhost/', 'http://intranet/',
  ];
  for (const url of blocked) assert.equal(checkOutboundUrl(url).ok, false, `${url} должен быть отклонён`);
  for (const url of ['https://example.com/hook', 'http://[2606:4700:4700::1111]/', 'http://[::ffff:8.8.8.8]/']) {
    assert.equal(checkOutboundUrl(url).ok, true, `${url} должен проходить`);
  }
});

test('тело запроса: не объект и слишком глубокая вложенность — 400, обычное проходит', async () => {
  for (const bad of ['null', '[]', '"text"', '5', nested(33), nested(5000)]) {
    await assert.rejects(readJson(jsonBody(bad)), (e) => e.code === 'INVALID_JSON' && e.statusCode === 400, `тело ${bad.slice(0, 20)}…`);
  }
  assert.deepEqual(await readJson(jsonBody('{"a":1}')), { a: 1 });
  assert.ok(await readJson(jsonBody(nested(10))));
  assert.deepEqual(await readJson(jsonBody('')), {});
});

test('текст: объект и массив не превращаются в «[object Object]»', () => {
  assert.throws(() => cleanText({ a: 1 }), (e) => e.code === 'INVALID_TEXT');
  assert.throws(() => cleanText(['x', 'y'], 50, 'Название'), (e) => e.code === 'INVALID_TEXT');
  assert.equal(cleanText('  привет '), 'привет');
});

test('адрес за прокси считается с правого края и не подделывается первым хопом', () => {
  const req = (xff) => ({ socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': xff } });
  assert.equal(clientAddress(req('1.2.3.4, 203.0.113.9'), { TRUST_PROXY: 'true' }), '203.0.113.9');
  assert.equal(clientAddress(req('1.2.3.4, 203.0.113.9, 10.9.9.9'), { TRUST_PROXY: 'true', TRUST_PROXY_HOPS: '2' }), '203.0.113.9');
  assert.equal(clientAddress(req('1.2.3.4'), {}), '10.0.0.1', 'без доверия к прокси заголовок игнорируется');
});

test('ссылки в письмах берутся из PUBLIC_URL, а не из заголовка Host', () => {
  const req = { headers: { host: 'evil.example' }, socket: {} };
  assert.equal(publicOrigin(req, { PUBLIC_URL: 'https://chat.example.com/' }), 'https://chat.example.com');
  assert.equal(publicOrigin(req, {}), 'http://evil.example', 'без PUBLIC_URL — прежнее запасное поведение');
  assert.equal(publicOrigin(req, { PUBLIC_URL: 'javascript:alert(1)' }), 'http://evil.example', 'мусорный PUBLIC_URL не принимается');
});

test('битая cookie чужого приложения не ломает разбор', () => {
  assert.deepEqual(cookies({ headers: { cookie: 'other=%E0%A4%A; chat_session=abc' } }), { other: '%E0%A4%A', chat_session: 'abc' });
});

test('склонение и часовой пояс', () => {
  const forms = ['человек', 'человека', 'человек'];
  assert.deepEqual([1, 2, 5, 11, 21, 22, 25].map((n) => ruPlural(n, ...forms)), ['человек', 'человека', 'человек', 'человек', 'человек', 'человека', 'человек']);
  assert.equal(validTimezone('Europe/Moscow'), true);
  assert.equal(validTimezone('Nowhere/Land'), false);
});

test('английские ошибки сервера показываются по-русски, русские не трогаются', () => {
  assert.equal(russianMessage('Message not found'), 'Сообщение не найдено');
  assert.equal(russianMessage('Authentication required'), 'Нужно войти в систему');
  assert.equal(russianMessage('Уже по-русски'), 'Уже по-русски');
});

test('ICS: событие на весь день отдаёт даты, а не строку Date, и конец исключающий', () => {
  const feed = buildIcsFeed([{
    id: 'e1', title: 'Весь день', allDay: true, timezone: 'Europe/Moscow',
    startAt: new Date('2026-11-09T21:00:00Z'), endAt: new Date('2026-11-10T20:59:59Z'),
    createdAt: new Date(), updatedAt: new Date(),
  }]);
  assert.match(feed, /DTSTART;VALUE=DATE:20261110/);
  assert.match(feed, /DTEND;VALUE=DATE:20261111/);
});

test('ZIP: запись-бомба обрывается по размеру, обычная читается', () => {
  const entry = (data, method, extra = {}) => {
    const raw = method === 8 ? deflateRawSync(data) : data;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(0, 26); header.writeUInt16LE(0, 28);
    return { buffer: Buffer.concat([header, raw]), entry: { offset: 0, method, compressedSize: raw.length, ...extra } };
  };
  const small = entry(Buffer.from('привет'), 8);
  assert.equal(readZipEntry(small.buffer, small.entry).toString(), 'привет');
  const bomb = entry(Buffer.alloc(80 * 1024 * 1024, 0), 8);
  assert.ok(bomb.entry.compressedSize < 200 * 1024, 'бомба маленькая в сжатом виде');
  assert.throws(() => readZipEntry(bomb.buffer, bomb.entry), (e) => e.code === 'ZIP_ENTRY_TOO_LARGE');
});
