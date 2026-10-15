import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function fixture(base, suffix) {
  const owner = await request(base, '/api/v1/auth/register-company', {
    method: 'POST',
    body: { companyName: `Части ${suffix}`, ownerName: 'Директор', email: `st-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const join = async (tag, name, role = 'member') => {
    const invitation = await request(base, '/api/v1/invitations', {
      cookie: owner.cookie, method: 'POST', body: { email: `${tag}-${suffix}@t.test`, role } });
    const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
    const session = await request(base, '/api/v1/invitations/accept', {
      method: 'POST', body: { token, displayName: name, password: 'OwnerPassword42' } });
    const me = await request(base, '/api/v1/me', { cookie: session.cookie });
    return { cookie: session.cookie, userId: me.payload?.userId };
  };
  return { owner, join };
}

/**
 * Шаги, соисполнители и связи.
 *
 * Три таблицы под них лежали в схеме с первого дня, и кода за ними не
 * было ни строки: схема обещала то, чего в продукте нет.
 */
test('обязательство разбирается на шаги, и шаг отмечает тот, кто его сделал',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const { owner, join } = await fixture(base, suffix);
  const nina = await join('nina', 'Нина');
  const oleg = await join('oleg', 'Олег');
  const passerby = await join('mimo', 'Мимо');

  const task = (await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST', body: { title: 'Свести акты', ownerId: nina.userId } })).payload.task;

  assert.equal((await request(base, `/api/v1/tasks/${task.id}/checklist`, {
    cookie: nina.cookie, method: 'POST', body: { title: 'Собрать подписи' } })).status, 201);
  const second = (await request(base, `/api/v1/tasks/${task.id}/checklist`, {
    cookie: nina.cookie, method: 'POST', body: { title: 'Сверить суммы' } })).payload.item;
  assert.equal(second.position, 1, 'шаги должны сохранять порядок');
  // Пустой шаг не заводится: общая проверка текста ловит его раньше
  // нашей, и это правильно — отказ один на весь продукт.
  assert.equal((await request(base, `/api/v1/tasks/${task.id}/checklist`, {
    cookie: nina.cookie, method: 'POST', body: { title: '   ' } })).status, 400);

  // Соисполнитель — четвёртый участник обязательства: без права видеть
  // задачу вся затея была бы формальной.
  assert.equal((await request(base, `/api/v1/tasks/${task.id}`, { cookie: oleg.cookie })).status, 404);
  assert.equal((await request(base, `/api/v1/tasks/${task.id}/collaborators`, {
    cookie: nina.cookie, method: 'POST', body: { userId: oleg.userId } })).status, 201);
  assert.equal((await request(base, `/api/v1/tasks/${task.id}`, { cookie: oleg.cookie })).status, 200);
  assert.equal((await request(base, '/api/v1/tasks?limit=50', { cookie: oleg.cookie }))
    .payload.items.some((x) => x.id === task.id), true, 'помощник не находит задачу в своём списке');

  // И отмечает шаг сам, а не просит отметить за него.
  assert.equal((await request(base, `/api/v1/tasks/${task.id}/checklist/${second.id}`, {
    cookie: oleg.cookie, method: 'PATCH', body: { done: true } })).status, 200);
  let detail = (await request(base, `/api/v1/tasks/${task.id}`, { cookie: nina.cookie })).payload.task;
  assert.equal(detail.checklist.find((x) => x.id === second.id).completedByName, 'Олег');
  assert.equal(detail.collaborators.map((x) => x.displayName).join(), 'Олег');

  // Счётчик шагов виден в списке — иначе чеклист существует только внутри карточки.
  const inList = (await request(base, '/api/v1/tasks?scope=all&limit=50', { cookie: owner.cookie }))
    .payload.items.find((x) => x.id === task.id);
  assert.equal(inList.checklistTotal, 2);
  assert.equal(inList.checklistDone, 1);

  // Отметку можно снять, шаг — удалить.
  assert.equal((await request(base, `/api/v1/tasks/${task.id}/checklist/${second.id}`, {
    cookie: nina.cookie, method: 'PATCH', body: { done: false } })).status, 200);
  assert.equal((await request(base, `/api/v1/tasks/${task.id}/checklist/${second.id}`, {
    cookie: nina.cookie, method: 'DELETE' })).status, 200);
  assert.equal((await request(base, `/api/v1/tasks/${task.id}/checklist/${second.id}`, {
    cookie: nina.cookie, method: 'DELETE' })).code, 'CHECKLIST_ITEM_NOT_FOUND');

  // Посторонний сотрудник задачу не видит и перекроить её не может.
  assert.equal((await request(base, `/api/v1/tasks/${task.id}/checklist`, {
    cookie: passerby.cookie, method: 'POST', body: { title: 'Не моё' } })).status, 404);

  // Гость обязательств не носит — и помогать с ними не может.
  const invitation = await request(base, '/api/v1/invitations', {
    cookie: owner.cookie, method: 'POST', body: { email: `guest-${suffix}@client.test`, role: 'guest' } });
  const guestToken = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const guest = await request(base, '/api/v1/invitations/accept', {
    method: 'POST', body: { token: guestToken, displayName: 'Заказчик', password: 'GuestPassword42' } });
  const guestId = (await request(base, '/api/v1/me', { cookie: guest.cookie })).payload.userId;
  assert.equal((await request(base, `/api/v1/tasks/${task.id}/collaborators`, {
    cookie: nina.cookie, method: 'POST', body: { userId: guestId } })).code, 'GUEST_CANNOT_HOLD_TASK');

  // Помощника можно убрать, и задача снова становится ему не видна.
  assert.equal((await request(base, `/api/v1/tasks/${task.id}/collaborators/${oleg.userId}`, {
    cookie: nina.cookie, method: 'DELETE' })).status, 200);
  assert.equal((await request(base, `/api/v1/tasks/${task.id}`, { cookie: oleg.cookie })).status, 404);
});

test('связь «это ждёт то» объясняет застрявшее и не замыкается в круг',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 7);
  const { owner, join } = await fixture(base, suffix);
  const nina = await join('nina', 'Нина');

  const make = async (title) => (await request(base, '/api/v1/tasks', {
    cookie: owner.cookie, method: 'POST', body: { title, ownerId: nina.userId } })).payload.task;
  const acts = await make('Свести акты');
  const estimate = await make('Получить смету');
  const third = await make('Согласовать с заказчиком');

  assert.equal((await request(base, `/api/v1/tasks/${acts.id}/dependencies`, {
    cookie: owner.cookie, method: 'POST', body: { dependsOn: estimate.id, kind: 'blocks' } })).status, 201);
  assert.equal((await request(base, `/api/v1/tasks/${estimate.id}/dependencies`, {
    cookie: owner.cookie, method: 'POST', body: { dependsOn: third.id, kind: 'blocks' } })).status, 201);

  // Цепочка «A ждёт B, B ждёт C, C ждёт A» — это не зависимость, а три
  // обязательства, которые никогда не сдвинутся.
  const loop = await request(base, `/api/v1/tasks/${third.id}/dependencies`, {
    cookie: owner.cookie, method: 'POST', body: { dependsOn: acts.id, kind: 'blocks' } });
  assert.equal(loop.status, 409);
  assert.equal(loop.code, 'DEPENDENCY_LOOP');
  assert.equal((await request(base, `/api/v1/tasks/${acts.id}/dependencies`, {
    cookie: owner.cookie, method: 'POST', body: { dependsOn: acts.id } })).code, 'SELF_DEPENDENCY');
  assert.equal((await request(base, `/api/v1/tasks/${acts.id}/dependencies`, {
    cookie: owner.cookie, method: 'POST', body: { dependsOn: estimate.id, kind: 'что-то' } })).code, 'INVALID_DEPENDENCY_KIND');

  // Связь видна с обеих сторон — иначе «почему это стоит» отвечает только одна.
  const blocked = (await request(base, `/api/v1/tasks/${acts.id}`, { cookie: owner.cookie })).payload.task;
  assert.deepEqual(blocked.dependencies.map((x) => [x.direction, x.title]), [['depends', 'Получить смету']]);
  const blocking = (await request(base, `/api/v1/tasks/${estimate.id}`, { cookie: owner.cookie })).payload.task;
  assert.deepEqual(blocking.dependencies.map((x) => x.direction).sort(), ['blocks', 'depends']);

  // Счётчик «чего ждёт» в списке считает только незакрытое: смысл его в
  // том, стоит ли задача сейчас, а не стояла ли когда-нибудь.
  const before = (await request(base, '/api/v1/tasks?scope=all&limit=50', { cookie: owner.cookie }))
    .payload.items.find((x) => x.id === acts.id);
  assert.equal(before.blockedBy, 1);
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  t.after(() => pool.end());
  await pool.query("UPDATE commitments SET status='closed' WHERE id=$1", [estimate.id]);
  const after = (await request(base, '/api/v1/tasks?scope=all&limit=50', { cookie: owner.cookie }))
    .payload.items.find((x) => x.id === acts.id);
  assert.equal(after.blockedBy, 0, 'закрытое обязательство больше ничего не держит');

  assert.equal((await request(base, `/api/v1/tasks/${acts.id}/dependencies/${estimate.id}`, {
    cookie: owner.cookie, method: 'DELETE' })).status, 200);
  assert.equal((await request(base, `/api/v1/tasks/${acts.id}/dependencies/${estimate.id}`, {
    cookie: owner.cookie, method: 'DELETE' })).code, 'DEPENDENCY_NOT_FOUND');
});

/**
 * Мёртвые schema promises остаются запрещены. Projects больше не входят
 * в этот список: с migration 072 за ними есть native authority/repository/API
 * и отдельный PostgreSQL contract test.
 */
test('в схеме не осталось таблиц-обещаний',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  t.after(() => pool.end());
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY($1::text[])`,
    [['teams', 'team_members', 'calendar_blocks', 'device_registrations', 'message_receipts']]);
  assert.deepEqual(rows.map((r) => r.table_name), [], `в схеме остались таблицы без кода: ${rows.map((r) => r.table_name).join(', ')}`);

  const { rows: columns } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='commitments' AND column_name='project_id'`);
  assert.deepEqual(columns, [], 'Task не должен хранить второй project status/context в commitments');

  const { rows: kept } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY($1::text[])`,
    [['task_checklist_items', 'task_collaborators', 'task_dependencies', 'projects', 'project_members', 'project_tasks', 'project_milestones']]);
  assert.equal(kept.length, 7, 'живые Task/Project authority tables должны присутствовать');
});
