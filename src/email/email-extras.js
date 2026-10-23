import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { cleanText, toDateOrNull, validTimezone } from '../http/helpers.js';
import { Permission, requirePermission } from '../rbac.js';
import { normalizeEmailRule, matchesEmailRule } from './email-rules.js';

const fail = (message, code = 'EMAIL_ACTION_UNAVAILABLE', statusCode = 400) => Object.assign(new Error(message), { code, statusCode, expose: true });
const hash = text => createHash('sha256').update(text).digest('hex');
const ruleView = r => ({ id: r.id, mailboxId: r.mailbox_id, name: r.name, condition: r.condition, action: r.action, enabled: r.enabled, version: r.version, createdAt: r.created_at });
const bookingView = r => ({ id: r.id, title: r.title, timezone: r.timezone, slots: r.slots, expiresAt: r.expires_at, status: r.status, calendarEventId: r.calendar_event_id || null });

export function createEmailExtras({ pool, email, calendar, linkResources, assistant, features, key = process.env.EMAIL_ENCRYPTION_KEY, clock = () => Date.now() } = {}) {
  const keyBytes = typeof key === 'string' ? Buffer.from(key, 'base64') : null;
  const bookingReady = Boolean(pool && calendar && keyBytes?.length === 32);
  function needDatabase() { if (!pool) throw fail('Эта функция требует постоянной базы данных', 'POSTGRES_REQUIRED', 503); }
  async function featureEnabled(workspaceId, id, client = pool) {
    if (!client) return !features || await features.isEnabled(workspaceId, id);
    if (client !== pool) await client.query('SELECT 1 FROM workspaces WHERE id=$1 FOR SHARE', [workspaceId]);
    const { rows } = await client.query('SELECT enabled FROM workspace_features WHERE workspace_id=$1 AND feature=$2', [workspaceId, id]);
    return rows[0]?.enabled !== false;
  }
  async function mailbox(session, id, { client = pool, manage = false } = {}) {
    needDatabase();
    const { rows } = await client.query(
      `SELECT mb.*,mm.role AS mailbox_role FROM email_mailboxes mb
       JOIN memberships m ON m.workspace_id=mb.workspace_id AND m.user_id=$3
       JOIN users u ON u.id=m.user_id
       LEFT JOIN email_mailbox_members mm ON mm.workspace_id=mb.workspace_id AND mm.mailbox_id=mb.id AND mm.user_id=m.user_id AND mm.revoked_at IS NULL
       WHERE mb.workspace_id=$1 AND mb.id=$2 AND mb.deleted_at IS NULL
         AND m.role<>'guest' AND u.disabled_at IS NULL AND (m.access_until IS NULL OR m.access_until>now())
         AND (mb.owner_id=m.user_id OR (mb.kind='shared' AND mm.id IS NOT NULL)) FOR SHARE OF m,u`,
      [session.workspaceId, id, session.userId],
    );
    const row = rows[0];
    if (!row) throw fail('Почтовый ящик не найден', 'EMAIL_MAILBOX_NOT_FOUND', 404);
    if (manage && row.owner_id !== session.userId && row.mailbox_role !== 'manager') throw fail('Правилами управляет владелец или менеджер ящика', 'EMAIL_MAILBOX_FORBIDDEN', 403);
    return row;
  }
  async function tx(session, run) {
    needDatabase();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO email_workspace_locks(workspace_id,organization_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [session.workspaceId, session.organizationId]);
      await client.query('SELECT workspace_id FROM email_workspace_locks WHERE workspace_id=$1 FOR UPDATE', [session.workspaceId]);
      if (!await featureEnabled(session.workspaceId, 'email', client)) throw fail('Почта отключена в компании', 'FEATURE_DISABLED', 403);
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  }
  async function activeCreator(row, client = pool) {
    const { rows } = await client.query(
      `SELECT m.user_id "userId",m.role,m.workspace_id "workspaceId",m.organization_id "organizationId",u.email,
              COALESCE(p.display_name,u.email) "displayName"
         FROM memberships m JOIN users u ON u.id=m.user_id
         LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id
        WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role<>'guest' AND u.disabled_at IS NULL
          AND (m.access_until IS NULL OR m.access_until>now()) FOR SHARE OF m,u`, [row.workspace_id, row.created_by],
    );
    const session = rows[0];
    if (!session || !await email.canReadMessage(session, row.message_id, { client }) || !await featureEnabled(row.workspace_id, 'email', client) || !await featureEnabled(row.workspace_id, 'calendar', client)) throw fail('Ссылка больше недоступна', 'EMAIL_BOOKING_UNAVAILABLE', 404);
    return session;
  }
  async function tokenRow(token, client = pool, lock = false) {
    needDatabase();
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(token))) throw fail('Ссылка не найдена', 'EMAIL_BOOKING_NOT_FOUND', 404);
    const { rows } = await client.query(`SELECT * FROM email_booking_links WHERE token_hash=$1${lock ? ' FOR UPDATE' : ''}`, [hash(token)]);
    const row = rows[0];
    if (!row || row.status === 'revoked' || Date.parse(row.expires_at) <= clock()) throw fail('Ссылка истекла или была отозвана', 'EMAIL_BOOKING_UNAVAILABLE', 410);
    return row;
  }
  const bookingToken = row => createHmac('sha256', keyBytes).update(`chatx-booking:${row.workspace_id}:${row.id}`).digest('base64url');
  async function validateRuleTargets(session, boxId, action, client) {
    if (action.assigneeId) {
      try { await mailbox({ ...session, userId: action.assigneeId }, boxId, { client }); }
      catch { throw fail('Ответственный должен иметь действующий доступ к ящику', 'EMAIL_ASSIGNEE_UNAVAILABLE'); }
    }
    if (action.labelIds?.length) {
      const { rows } = await client.query('SELECT id FROM email_labels WHERE workspace_id=$1 AND id=ANY($2::uuid[])', [session.workspaceId, action.labelIds]);
      if (rows.length !== action.labelIds.length) throw fail('Одна из меток больше недоступна', 'EMAIL_LABEL_NOT_FOUND');
    }
  }

  return {
    async status(session) {
      const ai = assistant?.status?.() || { enabled: false, provider: 'none' };
      const permitted = session.role !== 'guest';
      return { canUseAssistant: permitted && Boolean(ai.enabled) && await featureEnabled(session.workspaceId, 'assistant'), assistant: ai, canCreateBookingLink: permitted && bookingReady && await featureEnabled(session.workspaceId, 'calendar'), canManageRules: permitted && Boolean(pool) };
    },

    async assist(session, threadId, input = {}) {
      requirePermission(session.role, Permission.AI_USE);
      if (!await featureEnabled(session.workspaceId, 'assistant')) throw fail('ИИ-помощник отключён в компании', 'FEATURE_DISABLED', 403);
      const status = assistant?.status?.();
      if (!status?.enabled) throw fail('ИИ-помощник не подключён', 'EMAIL_ASSISTANT_UNAVAILABLE', 503);
      if (status.externalProcessing && input.consent !== true) throw fail('Подтвердите передачу выбранной переписки подключённому AI-провайдеру', 'EMAIL_AI_CONSENT_REQUIRED', 409);
      const detail = await email.getThreadTail(session, threadId, { limit: 30 });
      const messages = detail.messages.slice(-30).map(m => ({ id: m.id, authorId: ['outgoing','outbound'].includes(m.direction) ? `mailbox:${m.from?.address || 'outgoing'}` : m.from?.address || 'external', text: `${m.subject || ''}\n${String(m.text || '').slice(0, 6000)}` }));
      while (messages.length > 1 && messages.reduce((sum, m) => sum + m.text.length, 0) > 50000) messages.shift();
      let output;
      const mode = input.mode || 'summary';
      if (mode === 'summary') output = await assistant.summarizeThread({ messages, selfUserId: session.userId });
      else if (mode === 'reply') output = await assistant.suggestReplies({ messages, selfUserId: session.userId });
      else if (mode === 'rewrite') output = await assistant.rewriteEmail({ text: cleanText(input.text, 20000, 'Текст письма'), instruction: String(input.instruction || 'Улучшить ясность, сохранив смысл.').slice(0, 1000) });
      else throw fail('Неизвестное действие помощника', 'INVALID_EMAIL_AI_MODE');
      // A provider call can outlive membership. Never return content from an
      // expired grant, even when the request was admitted before the call.
      await email.getThread(session, threadId);
      if (!await featureEnabled(session.workspaceId, 'assistant')) throw fail('ИИ-помощник отключён в компании', 'FEATURE_DISABLED', 403);
      return { mode, text: output.text || output.summary || output.replies?.[0] || '', highlights: output.highlights || [], replies: output.replies || [], provider: output.provider || status.provider, model: output.model || status.model, sourceMessageIds: messages.map(m => m.id), contextTruncated: detail.truncated || messages.length < detail.messages.length, totalMessages: detail.totalMessages, externalProcessing: Boolean(status.externalProcessing) };
    },

    async listRules(session, mailboxId) {
      await mailbox(session, mailboxId, { manage: true });
      return { items: (await pool.query('SELECT * FROM email_rules WHERE workspace_id=$1 AND mailbox_id=$2 ORDER BY created_at,id', [session.workspaceId, mailboxId])).rows.map(ruleView) };
    },
    async saveRule(session, mailboxId, input, id = null) {
      const normalized = normalizeEmailRule(input);
      const name = cleanText(input.name, 120, 'Название правила');
      return tx(session, async client => {
        await mailbox(session, mailboxId, { client, manage: true });
        await validateRuleTargets(session, mailboxId, normalized.action, client);
        let row;
        if (id) {
          const result = await client.query('UPDATE email_rules SET name=$4,condition=$5,action=$6,enabled=$7,version=version+1,updated_at=now() WHERE workspace_id=$1 AND mailbox_id=$2 AND id=$3 AND version=$8 RETURNING *', [session.workspaceId, mailboxId, id, name, normalized.condition, normalized.action, input.enabled !== false, Number(input.expectedVersion) || 0]);
          if (!result.rows[0]) throw fail('Правило изменилось. Обновите список.', 'EMAIL_VERSION_CONFLICT', 409);
          row = result.rows[0];
        } else {
          const prior = (await client.query('SELECT * FROM email_rules WHERE workspace_id=$1 AND mailbox_id=$2 AND name=$3', [session.workspaceId, mailboxId, name])).rows[0];
          if (prior) {
            if (JSON.stringify(normalized.condition) !== JSON.stringify(normalizeEmailRule(prior).condition) || JSON.stringify(normalized.action) !== JSON.stringify(normalizeEmailRule(prior).action)) throw fail('Правило с таким названием уже существует', 'EMAIL_RULE_EXISTS', 409);
            return ruleView(prior);
          }
          row = (await client.query('INSERT INTO email_rules(organization_id,workspace_id,mailbox_id,name,condition,action,enabled,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [session.organizationId, session.workspaceId, mailboxId, name, normalized.condition, normalized.action, input.enabled !== false, session.userId])).rows[0];
        }
        return ruleView(row);
      });
    },
    async ruleMailbox(session, id) {
      needDatabase();
      const row = (await pool.query('SELECT mailbox_id FROM email_rules WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id])).rows[0];
      if (!row) throw fail('Правило не найдено', 'EMAIL_RULE_NOT_FOUND', 404);
      await mailbox(session, row.mailbox_id, { manage: true });
      return row.mailbox_id;
    },
    async deleteRule(session, id, input) {
      const mailboxId = await this.ruleMailbox(session, id);
      return tx(session, async client => {
        await mailbox(session, mailboxId, { client, manage: true });
        const { rowCount } = await client.query('DELETE FROM email_rules WHERE workspace_id=$1 AND id=$2 AND version=$3', [session.workspaceId, id, Number(input.expectedVersion) || 0]);
        if (!rowCount) throw fail('Правило изменилось. Обновите список.', 'EMAIL_VERSION_CONFLICT', 409);
        return { deleted: true };
      });
    },
    async previewRule(session, mailboxId, input) {
      await mailbox(session, mailboxId, { manage: true });
      const { condition, action } = normalizeEmailRule(input);
      const { rows } = await pool.query('SELECT id,thread_id,data FROM email_messages WHERE workspace_id=$1 AND mailbox_id=$2 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1000', [session.workspaceId, mailboxId]);
      const seen = new Set(), items = [];
      for (const row of rows) {
        if (seen.has(row.thread_id) || !matchesEmailRule(condition, row.data)) continue;
        seen.add(row.thread_id); items.push({ threadId: row.thread_id, subject: row.data.subject || '', from: row.data.from, actions: action });
      }
      return { items: items.slice(0, 100), total: items.length, scanned: rows.length, truncated: rows.length === 1000 };
    },

    async createBooking(session, messageId, input, requestKey = null) {
      if (!bookingReady) throw fail('Бронирование требует базы, календаря и ключа шифрования почты', 'EMAIL_BOOKING_UNAVAILABLE', 503);
      requirePermission(session.role, Permission.CALENDAR_CREATE);
      if (input.confirmDisclosure !== true) throw fail('Подтвердите публичное название и предложенные интервалы', 'EMAIL_DISCLOSURE_REQUIRED', 409);
      const message = await email.getMessage(session, messageId);
      const title = cleanText(input.title || 'Встреча', 240, 'Название встречи');
      const timezone = String(input.timezone || 'UTC');
      if (!validTimezone(timezone)) throw fail('Неизвестный часовой пояс', 'INVALID_TIMEZONE');
      if (!Array.isArray(input.slots) || input.slots.length < 1 || input.slots.length > 60) throw fail('Предложите от 1 до 60 интервалов', 'INVALID_BOOKING_SLOTS');
      const slots = input.slots.map(slot => ({ startAt: toDateOrNull(slot.startAt), endAt: toDateOrNull(slot.endAt) }));
      for (const slot of slots) if (!slot.startAt || !slot.endAt || Date.parse(slot.startAt) < clock() || Date.parse(slot.endAt) - Date.parse(slot.startAt) < 5 * 60000 || Date.parse(slot.endAt) - Date.parse(slot.startAt) > 8 * 3600000 || Date.parse(slot.startAt) > clock() + 60 * 86400000) throw fail('Интервал должен быть в будущем: от 5 минут до 8 часов, в пределах 60 дней', 'INVALID_BOOKING_SLOTS');
      const expiresAt = toDateOrNull(input.expiresAt) || new Date(Math.min(clock() + 14 * 86400000, Math.max(...slots.map(s => Date.parse(s.startAt))))).toISOString();
      if (Date.parse(expiresAt) <= clock() || Date.parse(expiresAt) > clock() + 60 * 86400000) throw fail('Некорректный срок ссылки', 'INVALID_BOOKING_EXPIRY');
      const fingerprint = hash(JSON.stringify({ messageId, title, timezone, slots, expiresAt: input.expiresAt || null }));
      return tx(session, async client => {
        if (!await email.canReadMessage(session, messageId, { client })) throw fail('Письмо больше недоступно', 'EMAIL_MESSAGE_NOT_FOUND', 404);
        if (!await featureEnabled(session.workspaceId, 'calendar', client)) throw fail('Календарь отключён', 'FEATURE_DISABLED', 403);
        if (requestKey) {
          const old = (await client.query('SELECT * FROM email_booking_links WHERE workspace_id=$1 AND created_by=$2 AND request_key=$3', [session.workspaceId, session.userId, requestKey.slice(0, 200)])).rows[0];
          if (old) {
            const token = bookingToken(old);
            if (old.request_fingerprint !== fingerprint || !timingSafeEqual(Buffer.from(old.token_hash), Buffer.from(hash(token)))) throw fail('Ключ команды уже использован или ключ ссылок сменился', 'EMAIL_IDEMPOTENCY_CONFLICT', 409);
            return { bookingLink: bookingView(old), url: `/email-booking/${token}` };
          }
        }
        const id = randomUUID(), token = bookingToken({ id, workspace_id: session.workspaceId });
        const row = (await client.query(`INSERT INTO email_booking_links(id,organization_id,workspace_id,mailbox_id,message_id,created_by,request_key,request_fingerprint,token_hash,title,timezone,slots,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [id, session.organizationId, session.workspaceId, message.mailboxId, messageId, session.userId, requestKey?.slice(0, 200) || null, fingerprint, hash(token), title, timezone, JSON.stringify(slots), expiresAt])).rows[0];
        return { bookingLink: bookingView(row), url: `/email-booking/${token}` };
      });
    },
    async revokeBooking(session, id) {
      return tx(session, async client => {
        const row = (await client.query('SELECT * FROM email_booking_links WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [session.workspaceId, id])).rows[0];
        if (!row || row.created_by !== session.userId) throw fail('Ссылка не найдена', 'EMAIL_BOOKING_NOT_FOUND', 404);
        await mailbox(session, row.mailbox_id, { client });
        await client.query("UPDATE email_booking_links SET status='revoked' WHERE id=$1", [id]);
        return { revoked: true };
      });
    },
    async getBooking(token) {
      const row = await tokenRow(token), creator = await activeCreator(row);
      const slots = [];
      if (row.status === 'open') for (const slot of row.slots) {
        if (Date.parse(slot.startAt) <= clock()) continue;
        const conflicts = await calendar.findConflicts(creator, slot);
        if (!conflicts.length) slots.push(slot);
      }
      return { title: row.title, timezone: row.timezone, expiresAt: row.expires_at, status: row.status, slots };
    },
    async book(token, input) {
      const initial = await tokenRow(token), creator = await activeCreator(initial);
      const name = cleanText(input.name, 120, 'Имя');
      const address = String(input.email || '').trim().toLowerCase();
      if (!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(address) || address.length > 254) throw fail('Укажите корректный email', 'INVALID_EMAIL');
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(String(input.submissionId))) throw fail('Обновите страницу бронирования', 'INVALID_BOOKING_REQUEST');
      const startAt = toDateOrNull(input.startAt), requestHash = hash(JSON.stringify({ name, address, startAt, submissionId: input.submissionId }));
      return tx(creator, async client => {
        const row = await tokenRow(token, client, true), actor = await activeCreator(row, client);
        if (row.status === 'booked') {
          if (row.booking_request_hash !== requestHash) throw fail('По этой ссылке время уже выбрано', 'EMAIL_BOOKING_TAKEN', 409);
          return { booked: true, ...row.booking_data };
        }
        const slot = row.slots.find(s => s.startAt === startAt);
        if (!slot || Date.parse(slot.startAt) <= clock()) throw fail('Этот интервал больше недоступен', 'EMAIL_BOOKING_SLOT_UNAVAILABLE', 409);
        const source = (await client.query('SELECT thread_id FROM email_messages WHERE workspace_id=$1 AND id=$2', [row.workspace_id, row.message_id])).rows[0];
        let event;
        try {
        event = await linkResources.event(actor, { title: row.title, ...slot, timezone: row.timezone, description: `Внешний участник: ${name}\nEmail: ${address}`, confirmDisclosure: true }, { client, source: { messageId: row.message_id, threadId: source.thread_id, mailboxId: row.mailbox_id } });
        } catch(error) {
          if(error.code==='CALENDAR_CONFLICT')throw fail('Этот интервал уже занят. Выберите другое время.', 'EMAIL_BOOKING_SLOT_UNAVAILABLE', 409);
          throw error;
        }
        const linkId = randomUUID(), link = { id: linkId, workspaceId: row.workspace_id, mailboxId: row.mailbox_id, messageId: row.message_id, threadId: source.thread_id, organizationId: actor.organizationId, kind: 'event', resourceId: event.id, actorId: actor.userId, createdAt: new Date(clock()).toISOString(), updatedAt: new Date(clock()).toISOString(), version: 1, deletedAt: null };
        await client.query('INSERT INTO email_resource_links(id,organization_id,workspace_id,mailbox_id,message_id,resource_kind,resource_id,data) VALUES($1,$2,$3,$4,$5,\'event\',$6,$7)', [linkId, actor.organizationId, actor.workspaceId, row.mailbox_id, row.message_id, event.id, link]);
        const result = { title: row.title, startAt: slot.startAt, endAt: slot.endAt, timezone: row.timezone, calendarEventId: event.id };
        await client.query("UPDATE email_booking_links SET status='booked',calendar_event_id=$2,booking_request_hash=$3,booking_data=$4,booked_at=now() WHERE id=$1", [row.id, event.id, requestHash, result]);
        return { booked: true, ...result };
      });
    },
  };
}
