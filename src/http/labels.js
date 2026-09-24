import { cleanText, json, noContent, readJson } from './helpers.js';

const ID = '([0-9a-f-]{36})';
const LABEL = new RegExp(`^/api/v1/labels/${ID}$`, 'i');
const LABEL_TARGETS = new RegExp(`^/api/v1/labels/${ID}/targets$`, 'i');
const LINK = new RegExp(`^/api/v1/labels/${ID}/links/([a-z]+)/${ID}$`, 'i');
const ON_TARGET = new RegExp(`^/api/v1/labelled/([a-z]+)/${ID}$`, 'i');

const unavailable = () => Object.assign(
  new Error('Метки доступны в режиме с базой данных'),
  { code: 'LABELS_UNAVAILABLE', statusCode: 503, expose: true },
);

export function createLabelHandler() {
  return async function handleLabels(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/labels') && !path.startsWith('/api/v1/labelled/')) return false;
    const session = await ctx.requireSession(req);
    const labels = ctx.labels;
    if (!labels) throw unavailable();

    if (method === 'GET' && path === '/api/v1/labels') {
      json(res, 200, { items: await labels.listLabels(session, { kind: url.searchParams.get('kind') }) });
      return true;
    }
    if (method === 'POST' && path === '/api/v1/labels') {
      const body = await readJson(req);
      json(res, 201, {
        label: await labels.createLabel(session, {
          kind: body.kind ?? 'tag',
          name: cleanText(body.name, 60),
          colour: body.colour ?? 'neutral',
          parentId: body.parentId ?? null,
          personal: Boolean(body.personal),
          description: body.description ? cleanText(body.description, 500) : null,
          position: Number.isInteger(body.position) ? body.position : 0,
        }),
      });
      return true;
    }

    let m = path.match(LABEL_TARGETS);
    if (m && method === 'GET') {
      json(res, 200, { items: await labels.targetsOf(session, m[1], { limit: url.searchParams.get('limit') }) });
      return true;
    }

    m = path.match(LINK);
    if (m && method === 'PUT') { json(res, 200, await labels.apply(session, m[1], m[2], m[3])); return true; }
    if (m && method === 'DELETE') { await labels.remove(session, m[1], m[2], m[3]); noContent(res); return true; }

    m = path.match(ON_TARGET);
    if (m && method === 'GET') { json(res, 200, { items: await labels.labelsOf(session, m[1], m[2]) }); return true; }

    m = path.match(LABEL);
    if (m && method === 'PATCH') { json(res, 200, { label: await labels.updateLabel(session, m[1], await readJson(req)) }); return true; }
    if (m && method === 'DELETE') { await labels.deleteLabel(session, m[1]); noContent(res); return true; }

    throw Object.assign(new Error('Label route not found'), { code: 'NOT_FOUND', statusCode: 404 });
  };
}
