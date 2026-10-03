import { randomUUID } from 'node:crypto';

/**
 * Структурные заявки и цепочка согласования.
 *
 * Шаблон версионируется: заявка ссылается на конкретную версию, а правка шаблона создаёт новую, поэтому
 * уже поданные заявки не меняются задним числом. Исполнением заявка не занимается — при желании по
 * одобрению заводится обычная задача (ровно один раз), и дальше её статус живёт только в задаче.
 */

const RANK = { guest: 0, member: 1, manager: 2, admin: 3, owner: 4 };
const FIELD_TYPES = new Set(['text', 'textarea', 'number', 'money', 'date', 'select', 'checkbox']);
const STEP_ROLES = new Set(['manager', 'admin', 'owner']);
const MAX_FIELDS = 30;
const MAX_STEPS = 5;

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode, expose: true });

/** Поля шаблона: ключ, подпись, тип, обязательность, варианты — этого хватает для отпуска, покупки и доступа. */
export function normalizeFields(raw) {
  if (!Array.isArray(raw) || !raw.length) throw fail('В шаблоне нужно хотя бы одно поле', 'INVALID_TEMPLATE');
  if (raw.length > MAX_FIELDS) throw fail(`Полей не больше ${MAX_FIELDS}`, 'INVALID_TEMPLATE');
  const seen = new Set();
  return raw.map((field) => {
    const key = String(field?.key ?? '').trim();
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) throw fail('Ключ поля — латиница, цифры и «_», не длиннее 32 знаков', 'INVALID_TEMPLATE');
    if (seen.has(key)) throw fail(`Поле «${key}» указано дважды`, 'INVALID_TEMPLATE');
    seen.add(key);
    const label = String(field?.label ?? '').trim();
    if (!label || label.length > 120) throw fail('У каждого поля есть подпись до 120 знаков', 'INVALID_TEMPLATE');
    const type = String(field?.type ?? 'text');
    if (!FIELD_TYPES.has(type)) throw fail(`Неизвестный тип поля «${type}»`, 'INVALID_TEMPLATE');
    const out = { key, label, type, required: Boolean(field?.required) };
    if (type === 'select') {
      const options = Array.isArray(field?.options) ? field.options.map((o) => String(o).trim()).filter(Boolean) : [];
      if (options.length < 2 || options.length > 30) throw fail(`У поля «${label}» нужно от 2 до 30 вариантов`, 'INVALID_TEMPLATE');
      out.options = [...new Set(options)];
    }
    return out;
  });
}

/** Шаги согласования: по роли («руководитель и выше») или по человеку; необязательное условие по числовому полю. */
export function normalizeApproval(raw, fields) {
  const steps = Array.isArray(raw?.steps) ? raw.steps : [];
  if (steps.length > MAX_STEPS) throw fail(`Шагов согласования не больше ${MAX_STEPS}`, 'INVALID_TEMPLATE');
  const numeric = new Set(fields.filter((f) => f.type === 'number' || f.type === 'money').map((f) => f.key));
  return {
    steps: steps.map((step) => {
      const out = {};
      if (step?.kind === 'user') {
        if (!/^[0-9a-f-]{36}$/i.test(String(step.userId ?? ''))) throw fail('Для шага по человеку нужен его идентификатор', 'INVALID_TEMPLATE');
        out.kind = 'user'; out.userId = String(step.userId);
      } else {
        const role = String(step?.role ?? 'manager');
        if (!STEP_ROLES.has(role)) throw fail('Роль согласующего: руководитель, администратор или владелец', 'INVALID_TEMPLATE');
        out.kind = 'role'; out.role = role;
      }
      if (step?.when) {
        const field = String(step.when.field ?? '');
        const gte = Number(step.when.gte);
        if (!numeric.has(field) || !Number.isFinite(gte)) throw fail('Условие шага — числовое поле и порог', 'INVALID_TEMPLATE');
        out.when = { field, gte };
      }
      return out;
    }),
  };
}

export function normalizeTaskMapping(raw, fields) {
  if (!raw?.enabled) return {};
  const keys = new Set(fields.map((f) => f.key));
  const out = { enabled: true };
  if (raw.titleField) { if (!keys.has(raw.titleField)) throw fail('titleField не найден среди полей', 'INVALID_TEMPLATE'); out.titleField = raw.titleField; }
  if (raw.dueField) { if (!keys.has(raw.dueField)) throw fail('dueField не найден среди полей', 'INVALID_TEMPLATE'); out.dueField = raw.dueField; }
  if (raw.assigneeId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(raw.assigneeId))) throw fail('Исполнитель указан неверно', 'INVALID_TEMPLATE');
    out.assigneeId = String(raw.assigneeId);
  }
  return out;
}

/** Значения заявки сверяются с полями ВЕРСИИ шаблона: что пришло лишнего — отбрасывается, чего нет — ошибка. */
export function validateValues(fields, rawValues) {
  const values = {};
  const input = rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues) ? rawValues : {};
  for (const field of fields) {
    let value = input[field.key];
    const empty = value === undefined || value === null || value === '' || (field.type === 'checkbox' && value === false && false);
    if (empty) {
      if (field.required && field.type !== 'checkbox') throw fail(`Заполните поле «${field.label}»`, 'INVALID_REQUEST_VALUES');
      if (field.type === 'checkbox') values[field.key] = false;
      continue;
    }
    switch (field.type) {
      case 'text': case 'textarea': {
        if (typeof value !== 'string') throw fail(`«${field.label}» — текст`, 'INVALID_REQUEST_VALUES');
        value = value.trim();
        if (value.length > (field.type === 'text' ? 300 : 4000)) throw fail(`«${field.label}» слишком длинное`, 'INVALID_REQUEST_VALUES');
        if (!value && field.required) throw fail(`Заполните поле «${field.label}»`, 'INVALID_REQUEST_VALUES');
        break;
      }
      case 'number': case 'money': {
        const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
        if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw fail(`«${field.label}» — число`, 'INVALID_REQUEST_VALUES');
        if (field.type === 'money' && n < 0) throw fail(`«${field.label}» не может быть отрицательной`, 'INVALID_REQUEST_VALUES');
        value = n;
        break;
      }
      case 'date': {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
          || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
          throw fail(`«${field.label}» — дата в виде 2026-12-31`, 'INVALID_REQUEST_VALUES');
        }
        break;
      }
      case 'select':
        if (!field.options.includes(value)) throw fail(`«${field.label}»: выберите один из вариантов`, 'INVALID_REQUEST_VALUES');
        break;
      case 'checkbox':
        value = value === true || value === 'true';
        break;
      default:
    }
    values[field.key] = value;
  }
  return values;
}

const stepApplies = (step, values) => !step.when || Number(values[step.when.field] ?? 0) >= step.when.gte;

export function createRequestRepository({ pool, store = null } = {}) {
  if (!pool) {
    const unavailable = () => { throw fail('Заявки работают только с базой данных', 'REQUESTS_UNAVAILABLE', 503); };
    return { listTemplates: unavailable, createTemplate: unavailable, updateTemplate: unavailable, archiveTemplate: unavailable,
      submit: unavailable, list: unavailable, get: unavailable, decide: unavailable, respond: unavailable, cancel: unavailable,
      complete: unavailable, queue: unavailable };
  }

  const eventOf = (client, requestId, actorId, event, comment = null) => client.query(
    'INSERT INTO request_events(request_id,actor_id,event,comment) VALUES($1,$2,$3,$4)', [requestId, actorId, event, comment]);

  /** Кто может ответить на шаг сейчас: по роли — все активные не ниже роли (кроме подавшего), по человеку — он сам. */
  const approversOf = async (client, request, step) => {
    if (step.kind === 'user') return step.user_id === request.requester_id ? [] : [step.user_id];
    const { rows } = await client.query(
      `SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.workspace_id=$1 AND u.disabled_at IS NULL AND m.user_id<>$2
          AND m.role = ANY($3::text[])`,
      [request.workspace_id, request.requester_id, Object.keys(RANK).filter((r) => RANK[r] >= RANK[step.role])]);
    return rows.map((r) => r.user_id);
  };

  const notify = async (client, request, userIds, type, title, body, dedupe) => {
    for (const userId of new Set(userIds)) {
      await client.query('SAVEPOINT request_notify');
      try {
        await client.query(
          `INSERT INTO notifications(organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body,url,priority)
           VALUES($1,$2,$3,gen_random_uuid(),$4,$5,$6,$7,$8,'high') ON CONFLICT (workspace_id,dedupe_key) DO NOTHING`,
          [request.organization_id, request.workspace_id, userId, `${dedupe}:${userId}`, type, title, body, `/#/more/requests?request=${request.id}`]);
        await client.query('RELEASE SAVEPOINT request_notify');
      } catch { await client.query('ROLLBACK TO SAVEPOINT request_notify'); }
    }
  };

  const view = (row) => ({
    id: row.id, templateId: row.template_id, templateTitle: row.template_title ?? null, templateVersion: row.template_version,
    requesterId: row.requester_id, requesterName: row.requester_name ?? null, title: row.title, values: row.values,
    status: row.status, currentStep: row.current_step, taskId: row.task_id, version: row.version,
    submittedAt: row.submitted_at, decidedAt: row.decided_at, completedAt: row.completed_at,
    steps: row.steps ?? undefined, events: row.events ?? undefined, fields: row.fields ?? undefined,
    awaitingMe: row.awaiting_me ?? undefined,
  });

  const SELECT = `
    SELECT r.*, t.title template_title, p.display_name requester_name`;
  const FROM = `
      FROM requests r
      JOIN request_templates t ON t.id=r.template_id
      LEFT JOIN workspace_profiles p ON p.workspace_id=r.workspace_id AND p.user_id=r.requester_id`;

  /** Ждёт ли заявка ответа именно от этого человека. */
  const awaitingSql = (userParam, roleParam) => `(r.status='submitted' AND EXISTS(
      SELECT 1 FROM request_steps s WHERE s.request_id=r.id AND s.step=r.current_step AND s.decision='pending' AND r.requester_id<>${userParam}
        AND ((s.kind='user' AND s.user_id=${userParam})
          OR (s.kind='role' AND (CASE ${roleParam} WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'manager' THEN 2 ELSE 0 END)
                              >= (CASE s.role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 ELSE 2 END)))))`;

  /** Одобрение может завести задачу — один раз и только по настройке шаблона. Сбой не откатывает одобрение. */
  const spawnTask = async (session, id, deciderId) => {
    if (!store?.createTask) return;
    const { rows } = await pool.query(
      `SELECT r.*,v.task_mapping,v.fields,t.title template_title FROM requests r
         JOIN request_template_versions v ON v.template_id=r.template_id AND v.version=r.template_version
         JOIN request_templates t ON t.id=r.template_id
        WHERE r.id=$1`, [id]);
    const request = rows[0];
    const mapping = request?.task_mapping ?? {};
    if (!request || request.task_id || !mapping.enabled) return;
    const ownerId = mapping.assigneeId ?? deciderId ?? request.requester_id;
    const title = String((mapping.titleField && request.values[mapping.titleField]) || request.title).slice(0, 240);
    const summary = request.fields.map((f) => `${f.label}: ${request.values[f.key] ?? '—'}`).join('\n').slice(0, 2000);
    const due = mapping.dueField && request.values[mapping.dueField] ? `${request.values[mapping.dueField]}T12:00:00.000Z` : null;
    try {
      const requesterSession = { userId: request.requester_id, workspaceId: request.workspace_id, organizationId: request.organization_id, role: 'member' };
      const task = await store.createTask(requesterSession, { title, outcome: summary, ownerId, acceptorId: request.requester_id, promisedAt: due });
      const { rowCount } = await pool.query('UPDATE requests SET task_id=$2 WHERE id=$1 AND task_id IS NULL', [id, task.id ?? task.task?.id]);
      if (rowCount) await eventOf(pool, id, null, 'task_created', title);
    } catch (error) {
      await eventOf(pool, id, null, 'task_failed', String(error?.message ?? error).slice(0, 300)).catch(() => {});
    }
  };

  const repository = {
    // ---------- шаблоны ----------
    async listTemplates(session, { includeArchived = false } = {}) {
      const { rows } = await pool.query(
        `SELECT t.id,t.title,t.description,t.status,t.current_version,t.created_at,v.fields,v.approval,v.task_mapping
           FROM request_templates t JOIN request_template_versions v ON v.template_id=t.id AND v.version=t.current_version
          WHERE t.workspace_id=$1 AND ($2 OR t.status='active') ORDER BY t.title`,
        [session.workspaceId, includeArchived]);
      return rows.map((r) => ({ id: r.id, title: r.title, description: r.description, status: r.status, version: r.current_version,
        fields: r.fields, approval: r.approval, taskMapping: r.task_mapping, createdAt: r.created_at }));
    },

    async createTemplate(session, { title, description = null, fields, approval, taskMapping }) {
      const cleanFields = normalizeFields(fields);
      const cleanApproval = normalizeApproval(approval, cleanFields);
      const mapping = normalizeTaskMapping(taskMapping, cleanFields);
      const cleanTitle = String(title ?? '').trim();
      if (!cleanTitle || cleanTitle.length > 160) throw fail('Название шаблона — до 160 знаков', 'INVALID_TEMPLATE');
      const id = randomUUID();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO request_templates(id,organization_id,workspace_id,title,description,created_by) VALUES($1,$2,$3,$4,$5,$6)`,
          [id, session.organizationId, session.workspaceId, cleanTitle, description ? String(description).slice(0, 1000) : null, session.userId]);
        await client.query(
          `INSERT INTO request_template_versions(template_id,version,fields,approval,task_mapping,created_by) VALUES($1,1,$2,$3,$4,$5)`,
          [id, JSON.stringify(cleanFields), JSON.stringify(cleanApproval), JSON.stringify(mapping), session.userId]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
      return (await repository.listTemplates(session, { includeArchived: true })).find((t) => t.id === id);
    },

    /** Правка = новая версия; поданные заявки остаются на той версии, на которой их подали. */
    async updateTemplate(session, id, { title, description, fields, approval, taskMapping }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM request_templates WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [session.workspaceId, id]);
        if (!rows[0]) throw fail('Шаблон не найден', 'TEMPLATE_NOT_FOUND', 404);
        const { rows: cur } = await client.query('SELECT * FROM request_template_versions WHERE template_id=$1 AND version=$2', [id, rows[0].current_version]);
        const cleanFields = normalizeFields(fields ?? cur[0].fields);
        const cleanApproval = normalizeApproval(approval ?? cur[0].approval, cleanFields);
        const mapping = normalizeTaskMapping(taskMapping ?? cur[0].task_mapping, cleanFields);
        const next = rows[0].current_version + 1;
        await client.query(
          `INSERT INTO request_template_versions(template_id,version,fields,approval,task_mapping,created_by) VALUES($1,$2,$3,$4,$5,$6)`,
          [id, next, JSON.stringify(cleanFields), JSON.stringify(cleanApproval), JSON.stringify(mapping), session.userId]);
        await client.query(
          `UPDATE request_templates SET current_version=$3,title=COALESCE($4,title),description=COALESCE($5,description),updated_at=now()
            WHERE workspace_id=$1 AND id=$2`,
          [session.workspaceId, id, next, title ? String(title).trim().slice(0, 160) : null, description === undefined ? null : String(description ?? '').slice(0, 1000)]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
      return (await repository.listTemplates(session, { includeArchived: true })).find((t) => t.id === id);
    },

    async archiveTemplate(session, id, archived = true) {
      const { rowCount } = await pool.query(
        `UPDATE request_templates SET status=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, id, archived ? 'archived' : 'active']);
      if (!rowCount) throw fail('Шаблон не найден', 'TEMPLATE_NOT_FOUND', 404);
      return { archived };
    },

    // ---------- заявки ----------
    async submit(session, { templateId, values, title = null }) {
      const client = await pool.connect();
      let request;
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `SELECT t.id,t.title,t.status,t.current_version,v.fields,v.approval,v.task_mapping
             FROM request_templates t JOIN request_template_versions v ON v.template_id=t.id AND v.version=t.current_version
            WHERE t.workspace_id=$1 AND t.id=$2`, [session.workspaceId, templateId]);
        const template = rows[0];
        if (!template) throw fail('Шаблон не найден', 'TEMPLATE_NOT_FOUND', 404);
        if (template.status !== 'active') throw fail('Шаблон в архиве: новые заявки по нему не принимаются', 'TEMPLATE_ARCHIVED', 409);
        const clean = validateValues(template.fields, values);
        const firstText = template.fields.find((f) => f.type === 'text' && clean[f.key]);
        const requestTitle = String(title ?? '').trim().slice(0, 200) || `${template.title}${firstText ? `: ${clean[firstText.key]}` : ''}`.slice(0, 200);
        const id = randomUUID();
        const { rows: created } = await client.query(
          `INSERT INTO requests(id,organization_id,workspace_id,template_id,template_version,requester_id,title,"values")
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [id, session.organizationId, session.workspaceId, templateId, template.current_version, session.userId, requestTitle, JSON.stringify(clean)]);
        request = created[0];
        // Шаги, чьё условие не выполнено (например, сумма ниже порога), не создаются вовсе.
        const steps = (template.approval.steps ?? []).filter((s) => stepApplies(s, clean)).filter((s) => !(s.kind === 'user' && s.userId === session.userId));
        // Если согласовать некому, кроме самого подавшего (компания из одного владельца), шаг не зависает навсегда:
        // он пропускается с пометкой в истории — но только когда подавший по рангу и был бы согласующим.
        const reachable = [];
        const skipped = [];
        for (const step of steps) {
          if (step.kind === 'role') {
            const others = await approversOf(client, { workspace_id: session.workspaceId, requester_id: session.userId }, { kind: 'role', role: step.role });
            if (!others.length && RANK[session.role] >= RANK[step.role]) { skipped.push(step); continue; }
          }
          reachable.push(step);
        }
        steps.splice(0, steps.length, ...reachable);
        for (const step of skipped) await eventOf(client, id, session.userId, 'step_skipped', `Некому согласовывать, кроме вас: шаг «${step.role}» пропущен`);
        let index = 0;
        for (const step of steps) {
          await client.query('INSERT INTO request_steps(request_id,step,kind,role,user_id) VALUES($1,$2,$3,$4,$5)',
            [id, index, step.kind, step.role ?? null, step.userId ?? null]);
          index += 1;
        }
        await eventOf(client, id, session.userId, 'submitted');
        if (!steps.length) {
          await client.query(`UPDATE requests SET status='approved',decided_at=now(),updated_at=now() WHERE id=$1`, [id]);
          await eventOf(client, id, null, 'auto_approved', 'Согласование по этому шаблону не требуется');
          request.status = 'approved';
        } else {
          const { rows: first } = await client.query('SELECT * FROM request_steps WHERE request_id=$1 AND step=0', [id]);
          await notify(client, request, await approversOf(client, request, first[0]), 'request.submitted',
            'Заявка ждёт вашего ответа', requestTitle, `request.submitted:${id}:0`);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
      if (request.status === 'approved') await spawnTask(session, request.id, null);
      return repository.get(session, request.id);
    },

    /** Видимость: свои, те, что ждут моего ответа или где я уже отвечал, а у ведущих людей — все. */
    async list(session, { scope = 'mine', status = null, limit = 50 } = {}) {
      const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
      const manage = RANK[session.role] >= RANK.admin;
      let where;
      if (scope === 'approve') where = `AND ${awaitingSql('$2', '$3')}`;
      else if (scope === 'all') {
        if (!manage) throw fail('Все заявки видят владелец и администраторы', 'FORBIDDEN', 403);
        where = '';
      } else where = 'AND r.requester_id=$2';
      const { rows } = await pool.query(
        `${SELECT}, ${scope === 'approve' ? 'true' : 'false'} awaiting_me ${FROM}
          WHERE r.workspace_id=$1 ${where} AND ($4::text IS NULL OR r.status=$4)
          ORDER BY r.submitted_at DESC LIMIT $5`,
        [session.workspaceId, session.userId, session.role, status, size]);
      return rows.map(view);
    },

    async get(session, id) {
      const { rows } = await pool.query(
        `${SELECT}, v.fields, ${awaitingSql('$2', '$3')} awaiting_me, EXISTS(SELECT 1 FROM request_steps x WHERE x.request_id=r.id AND x.decided_by=$2) i_decided
           ${FROM} JOIN request_template_versions v ON v.template_id=r.template_id AND v.version=r.template_version
          WHERE r.workspace_id=$1 AND r.id=$4`,
        [session.workspaceId, session.userId, session.role, id]);
      const row = rows[0];
      const manage = RANK[session.role] >= RANK.admin;
      if (!row || !(row.requester_id === session.userId || row.awaiting_me || row.i_decided || manage)) throw fail('Заявка не найдена', 'REQUEST_NOT_FOUND', 404);
      const [steps, events] = await Promise.all([
        pool.query(`SELECT s.step,s.kind,s.role,s.user_id "userId",s.decision,s.comment,s.decided_by "decidedBy",s.decided_at "decidedAt",
                           p.display_name "userName"
                      FROM request_steps s LEFT JOIN workspace_profiles p ON p.workspace_id=$2 AND p.user_id=s.user_id
                     WHERE s.request_id=$1 ORDER BY s.step`, [id, session.workspaceId]),
        pool.query(`SELECT e.id,e.actor_id "actorId",e.event,e.comment,e.created_at "createdAt",p.display_name "actorName"
                      FROM request_events e LEFT JOIN workspace_profiles p ON p.workspace_id=$2 AND p.user_id=e.actor_id
                     WHERE e.request_id=$1 ORDER BY e.id`, [id, session.workspaceId]),
      ]);
      return { ...view({ ...row, steps: steps.rows, events: events.rows }), canCancel: row.requester_id === session.userId && ['submitted', 'needs_info'].includes(row.status),
        canRespond: row.requester_id === session.userId && row.status === 'needs_info',
        canComplete: row.status === 'approved' && (row.requester_id === session.userId || manage) };
    },

    async decide(session, id, { decision, comment = null }) {
      if (!['approve', 'reject', 'needs_info'].includes(decision)) throw fail('Решение: согласовать, отклонить или запросить уточнение', 'INVALID_DECISION');
      const note = String(comment ?? '').trim().slice(0, 2000) || null;
      if (decision !== 'approve' && !note) throw fail('Без пояснения отклонить или вернуть заявку нельзя', 'COMMENT_REQUIRED');
      const client = await pool.connect();
      let finalApproved = false;
      let request;
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM requests WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [session.workspaceId, id]);
        request = rows[0];
        if (!request) throw fail('Заявка не найдена', 'REQUEST_NOT_FOUND', 404);
        if (request.status !== 'submitted') throw fail('Заявка сейчас не ждёт решения', 'REQUEST_NOT_PENDING', 409);
        const { rows: steps } = await client.query('SELECT * FROM request_steps WHERE request_id=$1 ORDER BY step FOR UPDATE', [id]);
        const step = steps.find((s) => s.step === request.current_step);
        if (!step || step.decision !== 'pending') throw fail('Заявка сейчас не ждёт решения', 'REQUEST_NOT_PENDING', 409);
        const eligible = session.userId !== request.requester_id && (step.kind === 'user'
          ? step.user_id === session.userId
          : RANK[session.role] >= RANK[step.role]);
        if (!eligible) {
          // Постороннему заявки не существует; подавшему и тем, кто мог её видеть по рангу, честно говорим, что шаг не их.
          const mayKnow = session.userId === request.requester_id || RANK[session.role] >= RANK.manager;
          throw mayKnow ? fail('Этот шаг согласования не ваш', 'NOT_AN_APPROVER', 403) : fail('Заявка не найдена', 'REQUEST_NOT_FOUND', 404);
        }
        const decided = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'needs_info';
        await client.query('UPDATE request_steps SET decision=$3,comment=$4,decided_by=$5,decided_at=now() WHERE request_id=$1 AND step=$2',
          [id, step.step, decided, note, session.userId]);
        await eventOf(client, id, session.userId, decision === 'approve' ? 'approved_step' : decision === 'reject' ? 'rejected' : 'needs_info', note);
        if (decision === 'approve') {
          const next = steps.find((s) => s.step === step.step + 1);
          if (next) {
            await client.query('UPDATE requests SET current_step=$2,version=version+1,updated_at=now() WHERE id=$1', [id, next.step]);
            await notify(client, request, await approversOf(client, request, next), 'request.submitted',
              'Заявка ждёт вашего ответа', request.title, `request.submitted:${id}:${next.step}`);
          } else {
            await client.query(`UPDATE requests SET status='approved',decided_at=now(),version=version+1,updated_at=now() WHERE id=$1`, [id]);
            finalApproved = true;
            await notify(client, request, [request.requester_id], 'request.decided', 'Заявка одобрена', request.title, `request.decided:${id}:approved`);
          }
        } else {
          await client.query(`UPDATE requests SET status=$2,decided_at=CASE WHEN $2='rejected' THEN now() ELSE decided_at END,version=version+1,updated_at=now() WHERE id=$1`,
            [id, decision === 'reject' ? 'rejected' : 'needs_info']);
          await notify(client, request, [request.requester_id], 'request.decided',
            decision === 'reject' ? 'Заявка отклонена' : 'По заявке нужно уточнение', `${request.title}${note ? ` — ${note}` : ''}`.slice(0, 500),
            `request.decided:${id}:${decision}:${step.step}:${Date.now()}`);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
      if (finalApproved) await spawnTask(session, id, session.userId);
      return repository.get(session, id);
    },

    /** Подавший отвечает на вопрос: значения обновляются по той же версии шаблона, шаг снова ждёт ответа. */
    async respond(session, id, { values, comment = null }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `SELECT r.*,v.fields FROM requests r JOIN request_template_versions v ON v.template_id=r.template_id AND v.version=r.template_version
            WHERE r.workspace_id=$1 AND r.id=$2 FOR UPDATE OF r`, [session.workspaceId, id]);
        const request = rows[0];
        if (!request || request.requester_id !== session.userId) throw fail('Заявка не найдена', 'REQUEST_NOT_FOUND', 404);
        if (request.status !== 'needs_info') throw fail('Уточнение сейчас не запрашивали', 'REQUEST_NOT_PENDING', 409);
        const clean = validateValues(request.fields, values ?? request.values);
        await client.query(`UPDATE requests SET "values"=$2,status='submitted',version=version+1,updated_at=now() WHERE id=$1`, [id, JSON.stringify(clean)]);
        await client.query(`UPDATE request_steps SET decision='pending',comment=NULL,decided_by=NULL,decided_at=NULL WHERE request_id=$1 AND step=$2`, [id, request.current_step]);
        await eventOf(client, id, session.userId, 'responded', String(comment ?? '').trim().slice(0, 2000) || null);
        const { rows: stepRows } = await client.query('SELECT * FROM request_steps WHERE request_id=$1 AND step=$2', [id, request.current_step]);
        await notify(client, request, await approversOf(client, request, stepRows[0]), 'request.submitted', 'Заявка снова ждёт вашего ответа', request.title,
          `request.submitted:${id}:${request.current_step}:${Date.now()}`);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
      return repository.get(session, id);
    },

    async cancel(session, id, { comment = null } = {}) {
      const { rowCount } = await pool.query(
        `UPDATE requests SET status='cancelled',version=version+1,updated_at=now()
          WHERE workspace_id=$1 AND id=$2 AND requester_id=$3 AND status IN ('submitted','needs_info')`, [session.workspaceId, id, session.userId]);
      if (!rowCount) throw fail('Отозвать можно свою заявку, пока по ней нет решения', 'REQUEST_NOT_PENDING', 409);
      await eventOf(pool, id, session.userId, 'cancelled', String(comment ?? '').trim().slice(0, 2000) || null);
      return repository.get(session, id);
    },

    /** «Выполнено» ставит подавший или ведущий человек; задача, если она заведена, живёт и закрывается сама по себе. */
    async complete(session, id) {
      const manage = RANK[session.role] >= RANK.admin;
      const { rowCount } = await pool.query(
        `UPDATE requests SET status='completed',completed_at=now(),version=version+1,updated_at=now()
          WHERE workspace_id=$1 AND id=$2 AND status='approved' AND (requester_id=$3 OR $4)`, [session.workspaceId, id, session.userId, manage]);
      if (!rowCount) throw fail('Отметить выполненной можно одобренную заявку', 'REQUEST_NOT_PENDING', 409);
      await eventOf(pool, id, session.userId, 'completed');
      return repository.get(session, id);
    },

    /**
     * Очередь — для людей, которые отвечают, а не для оценки сотрудников: счётчики и сроки по статусам без разбивки по персонам.
     */
    async queue(session) {
      const { rows } = await pool.query(
        `SELECT count(*) FILTER (WHERE status='submitted')::int pending,
                count(*) FILTER (WHERE status='needs_info')::int "needsInfo",
                count(*) FILTER (WHERE status='approved')::int "inExecution",
                count(*) FILTER (WHERE ${awaitingSql('$2', '$3')})::int "awaitingMe",
                COALESCE(round(extract(epoch FROM avg(now()-submitted_at) FILTER (WHERE status='submitted'))/3600)::int,0) "avgPendingHours",
                COALESCE(round(extract(epoch FROM avg(completed_at-submitted_at) FILTER (WHERE status='completed' AND completed_at>now()-interval '90 days'))/3600)::int,0) "avgCycleHours"
           FROM requests r WHERE r.workspace_id=$1`, [session.workspaceId, session.userId, session.role]);
      return rows[0];
    },
  };
  return repository;
}
