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
  'invitation.issued': 'позвал(а) человека в компанию',
  'invitation.accepted': 'принял(а) приглашение и вышел(шла) на работу',
  'member.deactivated': 'проводил(а) сотрудника',
  'member.reactivated': 'вернул(а) сотрудника на работу',
  'password.reset.issued': 'выписал(а) ссылку для смены пароля',
  'password.reset.used': 'сменил(а) пароль по ссылке',
  'vault.created': 'добавил(а) пароль в сейф',
  'vault.updated': 'изменил(а) запись в сейфе',
  'vault.revealed': 'раскрыл(а) пароль из сейфа',
  'vault.deleted': 'удалил(а) запись из сейфа',
  'profile.updated': 'изменил(а) карточку сотрудника',
  'commitment.reassigned': 'передал(а) задачу другому',
  'conversation.ownership_claimed': 'принял(а) беседу, оставшуюся без владельца',
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
     * Увольнение.
     *
     * До сих пор ушедший сотрудник сохранял доступ навсегда: механизм в
     * схеме был (`users.disabled_at` проверяется и при входе, и при каждом
     * запросе), а выставить признак было нечем. Это и есть та самая
     * незакрытая дверь, о которой в компании вспоминают последней.
     *
     * Кто провожает: тот, кто зовёт, — по праву `member.invite`, и только
     * человека ниже себя по лестнице. Владельца не увольняет никто, себя —
     * тоже: компанию нельзя оставить без хозяина случайным нажатием.
     *
     * Что происходит: признак выставляется, все живые сессии обрываются в
     * той же транзакции, запись уходит в журнал. Данные остаются на месте —
     * задачи, сообщения и доказательства ушедшего никуда не деваются, иначе
     * увольнение стирало бы историю работы компании.
     */
    async setActive(session, userId, active, { rank = () => 0 } = {}) {
      if (userId === session.userId) throw fail('Себя уволить нельзя', 'CANNOT_DEACTIVATE_SELF', 400);
      const profile = await profileRow(session, userId);
      if (!profile) throw fail('Person not found', 'PERSON_NOT_FOUND', 404);
      if (profile.workspaceRole === 'owner') throw fail('Владельца компании уволить нельзя', 'CANNOT_DEACTIVATE_OWNER', 403);
      if (rank(profile.workspaceRole) >= rank(session.role)) {
        throw fail('Увольнять можно только тех, кто ниже вас по лестнице', 'ROLE_TOO_HIGH', 403);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `UPDATE users SET disabled_at=$2 WHERE id=$1 RETURNING id, disabled_at "disabledAt"`,
          [userId, active ? null : new Date().toISOString()],
        );
        if (!rows[0]) throw fail('Person not found', 'PERSON_NOT_FOUND', 404);
        if (!active) {
          await client.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
        }
        await client.query(
          `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
           VALUES($1,$2,'membership',$3,$4,$5,$6)`,
          [session.organizationId, session.workspaceId, userId,
           active ? 'member.reactivated' : 'member.deactivated', session.userId,
           { email: profile.email, role: profile.workspaceRole }],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      return this.getPerson(session, userId);
    },

    /**
     * The people this person actually deals with, which is not the same list
     * as the staff directory.
     *
     * Two sources, because they answer two different questions. «Кто уже
     * пишет мне» comes from shared rooms. «Кто со мной в отделе» comes from
     * the chart an administrator filled in — those colleagues may not have
     * written a line yet and still belong on the list.
     *
     * An open channel is not a relationship: everybody is in it by visibility
     * alone, so it would make the whole company look like your contacts. Only
     * rooms with an explicit membership row count.
     */
    async contacts(session) {
      const [talking, unitRows] = await Promise.all([
        pool.query(
          // The join to messages multiplies the row per message, so the
          // conversations have to be counted distinctly or two colleagues who
          // chat a lot look like twenty shared rooms.
          `SELECT b.user_id "userId", count(DISTINCT c.id)::int "sharedCount",
                  max(c.title) FILTER (WHERE c.kind='direct') "directTitle",
                  bool_or(c.kind='direct') "hasDirect",
                  max(m.created_at) "lastMessageAt"
             FROM conversation_members a
             JOIN conversation_members b
               ON b.workspace_id=a.workspace_id AND b.conversation_id=a.conversation_id AND b.user_id<>a.user_id
             JOIN conversations c ON c.workspace_id=a.workspace_id AND c.id=a.conversation_id
             LEFT JOIN messages m ON m.workspace_id=c.workspace_id AND m.conversation_id=c.id AND m.deleted_at IS NULL
            WHERE a.workspace_id=$1 AND a.user_id=$2 AND c.archived_at IS NULL
            GROUP BY b.user_id`,
          [session.workspaceId, session.userId],
        ),
        // A guest has no place in the chart, so they get no unit groups.
        session.role === 'guest'
          ? Promise.resolve({ rows: [] })
          : pool.query(
              `SELECT u.id "unitId", u.name "unitName", u.kind "unitKind", u.depth,
                      om.user_id "userId", om.role "unitRole"
                 FROM org_unit_members mine
                 JOIN org_units u ON u.workspace_id=mine.workspace_id AND u.id=mine.unit_id
                 JOIN org_unit_members om ON om.workspace_id=u.workspace_id AND om.unit_id=u.id
                WHERE mine.workspace_id=$1 AND mine.user_id=$2
                ORDER BY u.depth, u.name, om.role`,
              [session.workspaceId, session.userId],
            ),
      ]);

      const wanted = new Set([...talking.rows, ...unitRows.rows].map((r) => r.userId));
      wanted.delete(session.userId);
      const people = new Map();
      if (wanted.size) {
        const { rows } = await pool.query(
          `SELECT m.user_id "userId", m.role "workspaceRole", u.email,
                  p.display_name "displayName", p.title, p.department,
                  pr.state "presenceState"
             FROM memberships m
             JOIN users u ON u.id=m.user_id
             LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id
             LEFT JOIN user_presence pr ON pr.workspace_id=m.workspace_id AND pr.user_id=m.user_id
            WHERE m.workspace_id=$1 AND m.user_id = ANY($2::uuid[]) AND u.disabled_at IS NULL`,
          [session.workspaceId, [...wanted]],
        );
        for (const row of rows) people.set(row.userId, row);
      }

      const talkingTo = talking.rows
        .filter((row) => row.userId !== session.userId && people.has(row.userId))
        .map((row) => ({
          ...people.get(row.userId),
          sharedCount: row.sharedCount,
          hasDirect: row.hasDirect,
          lastMessageAt: row.lastMessageAt ?? null,
        }))
        .sort((a, b) => String(b.lastMessageAt ?? '').localeCompare(String(a.lastMessageAt ?? '')) || b.sharedCount - a.sharedCount);

      const units = [];
      for (const row of unitRows.rows) {
        if (row.userId === session.userId || !people.has(row.userId)) continue;
        let unit = units.find((u) => u.unitId === row.unitId);
        if (!unit) { unit = { unitId: row.unitId, name: row.unitName, kind: row.unitKind, depth: row.depth, members: [] }; units.push(unit); }
        unit.members.push({ ...people.get(row.userId), unitRole: row.unitRole });
      }

      return { talkingTo, units };
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
