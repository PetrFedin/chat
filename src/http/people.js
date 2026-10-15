import { resolveAvatar } from '../media/avatar.js';
import { Permission, requirePermission } from '../rbac.js';
import { cleanText, json, readJson, validTimezone } from './helpers.js';

const ID = '([0-9a-f-]{36})';
const PERSON = new RegExp(`^/api/v1/people/${ID}$`, 'i');
const ACTIVITY = new RegExp(`^/api/v1/people/${ID}/activity$`, 'i');
const EMPLOYMENT = new RegExp(`^/api/v1/people/${ID}/(deactivate|reactivate)$`, 'i');
const ROLE = new RegExp(`^/api/v1/people/${ID}/role$`, 'i');
const ACCESS = new RegExp(`^/api/v1/people/${ID}/access$`, 'i');

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
        if (field === 'timezone' && patch[field] && !validTimezone(patch[field])) {
          throw Object.assign(new Error('Такого часового пояса нет'), { code: 'INVALID_TIMEZONE', statusCode: 400, expose: true });
        }
      }
      if (body.workingDays !== undefined) {
        if (!Array.isArray(body.workingDays)) {
          throw Object.assign(new Error('Рабочие дни должны быть списком'), { code: 'INVALID_WORKING_DAYS', statusCode: 400, expose: true });
        }
        const days=[...new Set(body.workingDays.map(Number))].sort((a,b)=>a-b);
        if (!days.length || days.some(day=>!Number.isInteger(day)||day<0||day>6)) {
          throw Object.assign(new Error('Рабочие дни — числа от 0 до 6'), { code: 'INVALID_WORKING_DAYS', statusCode: 400, expose: true });
        }
        patch.workingDays=days;
      }
      const hm=(value)=>{
        const match=String(value??'').match(/^(\d{2}):(\d{2})$/);
        if(!match)return null;
        const h=Number(match[1]),m=Number(match[2]);
        return h<=23&&m<=59?{text:String(value),minutes:h*60+m}:null;
      };
      const hasWorkStart=body.workdayStart!==undefined,hasWorkEnd=body.workdayEnd!==undefined;
      if(hasWorkStart!==hasWorkEnd) {
        throw Object.assign(new Error('Начало и конец рабочего дня меняются вместе'),{code:'INVALID_WORKING_HOURS',statusCode:400,expose:true});
      }
      const workStart=hasWorkStart?hm(body.workdayStart):null;
      const workEnd=hasWorkEnd?hm(body.workdayEnd):null;
      if(body.workdayStart!==undefined&&!workStart)throw Object.assign(new Error('Начало рабочего дня — HH:MM'),{code:'INVALID_WORKING_HOURS',statusCode:400,expose:true});
      if(body.workdayEnd!==undefined&&!workEnd)throw Object.assign(new Error('Конец рабочего дня — HH:MM'),{code:'INVALID_WORKING_HOURS',statusCode:400,expose:true});
      if(workStart)patch.workdayStart=workStart.text;
      if(workEnd)patch.workdayEnd=workEnd.text;
      if(workStart&&workEnd&&workEnd.minutes<=workStart.minutes) {
        throw Object.assign(new Error('Конец рабочего дня должен быть позже начала'),{code:'INVALID_WORKING_HOURS',statusCode:400,expose:true});
      }

      if (body.startedOn !== undefined) {
        // Соседние поля проходят через cleanText; дата уходила в базу
        // сырой и возвращалась пятисоткой на «когда-то».
        if (body.startedOn === '' || body.startedOn === null) patch.startedOn = null;
        else {
          if (typeof body.startedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.startedOn)) {
            throw Object.assign(new Error('Дата выхода на работу — в виде 2026-01-31'), { code: 'INVALID_DATE', statusCode: 400, expose: true });
          }
          const startedOn = new Date(`${body.startedOn}T00:00:00Z`);
          if (!Number.isNaN(startedOn.getTime()) && startedOn.toISOString().slice(0, 10) !== body.startedOn) {
            throw Object.assign(new Error('Такой даты не бывает'), { code: 'INVALID_DATE', statusCode: 400, expose: true });
          }
          if (startedOn.getUTCFullYear() < 1950 || startedOn.getUTCFullYear() > 2100) {
            throw Object.assign(new Error('Дата выхода на работу — между 1950 и 2100 годом'), { code: 'INVALID_DATE', statusCode: 400, expose: true });
          }
          if (Number.isNaN(startedOn.getTime())) {
            throw Object.assign(new Error('Invalid date'), { code: 'INVALID_DATE', statusCode: 400, expose: true });
          }
          patch.startedOn = startedOn.toISOString().slice(0, 10);
        }
      }
      // День рождения — день и месяц, без года: поздравить нужно в
      // правильный день, а возраст человек работодателю сообщать не
      // обязан. «31 февраля» отвергается здесь, а не пятисоткой из базы.
      if (body.birthday !== undefined) {
        if (body.birthday === '' || body.birthday === null) { patch.birthDay = null; patch.birthMonth = null; }
        else {
          const parts = String(body.birthday).match(/^(\d{1,2})[-./](\d{1,2})$/);
          const day = Number(parts?.[1]);
          const month = Number(parts?.[2]);
          const real = parts && month >= 1 && month <= 12 && day >= 1
            // Високосный год для проверки: 29 февраля — настоящая дата.
            && day <= new Date(Date.UTC(2028, month, 0)).getUTCDate();
          if (!real) {
            throw Object.assign(new Error('День рождения указывается как ДД.ММ'),
              { code: 'INVALID_BIRTHDAY', statusCode: 400, expose: true });
          }
          patch.birthDay = day;
          patch.birthMonth = month;
        }
      }
      // Фотография приходит ссылкой на уже загруженный файл: снимок
      // проходит тот же путь, что и любое вложение, — с проверкой
      // размера, типа и принадлежности пространству.
      if (Object.prototype.hasOwnProperty.call(body, 'avatarFileId')) {
        patch.avatarFileId = await resolveAvatar(ctx.store, session, body.avatarFileId);
      }
      const canManageMembers = (ctx.permissions(session.role) ?? []).includes(Permission.MEMBER_MANAGE);
      json(res, 200, { person: await people.updateProfile(session, m[1], patch, { canManageMembers }) });
      return true;
    }

    // Увольнение и возвращение на работу. Механизм был в схеме с самого
    // начала — вход и каждый запрос сверяются с `users.disabled_at`, — но
    // выставить признак было нечем, и ушедший сохранял доступ навсегда.
    /**
     * Срок доступа человека.
     *
     * Ставится в первую очередь гостю: проект закончился, а доступ к
     * переписке и файлам остался, и руками его никто не вспомнит
     * закрыть. Пустое значение снимает срок — так возвращают доступ
     * тому, кто остался работать.
     */
    m = path.match(ACCESS);
    if (m && method === 'PUT') {
      const body = await readJson(req);
      requirePermission(session.role, Permission.MEMBER_MANAGE);
      if (!people.setAccessUntil) throw unavailable();
      let accessUntil = null;
      if (body.accessUntil) {
        if (typeof body.accessUntil !== 'string') throw Object.assign(new Error('Непонятная дата'), { code: 'INVALID_DATE', statusCode: 400, expose: true });
        const at = new Date(body.accessUntil);
        if (Number.isNaN(at.getTime())) {
          throw Object.assign(new Error('Непонятная дата'), { code: 'INVALID_DATE', statusCode: 400, expose: true });
        }
        accessUntil = at.toISOString();
      }
      json(res, 200, await people.setAccessUntil(session, m[1], accessUntil));
      return true;
    }

    // Повышение и понижение. Владение передаётся отдельным маршрутом:
    // это не смена роли, а смена хозяина компании.
    m = path.match(ROLE);
    if (m && method === 'PUT') {
      if (!(ctx.permissions(session.role) ?? []).includes(Permission.MEMBER_MANAGE)) {
        throw Object.assign(new Error('Менять роли может владелец или администратор'),
          { code: 'FORBIDDEN', statusCode: 403, expose: true });
      }
      if (!people.setRole) throw unavailable();
      const body = await readJson(req);
      const person = await people.setRole(session, m[1], String(body.role ?? ''), {
        rank: (role) => RANK[role] ?? 0,
        seatState: ctx.store.seatState ? () => ctx.store.seatState(session) : null,
      });
      json(res, 200, { person });
      return true;
    }

    m = path.match(EMPLOYMENT);
    if (m && method === 'POST') {
      if (!(ctx.permissions(session.role) ?? []).includes(Permission.MEMBER_MANAGE)) {
        throw Object.assign(new Error('Провожать сотрудников может владелец или администратор'),
          { code: 'FORBIDDEN', statusCode: 403 });
      }
      const person = await people.setActive(session, m[1], m[2].toLowerCase() === 'reactivate',
        { rank: (role) => RANK[role] ?? 0, seatState: ctx.store.seatState ? () => ctx.store.seatState(session) : null });
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
