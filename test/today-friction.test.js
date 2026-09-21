import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/persistence/daily-work-store.js', import.meta.url), 'utf8');

/**
 * «Что сегодня горит» — главный вопрос к первому экрану, и продукт на него
 * не отвечал: слова «просрочено» не было во всём интерфейсе, а счётчики
 * внимания считали только задачи, которыми человек владеет, — руководитель
 * видел вечные нули, пока в компании горели шесть просроченных.
 */
test('просрочка видна в строке задачи', () => {
  const overdue = app.slice(app.indexOf('const taskOverdue='));
  const body = overdue.slice(0, overdue.indexOf('\nfunction taskRow'));
  const fn = new Function(`${body}; return { taskOverdue, taskDueSoon };`)();

  const day = 24 * 3600 * 1000;
  assert.equal(fn.taskOverdue({ promisedAt: new Date(Date.now() - day).toISOString(), status: 'in_progress' }), true);
  assert.equal(fn.taskOverdue({ promisedAt: new Date(Date.now() + day).toISOString(), status: 'in_progress' }), false);
  // Закрытая задача не горит, сколько бы ни прошло.
  assert.equal(fn.taskOverdue({ promisedAt: new Date(Date.now() - day).toISOString(), status: 'closed' }), false);
  assert.equal(fn.taskOverdue({ status: 'in_progress' }), false, 'задача без срока не может быть просрочена');
  assert.equal(fn.taskDueSoon({ promisedAt: new Date(Date.now() + 3600e3).toISOString(), status: 'accepted' }), true);
  assert.equal(fn.taskDueSoon({ promisedAt: new Date(Date.now() - day).toISOString(), status: 'accepted' }), false);

  assert.match(app, /просрочено — /, 'слово «просрочено» снова исчезло из интерфейса');
  assert.match(app, /class="task-card pressable\$\{late\?' overdue':''\}/);
});

test('счётчики внимания считают обязательство целиком, а не только своё владение', () => {
  assert.match(store, /owner_id=\$2 OR requester_id=\$2 OR acceptor_id=\$2/,
    'руководитель снова видит нули: считается только то, чем он владеет');
  assert.match(store, /\[t\.ownerId, t\.requesterId, t\.acceptorId\]\.includes\(session\.userId\)/);
});

test('задачу, которая ждёт решения, видно и можно принять из строки', () => {
  assert.match(app, /function answerNeededSection\(\)/);
  assert.match(app, /\$\{answerNeededSection\(\)\}/, 'блок не вставлен на экран');
  assert.match(app, /data-answer-task="\$\{esc\(t\.id\)\}" data-answer-to="accepted"/);
  assert.match(app, /expectedVersion:task\.version/, 'переход уходит без версии — потеряется на гонке');
});

/**
 * Возвращение из отпуска: отметка о прочтении ставилась при открытии, по
 * последнему сообщению. Заглянуть в канал, чтобы оценить масштаб, было
 * нельзя — взгляд стирал отметку, и сто непрочитанных превращались в ноль
 * за одно нажатие, а вернуться к точке остановки было нечем.
 */
test('взгляд в беседу не считается прочтением', () => {
  const opener = app.slice(app.indexOf('async function openChat(id)'));
  const body = opener.slice(0, opener.indexOf('/** Отметить прочитанным'));
  assert.doesNotMatch(body, /\/read`/, 'открытие беседы снова отмечает её прочитанной');
  assert.match(body, /S\.unreadFrom\.set/, 'граница непрочитанного не запоминается');

  // Прочитанным считается то, до чего долистали.
  assert.match(app, /scrollHeight-stream\.scrollTop-stream\.clientHeight<40\)markConversationRead/);
  // Короткая переписка помещается целиком — тогда она и прочитана; через
  // таймер, а не кадр анимации, иначе в фоновой вкладке отметки не будет.
  assert.match(app, /setTimeout\(\(\)=>\{\s*const pane=\$\('#message-stream'\);/);
  assert.match(app, /class="unread-divider"/, 'в ленте нет границы непрочитанного');
});

/**
 * Сообщение → задача занимало шестнадцать нажатий: три, чтобы добраться
 * до десятой плитки в меню «ещё», и тринадцать на форму из шести полей.
 * На объекте с телефона так никто делать не будет — вопрос остаётся
 * висеть в переписке.
 */
test('задача из сообщения ставится одним движением', () => {
  // Кнопка в самой панели пузыря, а не в меню «ещё».
  assert.match(app, /data-quick-task="\$\{m\.id\}"/);
  assert.match(app, /function quickTaskModal\(message\)/);
  // Только то, без чего обязательства не бывает: что, кто и когда.
  const form = app.slice(app.indexOf('function quickTaskModal'), app.indexOf('function taskModal'));
  assert.match(form, /name="title"/);
  assert.match(form, /name="ownerId"/);
  assert.match(form, /data-due=/);
  assert.match(form, /sourceMessageId:message\.id/, 'связь с сообщением не передаётся');
  assert.doesNotMatch(form, /name="priority"/, 'в короткой форме снова лишние поля');
});

test('связь задачи и сообщения видна в обе стороны', () => {
  // На сообщении — отметка с задачей.
  assert.match(app, /S\.tasksFromMessage\?\.get\(m\.id\)/);
  assert.match(app, /function indexTasksByMessage\(\)/);
  // В карточке задачи — ссылка на обсуждение.
  assert.match(app, /data-task-source="\$\{esc\(task\.sourceMessageId\)\}"/);
  assert.match(app, /\$\('\[data-task-source\]'\)\?\.addEventListener/);
});
