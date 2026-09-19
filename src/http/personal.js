import { cleanText, json, noContent, readJson } from './helpers.js';

const ID = '([0-9a-f-]{36})';
const ITEM = new RegExp(`^/api/v1/personal-items/${ID}$`, 'i');
const COMMENTS = new RegExp(`^/api/v1/personal-items/${ID}/comments$`, 'i');
const FILES = new RegExp(`^/api/v1/personal-items/${ID}/files$`, 'i');
const SCHEDULE = new RegExp(`^/api/v1/personal-items/${ID}/schedule$`, 'i');

const unavailable = () => Object.assign(
  new Error('Личное планирование доступно в режиме с базой данных'),
  { code: 'PERSONAL_UNAVAILABLE', statusCode: 503, expose: true },
);

const iso = (value) => (value ? new Date(value).toISOString() : null);

export function createPersonalHandler() {
  return async function handlePersonal(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/personal-items')) return false;
    const session = await ctx.requireSession(req);
    const personal = ctx.personal;
    if (!personal) throw unavailable();

    if (method === 'GET' && path === '/api/v1/personal-items') {
      json(res, 200, {
        items: await personal.list(session, {
          status: url.searchParams.get('status') ?? 'open',
          kind: url.searchParams.get('kind'),
          due: url.searchParams.get('due'),
          limit: url.searchParams.get('limit'),
        }),
      });
      return true;
    }
    if (method === 'POST' && path === '/api/v1/personal-items') {
      const body = await readJson(req);
      json(res, 201, {
        item: await personal.create(session, {
          kind: body.kind ?? 'todo',
          title: cleanText(body.title, 240),
          body: body.body ? cleanText(body.body, 20000) : null,
          dueAt: iso(body.dueAt),
          plannedStart: iso(body.plannedStart),
          plannedEnd: iso(body.plannedEnd),
          position: Number.isInteger(body.position) ? body.position : 0,
        }),
      });
      return true;
    }

    let m = path.match(COMMENTS);
    if (m && method === 'POST') {
      const body = await readJson(req);
      json(res, 201, { comment: await personal.comment(session, m[1], cleanText(body.body, 4000)) });
      return true;
    }

    m = path.match(FILES);
    if (m && method === 'POST') {
      const body = await readJson(req);
      json(res, 201, await personal.attachFile(session, m[1], body.fileId));
      return true;
    }

    m = path.match(SCHEDULE);
    if (m && method === 'POST') {
      const body = await readJson(req);
      json(res, 200, { item: await personal.schedule(session, m[1], { startAt: body.startAt, endAt: body.endAt }) });
      return true;
    }

    m = path.match(ITEM);
    if (m && method === 'GET') { json(res, 200, { item: await personal.get(session, m[1]) }); return true; }
    if (m && method === 'PATCH') {
      const body = await readJson(req);
      const patch = {};
      if (body.title !== undefined) patch.title = cleanText(body.title, 240);
      if (body.body !== undefined) patch.body = body.body ? cleanText(body.body, 20000) : null;
      if (body.kind !== undefined) patch.kind = body.kind;
      if (body.status !== undefined) patch.status = body.status;
      if (body.dueAt !== undefined) patch.dueAt = iso(body.dueAt);
      if (body.plannedStart !== undefined) patch.plannedStart = iso(body.plannedStart);
      if (body.plannedEnd !== undefined) patch.plannedEnd = iso(body.plannedEnd);
      if (body.position !== undefined) patch.position = body.position;
      json(res, 200, { item: await personal.update(session, m[1], patch) });
      return true;
    }
    if (m && method === 'DELETE') { await personal.remove(session, m[1]); noContent(res); return true; }

    throw Object.assign(new Error('Personal route not found'), { code: 'NOT_FOUND', statusCode: 404 });
  };
}
