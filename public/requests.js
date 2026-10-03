// Заявки и согласования: подать заявку по шаблону, ответить на чужую, вести шаблоны.
// Экран рисуется тем же слоем, что поиск и файлы (.dwc-overlay), поэтому «назад», фокус и закрытие работают одинаково.
const R = { tab: 'mine', templates: [], canManage: false, queue: null };
const $ = (q, r = document) => r.querySelector(q);
const esc = (v = '') => String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const locale = () => (window.ChatPreferences?.locale === 'en' ? 'en' : 'ru');
const tr = (ru, en) => (locale() === 'en' ? en : ru);

const STATUS = {
  submitted: () => tr('На согласовании', 'In approval'), needs_info: () => tr('Нужно уточнение', 'Needs info'),
  approved: () => tr('Одобрена', 'Approved'), rejected: () => tr('Отклонена', 'Rejected'),
  cancelled: () => tr('Отозвана', 'Withdrawn'), completed: () => tr('Выполнена', 'Completed'),
};
const ROLE = { manager: () => tr('руководитель', 'manager'), admin: () => tr('администратор', 'administrator'), owner: () => tr('владелец', 'owner') };
const EVENT = {
  submitted: () => tr('Подана', 'Submitted'), auto_approved: () => tr('Одобрена автоматически', 'Approved automatically'),
  approved_step: () => tr('Шаг согласован', 'Step approved'), rejected: () => tr('Отклонена', 'Rejected'),
  needs_info: () => tr('Запрошено уточнение', 'More information requested'), responded: () => tr('Ответ подавшего', 'Requester replied'),
  cancelled: () => tr('Отозвана', 'Withdrawn'), completed: () => tr('Отмечена выполненной', 'Marked completed'),
  step_skipped: () => tr('Шаг пропущен: других согласующих нет', 'Step skipped: no other approvers'), task_created: () => tr('Заведена задача', 'Task created'), task_failed: () => tr('Задачу завести не удалось', 'Could not create the task'),
};
const STARTERS = [
  { title: ['Отпуск', 'Time off'], fields: [
    { key: 'from', label: 'С какого числа', type: 'date', required: true }, { key: 'to', label: 'По какое число', type: 'date', required: true },
    { key: 'note', label: 'Комментарий', type: 'textarea' }], approval: { steps: [{ kind: 'role', role: 'manager' }] } },
  { title: ['Покупка', 'Purchase'], fields: [
    { key: 'item', label: 'Что купить', type: 'text', required: true }, { key: 'amount', label: 'Сумма', type: 'money', required: true },
    { key: 'why', label: 'Зачем это нужно', type: 'textarea' }],
  approval: { steps: [{ kind: 'role', role: 'manager' }, { kind: 'role', role: 'admin', when: { field: 'amount', gte: 100000 } }] },
  taskMapping: { enabled: true, titleField: 'item' } },
  { title: ['Доступ к системе', 'System access'], fields: [
    { key: 'system', label: 'Система', type: 'text', required: true }, { key: 'reason', label: 'Зачем нужен доступ', type: 'textarea', required: true }],
  approval: { steps: [{ kind: 'role', role: 'admin' }] } },
];

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || tr('Не получилось', 'Something went wrong')), { status: response.status, code: payload?.error?.code });
  return payload;
}
const toast = (text) => window.ChatApp?.toast?.(text) ?? alert(text);
const when = (value) => (value ? new Intl.DateTimeFormat(locale() === 'en' ? 'en-GB' : 'ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '');
const money = (n) => new Intl.NumberFormat(locale() === 'en' ? 'en-GB' : 'ru').format(n);

function shell(body) {
  const root = $('.dwc-overlay');
  if (!root) return;
  root.querySelector('[data-rq-body]').innerHTML = body;
}

async function open(initialTab = 'mine') {
  document.querySelector('.dwc-overlay')?.remove();
  window.ChatApp?.ghostOverlay?.push(() => document.querySelector('.dwc-overlay')?.remove());
  const root = document.createElement('div');
  root.className = 'dwc-overlay';
  root.innerHTML = `<section class="dwc-drawer wide"><header class="dwc-head"><div><p class="kicker">${tr('СОГЛАСОВАНИЯ', 'APPROVALS')}</p><h2>${tr('Заявки', 'Requests')}</h2></div><button class="dwc-icon-button" data-dwc-close aria-label="${tr('Закрыть', 'Close')}">×</button></header>
    <div class="dwc-filter-row" data-rq-tabs style="padding:0 18px"></div><div data-rq-body style="padding:14px 18px 28px;overflow:auto"></div></section>`;
  document.body.append(root);
  R.tab = initialTab;
  const pending = window.ChatRequestsPending; window.ChatRequestsPending = null;
  await refreshTabs();
  if (pending) return detail(pending);
  return show(R.tab);
}

async function refreshTabs() {
  try {
    const [templates, queue] = await Promise.all([api('/api/v1/request-templates'), api('/api/v1/requests/queue')]);
    R.templates = templates.items; R.canManage = templates.canManage; R.queue = queue.queue;
  } catch (error) { shell(`<p class="muted">${esc(error.message)}</p>`); return; }
  const tabs = [['mine', tr('Мои', 'Mine')], ['approve', `${tr('На согласование', 'To approve')}${R.queue?.awaitingMe ? ` · ${R.queue.awaitingMe}` : ''}`], ['new', tr('Новая заявка', 'New request')]];
  if (R.canManage) tabs.push(['all', tr('Все', 'All')], ['templates', tr('Шаблоны', 'Templates')]);
  const box = $('[data-rq-tabs]');
  box.innerHTML = tabs.map(([key, label]) => `<button class="dwc-filter${R.tab === key ? ' active' : ''}" data-rq-tab="${key}">${esc(label)}</button>`).join('');
  box.querySelectorAll('[data-rq-tab]').forEach((b) => { b.onclick = () => show(b.dataset.rqTab); });
}

async function show(tab) {
  R.tab = tab;
  document.querySelectorAll('[data-rq-tab]').forEach((b) => b.classList.toggle('active', b.dataset.rqTab === tab));
  if (tab === 'new') return newRequest();
  if (tab === 'templates') return templatesScreen();
  try {
    const { items } = await api(`/api/v1/requests?scope=${tab}`);
    const queue = R.queue ? `<p class="muted" style="margin:0 0 12px">${tr('Ждут решения', 'Pending')}: ${R.queue.pending} · ${tr('нужно уточнение', 'need info')}: ${R.queue.needsInfo} · ${tr('в исполнении', 'in progress')}: ${R.queue.inExecution}${R.queue.avgCycleHours ? ` · ${tr('средний цикл', 'avg. cycle')}: ${R.queue.avgCycleHours} ${tr('ч', 'h')}` : ''}</p>` : '';
    shell(`${tab === 'all' || tab === 'approve' ? queue : ''}${items.length ? items.map(row).join('') : `<div class="empty"><strong>${tab === 'approve' ? tr('Нечего согласовывать', 'Nothing to approve') : tr('Заявок пока нет', 'No requests yet')}</strong>${tab === 'mine' ? tr('Нажмите «Новая заявка», чтобы подать первую.', 'Use “New request” to submit the first one.') : ''}</div>`}`);
    document.querySelectorAll('[data-rq-open]').forEach((b) => { b.onclick = () => detail(b.dataset.rqOpen); });
  } catch (error) { shell(`<p class="muted">${esc(error.message)}</p>`); }
}

const row = (r) => `<button class="row pressable" data-rq-open="${esc(r.id)}" style="width:100%;text-align:left"><span><div class="row-title">${esc(r.title)}</div>
  <div class="row-sub">${esc(r.templateTitle ?? '')} · ${esc(r.requesterName ?? '')} · ${esc(when(r.submittedAt))}</div></span>
  <span class="chip ${r.status === 'approved' || r.status === 'completed' ? 'good' : r.status === 'rejected' ? 'danger' : 'warm'}">${esc(STATUS[r.status]())}</span></button>`;

function fieldInput(f, value = '') {
  const id = `rq-${f.key}`;
  const label = `${esc(f.label)}${f.required ? ' *' : ''}`;
  if (f.type === 'textarea') return `<label class="field-group"><span>${label}</span><textarea name="${f.key}" rows="3" maxlength="4000">${esc(value)}</textarea></label>`;
  if (f.type === 'select') return `<label class="field-group"><span>${label}</span><select name="${f.key}" class="field"><option value=""></option>${f.options.map((o) => `<option${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  if (f.type === 'checkbox') return `<label class="switch-row"><input type="checkbox" name="${f.key}"${value ? ' checked' : ''}><span class="row-title">${label}</span></label>`;
  const type = f.type === 'date' ? 'date' : f.type === 'number' || f.type === 'money' ? 'number' : 'text';
  return `<label class="field-group"><span>${label}</span><input id="${id}" name="${f.key}" type="${type}"${type === 'number' ? ' step="any" min="' + (f.type === 'money' ? 0 : '') + '"' : ''} value="${esc(value)}"></label>`;
}
function readForm(form, fields) {
  const values = {};
  for (const f of fields) {
    const el = form.elements[f.key];
    if (!el) continue;
    values[f.key] = f.type === 'checkbox' ? el.checked : el.value;
  }
  return values;
}

function newRequest() {
  if (!R.templates.length) {
    shell(`<div class="empty"><strong>${tr('Шаблонов пока нет', 'No templates yet')}</strong>${R.canManage ? tr('Создайте первый на вкладке «Шаблоны».', 'Create the first one in “Templates”.') : tr('Попросите администратора завести шаблон заявки.', 'Ask an administrator to set up a request template.')}</div>`);
    return;
  }
  shell(`<p class="muted" style="margin:0 0 10px">${tr('Что нужно оформить?', 'What do you need?')}</p>${R.templates.map((t) => `<button class="row pressable" data-rq-template="${esc(t.id)}" style="width:100%;text-align:left"><span><div class="row-title">${esc(t.title)}</div><div class="row-sub">${t.approval.steps.length ? t.approval.steps.map((s) => (s.kind === 'role' ? ROLE[s.role]() : tr('человек', 'person'))).join(' → ') : tr('без согласования', 'no approval needed')}</div></span><span>›</span></button>`).join('')}`);
  document.querySelectorAll('[data-rq-template]').forEach((b) => { b.onclick = () => form(R.templates.find((t) => t.id === b.dataset.rqTemplate)); });
}

function form(template) {
  shell(`<button class="text-button" data-rq-back>‹ ${tr('Назад', 'Back')}</button><h3 style="margin:8px 0 4px">${esc(template.title)}</h3>${template.description ? `<p class="muted">${esc(template.description)}</p>` : ''}
    <form id="rq-form" class="form-stack">${template.fields.map((f) => fieldInput(f)).join('')}<p id="rq-error" class="muted" style="color:var(--danger)" role="alert"></p><button class="button primary" type="submit">${tr('Отправить заявку', 'Submit request')}</button></form>`);
  $('[data-rq-back]').onclick = () => show('new');
  $('#rq-form').onsubmit = async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type=submit]'); button.disabled = true;
    try {
      const { request } = await api('/api/v1/requests', { method: 'POST', body: { templateId: template.id, values: readForm(event.target, template.fields) } });
      toast(request.status === 'approved' ? tr('Заявка одобрена автоматически', 'Request approved automatically') : tr('Заявка отправлена на согласование', 'Request sent for approval'));
      await refreshTabs(); await detail(request.id);
    } catch (error) { $('#rq-error').textContent = error.message; button.disabled = false; }
  };
}

async function detail(id) {
  try {
    const { request: r } = await api(`/api/v1/requests/${id}`);
    const values = r.fields.map((f) => `<div class="row-sub"><strong>${esc(f.label)}:</strong> ${esc(f.type === 'checkbox' ? (r.values[f.key] ? tr('да', 'yes') : tr('нет', 'no')) : f.type === 'money' && r.values[f.key] !== undefined ? money(r.values[f.key]) : (r.values[f.key] ?? '—'))}</div>`).join('');
    const steps = r.steps.map((s) => `<div class="row-sub">${r.currentStep === s.step && r.status === 'submitted' ? '▶ ' : ''}${s.kind === 'role' ? esc(ROLE[s.role]()) : esc(s.userName ?? tr('человек', 'person'))}: <strong>${esc({ pending: tr('ждёт', 'waiting'), approved: tr('согласовал', 'approved'), rejected: tr('отклонил', 'rejected'), needs_info: tr('спросил', 'asked') }[s.decision])}</strong>${s.comment ? ` — «${esc(s.comment)}»` : ''}</div>`).join('');
    const events = r.events.map((e) => `<div class="row-sub">${esc(when(e.createdAt))} · ${esc(e.actorName ?? tr('система', 'system'))} · ${esc((EVENT[e.event] ?? (() => e.event))())}${e.comment ? ` — «${esc(e.comment)}»` : ''}</div>`).join('');
    const canAnswer = r.awaitingMe;
    shell(`<button class="text-button" data-rq-back>‹ ${tr('К списку', 'Back to list')}</button>
      <h3 style="margin:8px 0 2px">${esc(r.title)}</h3>
      <p class="row-sub"><span class="chip ${r.status === 'approved' || r.status === 'completed' ? 'good' : r.status === 'rejected' ? 'danger' : 'warm'}">${esc(STATUS[r.status]())}</span> ${esc(r.templateTitle ?? '')} (v${r.templateVersion}) · ${esc(r.requesterName ?? '')}</p>
      <div class="surface" style="margin:10px 0">${values}</div>
      ${steps ? `<div class="section-title">${tr('Согласование', 'Approval')}</div>${steps}` : ''}
      ${r.taskId ? `<p style="margin:10px 0"><button class="button secondary small" data-rq-task="${esc(r.taskId)}">${tr('Открыть задачу', 'Open task')}</button></p>` : ''}
      <div data-rq-actions style="margin:12px 0" class="inline-actions">
        ${canAnswer ? `<button class="button primary" data-rq-decide="approve">${tr('Согласовать', 'Approve')}</button><button class="button secondary" data-rq-decide="needs_info">${tr('Запросить уточнение', 'Ask for details')}</button><button class="button danger" data-rq-decide="reject">${tr('Отклонить', 'Reject')}</button>` : ''}
        ${r.canRespond ? `<button class="button primary" data-rq-respond>${tr('Ответить и отправить снова', 'Reply and resubmit')}</button>` : ''}
        ${r.canComplete ? `<button class="button secondary" data-rq-complete>${tr('Отметить выполненной', 'Mark as completed')}</button>` : ''}
        ${r.canCancel ? `<button class="button secondary" data-rq-cancel>${tr('Отозвать заявку', 'Withdraw request')}</button>` : ''}
      </div>
      <div data-rq-extra></div>
      <div class="section-title">${tr('История', 'History')}</div>${events}`);
    $('[data-rq-back]').onclick = () => show(R.tab === 'new' || R.tab === 'templates' ? 'mine' : R.tab);
    $('[data-rq-task]')?.addEventListener('click', (e) => window.ChatApp?.openTask?.(e.currentTarget.dataset.rqTask));
    const act = async (path, body) => {
      try { await api(`/api/v1/requests/${id}/${path}`, { method: 'POST', body }); await refreshTabs(); await detail(id); } catch (error) { toast(error.message); }
    };
    document.querySelectorAll('[data-rq-decide]').forEach((b) => {
      b.onclick = () => {
        const decision = b.dataset.rqDecide;
        if (decision === 'approve') return act('decision', { decision });
        $('[data-rq-extra]').innerHTML = `<form class="form-stack" id="rq-comment"><label class="field-group"><span>${decision === 'reject' ? tr('Почему отклоняете', 'Why are you rejecting') : tr('Что нужно уточнить', 'What needs clarifying')} *</span><textarea name="comment" rows="3" required></textarea></label><button class="button primary" type="submit">${tr('Отправить', 'Send')}</button></form>`;
        $('#rq-comment').onsubmit = (e) => { e.preventDefault(); act('decision', { decision, comment: new FormData(e.target).get('comment') }); };
        $('#rq-comment textarea').focus();
      };
    });
    $('[data-rq-complete]')?.addEventListener('click', () => act('complete', {}));
    $('[data-rq-cancel]')?.addEventListener('click', () => act('cancel', {}));
    $('[data-rq-respond]')?.addEventListener('click', () => {
      $('[data-rq-extra]').innerHTML = `<form class="form-stack" id="rq-reply">${r.fields.map((f) => fieldInput(f, r.values[f.key] ?? '')).join('')}<label class="field-group"><span>${tr('Ответ на вопрос', 'Your answer')}</span><textarea name="__comment" rows="2"></textarea></label><button class="button primary" type="submit">${tr('Отправить снова', 'Resubmit')}</button></form>`;
      $('#rq-reply').onsubmit = (e) => { e.preventDefault(); act('respond', { values: readForm(e.target, r.fields), comment: e.target.elements.__comment.value }); };
    });
  } catch (error) { shell(`<p class="muted">${esc(error.message)}</p><button class="text-button" data-rq-back>‹ ${tr('К списку', 'Back to list')}</button>`); $('[data-rq-back]').onclick = () => show('mine'); }
}

// ---------- шаблоны (владелец и администраторы) ----------
function templatesScreen() {
  shell(`<p class="muted" style="margin:0 0 10px">${tr('Шаблон — это поля заявки и цепочка согласования. Правка создаёт новую версию: уже поданные заявки не меняются.', 'A template is the request fields plus the approval chain. Editing creates a new version; submitted requests stay as they were.')}</p>
    ${R.templates.map((t) => `<div class="row flow"><span><div class="row-title">${esc(t.title)} <span class="muted">v${t.version}</span></div><div class="row-sub">${t.fields.length} ${tr('полей', 'fields')} · ${t.approval.steps.length ? t.approval.steps.map((s) => (s.kind === 'role' ? ROLE[s.role]() : tr('человек', 'person'))).join(' → ') : tr('без согласования', 'no approval')}</div></span><button class="text-button" data-rq-archive="${esc(t.id)}">${tr('в архив', 'archive')}</button></div>`).join('')}
    <div class="section-title" style="margin-top:14px">${tr('Создать из образца', 'Create from a starter')}</div>
    <div class="inline-actions">${STARTERS.map((s, i) => `<button class="button secondary small" data-rq-starter="${i}">${esc(tr(...s.title))}</button>`).join('')}</div>
    <div class="section-title" style="margin-top:14px">${tr('Свой шаблон', 'Custom template')}</div>
    <form id="rq-template" class="form-stack">
      <label class="field-group"><span>${tr('Название', 'Title')}</span><input name="title" required maxlength="160"></label>
      <label class="field-group"><span>${tr('Поля: по одному в строке — ключ | подпись | тип | * если обязательное | варианты через запятую', 'Fields, one per line: key | label | type | * if required | options separated by commas')}</span>
        <textarea name="fields" rows="5" placeholder="item | Что купить | text | *&#10;amount | Сумма | money | *&#10;kind | Вид | select | | Офис, Склад"></textarea></label>
      <p class="muted" style="margin:0;font-size:12px">${tr('Типы: text, textarea, number, money, date, select, checkbox.', 'Types: text, textarea, number, money, date, select, checkbox.')}</p>
      <label class="field-group"><span>${tr('Кто согласует (по порядку)', 'Approvers (in order)')}</span><select name="approvers" class="field"><option value="">${tr('Без согласования', 'No approval')}</option><option value="manager">${tr('Руководитель', 'Manager')}</option><option value="manager,admin">${tr('Руководитель → администратор', 'Manager → administrator')}</option><option value="admin">${tr('Администратор', 'Administrator')}</option><option value="owner">${tr('Владелец', 'Owner')}</option></select></label>
      <label class="field-group"><span>${tr('Последнему шагу нужна сумма от (поле money/number — ключ, порог)', 'Last step only above an amount (money/number field key, threshold)')}</span><input name="threshold" placeholder="amount, 100000"></label>
      <label class="switch-row"><input type="checkbox" name="task"><span class="row-title">${tr('После одобрения завести задачу', 'Create a task after approval')}</span></label>
      <p id="rq-error" class="muted" style="color:var(--danger)" role="alert"></p><button class="button primary" type="submit">${tr('Создать шаблон', 'Create template')}</button></form>`);
  document.querySelectorAll('[data-rq-archive]').forEach((b) => {
    b.onclick = async () => { try { await api(`/api/v1/request-templates/${b.dataset.rqArchive}/archive`, { method: 'POST', body: {} }); await refreshTabs(); templatesScreen(); } catch (e) { toast(e.message); } };
  });
  document.querySelectorAll('[data-rq-starter]').forEach((b) => {
    b.onclick = async () => {
      const s = STARTERS[Number(b.dataset.rqStarter)];
      try {
        await api('/api/v1/request-templates', { method: 'POST', body: { title: tr(...s.title), fields: s.fields.map((f) => ({ ...f, label: f.label })), approval: s.approval, taskMapping: s.taskMapping } });
        toast(tr('Шаблон создан', 'Template created')); await refreshTabs(); templatesScreen();
      } catch (e) { toast(e.message); }
    };
  });
  $('#rq-template').onsubmit = async (event) => {
    event.preventDefault();
    const f = event.target.elements;
    try {
      const fields = f.fields.value.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
        const [key, label, type, req, options] = line.split('|').map((x) => x.trim());
        return { key, label, type: type || 'text', required: req === '*', ...(options ? { options: options.split(',').map((o) => o.trim()).filter(Boolean) } : {}) };
      });
      const roles = f.approvers.value ? f.approvers.value.split(',') : [];
      const steps = roles.map((role) => ({ kind: 'role', role }));
      const [field, gte] = f.threshold.value.split(',').map((x) => x.trim());
      if (steps.length > 1 && field && gte) steps[steps.length - 1].when = { field, gte: Number(gte) };
      await api('/api/v1/request-templates', { method: 'POST', body: { title: f.title.value, fields, approval: { steps }, taskMapping: { enabled: f.task.checked } } });
      toast(tr('Шаблон создан', 'Template created')); await refreshTabs(); templatesScreen();
    } catch (error) { $('#rq-error').textContent = error.message; }
  };
}

window.ChatRequests = { open };
