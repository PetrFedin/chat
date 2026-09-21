
/**
 * Порядковый номер в списке.
 *
 * Дробное значение молча становилось нулём при создании и роняло запрос
 * в пятисотку при правке, а число больше двух миллиардов — в пятисотку в
 * обоих случаях: колонка объявлена int4, и отказ прилетал из базы.
 */
const readPosition = (value) => {
  if (value === undefined || value === null || value === '') return 0;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || Math.abs(number) > 2147483647) {
    throw Object.assign(new Error('Position must be a whole number'), { code: 'INVALID_POSITION', statusCode: 400, expose: true });
  }
  return number;
};
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

/**
 * Срок личной записи разбирается так же строго, как срок задачи:
 * `new Date('2027-02-30')` молча давало второе марта, и сервер отвечал
 * «сохранено» на дату, которой не существует.
 */
const iso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  const invalid = () => Object.assign(new Error('Invalid date'), { code: 'INVALID_DATE', statusCode: 400, expose: true });
  if (Number.isNaN(date.getTime())) throw invalid();
  const written = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (written) {
    const day = `${written[1]}-${written[2]}-${written[3]}`;
    const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (!date.toISOString().startsWith(day) && local !== day) throw invalid();
  }
  const year = date.getUTCFullYear();
  if (year < 1970 || year > 2200) throw invalid();
  return date.toISOString();
};

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
          position: readPosition(body.position),
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
      if (body.position !== undefined) patch.position = readPosition(body.position);
      json(res, 200, { item: await personal.update(session, m[1], patch) });
      return true;
    }
    if (m && method === 'DELETE') { await personal.remove(session, m[1]); noContent(res); return true; }

    throw Object.assign(new Error('Personal route not found'), { code: 'NOT_FOUND', statusCode: 404 });
  };
}
