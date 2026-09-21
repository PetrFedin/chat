import { Permission } from '../rbac.js';
import { cleanText, json, readJson } from './helpers.js';

const ID = '([0-9a-f-]{36})';
const PERSON = new RegExp(`^/api/v1/people/${ID}$`, 'i');
const ACTIVITY = new RegExp(`^/api/v1/people/${ID}/activity$`, 'i');
const EMPLOYMENT = new RegExp(`^/api/v1/people/${ID}/(deactivate|reactivate)$`, 'i');

// Лестница ролей: увольняют только тех, кто ниже.
const RANK = { guest: 0, member: 1, manager: 2, admin: 3, owner: 4 };

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
        // Пустая строка — «очистить поле», а не отказ. Но имя очистить
        // нельзя: у человека оно всегда есть, а колонка объявлена NOT NULL,
        // и пустое значение отвечало пятисоткой, тогда как строка из
        // пробелов — внятным отказом.
        if (field === 'displayName') { patch[field] = cleanText(body[field], max); continue; }
        patch[field] = body[field] === null || body[field] === '' ? null : cleanText(body[field], max);
      }
      if (body.startedOn !== undefined) {
        // Соседние поля проходят через cleanText; дата уходила в базу
        // сырой и возвращалась пятисоткой на «когда-то».
        if (body.startedOn === '' || body.startedOn === null) patch.startedOn = null;
        else {
          const startedOn = new Date(body.startedOn);
          if (Number.isNaN(startedOn.getTime())) {
            throw Object.assign(new Error('Invalid date'), { code: 'INVALID_DATE', statusCode: 400, expose: true });
          }
          patch.startedOn = startedOn.toISOString().slice(0, 10);
        }
      }
      const canManageMembers = (ctx.permissions(session.role) ?? []).includes(Permission.MEMBER_MANAGE);
      json(res, 200, { person: await people.updateProfile(session, m[1], patch, { canManageMembers }) });
      return true;
    }

    // Увольнение и возвращение на работу. Механизм был в схеме с самого
    // начала — вход и каждый запрос сверяются с `users.disabled_at`, — но
    // выставить признак было нечем, и ушедший сохранял доступ навсегда.
    m = path.match(EMPLOYMENT);
    if (m && method === 'POST') {
      if (!(ctx.permissions(session.role) ?? []).includes(Permission.MEMBER_MANAGE)) {
        throw Object.assign(new Error('Провожать сотрудников может владелец или администратор'),
          { code: 'FORBIDDEN', statusCode: 403 });
      }
      const person = await people.setActive(session, m[1], m[2].toLowerCase() === 'reactivate',
        { rank: (role) => RANK[role] ?? 0 });
      json(res, 200, { person });
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
