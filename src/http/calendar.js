import { cleanText, json, noContent, readJson } from './helpers.js';

const ID = '([0-9a-f-]{36})';
const EVENT = new RegExp(`^/api/v1/calendar-events/${ID}$`, 'i');
const RESPOND = new RegExp(`^/api/v1/calendar-events/${ID}/respond$`, 'i');
const PARTICIPANTS = new RegExp(`^/api/v1/calendar-events/${ID}/participants$`, 'i');
const PARTICIPANT = new RegExp(`^/api/v1/calendar-events/${ID}/participants/${ID}$`, 'i');
const FILES = new RegExp(`^/api/v1/calendar-events/${ID}/files$`, 'i');
// У протокола адрес может нести момент вхождения: протокол принадлежит
// встрече, а не серии, и понедельничный не должен затираться средой.
const NOTE_ID = `([0-9a-f-]{36}(?:@[^/]{10,64})?)`;
const NOTES = new RegExp(`^/api/v1/calendar-events/${NOTE_ID}/notes$`, 'i');
const NOTES_COMMIT = new RegExp(`^/api/v1/calendar-events/${NOTE_ID}/notes/commit$`, 'i');
// Вхождение серии адресуется моментом, на который оно приходится по
// правилу: это его единственный устойчивый признак.
// Момент приезжает в адресе закодированным: двоеточия превращаются в
// %3A, то есть в путь попадают и буквы шестнадцатеричной записи. Набор
// разрешённых символов здесь угадывать незачем — берём весь отрезок пути
// и проверяем его разбором даты, а не образцом.
const OCCURRENCE = new RegExp(`^/api/v1/calendar-events/${ID}/occurrences/([^/]{10,64})$`, 'i');

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

    /**
     * Протокол встречи, у которой не было записи.
     *
     * Разбор с расшифровкой есть только у записанного звонка.
     * Совещание в кабинете, планёрка на объекте, разговор с заказчиком
     * по телефону проходили мимо: договорились и разошлись.
     */
    let notes = path.match(NOTES);
    if (notes) {
      if (!ctx.meetingNotes) {
        throw Object.assign(new Error('Протоколы доступны в режиме с базой данных'),
          { code: 'NOTES_UNAVAILABLE', statusCode: 503, expose: true });
      }
      if (method === 'GET') { json(res, 200, { notes: await ctx.meetingNotes.get(session, notes[1]) }); return true; }
      if (method === 'PUT') {
        const body = await readJson(req);
        json(res, 200, {
          notes: await ctx.meetingNotes.save(session, notes[1], {
            title: body.title ?? null,
            notes: body.notes ?? null,
            decisions: body.decisions ?? [],
            actionItems: body.actionItems ?? [],
          }),
        });
        return true;
      }
    }
    notes = path.match(NOTES_COMMIT);
    if (notes && method === 'POST') {
      if (!ctx.meetingNotes) {
        throw Object.assign(new Error('Протоколы доступны в режиме с базой данных'),
          { code: 'NOTES_UNAVAILABLE', statusCode: 503, expose: true });
      }
      const body = await readJson(req);
      const result = await ctx.meetingNotes.commit(session, notes[1], {
        index: body.index, ownerId: body.ownerId ?? null, promisedAt: body.promisedAt ?? null,
      });
      json(res, 201, result);
      return true;
    }

    if (method === 'GET' && path === '/api/v1/calendar-invitations') {
      json(res, 200, { items: await calendar.pendingInvitations(session) });
      return true;
    }

    /**
     * Одно вхождение серии: отменить, перенести или вернуть как было.
     *
     * Правило при этом не трогается — остальная планёрка остаётся на
     * месте. Без этого пропустить одну встречу на праздниках можно было
     * бы только разорвав серию надвое.
     */
    let occurrence = path.match(OCCURRENCE);
    if (occurrence && (method === 'POST' || method === 'DELETE')) {
      const [, eventId, at] = occurrence;
      const when = decodeURIComponent(at);
      if (Number.isNaN(Date.parse(when))) {
        throw Object.assign(new Error('Не разбирается момент вхождения'),
          { code: 'INVALID_DATE', statusCode: 400, expose: true });
      }
      if (method === 'DELETE') {
        json(res, 200, await calendar.restoreOccurrence(session, eventId, when));
        return true;
      }
      const body = await readJson(req);
      json(res, 200, await calendar.amendOccurrence(session, eventId, when, {
        cancelled: Boolean(body.cancelled),
        startAt: body.startAt ? new Date(body.startAt).toISOString() : null,
        endAt: body.endAt ? new Date(body.endAt).toISOString() : null,
        title: body.title ? cleanText(body.title, 240) : null,
      }));
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
      // Пустая строка — это «больше не повторять», и её надо отличать от
      // «не трогай правило».
      if (body.recurrenceRule !== undefined) patch.recurrenceRule = body.recurrenceRule || null;
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
