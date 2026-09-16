import { cleanText, json, noContent, readJson } from './helpers.js';

const SEARCH_TYPES = new Set(['message','conversation','task','file','person','event']);

function parseTypes(value) {
  if (!value) return null;
  const types = String(value).split(',').map((item) => item.trim()).filter((item) => SEARCH_TYPES.has(item));
  return types.length ? [...new Set(types)] : null;
}

export async function handleDailyWork(req,res,ctx,url,path,method) {
  const { store, requireSession, hub } = ctx;

  if (path === '/api/v1/attention' && method === 'GET') {
    const session = await requireSession(req);
    json(res,200,{ attention:await store.attentionSummary(session) });
    return true;
  }

  if (path === '/api/v1/notifications' && method === 'GET') {
    const session = await requireSession(req);
    const status = url.searchParams.get('status');
    const type = url.searchParams.get('type');
    const limit = Number(url.searchParams.get('limit') ?? 50);
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
    const query = cleanText(url.searchParams.get('q') ?? '',160);
    if (query.length < 2) return json(res,200,{query,items:[]});
    const types = parseTypes(url.searchParams.get('types'));
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 30),1),60);
    json(res,200,{query,items:await store.searchWorkspace(session,query,{types,limit})});
    return true;
  }

  if (path === '/api/v1/files' && method === 'GET') {
    const session = await requireSession(req);
    const query = cleanText(url.searchParams.get('q') ?? '',160);
    const mime = url.searchParams.get('mime');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 60),1),100);
    json(res,200,{items:await store.listFiles(session,{query,mime,limit})});
    return true;
  }

  if (path === '/api/v1/mentions' && method === 'GET') {
    const session = await requireSession(req);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50),1),100);
    json(res,200,{items:await store.listNotifications(session,{type:'mentions',limit})});
    return true;
  }

  return false;
}
