import { Permission, requirePermission } from '../rbac.js';
import { cleanText, json, noContent, readJson } from './helpers.js';

const ENDPOINT_ID = /^\/api\/v1\/integrations\/webhooks\/([0-9a-f-]{36})$/;
const ENDPOINT_STATE = /^\/api\/v1\/integrations\/webhooks\/([0-9a-f-]{36})\/(enable|disable)$/;

const unavailable = () => Object.assign(
  new Error('Outbound integrations require a PostgreSQL deployment'),
  { code: 'INTEGRATIONS_UNAVAILABLE', statusCode: 503, expose: true },
);

/**
 * Список тем подписки.
 *
 * Пустой список — уговор «присылать всё». Значит, всё, что пришло не
 * списком, обязано быть ошибкой: иначе опечатка превращается в подписку
 * на весь рабочий граф компании, а на экране выглядит как «без тем».
 *
 * Тема сверяется со списком существующих: подписка на выдуманное
 * событие создавалась молча и не срабатывала никогда, и отличить её от
 * сломанной интеграции было неоткуда.
 */
const KNOWN_TOPICS = new Set(['task.created', 'task.transitioned', 'task.rescheduled',
  'task.reassigned', 'task.evidence.added']);
const topicList = (value) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw Object.assign(new Error('Темы задаются списком. Пустой список означает «присылать всё».'),
      { code: 'INVALID_TOPICS', statusCode: 400, expose: true });
  }
  return value.map((topic) => {
    const name = String(topic ?? '').trim();
    if (name === '*' || KNOWN_TOPICS.has(name)) return name;
    if (name.endsWith('.*') && [...KNOWN_TOPICS].some((known) => known.startsWith(name.slice(0, -1)))) return name;
    throw Object.assign(new Error(`Такого события не бывает: «${name}». Есть: ${[...KNOWN_TOPICS].join(', ')}.`),
      { code: 'UNKNOWN_TOPIC', statusCode: 400, expose: true });
  });
};

export function createIntegrationsHandler() {
  return async function handleIntegrations(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/integrations/')) return false;
    const { requireSession, webhooks } = ctx;
    const session = await requireSession(req);
    // Endpoints carry a signing secret and receive the whole work graph, so
    // they are workspace administration, not a member-level preference.
    requirePermission(session.role, Permission.INTEGRATION_MANAGE);
    if (!webhooks) throw unavailable();

    if (method === 'GET' && path === '/api/v1/integrations/webhooks') {
      json(res, 200, { items: await webhooks.listEndpoints(session) });
      return true;
    }

    if (method === 'POST' && path === '/api/v1/integrations/webhooks') {
      const body = await readJson(req);
      const endpoint = await webhooks.createEndpoint(session, {
        label: cleanText(body.label, 120),
        url: String(body.url ?? ''),
        // Пустой список означает «все события», и это осознанный уговор.
        // Но не-массив молча превращался в пустой список: подписка с
        // `topics: "всё"` создавалась как подписка на всё подряд, а на
        // экране рисовалась как «без тем». Данные компании уходили
        // наружу ровно там, где администратор был уверен в обратном.
        topics: topicList(body.topics),
      });
      json(res, 201, { endpoint, secretShownOnce: true });
      return true;
    }

    if (method === 'GET' && path === '/api/v1/integrations/deliveries') {
      const deliveries = await webhooks.listDeliveries(session, {
        endpointId: url.searchParams.get('endpointId'),
        limit: url.searchParams.get('limit'),
      });
      json(res, 200, { items: deliveries });
      return true;
    }

    const stateMatch = path.match(ENDPOINT_STATE);
    if (method === 'POST' && stateMatch) {
      json(res, 200, { endpoint: await webhooks.setEndpointEnabled(session, stateMatch[1], stateMatch[2] === 'enable') });
      return true;
    }

    const idMatch = path.match(ENDPOINT_ID);
    if (method === 'DELETE' && idMatch) {
      await webhooks.deleteEndpoint(session, idMatch[1]);
      noContent(res);
      return true;
    }

    throw Object.assign(new Error('Integration route not found'), { code: 'NOT_FOUND', statusCode: 404 });
  };
}
