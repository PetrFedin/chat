import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';
import { validateValues, normalizeFields, normalizeApproval } from '../src/requests/request-repository.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const skip = !DATABASE_URL && 'нет базы';

async function call(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, payload, code: payload?.error?.code, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function company(t) {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = randomUUID().slice(0, 8);
  const owner = await call(base, '/api/v1/auth/register-company', {
    method: 'POST', body: { companyName: `Req ${suffix}`, ownerName: 'Владелец', email: `r-owner-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  const people = { owner: { cookie: owner.cookie } };
  for (const [key, role] of [['admin', 'admin'], ['manager', 'manager'], ['alice', 'member'], ['bob', 'member'], ['guest', 'guest']]) {
    const invited = await call(base, '/api/v1/invitations', { cookie: owner.cookie, method: 'POST', body: { email: `r-${key}-${suffix}@t.test`, role } });
    const token = new URL(invited.payload.invitation.inviteUrl).searchParams.get('invite');
    const accepted = await call(base, '/api/v1/invitations/accept', { method: 'POST', body: { token, displayName: key, password: 'MemberPassword42' } });
    people[key] = { cookie: accepted.cookie };
  }
  for (const key of Object.keys(people)) {
    people[key].id = (await call(base, '/api/v1/bootstrap', { cookie: people[key].cookie })).payload.session.userId;
  }
  return { app, base, people };
}

const purchaseTemplate = (extra = {}) => ({
  title: 'Покупка',
  fields: [
    { key: 'item', label: 'Что купить', type: 'text', required: true },
    { key: 'amount', label: 'Сумма', type: 'money', required: true },
    { key: 'urgency', label: 'Срочность', type: 'select', options: ['обычная', 'срочная'] },
    { key: 'needed_by', label: 'Нужно к', type: 'date' },
    { key: 'why', label: 'Зачем', type: 'textarea' },
  ],
  approval: { steps: [{ kind: 'role', role: 'manager' }, { kind: 'role', role: 'admin', when: { field: 'amount', gte: 100000 } }] },
  ...extra,
});

test('поля и значения заявки: типы, обязательность, лишнее отбрасывается', () => {
  const fields = normalizeFields(purchaseTemplate().fields);
  assert.deepEqual(validateValues(fields, { item: ' Ноутбук ', amount: '1500,5', urgency: 'срочная', needed_by: '2026-12-31', extra: 'x' }),
    { item: 'Ноутбук', amount: 1500.5, urgency: 'срочная', needed_by: '2026-12-31' });
  assert.throws(() => validateValues(fields, { amount: 5 }), (e) => e.code === 'INVALID_REQUEST_VALUES');
  assert.throws(() => validateValues(fields, { item: 'x', amount: -1 }), (e) => e.code === 'INVALID_REQUEST_VALUES');
  assert.throws(() => validateValues(fields, { item: 'x', amount: 1, urgency: 'никогда' }), (e) => e.code === 'INVALID_REQUEST_VALUES');
  assert.throws(() => validateValues(fields, { item: 'x', amount: 1, needed_by: '2026-02-31' }), (e) => e.code === 'INVALID_REQUEST_VALUES');
  assert.throws(() => validateValues(fields, { item: { a: 1 }, amount: 1 }), (e) => e.code === 'INVALID_REQUEST_VALUES');
  assert.throws(() => normalizeFields([{ key: 'Bad Key', label: 'x', type: 'text' }]), (e) => e.code === 'INVALID_TEMPLATE');
  assert.throws(() => normalizeFields([{ key: 'a', label: 'x', type: 'select', options: ['one'] }]), (e) => e.code === 'INVALID_TEMPLATE');
  assert.throws(() => normalizeApproval({ steps: [{ kind: 'role', role: 'manager', when: { field: 'item', gte: 1 } }] }, fields), (e) => e.code === 'INVALID_TEMPLATE');
});

test('заявка проходит цепочку: порог суммы добавляет шаг, свой шаг чужому не отдаётся, версии шаблона неизменны', { skip }, async (t) => {
  const { base, people } = await company(t);
  const made = await call(base, '/api/v1/request-templates', { cookie: people.admin.cookie, method: 'POST', body: purchaseTemplate() });
  assert.equal(made.status, 201);
  const templateId = made.payload.template.id;
  assert.equal((await call(base, '/api/v1/request-templates', { cookie: people.alice.cookie, method: 'POST', body: purchaseTemplate() })).status, 403, 'шаблоны ведут не все');
  assert.equal((await call(base, '/api/v1/request-templates', { cookie: people.guest.cookie })).status, 404, 'гость модуля не видит');

  // Малая сумма: один шаг — руководитель.
  const small = await call(base, '/api/v1/requests', { cookie: people.alice.cookie, method: 'POST', body: { templateId, values: { item: 'Мышь', amount: 3000 } } });
  assert.equal(small.status, 201);
  const smallId = small.payload.request.id;
  assert.equal(small.payload.request.steps.length, 1);
  assert.equal(small.payload.request.status, 'submitted');
  assert.equal((await call(base, `/api/v1/requests/${smallId}`, { cookie: people.bob.cookie })).status, 404, 'чужую заявку не видно');
  assert.equal((await call(base, `/api/v1/requests/${smallId}/decision`, { cookie: people.bob.cookie, method: 'POST', body: { decision: 'approve' } })).status, 404);
  assert.equal((await call(base, `/api/v1/requests/${smallId}/decision`, { cookie: people.alice.cookie, method: 'POST', body: { decision: 'approve' } })).code, 'NOT_AN_APPROVER', 'свою заявку не согласуют');
  const queue = await call(base, '/api/v1/requests?scope=approve', { cookie: people.manager.cookie });
  assert.ok(queue.payload.items.some((r) => r.id === smallId), 'руководитель видит заявку в очереди');
  assert.equal((await call(base, `/api/v1/requests/${smallId}/decision`, { cookie: people.manager.cookie, method: 'POST', body: { decision: 'reject' } })).code, 'COMMENT_REQUIRED');
  const approved = await call(base, `/api/v1/requests/${smallId}/decision`, { cookie: people.manager.cookie, method: 'POST', body: { decision: 'approve' } });
  assert.equal(approved.payload.request.status, 'approved');

  // Большая сумма: два шага; руководитель не может закрыть шаг администратора.
  const big = await call(base, '/api/v1/requests', { cookie: people.alice.cookie, method: 'POST', body: { templateId, values: { item: 'Сервер', amount: 250000 } } });
  const bigId = big.payload.request.id;
  assert.equal(big.payload.request.steps.length, 2);
  assert.equal((await call(base, `/api/v1/requests/${bigId}/decision`, { cookie: people.manager.cookie, method: 'POST', body: { decision: 'approve' } })).payload.request.status, 'submitted');
  assert.equal((await call(base, `/api/v1/requests/${bigId}/decision`, { cookie: people.manager.cookie, method: 'POST', body: { decision: 'approve' } })).code, 'NOT_AN_APPROVER');
  const done = await call(base, `/api/v1/requests/${bigId}/decision`, { cookie: people.admin.cookie, method: 'POST', body: { decision: 'approve' } });
  assert.equal(done.payload.request.status, 'approved');
  assert.equal((await call(base, `/api/v1/requests/${bigId}/complete`, { cookie: people.alice.cookie, method: 'POST' })).payload.request.status, 'completed');

  // Правка шаблона — новая версия; старая заявка осталась на первой.
  const edited = await call(base, `/api/v1/request-templates/${templateId}`, { cookie: people.admin.cookie, method: 'PATCH',
    body: { approval: { steps: [{ kind: 'role', role: 'admin' }] } } });
  assert.equal(edited.payload.template.version, 2);
  assert.equal((await call(base, `/api/v1/requests/${smallId}`, { cookie: people.alice.cookie })).payload.request.templateVersion, 1);
  const again = await call(base, '/api/v1/requests', { cookie: people.alice.cookie, method: 'POST', body: { templateId, values: { item: 'Кабель', amount: 10 } } });
  assert.equal(again.payload.request.templateVersion, 2);
  assert.equal(again.payload.request.steps[0].role, 'admin');
});

test('уточнение: заявка возвращается подавшему, он отвечает, шаг снова ждёт; отзыв и отказ', { skip }, async (t) => {
  const { base, people } = await company(t);
  const templateId = (await call(base, '/api/v1/request-templates', { cookie: people.owner.cookie, method: 'POST', body: purchaseTemplate() })).payload.template.id;
  const submit = async (amount = 100) => (await call(base, '/api/v1/requests', { cookie: people.alice.cookie, method: 'POST', body: { templateId, values: { item: 'Стул', amount } } })).payload.request.id;
  const id = await submit();
  const ask = await call(base, `/api/v1/requests/${id}/decision`, { cookie: people.manager.cookie, method: 'POST', body: { decision: 'needs_info', comment: 'Какая модель?' } });
  assert.equal(ask.payload.request.status, 'needs_info');
  const inbox = await call(base, '/api/v1/notifications?limit=20', { cookie: people.alice.cookie });
  assert.ok(inbox.payload.items.some((n) => n.type === 'request.decided'), 'подавший получил уведомление');
  assert.equal((await call(base, `/api/v1/requests/${id}/respond`, { cookie: people.bob.cookie, method: 'POST', body: { values: {} } })).status, 404);
  const answered = await call(base, `/api/v1/requests/${id}/respond`, { cookie: people.alice.cookie, method: 'POST', body: { values: { item: 'Стул Ikea', amount: 120 }, comment: 'Модель Markus' } });
  assert.equal(answered.payload.request.status, 'submitted');
  assert.equal(answered.payload.request.values.item, 'Стул Ikea');
  const rejected = await call(base, `/api/v1/requests/${id}/decision`, { cookie: people.manager.cookie, method: 'POST', body: { decision: 'reject', comment: 'Нет бюджета' } });
  assert.equal(rejected.payload.request.status, 'rejected');
  assert.equal((await call(base, `/api/v1/requests/${id}/decision`, { cookie: people.manager.cookie, method: 'POST', body: { decision: 'approve' } })).code, 'REQUEST_NOT_PENDING');
  const history = (await call(base, `/api/v1/requests/${id}`, { cookie: people.alice.cookie })).payload.request.events.map((e) => e.event);
  assert.deepEqual(history, ['submitted', 'needs_info', 'responded', 'rejected']);

  const other = await submit();
  assert.equal((await call(base, `/api/v1/requests/${other}/cancel`, { cookie: people.alice.cookie, method: 'POST', body: {} })).payload.request.status, 'cancelled');
  const q = await call(base, '/api/v1/requests/queue', { cookie: people.manager.cookie });
  assert.equal(typeof q.payload.queue.pending, 'number');
});

test('одобрение заводит задачу ровно один раз, а без порога заявка одобряется сразу', { skip }, async (t) => {
  const { base, people } = await company(t);
  const access = await call(base, '/api/v1/request-templates', { cookie: people.owner.cookie, method: 'POST', body: {
    title: 'Доступ', fields: [{ key: 'system', label: 'Система', type: 'text', required: true }, { key: 'until', label: 'До', type: 'date' }],
    approval: { steps: [{ kind: 'role', role: 'admin' }] },
    taskMapping: { enabled: true, titleField: 'system', dueField: 'until', assigneeId: people.bob.id },
  } });
  assert.equal(access.status, 201);
  const sent = await call(base, '/api/v1/requests', { cookie: people.alice.cookie, method: 'POST', body: { templateId: access.payload.template.id, values: { system: 'Jira', until: '2026-12-31' } } });
  const id = sent.payload.request.id;
  const ok = await call(base, `/api/v1/requests/${id}/decision`, { cookie: people.admin.cookie, method: 'POST', body: { decision: 'approve' } });
  assert.equal(ok.payload.request.status, 'approved');
  assert.ok(ok.payload.request.taskId, 'задача заведена');
  const task = await call(base, `/api/v1/tasks/${ok.payload.request.taskId}`, { cookie: people.bob.cookie });
  assert.equal(task.status, 200);
  assert.equal(task.payload.task.title, 'Jira');
  assert.equal(task.payload.task.ownerId, people.bob.id);

  const free = await call(base, '/api/v1/request-templates', { cookie: people.owner.cookie, method: 'POST', body: {
    title: 'Уведомление', fields: [{ key: 'text', label: 'Текст', type: 'textarea', required: true }], approval: { steps: [] } } });
  const auto = await call(base, '/api/v1/requests', { cookie: people.bob.cookie, method: 'POST', body: { templateId: free.payload.template.id, values: { text: 'Я на больничном' } } });
  assert.equal(auto.payload.request.status, 'approved');
});

test('в компании из одного владельца шаг, на который некому ответить, пропускается с пометкой', { skip }, async (t) => {
  const app = await createChatServer({ databaseUrl: DATABASE_URL, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const suffix = randomUUID().slice(0, 8);
  const owner = await call(base, '/api/v1/auth/register-company', { method: 'POST',
    body: { companyName: `Solo ${suffix}`, ownerName: 'Один', email: `solo-${suffix}@t.test`, password: 'OwnerPassword42' } });
  const template = await call(base, '/api/v1/request-templates', { cookie: owner.cookie, method: 'POST', body: purchaseTemplate() });
  const sent = await call(base, '/api/v1/requests', { cookie: owner.cookie, method: 'POST',
    body: { templateId: template.payload.template.id, values: { item: 'Лампа', amount: 500 } } });
  assert.equal(sent.status, 201);
  assert.equal(sent.payload.request.status, 'approved');
  assert.ok(sent.payload.request.events.some((e) => e.event === 'step_skipped'));
});
