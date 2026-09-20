import { Permission } from '../rbac.js';
import { cleanText, json, readJson } from './helpers.js';

const ID = '([0-9a-f-]{36})';
const PERSON = new RegExp(`^/api/v1/people/${ID}$`, 'i');
const ACTIVITY = new RegExp(`^/api/v1/people/${ID}/activity$`, 'i');

const unavailable = () => Object.assign(
  new Error('Личные карточки доступны в режиме с базой данных'),
  { code: 'PEOPLE_UNAVAILABLE', statusCode: 503, expose: true },
);

const TEXT_LIMITS = { displayName: 120, title: 120, department: 120, phone: 40, about: 2000, location: 120, timezone: 64, statusText: 140 };

export function createPeopleHandler() {
  return async function handlePeople(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/people') && path !== '/api/v1/contacts') return false;
    const session = await ctx.requireSession(req);
    const people = ctx.people;
    if (!people) throw unavailable();

    // Who this person actually deals with: the rooms they are in and the
    // units an administrator placed them in. The staff directory answers a
    // different question and lives in /bootstrap.
    if (path === '/api/v1/contacts' && method === 'GET') {
      json(res, 200, await people.contacts(session));
      return true;
    }

    // Справочник людей: тот же список, что приходит в /bootstrap, но со
    // своим адресом — клиенту, которому нужны только коллеги, незачем
    // тянуть всё рабочее пространство.
    if (path === '/api/v1/people' && method === 'GET') {
      json(res, 200, { items: await ctx.store.listPeople(session) });
      return true;
    }

    let m = path.match(PERSON);
    if (m && method === 'GET') {
      json(res, 200, { person: await people.getPerson(session, m[1]) });
      return true;
    }
    if (m && method === 'PATCH') {
      const body = await readJson(req);
      const patch = {};
      for (const [field, max] of Object.entries(TEXT_LIMITS)) {
        if (body[field] === undefined) continue;
        // An empty string is "clear this field", not a validation failure.
        patch[field] = body[field] === null || body[field] === '' ? null : cleanText(body[field], max);
      }
      if (body.startedOn !== undefined) patch.startedOn = body.startedOn || null;
      const canManageMembers = (ctx.permissions(session.role) ?? []).includes(Permission.MEMBER_MANAGE);
      json(res, 200, { person: await people.updateProfile(session, m[1], patch, { canManageMembers }) });
      return true;
    }

    m = path.match(ACTIVITY);
    if (m && method === 'GET') {
      json(res, 200, {
        items: await people.activity(session, m[1], {
          limit: url.searchParams.get('limit'),
          before: url.searchParams.get('before'),
        }),
      });
      return true;
    }

    throw Object.assign(new Error('People route not found'), { code: 'NOT_FOUND', statusCode: 404 });
  };
}
