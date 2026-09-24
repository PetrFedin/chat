import { json, noContent, readJson } from './helpers.js';

const ID = '([0-9a-f-]{36})';
const FAVOURITE = new RegExp(`^/api/v1/favourites/([a-z]+)/${ID}$`, 'i');
const HIGHLIGHT = new RegExp(`^/api/v1/highlights/${ID}$`, 'i');
const NOTE = new RegExp(`^/api/v1/message-notes/${ID}$`, 'i');

const PREFIXES = ['/api/v1/favourites', '/api/v1/highlights', '/api/v1/message-notes'];

export function createMarksHandler() {
  return async function handleMarks(req, res, ctx, url, path, method) {
    if (!PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
    const session = await ctx.requireSession(req);
    const marks = ctx.marks;
    if (!marks?.enabled) {
      throw Object.assign(new Error('Personal marks require a database deployment'),
        { code: 'MARKS_UNAVAILABLE', statusCode: 503, expose: true });
    }

    if (path === '/api/v1/favourites' && method === 'GET') {
      json(res, 200, { items: await marks.favourites(session, { type: url.searchParams.get('type') }) });
      return true;
    }
    let m = path.match(FAVOURITE);
    if (m && method === 'PUT') { json(res, 200, await marks.favour(session, m[1].toLowerCase(), m[2])); return true; }
    if (m && method === 'DELETE') { json(res, 200, await marks.unfavour(session, m[1].toLowerCase(), m[2])); return true; }

    if (path === '/api/v1/highlights' && method === 'GET') {
      json(res, 200, {
        items: await marks.highlights(session, {
          conversationId: url.searchParams.get('conversationId'),
          messageId: url.searchParams.get('messageId'),
        }),
      });
      return true;
    }
    if (path === '/api/v1/highlights' && method === 'POST') {
      json(res, 201, { highlight: await marks.highlight(session, await readJson(req)) });
      return true;
    }
    m = path.match(HIGHLIGHT);
    if (m && method === 'DELETE') { await marks.unhighlight(session, m[1]); noContent(res); return true; }

    if (path === '/api/v1/message-notes' && method === 'GET') {
      json(res, 200, {
        items: await marks.notes(session, {
          conversationId: url.searchParams.get('conversationId'),
          messageId: url.searchParams.get('messageId'),
        }),
      });
      return true;
    }
    if (path === '/api/v1/message-notes' && method === 'POST') {
      json(res, 201, { note: await marks.note(session, await readJson(req)) });
      return true;
    }
    m = path.match(NOTE);
    if (m && method === 'PATCH') { json(res, 200, { note: await marks.editNote(session, m[1], await readJson(req)) }); return true; }
    if (m && method === 'DELETE') { await marks.removeNote(session, m[1]); noContent(res); return true; }

    throw Object.assign(new Error('Mark route not found'), { code: 'NOT_FOUND', statusCode: 404 });
  };
}
