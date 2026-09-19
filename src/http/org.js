import { Permission, requirePermission } from '../rbac.js';
import { cleanText, json, noContent, readJson } from './helpers.js';

const UNIT = '([0-9a-f-]{36})';
const UNIT_ID = new RegExp(`^/api/v1/org/units/${UNIT}$`, 'i');
const UNIT_MEMBERS = new RegExp(`^/api/v1/org/units/${UNIT}/members$`, 'i');
const UNIT_MEMBER = new RegExp(`^/api/v1/org/units/${UNIT}/members/${UNIT}$`, 'i');
const PERSON_CHAIN = new RegExp(`^/api/v1/org/people/${UNIT}/chain$`, 'i');

const unavailable = () => Object.assign(
  new Error('The organisational chart requires a PostgreSQL deployment'),
  { code: 'ORG_STRUCTURE_UNAVAILABLE', statusCode: 503, expose: true },
);

const forbidden = () => Object.assign(
  new Error('You do not manage this unit'),
  { code: 'ORG_UNIT_FORBIDDEN', statusCode: 403 },
);

export function createOrgHandler() {
  return async function handleOrg(req, res, ctx, url, path, method) {
    if (!path.startsWith('/api/v1/org/')) return false;
    const session = await ctx.requireSession(req);
    const org = ctx.org;
    if (!org) throw unavailable();

    // Two authorities: workspace-wide structure rights, and running one unit.
    const workspaceWide = (ctx.permissions(session.role) ?? []).includes(Permission.ORG_STRUCTURE_MANAGE);
    const mayManage = (unitId) => org.canManageUnit(session, unitId, { workspaceWide });

    // Everyone in the workspace may read the chart: knowing who runs what is
    // the point of having one.
    if (method === 'GET' && path === '/api/v1/org/units') {
      json(res, 200, { items: await org.listUnits(session), canManage: workspaceWide, managedUnitIds: await org.adminUnitIds(session) });
      return true;
    }

    if (method === 'POST' && path === '/api/v1/org/units') {
      const body = await readJson(req);
      // A sub-unit may be created by whoever runs the parent; a top-level one
      // is a workspace-wide act.
      if (body.parentId ? !(await mayManage(body.parentId)) : !workspaceWide) throw forbidden();
      const unit = await org.createUnit(session, {
        parentId: body.parentId ?? null,
        kind: body.kind ?? 'department',
        name: cleanText(body.name, 120),
        purpose: body.purpose ? cleanText(body.purpose, 500) : null,
        seatLimit: body.seatLimit ?? null,
      });
      json(res, 201, { unit });
      return true;
    }

    let m = path.match(UNIT_ID);
    if (m && method === 'PATCH') {
      const body = await readJson(req);
      if (!(await mayManage(m[1]))) throw forbidden();
      // Moving a unit or changing its plan reshapes the company, so it stays
      // with workspace-wide rights even for a unit admin.
      if ((body.parentId !== undefined || body.seatLimit !== undefined) && !workspaceWide) throw forbidden();
      json(res, 200, { unit: await org.updateUnit(session, m[1], body) });
      return true;
    }
    if (m && method === 'DELETE') {
      if (!workspaceWide) throw forbidden();
      await org.deleteUnit(session, m[1]);
      noContent(res);
      return true;
    }

    m = path.match(UNIT_MEMBERS);
    if (m && method === 'GET') {
      json(res, 200, { items: await org.listMembers(session, m[1]) });
      return true;
    }
    if (m && method === 'POST') {
      if (!(await mayManage(m[1]))) throw forbidden();
      const body = await readJson(req);
      json(res, 201, { member: await org.addMember(session, m[1], { userId: body.userId, role: body.role ?? 'member' }) });
      return true;
    }

    m = path.match(UNIT_MEMBER);
    if (m && method === 'DELETE') {
      if (!(await mayManage(m[1]))) throw forbidden();
      await org.removeMember(session, m[1], m[2]);
      noContent(res);
      return true;
    }

    m = path.match(PERSON_CHAIN);
    if (m && method === 'GET') {
      json(res, 200, { units: await org.unitsOf(session, m[1]), chain: await org.reportingChain(session, m[1]) });
      return true;
    }

    throw Object.assign(new Error('Org route not found'), { code: 'NOT_FOUND', statusCode: 404 });
  };
}
