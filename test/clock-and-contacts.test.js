import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// «Доброе утро» at one in the morning: the old rule read hours<12 and counted
// the small hours as morning.
test('the greeting follows the clock, night included', async () => {
  const app = await read('public/app.js');
  const match = app.match(/function greetingFor\(now=new Date\(\)\)\{[\s\S]*?\n\}/);
  assert.ok(match, 'greetingFor не найдена');
  const greetingFor = new Function('now', match[0] + '\nreturn greetingFor(now);');

  const at = (hour) => { const d = new Date(2026, 8, 20, hour, 30); return greetingFor(d); };
  assert.equal(at(1), 'Доброй ночи', 'час ночи всё ещё «утро»');
  assert.equal(at(4), 'Доброй ночи');
  assert.equal(at(5), 'Доброе утро');
  assert.equal(at(11), 'Доброе утро');
  assert.equal(at(12), 'Добрый день');
  assert.equal(at(17), 'Добрый день');
  assert.equal(at(18), 'Добрый вечер');
  assert.equal(at(22), 'Добрый вечер');
  assert.equal(at(23), 'Доброй ночи');

  const prefs = await read('public/preferences.js');
  for (const phrase of ['Доброй ночи', 'Доброе утро', 'Добрый день', 'Добрый вечер']) {
    assert.ok(prefs.includes(`    '${phrase}':`), `нет перевода для «${phrase}»`);
  }
});

test('the clock runs without waking the translator each second', async () => {
  const app = await read('public/app.js');
  assert.match(app, /second:'2-digit'/, 'в строке нет секунд');
  assert.match(app, /setInterval\(tickClock,1000\)/, 'часы не идут');
  // The element is re-created on every render, so the tick has to be redone.
  assert.match(app, /\n  tickClock\(\);/, 'часы не восстанавливаются после перерисовки');
  assert.match(app, /startClock\(\);connect\(\)/, 'часы не запускаются при входе');

  // data-prefs-owned is in the translator's skip list. Without it the ticking
  // node is re-read through the dictionary every second for nothing.
  assert.match(app, /id="now-line" data-prefs-owned/, 'часы не помечены как свои');
  const prefs = await read('public/preferences.js');
  assert.match(prefs, /\[data-prefs-owned\]/, 'переводчик больше не знает этот маркер');

  // Writing the same text would still be a mutation, so both writes guard.
  assert.match(app, /if\(line\.textContent!==text\)line\.textContent=text/);
  assert.match(app, /if\(slot&&lastGreeting!==word\)/);
});

// The staff directory answers «кто работает в компании». Contacts answer
// «с кем я имею дело», which is a different and shorter list.
test('contacts are built from rooms and from the chart', async () => {
  const repo = await read('src/people/people-repository.js');
  const http = await read('src/http/people.js');
  const app = await read('public/app.js');

  assert.match(repo, /async contacts\(session\)/);
  // Counting rows after the join to messages turned a chatty colleague into
  // twenty shared rooms.
  assert.match(repo, /count\(DISTINCT c\.id\)::int "sharedCount"/, 'беседы считаются не различно');
  // An open channel is membership by visibility, not a relationship.
  assert.match(repo, /FROM conversation_members a/);
  // A guest has no place in the chart and gets no unit groups.
  assert.match(repo, /session\.role === 'guest'\s*\n?\s*\? Promise\.resolve\(\{ rows: \[\] \}\)/);

  assert.match(http, /path === '\/api\/v1\/contacts'/);
  assert.match(http, /path !== '\/api\/v1\/contacts'\) return false/, 'маршрут недостижим из-за префикса');

  assert.match(app, /data-action="contacts"/);
  assert.match(app, /contacts:contactsModal/);
  assert.match(app, /async function contactsModal\(\)/);
  // A row's note is markup, so every caller has to escape what it puts in.
  assert.match(app, /esc\(UNIT_ROLE\[m\.unitRole\]\|\|m\.unitRole\)/);
});
