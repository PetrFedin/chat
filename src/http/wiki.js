import { json, readJson } from './helpers.js';
import { Permission, requirePermission } from '../rbac.js';

const PAGE_ID = '([0-9a-f-]{36})';
const ONE = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}$`, 'i');
const HISTORY = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/history$`, 'i');
const ACCESS = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/access$`, 'i');
const ACCESS_GRANT = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/access/${PAGE_ID}$`, 'i');
const TASKS = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/tasks$`, 'i');
const TASK = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/tasks/${PAGE_ID}$`, 'i');
const CHANNELS = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/channels$`, 'i');
const CHANNEL = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/channels/${PAGE_ID}$`, 'i');
const CALENDAR_MEETINGS = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/calendar-meetings$`, 'i');
const CALENDAR_MEETING = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/calendar-meetings/${PAGE_ID}$`, 'i');
const CALLS = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/calls$`, 'i');
const CALL = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/calls/${PAGE_ID}$`, 'i');
const DECISION_PAGES = new RegExp(`^/api/v1/wiki/decisions/${PAGE_ID}/pages$`, 'i');
const DECISIONS = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/decisions$`, 'i');
const DECISION = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/decisions/${PAGE_ID}$`, 'i');
const PROJECTS = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/projects$`, 'i');
const PROJECT = new RegExp(`^/api/v1/wiki/pages/${PAGE_ID}/projects/${PAGE_ID}$`, 'i');

function unavailable() {
  throw Object.assign(new Error('Вики работает только с базой данных PostgreSQL'), {
    code: 'WIKI_UNAVAILABLE', statusCode: 503, expose: true,
  });
}

export function createWikiHandler() {
  return async function handleWiki(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/wiki/')) return false;
    const session = await ctx.requireSession(req);
    requirePermission(session.role, Permission.WIKI_USE);
    if (!ctx.wiki?.enabled) unavailable();

    if (path === '/api/v1/wiki/pages' && method === 'GET') {
      const parentId = url.searchParams.get('parentId') || null;
      json(res, 200, { items: await ctx.wiki.list(session, { parentId }) });
      return true;
    }
    if (path === '/api/v1/wiki/pages' && method === 'POST') {
      const body = await readJson(req);
      json(res, 201, await ctx.wiki.create(session, body));
      return true;
    }
    if (path === '/api/v1/wiki/search' && method === 'GET') {
      json(res, 200, {
        items: await ctx.wiki.search(session, {
          query: url.searchParams.get('q'),
          limit: url.searchParams.get('limit'),
        }),
      });
      return true;
    }

    const inverseDecisionPages = path.match(DECISION_PAGES);
    if (inverseDecisionPages && method === 'GET') {
      json(res, 200, { items: await ctx.wiki.pagesForDecision(session, inverseDecisionPages[1]) });
      return true;
    }

    const history = path.match(HISTORY);
    if (history && method === 'GET') {
      json(res, 200, { items: await ctx.wiki.history(session, history[1]) });
      return true;
    }

    const access = path.match(ACCESS);
    if (access && method === 'GET') {
      json(res, 200, await ctx.wiki.getAccess(session, access[1]));
      return true;
    }
    if (access && method === 'PUT') {
      const body = await readJson(req);
      json(res, 200, await ctx.wiki.setVisibility(session, access[1], body.visibility));
      return true;
    }
    if (access && method === 'POST') {
      const body = await readJson(req);
      if (!body.userId) throw Object.assign(new Error('userId is required'), {
        code:'USER_ID_REQUIRED',statusCode:400,expose:true,
      });
      json(res, 200, await ctx.wiki.grantAccess(session, access[1], String(body.userId), body.access));
      return true;
    }

    const accessGrant = path.match(ACCESS_GRANT);
    if (accessGrant && method === 'DELETE') {
      json(res, 200, await ctx.wiki.revokeAccess(session, accessGrant[1], accessGrant[2]));
      return true;
    }

    const taskList = path.match(TASKS);
    if (taskList && method === 'POST') {
      const body = await readJson(req);
      if (!body.taskId) {
        throw Object.assign(new Error('taskId is required'), {
          code: 'TASK_ID_REQUIRED', statusCode: 400, expose: true,
        });
      }
      json(res, 200, await ctx.wiki.linkTask(session, taskList[1], String(body.taskId)));
      return true;
    }
    const task = path.match(TASK);
    if (task && method === 'DELETE') {
      json(res, 200, await ctx.wiki.unlinkTask(session, task[1], task[2]));
      return true;
    }

    const channelList = path.match(CHANNELS);
    if (channelList && method === 'POST') {
      const body = await readJson(req);
      if (!body.conversationId) {
        throw Object.assign(new Error('conversationId is required'), {
          code: 'CONVERSATION_ID_REQUIRED', statusCode: 400, expose: true,
        });
      }
      json(res, 200, await ctx.wiki.linkChannel(session, channelList[1], String(body.conversationId)));
      return true;
    }
    const channel = path.match(CHANNEL);
    if (channel && method === 'DELETE') {
      json(res, 200, await ctx.wiki.unlinkChannel(session, channel[1], channel[2]));
      return true;
    }

    const meetingList = path.match(CALENDAR_MEETINGS);
    if (meetingList && method === 'POST') {
      const body = await readJson(req);
      if (!body.eventId) {
        throw Object.assign(new Error('eventId is required'), {
          code: 'EVENT_ID_REQUIRED', statusCode: 400, expose: true,
        });
      }
      json(res, 200, await ctx.wiki.linkCalendarMeeting(session, meetingList[1], String(body.eventId)));
      return true;
    }
    const calendarMeeting = path.match(CALENDAR_MEETING);
    if (calendarMeeting && method === 'DELETE') {
      json(res, 200, await ctx.wiki.unlinkCalendarMeeting(session, calendarMeeting[1], calendarMeeting[2]));
      return true;
    }

    const callList = path.match(CALLS);
    if (callList && method === 'POST') {
      const body = await readJson(req);
      if (!body.callId) {
        throw Object.assign(new Error('callId is required'), {
          code: 'CALL_ID_REQUIRED', statusCode: 400, expose: true,
        });
      }
      json(res, 200, await ctx.wiki.linkCall(session, callList[1], String(body.callId)));
      return true;
    }
    const call = path.match(CALL);
    if (call && method === 'DELETE') {
      json(res, 200, await ctx.wiki.unlinkCall(session, call[1], call[2]));
      return true;
    }

    const decisionList = path.match(DECISIONS);
    if (decisionList && method === 'POST') {
      const body = await readJson(req);
      if (!body.decisionId) {
        throw Object.assign(new Error('decisionId is required'), {
          code: 'DECISION_ID_REQUIRED', statusCode: 400, expose: true,
        });
      }
      json(res, 200, await ctx.wiki.linkDecision(session, decisionList[1], String(body.decisionId)));
      return true;
    }
    const decision = path.match(DECISION);
    if (decision && method === 'DELETE') {
      json(res, 200, await ctx.wiki.unlinkDecision(session, decision[1], decision[2]));
      return true;
    }

    const projectList = path.match(PROJECTS);
    if (projectList && method === 'POST') {
      const body = await readJson(req);
      if (!body.projectId) {
        throw Object.assign(new Error('projectId is required'), {
          code: 'PROJECT_ID_REQUIRED', statusCode: 400, expose: true,
        });
      }
      json(res, 200, await ctx.wiki.linkProject(session, projectList[1], String(body.projectId)));
      return true;
    }

    const project = path.match(PROJECT);
    if (project && method === 'DELETE') {
      json(res, 200, await ctx.wiki.unlinkProject(session, project[1], project[2]));
      return true;
    }

    const one = path.match(ONE);
    if (one && method === 'GET') {
      json(res, 200, await ctx.wiki.get(session, one[1]));
      return true;
    }
    if (one && method === 'PATCH') {
      const body = await readJson(req);
      json(res, 200, await ctx.wiki.update(session, one[1], body));
      return true;
    }
    if (one && method === 'DELETE') {
      await ctx.wiki.archive(session, one[1]);
      json(res, 200, { ok: true });
      return true;
    }
    return false;
  };
}
