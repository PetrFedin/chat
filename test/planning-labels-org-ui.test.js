import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// Labels, personal planning and the org chart were built, tested and reachable
// only through the API. These check the screens that now carry them, and the
// wiring that makes a sheet show what the sheet above it changed.

test('the personal list is reachable and carries its own controls', async () => {
  const app = await read('public/app.js');

  assert.match(app, /data-action="plan"/, 'нет плитки «Личные дела» в «Ещё»');
  assert.match(app, /plan:\(\)=>planModal\(\)/, 'действие plan не зарегистрировано');
  assert.match(app, /function planSection\(\)/, 'на экране «Сегодня» нет секции дел');
  assert.match(app, /\$\{planSection\(\)\}/, 'секция дел не вставлена в экран');
  assert.match(app, /loadTasks\(\),loadCalendar\(\),loadPlan\(\)/, 'список не загружается при входе');

  // A row does two things and both must be bound wherever it is rendered.
  assert.match(app, /data-plan-toggle=/);
  assert.match(app, /data-plan-open=/);
  assert.match(app, /function bindPlanRows\(/);
  assert.match(app, /bindPlanRows\(async\(\)=>\{await loadPlan\(\);render\(\)\}\)/, 'строки на «Сегодня» не привязаны');

  for (const verb of ['comments', 'schedule', 'personal-items']) {
    assert.ok(app.includes(`/api/v1/personal-items`) && app.includes(verb), `нет вызова ${verb}`);
  }
  assert.match(app, /method:'DELETE'/);
});

test('labels reach every thing they can be put on', async () => {
  const app = await read('public/app.js');

  assert.match(app, /data-action="labels"/, 'нет плитки «Метки»');
  assert.match(app, /labels:labelsModal/, 'действие labels не зарегистрировано');
  assert.match(app, /function labelPicker\(targetType,targetId/);

  // The picker is the same sheet from a message, a task and a personal item:
  // one vocabulary, reached three ways.
  assert.match(app, /labelPicker\('message',/, 'у сообщения нет метки');
  assert.match(app, /labelPicker\('task',/, 'у задачи нет метки');
  assert.match(app, /labelPicker\('note',/, 'у личного дела нет метки');
  assert.match(app, /data-message-label=/);
  assert.match(app, /data-task-labels/);
  assert.match(app, /data-plan-labels/);

  // PUT applies and DELETE removes: the server takes no POST here.
  assert.match(app, /links\/\$\{targetType\}\/\$\{targetId\}`,\{method:applied\?'DELETE':'PUT'\}/);
  assert.match(app, /labelled\/\$\{targetType\}\/\$\{targetId\}/);
});

test('the org chart can be reshaped by whoever runs a branch', async () => {
  const app = await read('public/app.js');

  assert.match(app, /function unitSheet\(/);
  assert.match(app, /function unitFormModal\(/);
  assert.match(app, /function unitAddMemberModal\(/);

  // The server splits authority: a unit admin runs their branch, but moving a
  // unit or changing its seat plan is workspace-wide. The screen has to show
  // the same split or it offers buttons that will be refused.
  assert.match(app, /\$\{wide\?`<label>Штатных мест/, 'поле штата показывается без прав на него');
  assert.match(app, /\$\{wide\?'<button data-delete/, 'удаление показывается без прав на него');
  assert.match(app, /if\(wide\)patch\.seatLimit=seatLimit;/, 'штат уходит в запрос без прав');
  assert.match(app, /data-new-root/);

  // A guest is refused by the server, so the picker must not offer one.
  assert.match(app, /p\.role!=='guest'/, 'гость попадает в список для зачисления');

  assert.doesNotMatch(app, /POST \/api\/v1\/org\/units<\/code>/, 'экран всё ещё отсылает к curl');
});

// A sheet keeps the markup it opened with. Step back onto one that the sheet
// above it changed — apply a label, go back — and it showed the stale answer.
test('an overlay is re-read when it becomes the top again', async () => {
  const app = await read('public/app.js');
  assert.match(app, /function modal\(title,body,after,refresh\)/, 'modal не принимает refresh');
  assert.match(app, /async function resumeTop\(\)/);
  assert.match(app, /overlayStack\.pop\(\);renderOverlay\(\);resumeTop\(\)/, 'возврат не перечитывает страницу');
  // Both planning pages have to supply one, or the feature is decorative.
  assert.match(app, /modal\(first\.title,first\.body,first\.after,\(\)=>build\(true\)\)/);
  assert.match(app, /modal\(first\.title,first\.body,first\.after,build\)/);
});

test('the new surfaces carry no untranslated chrome and no stray placeholder', async () => {
  const [app, prefs, context, css, light] = await Promise.all([
    read('public/app.js'),
    read('public/preferences.js'),
    read('public/preferences-context.js'),
    read('public/styles.css'),
    read('public/preferences.css'),
  ]);

  for (const phrase of ['Личные дела', 'Метки', 'Мои дела', 'Новое подразделение', 'Зачислить сотрудника']) {
    assert.ok(prefs.includes(`    '${phrase}':`), `нет перевода для «${phrase}»`);
  }

  // The capture bar's placeholder was written onto every .quick-bar input, so
  // the personal list's own two bars lost their text.
  assert.doesNotMatch(context, /'\.quick-bar input', 'placeholder'/, 'правило снова бьёт по всем quick-bar');
  assert.match(context, /\[data-quick-form\] input', 'placeholder'/);

  // .row is a three-column grid; a strip of filter chips needs its own class.
  assert.match(app, /<div class="chip-row">\$\{filters\}<\/div>/);
  assert.match(css, /\.chip-row\{display:flex/);

  // Every colour a label can take needs a swatch in both themes.
  for (const colour of ['neutral', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'grey']) {
    assert.ok(css.includes(`.label-chip[data-colour="${colour}"]`), `тёмная тема не знает цвет ${colour}`);
    assert.ok(light.includes(`.label-chip[data-colour="${colour}"]`), `светлая тема не знает цвет ${colour}`);
  }
});
