import { json, readJson } from './helpers.js';

const ID = '([0-9a-f-]{36})';

/**
 * Сторис.
 *
 * Гостю их не видно и не слышно: он чужой сотрудник в одной комнате, а
 * сторис показывают всей компании. Поэтому отказ здесь — 404, как и
 * везде, где гостю не положено знать даже о существовании раздела.
 */
export function createStoryHandler() {
  return async function handleStories(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/stories')) return false;
    const session = await ctx.requireSession(req);
    if (!ctx.stories) {
      throw Object.assign(new Error('Сторис доступны в режиме с базой данных'),
        { code: 'STORIES_UNAVAILABLE', statusCode: 503, expose: true });
    }
    if (session.role === 'guest') throw Object.assign(new Error('Not found'), { code: 'NOT_FOUND', statusCode: 404 });

    if (path === '/api/v1/stories' && method === 'GET') {
      json(res, 200, { items: await ctx.stories.live(session) });
      return true;
    }
    if (path === '/api/v1/stories' && method === 'POST') {
      const body = await readJson(req);
      const story = await ctx.stories.publish(session, {
        fileId: body.fileId, caption: body.caption ?? null, hours: body.hours,
      });
      // Сторис — это «посмотрите сейчас»: тем, кто в сети, о ней стоит
      // сказать сразу, иначе она догорит непоказанной.
      ctx.hub.broadcastWorkspace(session.workspaceId, 'story.published', story);
      json(res, 201, { story });
      return true;
    }
    if (path === '/api/v1/stories/archive' && method === 'GET') {
      json(res, 200, { items: await ctx.stories.archive(session, { limit: url.searchParams.get('limit') }) });
      return true;
    }

    let match = path.match(new RegExp(`^/api/v1/stories/${ID}/seen$`, 'i'));
    if (match && method === 'POST') {
      json(res, 200, await ctx.stories.seen(session, match[1]));
      return true;
    }
    match = path.match(new RegExp(`^/api/v1/stories/${ID}/viewers$`, 'i'));
    if (match && method === 'GET') {
      json(res, 200, { items: await ctx.stories.viewers(session, match[1]) });
      return true;
    }
    match = path.match(new RegExp(`^/api/v1/stories/${ID}$`, 'i'));
    if (match && method === 'DELETE') {
      json(res, 200, await ctx.stories.remove(session, match[1]));
      return true;
    }
    return false;
  };
}
