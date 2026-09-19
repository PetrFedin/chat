import { DEMO_EMAIL } from './seed-demo.js';

/**
 * Gives the preview workspace a company shape, so the org chart shows
 * something real instead of an empty state. Idempotent: a restart against a
 * persisted demo finds the units already there and leaves them alone.
 */
export async function seedDemoOrgStructure(pool, org) {
  if (!pool || !org) return { seeded: false, reason: 'no database' };

  const { rows: owner } = await pool.query(
    `SELECT m.organization_id "organizationId", m.workspace_id "workspaceId", m.user_id "userId", m.role
     FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email=$1 LIMIT 1`,
    [DEMO_EMAIL],
  );
  if (!owner[0]) return { seeded: false, reason: 'demo owner not found' };
  const session = owner[0];

  const { rows: existing } = await pool.query('SELECT count(*)::int c FROM org_units WHERE workspace_id=$1', [session.workspaceId]);
  if (existing[0].c) return { seeded: false, reason: 'already present' };

  const { rows: people } = await pool.query(
    `SELECT m.user_id "userId", m.role, p.display_name "displayName"
     FROM memberships m LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id
     WHERE m.workspace_id=$1 AND m.role<>'guest' ORDER BY p.display_name`,
    [session.workspaceId],
  );
  if (!people.length) return { seeded: false, reason: 'no staff' };

  const company = await org.createUnit(session, { kind: 'company', name: 'Northstar Studio', purpose: 'Продуктовая студия' });
  const product = await org.createUnit(session, { kind: 'department', name: 'Продукт', parentId: company.id, seatLimit: 8 });
  const engineering = await org.createUnit(session, { kind: 'department', name: 'Разработка', parentId: company.id, seatLimit: 10 });
  const design = await org.createUnit(session, { kind: 'division', name: 'Дизайн', parentId: product.id, seatLimit: 3 });
  const mobile = await org.createUnit(session, { kind: 'team', name: 'Мобильная группа', parentId: engineering.id, seatLimit: 4 });
  await org.createUnit(session, { kind: 'department', name: 'Операции', parentId: company.id, seatLimit: 3 });

  // Spread the demo staff across the branches, with a head where there is
  // somebody to appoint, so the chart shows both filled and open posts.
  const plan = [
    [company.id, 'head'], [product.id, 'head'], [engineering.id, 'head'],
    [design.id, 'head'], [design.id, 'member'], [mobile.id, 'head'], [mobile.id, 'member'],
  ];
  let placed = 0;
  for (const [index, [unitId, role]] of plan.entries()) {
    const person = people[index % people.length];
    try {
      await org.addMember(session, unitId, { userId: person.userId, role });
      placed += 1;
    } catch {
      // A seat limit or a duplicate is not a reason to fail startup.
    }
  }
  return { seeded: true, units: 6, placed };
}
