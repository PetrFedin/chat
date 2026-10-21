const fail = (message, code = 'INVALID_EMAIL_RULE', statusCode = 400) => Object.assign(new Error(message), { code, statusCode, expose: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const addressText = value => (Array.isArray(value) ? value : [value]).filter(Boolean).map(v => typeof v === 'string' ? v : `${v.name || ''} ${v.address || ''}`).join(' ').toLocaleLowerCase();

export function normalizeEmailRule(input = {}) {
  const condition = {}, action = {};
  for (const field of ['fromIncludes', 'toIncludes', 'subjectIncludes']) {
    const value = String(input.condition?.[field] || '').trim();
    if (value.length > 200) throw fail('Условие правила слишком длинное');
    if (value) condition[field] = value.toLocaleLowerCase();
  }
  if (typeof input.condition?.hasAttachments === 'boolean') condition.hasAttachments = input.condition.hasAttachments;
  if (!Object.keys(condition).length) throw fail('Укажите хотя бы одно условие правила');
  if (input.action?.labelIds !== undefined) {
    if (!Array.isArray(input.action.labelIds) || input.action.labelIds.length > 20 || input.action.labelIds.some(id => !UUID.test(String(id)))) throw fail('Некорректные метки правила');
    action.labelIds = [...new Set(input.action.labelIds)];
  }
  if (input.action?.assigneeId) {
    if (!UUID.test(String(input.action.assigneeId))) throw fail('Некорректный ответственный');
    action.assigneeId = String(input.action.assigneeId);
  }
  if (input.action?.archived === true) action.archived = true;
  if (input.action?.snoozeMinutes !== undefined && input.action.snoozeMinutes !== '') {
    const n = Number(input.action.snoozeMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 43200) throw fail('Отложить можно на 1–43200 минут');
    action.snoozeMinutes = n;
  }
  if (!Object.keys(action).length || (Object.keys(action).length === 1 && action.labelIds?.length === 0)) throw fail('Укажите действие правила');
  return { condition, action };
}

export function matchesEmailRule(condition, message) {
  if (condition.fromIncludes && !addressText(message.from).includes(condition.fromIncludes)) return false;
  if (condition.toIncludes && !addressText([...(message.to || []), ...(message.cc || [])]).includes(condition.toIncludes)) return false;
  if (condition.subjectIncludes && !String(message.subject || '').toLocaleLowerCase().includes(condition.subjectIncludes)) return false;
  if (typeof condition.hasAttachments === 'boolean' && Boolean(message.attachments?.length || message.attachmentIds?.length) !== condition.hasAttachments) return false;
  return true;
}

/** Pure projection except for the rule read; email repository admits targets. */
export async function evaluateEmailRoutingRules({ client, workspaceId, mailboxId, message, clock = () => Date.now() }) {
  if (!client) return { patch: {}, matchedRuleIds: [] };
  const { rows } = await client.query('SELECT id,condition,action FROM email_rules WHERE workspace_id=$1 AND mailbox_id=$2 AND enabled ORDER BY created_at,id', [workspaceId, mailboxId]);
  const patch = {}, matchedRuleIds = [];
  for (const rule of rows) {
    if (!matchesEmailRule(rule.condition, message)) continue;
    matchedRuleIds.push(rule.id);
    if (rule.action.labelIds?.length) patch.labelIds = [...new Set([...(patch.labelIds || []), ...rule.action.labelIds])];
    if (rule.action.assigneeId) patch.assigneeId = rule.action.assigneeId;
    if (rule.action.archived) patch.archived = true;
    if (rule.action.snoozeMinutes) patch.snoozedUntil = new Date(Number(clock()) + rule.action.snoozeMinutes * 60000).toISOString();
  }
  return { patch, matchedRuleIds };
}
