import { DEMO_EMAIL } from './seed-demo.js';

/**
 * Invites the demo staff to the seeded meetings and leaves one answer
 * outstanding, so the grid actually shows the "awaiting your confirmation"
 * state instead of a calendar where nobody was ever invited.
 */
export async function seedDemoCalendarParticipation(pool, calendar) {
  if (!pool || !calendar) return { seeded: false, reason: 'no database' };

  const { rows: owner } = await pool.query(
    `SELECT m.organization_id "organizationId", m.workspace_id "workspaceId", m.user_id "userId", m.role
     FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email=$1 LIMIT 1`,
    [DEMO_EMAIL],
  );
  if (!owner[0]) return { seeded: false, reason: 'demo owner not found' };
  const session = owner[0];

  const { rows: already } = await pool.query('SELECT count(*)::int c FROM calendar_event_participants WHERE workspace_id=$1', [session.workspaceId]);
  if (already[0].c) return { seeded: false, reason: 'already present' };

  const { rows: events } = await pool.query(
    "SELECT id FROM calendar_events WHERE workspace_id=$1 AND owner_id=$2 AND kind='meeting' ORDER BY start_at LIMIT 2",
    [session.workspaceId, session.userId],
  );
  const { rows: staff } = await pool.query(
    "SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id<>$2 AND role<>'guest' LIMIT 3",
    [session.workspaceId, session.userId],
  );
  if (!events.length || !staff.length) return { seeded: false, reason: 'nothing to invite to' };

  let invited = 0;
  for (const event of events) {
    try {
      await calendar.invite(session, event.id, staff.map((s) => s.user_id));
      invited += staff.length;
    } catch { /* a seat or duplicate is not a reason to fail startup */ }
  }
  // One person answers; the rest stay outstanding so the pulse has something
  // to point at.
  if (staff[0] && events[0]) {
    try {
      await calendar.respond({ ...session, userId: staff[0].user_id, role: 'member' }, events[0].id, 'accepted');
    } catch { /* ignore */ }
  }
  return { seeded: true, events: events.length, invited };
}
