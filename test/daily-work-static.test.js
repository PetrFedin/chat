import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('daily work client is syntactically valid and wired into the shell',async()=>{
  const[html,js,css,sw]=await Promise.all([
    read('public/index.html'),read('public/daily-work.js'),read('public/daily-work.css'),read('public/sw.js'),
  ]);
  assert.doesNotThrow(()=>new Function(js));
  assert.match(html,/\/daily-work\.css/);
  assert.match(html,/src="\/daily-work\.js"/);
  assert.match(js,/\/api\/v1\/attention/);
  assert.match(js,/\/api\/v1\/notifications/);
  assert.match(js,/\/api\/v1\/search/);
  assert.match(js,/\/api\/v1\/files/);
  assert.match(css,/\.dwc-attention-strip/);
  assert.match(css,/\.dwc-mention-picker/);
  assert.match(sw,/chat-shell-v\d+/);
  assert.match(sw,/daily-work\.css/);
  assert.match(sw,/daily-work\.js/);
});


/**
 * Значок непрочитанного — для пунктов меню.
 *
 * Он вешался на всё, у чего есть `data-nav="chats"`, а карточка-счётчик
 * «N диалогов» на главной помечена так же: значок растягивался во всю
 * ширину карточки поверх её собственного числа.
 */
test('значок непрочитанного не попадает в карточку-счётчик', async () => {
  const daily = await readFile(new URL('../public/daily-work.js', import.meta.url), 'utf8');
  assert.match(daily, /\[data-nav="chats"\]:not\(\.metric-card\)/,
    'значок снова вешается на карточку-счётчик');
});

/**
 * История действий в карточке человека — самый длинный её блок, а
 * открывают карточку обычно не ради него: нужны должность, телефон,
 * подразделение и чем человек занят. Развёрнутая история отодвигала за
 * край экрана и то, и кнопки «уволить» с «выписать ссылку».
 */
test('история действий в карточке человека свёрнута по умолчанию', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /<details class="person-history"\$\{activity\.length\?'':' open'\}>/,
    'история действий снова развёрнута сразу');
  assert.match(app, /<summary>История действий/);
});

/**
 * Находка должна открывать саму вещь.
 *
 * Найденная задача вела на список всех задач, найденное событие — просто
 * в календарь, найденный человек — на экран «Ещё». Искомое приходилось
 * искать заново уже глазами.
 */
test('поиск открывает найденное, а не раздел, где оно лежит', async () => {
  const [app, daily] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/daily-work.js', import.meta.url), 'utf8'),
  ]);

  // Поиск живёт в отдельном файле и ходит в приложение через одну дверь.
  assert.match(app, /window\.ChatApp=\{[^}]*openTask[^}]*openEvent/,
    'дверь для поиска снова не пускает к задаче и событию');

  assert.match(daily, /window\.ChatApp\?\.openTask/);
  assert.match(daily, /window\.ChatApp\?\.openEvent/);
  assert.match(daily, /window\.ChatApp\?\.openPerson/);
});

/**
 * Адрес обязан догонять экран: беседу открывают из поиска, из центра
 * внимания и из карточки задачи, а в адресе оставался прежний раздел —
 * перезагрузка уводила на «Сегодня», ссылкой нельзя было поделиться.
 */
test('открытая беседа отражается в адресе', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /if\(location\.hash!=='#\/chats'\)\{try\{history\.replaceState\(null,'','#\/chats'\)/,
    'адрес снова не догоняет открытую беседу');
});
