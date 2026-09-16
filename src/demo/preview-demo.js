import { json } from '../http/helpers.js';
import { DEMO_EMAIL, seedDemoWorkspace } from './seed-demo.js';

export async function preparePreviewDemo({ store, objectStore, mode, enabled }) {
  if (!enabled || mode !== 'memory') return { enabled: false };
  await seedDemoWorkspace(store, objectStore);
  return { enabled: true, email: DEMO_EMAIL, label: 'Northstar Studio' };
}

export async function handlePreviewDemo(req, res, ctx, path, method) {
  if (path === '/api/v1/auth/demo' && method === 'POST') {
    if (!ctx.demo?.enabled) {
      const error = new Error('Demo mode is not enabled');
      error.code = 'DEMO_DISABLED';
      error.statusCode = 404;
      throw error;
    }
    const auth = await ctx.store.findAuthByEmail(ctx.demo.email);
    if (!auth) {
      const error = new Error('Demo workspace is unavailable');
      error.code = 'DEMO_UNAVAILABLE';
      error.statusCode = 503;
      throw error;
    }
    await ctx.openSession(res, req, auth.id, auth.workspaceId, 200);
    return true;
  }
  if (path === '/api/v1/demo' && method === 'GET') {
    json(res, 200, { enabled: Boolean(ctx.demo?.enabled), label: ctx.demo?.label ?? null });
    return true;
  }
  return false;
}
