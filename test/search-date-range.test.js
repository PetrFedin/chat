import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dailyWork = readFileSync(new URL('../public/daily-work.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/http/daily-work.js', import.meta.url), 'utf8');
const search = readFileSync(new URL('../src/persistence/daily-work-search-store.js', import.meta.url), 'utf8');

/**
 * Отрезок времени в поиске.
 *
 * Сервер принимал `from` и `to` с первого дня, но задать их было нечем —
 * ни одного поля в интерфейсе. Человек, помнящий «это было где-то в
 * марте», листал сорок результатов подряд.
 */
test('поиск умеет ограничивать выдачу отрезком времени', () => {
  const source = dailyWork.slice(dailyWork.indexOf('const SEARCH_PERIODS='));
  const body = source.slice(0, source.indexOf('\nlet searchTimer'));
  const make = (D) => new Function('D', `${body}; return searchRange()`)(D);

  assert.deepEqual(make({ searchPeriod: 'any' }), { from: '', to: '' });

  const week = make({ searchPeriod: '7' });
  assert.equal(week.to, '', 'у пресета «7 дней» верхней границы нет — он до сих пор');
  const days = (Date.now() - Date.parse(week.from)) / 86400000;
  assert.ok(Math.abs(days - 7) < 0.01, `ожидались семь дней, вышло ${days}`);

  // Свой период считается по местным суткам: «по 31 декабря» включает
  // весь этот день, а не обрывается на его полуночи.
  const exact = make({ searchPeriod: 'custom', searchFrom: '2020-01-01', searchTo: '2020-12-31' });
  assert.equal(new Date(exact.from).getTime(), new Date('2020-01-01T00:00:00').getTime());
  assert.equal(new Date(exact.to).getTime(), new Date('2020-12-31T23:59:59.999').getTime());

  // Одна граница без второй — законный полуоткрытый отрезок.
  assert.equal(make({ searchPeriod: 'custom', searchFrom: '', searchTo: '2020-12-31' }).from, '');
  assert.equal(make({ searchPeriod: 'custom', searchFrom: '2020-01-01', searchTo: '' }).to, '');

  // Границы должны доезжать до запроса и до базы.
  assert.match(dailyWork, /params\.set\('from',range\.from\)/);
  assert.match(dailyWork, /params\.set\('to',range\.to\)/);
  assert.match(route, /from/, 'маршрут поиска перестал читать from');
  assert.match(search, /inRange/, 'отрезок времени пропал из запроса к базе');
});

/**
 * Переход к найденному сообщению.
 *
 * Лента подгружала последние сто сообщений, не находила среди них реплику
 * трёхмесячной давности и молча сдавалась: человек оказывался внизу
 * переписки без единого объяснения.
 */
test('переход из поиска открывает ленту окном вокруг сообщения', () => {
  assert.match(app, /messages\?around=\$\{encodeURIComponent\(messageId\)\}/,
    'открытие ленты больше не просит окно вокруг сообщения');
  assert.match(app, /window\.ChatApp=\{openChatAtMessage,/);
  assert.match(dailyWork, /window\.ChatApp\?\.openChatAtMessage/,
    'поиск снова ищет сообщение в DOM вместо загрузки окна');
  // Не нашли даже после загрузки — это сообщение, а не тишина.
  assert.match(app, /Это сообщение не удалось показать/);
  assert.match(app, /MESSAGE_NOT_FOUND/);
});
