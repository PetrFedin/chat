const PROFILE_FIELDS = ['displayName', 'title', 'department', 'phone', 'about', 'location', 'startedOn', 'timezone', 'statusText'];

const COLUMN = {
  displayName: 'display_name', title: 'title', department: 'department', phone: 'phone',
  about: 'about', location: 'location', startedOn: 'started_on', timezone: 'timezone', statusText: 'status_text',
};

// Audit rows are machine names; a person's page needs a sentence.
const ACTIVITY_LABEL = {
  'commitment.created': 'поставил(а) задачу',
  'commitment.transitioned': 'перевёл(а) задачу',
  'evidence.added': 'приложил(а) доказательство',
  'commitment.rescheduled': 'перенёс(ла) срок',
  'conversation.created': 'создал(а) беседу',
  'member.joined': 'присоединился(ась)',
};

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

export function createPeopleRepository(pool, org = null) {
  if (!pool) return null;

  const profileRow = async (session, userId) => {
    const { rows } = await pool.query(
      `SELECT m.user_id "userId", m.role "workspaceRole", m.created_at "joinedAt", u.email, u.disabled_at "disabledAt",
              p.display_name "displayName", p.title, p.department, p.phone, p.about, p.location,
              p.started_on "startedOn", p.timezone, p.locale, p.status_text "statusText", p.avatar_url "avatarUrl",
              pr.state "presenceState", pr.last_seen_at "lastSeenAt"
       FROM memberships m
       JOIN users u ON u.id=m.user_id
       LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id
       LEFT JOIN user_presence pr ON pr.workspace_id=m.workspace_id AND pr.user_id=m.user_id
       WHERE m.workspace_id=$1 AND m.user_id=$2`,
      [session.workspaceId, userId],
    );
    return rows[0] ?? null;
  };

  return {
    /**
     * One person's card: who they are, where they sit in the company, what
     * they are accountable for and what they have been doing.
     *
     * A guest may only look up somebody they share a room with; the staff
     * directory is not a customer-facing asset.
     */
    async getPerson(session, userId) {
      if (session.role === 'guest') {
        const { rowCount } = await pool.query(
          `SELECT 1 FROM conversation_members a JOIN conversation_members b
             ON b.conversation_id=a.conversation_id AND b.workspace_id=a.workspace_id
           WHERE a.workspace_id=$1 AND a.user_id=$2 AND b.user_id=$3 LIMIT 1`,
          [session.workspaceId, session.userId, userId],
        );
        if (!rowCount && userId !== session.userId) throw fail('Person not found', 'PERSON_NOT_FOUND', 404);
      }
      const profile = await profileRow(session, userId);
      if (!profile) throw fail('Person not found', 'PERSON_NOT_FOUND', 404);

      const [units, chain, work] = await Promise.all([
        org ? org.unitsOf(session, userId) : [],
        org ? org.reportingChain(session, userId) : [],
        pool.query(
          `SELECT status, count(*)::int count FROM commitments
           WHERE workspace_id=$1 AND owner_id=$2 GROUP BY status`,
          [session.workspaceId, userId],
        ),
      ]);

      const byStatus = Object.fromEntries(work.rows.map((r) => [r.status, r.count]));
      const open = Object.entries(byStatus)
        .filter(([status]) => !['closed', 'cancelled', 'rejected'].includes(status))
        .reduce((sum, [, count]) => sum + count, 0);

      return {
        ...profile,
        isSelf: userId === session.userId,
        units,
        reportsTo: chain.filter((c) => c.headUserId && c.headUserId !== userId).map((c) => ({ unit: c.unitName, headUserId: c.headUserId, headName: c.headName })),
        chain,
        workload: { byStatus, open, total: Object.values(byStatus).reduce((a, b) => a + b, 0) },
      };
    },

    /**
     * A person edits their own card. A workspace admin may edit anyone's,
     * because job titles and departments are company facts, not self-declared
     * ones — but nobody silently edits somebody else without it being an
     * audited act.
     */
    async updateProfile(session, userId, patch, { canManageMembers = false } = {}) {
      if (userId !== session.userId && !canManageMembers) throw fail('You may only edit your own profile', 'PROFILE_FORBIDDEN', 403);
      const fields = PROFILE_FIELDS.filter((f) => patch[f] !== undefined);
      if (!fields.length) throw fail('Nothing to update', 'EMPTY_PATCH');
      if (patch.displayName !== undefined && !String(patch.displayName).trim()) throw fail('A display name is required', 'INVALID_DISPLAY_NAME');

      const setters = fields.map((f, i) => `${COLUMN[f]}=$${i + 3}`).join(',');
      const values = fields.map((f) => (typeof patch[f] === 'string' ? patch[f].trim() || null : patch[f]));
      const { rows } = await pool.query(
        `UPDATE workspace_profiles SET ${setters}, updated_at=now() WHERE workspace_id=$1 AND user_id=$2 RETURNING user_id`,
        [session.workspaceId, userId, ...values],
      );
      if (!rows[0]) throw fail('Person not found', 'PERSON_NOT_FOUND', 404);

      await pool.query(
        `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
         VALUES($1,$2,'profile',$3,'profile.updated',$4,$5)`,
        [session.organizationId, session.workspaceId, userId, session.userId, { fields, onBehalfOf: userId !== session.userId }],
      );
      return this.getPerson(session, userId);
    },

    /**
     * What a person actually did, newest first, straight from the append-only
     * audit log. Nothing is written here to build the feed — the events were
     * already being recorded, they simply had no reader.
     */
    async activity(session, userId, { limit = 40, before = null } = {}) {
      const { rows } = await pool.query(
        `SELECT a.sequence, a.event_type "eventType", a.aggregate_type "aggregateType", a.aggregate_id "aggregateId",
                a.payload, a.created_at "createdAt",
                CASE WHEN a.aggregate_type='commitment' THEN (SELECT title FROM commitments c WHERE c.workspace_id=a.workspace_id AND c.id=a.aggregate_id) END subject
         FROM audit_events a
         WHERE a.workspace_id=$1 AND a.actor_id=$2 AND ($3::bigint IS NULL OR a.sequence < $3)
         ORDER BY a.sequence DESC LIMIT $4`,
        [session.workspaceId, userId, before, Math.min(Number(limit) || 40, 100)],
      );
      return rows.map((row) => ({
        ...row,
        sequence: Number(row.sequence),
        label: ACTIVITY_LABEL[row.eventType] ?? row.eventType,
      }));
    },
  };
}
