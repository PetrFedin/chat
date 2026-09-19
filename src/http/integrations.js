import { Permission, requirePermission } from '../rbac.js';
import { cleanText, json, noContent, readJson } from './helpers.js';

const ENDPOINT_ID = /^\/api\/v1\/integrations\/webhooks\/([0-9a-f-]{36})$/;
const ENDPOINT_STATE = /^\/api\/v1\/integrations\/webhooks\/([0-9a-f-]{36})\/(enable|disable)$/;

const unavailable = () => Object.assign(
  new Error('Outbound integrations require a PostgreSQL deployment'),
  { code: 'INTEGRATIONS_UNAVAILABLE', statusCode: 503, expose: true },
);

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
      json(res, 200, { endpoints: await webhooks.listEndpoints(session) });
      return true;
    }

    if (method === 'POST' && path === '/api/v1/integrations/webhooks') {
      const body = await readJson(req);
      const endpoint = await webhooks.createEndpoint(session, {
        label: cleanText(body.label, 120),
        url: String(body.url ?? ''),
        topics: Array.isArray(body.topics) ? body.topics.map((topic) => cleanText(topic, 120)) : [],
      });
      json(res, 201, { endpoint, secretShownOnce: true });
      return true;
    }

    if (method === 'GET' && path === '/api/v1/integrations/deliveries') {
      const deliveries = await webhooks.listDeliveries(session, {
        endpointId: url.searchParams.get('endpointId'),
        limit: url.searchParams.get('limit'),
      });
      json(res, 200, { deliveries });
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
