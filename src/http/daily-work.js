import { json, readJson, pageSize } from './helpers.js';

const SEARCH_TYPES = new Set(['message','conversation','task','file','person','event']);

function parseTypes(value) {
  if (!value) return null;
  const types = String(value).split(',').map((item) => item.trim()).filter((item) => SEARCH_TYPES.has(item));
  return types.length ? [...new Set(types)] : null;
}

function boundedQuery(value,max=160) {
  const query=String(value??'').trim();
  if(query.length>max)throw Object.assign(new Error('Query is too long'),{code:'INVALID_QUERY'});
  return query;
}

export async function handleDailyWork(req,res,ctx,url,path,method) {
  const { store, requireSession, hub } = ctx;

  if (path === '/api/v1/attention' && method === 'GET') {
    const session = await requireSession(req);
    json(res,200,{ attention:await store.attentionSummary(session) });
    return true;
  }

  /**
   * «Что я пропустил» за период.
   *
   * Без `from` граница — прошлый сеанс этого человека: это и есть «пока
   * меня не было», и спрашивать об этом незачем.
   */
  if (path === '/api/v1/digest' && method === 'GET') {
    const session = await requireSession(req);
    if (!ctx.digest) {
      throw Object.assign(new Error('Сводка доступна в режиме с базой данных'),
        { code: 'DIGEST_UNAVAILABLE', statusCode: 503, expose: true });
    }
    json(res, 200, await ctx.digest.build(session, { from: url.searchParams.get('from') }));
    return true;
  }

  /**
   * Первые шаги нового человека. `null` — показывать нечего.
   */
  if (path === '/api/v1/onboarding' && method === 'GET') {
    const session = await requireSession(req);
    json(res, 200, { onboarding: ctx.onboarding ? await ctx.onboarding.state(session) : null });
    return true;
  }
  if (path === '/api/v1/onboarding/dismiss' && method === 'POST') {
    const session = await requireSession(req);
    if (!ctx.onboarding) {
      throw Object.assign(new Error('Подсказка доступна в режиме с базой данных'),
        { code: 'ONBOARDING_UNAVAILABLE', statusCode: 503, expose: true });
    }
    json(res, 200, await ctx.onboarding.dismiss(session));
    return true;
  }

  /**
   * Настройки уведомлений.
   *
   * Касаются только push — того, что прерывает человека. Список внутри
   * приложения остаётся полным: это журнал, а не окрик.
   */
  if (path === '/api/v1/notification-preferences' && (method === 'GET' || method === 'PUT')) {
    const session = await requireSession(req);
    if (!ctx.notificationPreferences) {
      throw Object.assign(new Error('Настройки уведомлений доступны в режиме с базой данных'),
        { code: 'PREFERENCES_UNAVAILABLE', statusCode: 503, expose: true });
    }
    const preferences = method === 'GET'
      ? await ctx.notificationPreferences.get(session)
      : await ctx.notificationPreferences.save(session, await readJson(req));
    json(res, 200, { preferences });
    return true;
  }

  if (path === '/api/v1/notifications' && method === 'GET') {
    const session = await requireSession(req);
    const status = url.searchParams.get('status');
    const type = url.searchParams.get('type');
    const limit = pageSize(url.searchParams.get('limit'), 50, 100);
    json(res,200,{ items:await store.listNotifications(session,{status,type,limit}) });
    return true;
  }

  if (path === '/api/v1/notifications/read-all' && method === 'POST') {
    const session = await requireSession(req);
    const body = await readJson(req).catch(() => ({}));
    const count = await store.markAllNotificationsRead(session,body.type ?? null);
    hub.broadcastUsers(session.workspaceId,[session.userId],'notification.read-all',{type:body.type ?? null,count});
    json(res,200,{count});
    return true;
  }

  let match = path.match(/^\/api\/v1\/notifications\/([0-9a-f-]+)\/read$/i);
  if (match && method === 'POST') {
    const session = await requireSession(req);
    const notification = await store.markNotificationRead(session,match[1]);
    if (!notification) throw Object.assign(new Error('Notification not found'),{code:'NOT_FOUND',statusCode:404});
    hub.broadcastUsers(session.workspaceId,[session.userId],'notification.read',{notificationId:match[1]});
    json(res,200,{notification});
    return true;
  }

  if (path === '/api/v1/search' && method === 'GET') {
    const session = await requireSession(req);
    const query = boundedQuery(url.searchParams.get('q'));
    if (query.length < 2) return json(res,200,{query,items:[]});
    const types = parseTypes(url.searchParams.get('types'));
    const limit = pageSize(url.searchParams.get('limit'), 30, 60);
    // Диапазон дат: договор трёхмесячной давности иначе тонет среди
    // шестидесяти свежих совпадений, а второй страницы у поиска нет.
    const range=(value)=>{
      if(!value)return null;
      const at=new Date(value);
      if(Number.isNaN(at.getTime()))throw Object.assign(new Error('Invalid date'),{code:'INVALID_DATE',statusCode:400,expose:true});
      return at.toISOString();
    };
    const from=range(url.searchParams.get('from')),to=range(url.searchParams.get('to'));
    json(res,200,{query,from,to,items:await store.searchWorkspace(session,query,{types,limit,from,to})});
    return true;
  }

  if (path === '/api/v1/files' && method === 'GET') {
    const session = await requireSession(req);
    const query = boundedQuery(url.searchParams.get('q'));
    const mime = url.searchParams.get('mime');
    const limit = pageSize(url.searchParams.get('limit'), 60, 100);
    json(res,200,{items:await store.listFiles(session,{query,mime,limit})});
    return true;
  }

  if (path === '/api/v1/mentions' && method === 'GET') {
    const session = await requireSession(req);
    const limit = pageSize(url.searchParams.get('limit'), 50, 100);
    json(res,200,{items:await store.listNotifications(session,{type:'mentions',limit})});
    return true;
  }

  return false;
}
