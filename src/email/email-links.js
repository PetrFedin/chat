import { Permission, requirePermission } from '../rbac.js';
import { cleanText, toDateOrNull, validTimezone } from '../http/helpers.js';

const fail = (message, code = 'INVALID_EMAIL_RESOURCE', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode, expose: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optionalId = value => {
  if (value === undefined || value === null || value === '') return null;
  if (!UUID.test(String(value))) throw fail('Некорректный идентификатор участника или записи');
  return String(value);
};

/**
 * Email owns provenance and mailbox access. These adapters create the same
 * canonical resources as the rest of ChatX, in the email command transaction.
 * No internal-message IDs, shadow task states or broad email excerpts are
 * manufactured here. The submitted text is the disclosure preview the actor
 * has explicitly accepted in the source-action form.
 */
export function createEmailLinkResources({ pool, store, wiki, calendar, meeting, features } = {}) {
  async function enabled(session, kind, client) {
    const feature = { task: 'tasks', event: 'calendar', page: 'wiki', decision: 'decisions' }[kind];
    if (client) {
      // Feature settings use an exclusive workspace lock. Hold the compatible
      // read lock through commit, then read the current setting without a cache.
      await client.query('SELECT id FROM workspaces WHERE id=$1 FOR SHARE', [session.workspaceId]);
      const { rows } = await client.query('SELECT enabled FROM workspace_features WHERE workspace_id=$1 AND feature=$2', [session.workspaceId, feature]);
      if (rows[0]?.enabled === false) throw fail('Этот раздел отключён в настройках компании', 'FEATURE_DISABLED', 403);
    } else if (features && !(await features.isEnabled(session.workspaceId, feature))) {
      throw fail('Этот раздел отключён в настройках компании', 'FEATURE_DISABLED', 403);
    }
  }

  function disclosure(input, kind) {
    if (input.confirmDisclosure !== true) {
      throw fail('Подтвердите текст и аудиторию новой записи', 'EMAIL_DISCLOSURE_REQUIRED', 409);
    }
    if (kind === 'decision' && input.accepted !== true) {
      throw fail('Решение должен подтвердить участник переписки', 'EMAIL_DECISION_ACCEPTANCE_REQUIRED', 409);
    }
  }

  const resources = {
    capabilities: { task: true, event: true, page: Boolean(pool && wiki?.enabled), decision: Boolean(pool) },

    async get(session, kind, id, { client = null } = {}) {
      if (!['task', 'event', 'page', 'decision'].includes(kind)) return null;
      try { await enabled(session, kind, client); }
      catch (error) { if (error.code === 'FEATURE_DISABLED') return null; throw error; }
      if (kind === 'task') return store.getTask(session, id, { client });
      if (kind === 'event') return calendar?.getEvent ? calendar.getEvent(session, id, { client }) :
        (await store.listCalendar(session)).find(row => row.id === id && (row.ownerId === session.userId || row.visibility === 'workspace')) ?? null;
      if (kind === 'page') return wiki?.enabled ? wiki.getReference(session, id, { client }) : null;
      if (kind === 'decision') return meeting?.getDecision ? meeting.getDecision(session, id, { client }) : null;
      return null;
    },

    async task(session, input = {}, { client, source } = {}) {
      requirePermission(session.role, Permission.TASK_CREATE);
      await enabled(session, 'task', client);
      disclosure(input, 'task');
      if (input.sourceMessageId) throw fail('Письмо связывается с задачей как отдельный тип источника');
      const title = cleanText(input.title || source?.subject, 240, 'Название задачи');
      const priority = input.priority || 'normal';
      if (!['low', 'normal', 'high', 'urgent'].includes(priority)) throw fail('Некорректный приоритет');
      return store.createTask(session, {
        title, outcome: cleanText(input.outcome || title, 4000, 'Ожидаемый результат'),
        ownerId: optionalId(input.ownerId), acceptorId: optionalId(input.acceptorId),
        promisedAt: toDateOrNull(input.promisedAt), forecastAt: toDateOrNull(input.forecastAt),
        sourceMessageId: null, priority,
      }, { client });
    },

    async event(session, input = {}, { client, source } = {}) {
      requirePermission(session.role, Permission.CALENDAR_CREATE);
      await enabled(session, 'event', client);
      disclosure(input, 'event');
      const startAt = toDateOrNull(input.startAt), endAt = toDateOrNull(input.endAt);
      if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) throw fail('Укажите начало и окончание встречи', 'INVALID_CALENDAR_RANGE');
      const timezone = String(input.timezone || 'UTC');
      if (!validTimezone(timezone)) throw fail('Неизвестный часовой пояс', 'INVALID_TIMEZONE');
      const participantIds = [...new Set((Array.isArray(input.participantIds) ? input.participantIds : []).map(optionalId).filter(Boolean))];
      if (participantIds.length > 100) throw fail('Не больше 100 участников встречи');
      const body = {
        kind: 'meeting', title: cleanText(input.title || source?.subject, 240, 'Название встречи'),
        description: input.description ? cleanText(input.description, 2000, 'Описание') : null,
        startAt, endAt, timezone, visibility: 'participants',
        allowConflict: input.allowConflict === true,
      };
      if (calendar?.createWithParticipants) return (await calendar.createWithParticipants(session, body, participantIds, { client })).event;
      if (participantIds.length) throw fail('Участники встреч доступны после подключения базы данных', 'POSTGRES_REQUIRED', 503);
      const existing = await store.listCalendar(session, startAt, endAt);
      if (!body.allowConflict && existing.some(row => row.ownerId === session.userId && Date.parse(row.startAt) < Date.parse(endAt) && Date.parse(row.endAt || row.startAt) > Date.parse(startAt))) {
        throw fail('В этом интервале уже есть событие', 'CALENDAR_CONFLICT', 409);
      }
      return store.createCalendarEvent(session, body);
    },

    async page(session, input = {}, { client, source } = {}) {
      requirePermission(session.role, Permission.WIKI_USE);
      await enabled(session, 'page', client);
      if (!wiki?.enabled) throw fail('Pages требуют подключённой базы данных', 'WIKI_UNAVAILABLE', 503);
      disclosure(input, 'page');
      // A new source-derived page starts restricted to its author. Page access
      // management is the only path that can subsequently expand its audience.
      return wiki.create(session, {
        title: cleanText(input.title || source?.subject, 200, 'Название страницы'),
        content: String(input.content ?? ''), visibility: 'restricted',
      }, { client });
    },

    async decision(session, input = {}, { client, source } = {}) {
      requirePermission(session.role, Permission.MESSAGE_SEND);
      await enabled(session, 'decision', client);
      if (!pool || !client) throw fail('Реестр решений требует подключённой базы данных', 'POSTGRES_REQUIRED', 503);
      disclosure(input, 'decision');
      const title = cleanText(input.title, 500, 'Решение');
      const body = input.body ? cleanText(input.body, 20000, 'Основание решения') : null;
      const { rows } = await client.query(
        `INSERT INTO decisions(organization_id,workspace_id,source_kind,source_id,email_message_id,title,body,source_title,accepted_by,status)
         VALUES($1,$2,'email_message',$3,$3,$4,$5,$6,$7,'active')
         RETURNING id,source_kind "sourceKind",source_id "sourceId",email_message_id "emailMessageId",title,body,
                   accepted_by "acceptedBy",accepted_at "acceptedAt",source_title "callTitle"`,
        [session.organizationId, session.workspaceId, source.messageId, title, body, String(source.subject || '').slice(0, 500), session.userId],
      );
      await client.query(
        `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
         VALUES($1,$2,'decision',$3,'decision.email_accepted',$4,$5)`,
        [session.organizationId, session.workspaceId, rows[0].id, session.userId, { sourceKind: 'email_message', messageId: source.messageId }],
      );
      return rows[0];
    },
  };
  return resources;
}
