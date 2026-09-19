import { cleanText, json, noContent, readJson } from './helpers.js';

const ID = '([0-9a-f-]{36})';
const EVENT = new RegExp(`^/api/v1/calendar-events/${ID}$`, 'i');
const RESPOND = new RegExp(`^/api/v1/calendar-events/${ID}/respond$`, 'i');
const PARTICIPANTS = new RegExp(`^/api/v1/calendar-events/${ID}/participants$`, 'i');
const PARTICIPANT = new RegExp(`^/api/v1/calendar-events/${ID}/participants/${ID}$`, 'i');
const FILES = new RegExp(`^/api/v1/calendar-events/${ID}/files$`, 'i');

const unavailable = () => Object.assign(
  new Error('Участники встреч доступны в режиме с базой данных'),
  { code: 'CALENDAR_UNAVAILABLE', statusCode: 503, expose: true },
);

export function createCalendarHandler() {
  return async function handleCalendar(req, res, ctx, url, path, method) {
    // The plain list and create endpoints stay in the workspace handler; this
    // one owns everything about a single event.
    if (!path.startsWith('/api/v1/calendar-events/') && path !== '/api/v1/calendar-invitations') return false;
    const session = await ctx.requireSession(req);
    const calendar = ctx.calendar;
    if (!calendar) throw unavailable();

    if (method === 'GET' && path === '/api/v1/calendar-invitations') {
      json(res, 200, { items: await calendar.pendingInvitations(session) });
      return true;
    }

    let m = path.match(EVENT);
    if (m && method === 'GET') { json(res, 200, { event: await calendar.getEvent(session, m[1]) }); return true; }
    if (m && method === 'PATCH') {
      const body = await readJson(req);
      const patch = {};
      if (body.title !== undefined) patch.title = cleanText(body.title, 240);
      if (body.description !== undefined) patch.description = body.description ? cleanText(body.description, 2000) : null;
      if (body.startAt !== undefined) patch.startAt = new Date(body.startAt).toISOString();
      if (body.endAt !== undefined) patch.endAt = body.endAt ? new Date(body.endAt).toISOString() : null;
      if (body.visibility !== undefined) patch.visibility = body.visibility;
      if (body.kind !== undefined) patch.kind = body.kind;
      if (body.allDay !== undefined) patch.allDay = Boolean(body.allDay);
      json(res, 200, { event: await calendar.updateEvent(session, m[1], patch) });
      return true;
    }
    if (m && method === 'DELETE') { await calendar.cancelEvent(session, m[1]); noContent(res); return true; }

    m = path.match(RESPOND);
    if (m && method === 'POST') {
      const body = await readJson(req);
      json(res, 200, { participant: await calendar.respond(session, m[1], body.response, body.note ? cleanText(body.note, 500) : null) });
      return true;
    }

    m = path.match(PARTICIPANTS);
    if (m && method === 'POST') {
      const body = await readJson(req);
      const userIds = Array.isArray(body.userIds) ? body.userIds : [body.userId].filter(Boolean);
      json(res, 201, await calendar.invite(session, m[1], userIds, { optional: Boolean(body.optional) }));
      return true;
    }

    m = path.match(PARTICIPANT);
    if (m && method === 'DELETE') { await calendar.removeParticipant(session, m[1], m[2]); noContent(res); return true; }

    m = path.match(FILES);
    if (m && method === 'POST') {
      const body = await readJson(req);
      json(res, 201, await calendar.attachFile(session, m[1], body.fileId));
      return true;
    }

    throw Object.assign(new Error('Calendar route not found'), { code: 'NOT_FOUND', statusCode: 404 });
  };
}
