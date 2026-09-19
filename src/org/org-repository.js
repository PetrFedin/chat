import { randomUUID } from 'node:crypto';

const MAX_DEPTH = 6;

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

const unitView = (row) => ({
  id: row.id,
  parentId: row.parent_id ?? null,
  kind: row.kind,
  name: row.name,
  purpose: row.purpose ?? null,
  depth: row.depth,
  headUserId: row.head_user_id ?? null,
  seats: {
    limit: row.seat_limit ?? null,
    used: Number(row.member_count ?? 0),
    free: row.seat_limit === null || row.seat_limit === undefined ? null : row.seat_limit - Number(row.member_count ?? 0),
  },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * The company's shape: units in a tree, people placed in them, one person
 * accountable per unit and a planned headcount per unit.
 *
 * Two authorities act here. Workspace owners and admins hold
 * `org.structure.manage` and may reshape anything. A unit's own `admin` runs
 * that unit and everything under it — its roster and its invitations — which
 * is what lets a department head staff their department without being handed
 * the whole workspace.
 */
export function createOrgRepository(pool) {
  if (!pool) return null;

  const tx = async (run) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };

  const loadUnit = async (client, session, id) => {
    const { rows } = await client.query('SELECT * FROM org_units WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [session.workspaceId, id]);
    if (!rows[0]) throw fail('Unit not found', 'ORG_UNIT_NOT_FOUND', 404);
    return rows[0];
  };

  /** Every unit from `id` downwards, itself included. */
  const subtreeIds = async (client, workspaceId, id) => {
    const { rows } = await client.query(
      `WITH RECURSIVE sub AS (
         SELECT id FROM org_units WHERE workspace_id=$1 AND id=$2
         UNION ALL
         SELECT u.id FROM org_units u JOIN sub ON u.parent_id=sub.id WHERE u.workspace_id=$1
       ) SELECT id FROM sub`,
      [workspaceId, id],
    );
    return rows.map((r) => r.id);
  };

  const repository = {
    /** The whole tree in one read, with headcount against planned seats. */
    async listUnits(session) {
      const { rows } = await pool.query(
        `SELECT u.*, (SELECT count(*) FROM org_unit_members m WHERE m.workspace_id=u.workspace_id AND m.unit_id=u.id) member_count
         FROM org_units u WHERE u.workspace_id=$1
         ORDER BY u.depth, u.position, u.name`,
        [session.workspaceId],
      );
      return rows.map(unitView);
    },

    /** Which units this person runs, directly or by inheritance from above. */
    async adminUnitIds(session) {
      const { rows } = await pool.query(
        `WITH RECURSIVE owned AS (
           SELECT u.id FROM org_units u JOIN org_unit_members m ON m.unit_id=u.id AND m.workspace_id=u.workspace_id
             WHERE u.workspace_id=$1 AND m.user_id=$2 AND m.role IN ('head','admin')
           UNION ALL
           SELECT c.id FROM org_units c JOIN owned ON c.parent_id=owned.id WHERE c.workspace_id=$1
         ) SELECT DISTINCT id FROM owned`,
        [session.workspaceId, session.userId],
      );
      return rows.map((r) => r.id);
    },

    async canManageUnit(session, unitId, { workspaceWide = false } = {}) {
      if (workspaceWide) return true;
      return (await repository.adminUnitIds(session)).includes(unitId);
    },

    async createUnit(session, { parentId = null, kind = 'department', name, purpose = null, seatLimit = null }) {
      if (!String(name ?? '').trim()) throw fail('Unit name is required', 'INVALID_UNIT_NAME');
      if (seatLimit !== null && seatLimit !== undefined && (!Number.isInteger(seatLimit) || seatLimit < 1)) {
        throw fail('Seat limit must be a positive whole number', 'INVALID_SEAT_LIMIT');
      }
      return tx(async (client) => {
        let depth = 0;
        if (parentId) {
          const parent = await loadUnit(client, session, parentId);
          depth = parent.depth + 1;
          if (depth > MAX_DEPTH) throw fail(`A unit cannot sit deeper than ${MAX_DEPTH} levels`, 'ORG_DEPTH_EXCEEDED', 409);
        }
        const id = randomUUID();
        const { rows } = await client.query(
          `INSERT INTO org_units(id,organization_id,workspace_id,parent_id,kind,name,purpose,seat_limit,depth,position,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,
             (SELECT coalesce(max(position),0)+1 FROM org_units WHERE workspace_id=$3 AND parent_id IS NOT DISTINCT FROM $4),$10)
           RETURNING *`,
          [id, session.organizationId, session.workspaceId, parentId, kind, String(name).trim(), purpose, seatLimit ?? null, depth, session.userId],
        );
        return unitView({ ...rows[0], member_count: 0 });
      });
    },

    async updateUnit(session, id, patch) {
      return tx(async (client) => {
        const unit = await loadUnit(client, session, id);

        if (patch.parentId !== undefined && patch.parentId !== unit.parent_id) {
          if (patch.parentId) {
            // Moving a unit under its own descendant would detach the branch
            // from the tree and orphan everyone in it.
            const descendants = await subtreeIds(client, session.workspaceId, id);
            if (descendants.includes(patch.parentId)) throw fail('A unit cannot be moved under itself', 'ORG_CYCLE', 409);
            await loadUnit(client, session, patch.parentId);
          }
          const { rows: depthRows } = await client.query(
            'SELECT coalesce((SELECT depth FROM org_units WHERE workspace_id=$1 AND id=$2),-1)+1 new_depth',
            [session.workspaceId, patch.parentId],
          );
          const shift = depthRows[0].new_depth - unit.depth;
          const branch = await subtreeIds(client, session.workspaceId, id);
          const { rows: deepest } = await client.query('SELECT max(depth) d FROM org_units WHERE workspace_id=$1 AND id=ANY($2::uuid[])', [session.workspaceId, branch]);
          if (Number(deepest[0].d) + shift > MAX_DEPTH) throw fail(`The branch would sit deeper than ${MAX_DEPTH} levels`, 'ORG_DEPTH_EXCEEDED', 409);
          await client.query('UPDATE org_units SET parent_id=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id, patch.parentId ?? null]);
          await client.query('UPDATE org_units SET depth=depth+$3, updated_at=now() WHERE workspace_id=$1 AND id=ANY($2::uuid[])', [session.workspaceId, branch, shift]);
        }

        if (patch.seatLimit !== undefined) {
          if (patch.seatLimit !== null && (!Number.isInteger(patch.seatLimit) || patch.seatLimit < 1)) throw fail('Seat limit must be a positive whole number', 'INVALID_SEAT_LIMIT');
          if (patch.seatLimit !== null) {
            const { rows: used } = await client.query('SELECT count(*)::int c FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2', [session.workspaceId, id]);
            // Lowering the plan below the people already in the unit would
            // record a number nobody can act on; say so instead.
            if (used[0].c > patch.seatLimit) throw fail(`The unit already holds ${used[0].c} people`, 'SEAT_LIMIT_BELOW_HEADCOUNT', 409);
          }
          await client.query('UPDATE org_units SET seat_limit=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id, patch.seatLimit]);
        }

        if (patch.headUserId !== undefined) {
          if (patch.headUserId) {
            const { rowCount } = await client.query('SELECT 1 FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2 AND user_id=$3', [session.workspaceId, id, patch.headUserId]);
            if (!rowCount) throw fail('The head must be a member of the unit', 'HEAD_NOT_IN_UNIT', 409);
            await client.query("UPDATE org_unit_members SET role='member' WHERE workspace_id=$1 AND unit_id=$2 AND role='head'", [session.workspaceId, id]);
            await client.query("UPDATE org_unit_members SET role='head' WHERE workspace_id=$1 AND unit_id=$2 AND user_id=$3", [session.workspaceId, id, patch.headUserId]);
          } else {
            await client.query("UPDATE org_unit_members SET role='member' WHERE workspace_id=$1 AND unit_id=$2 AND role='head'", [session.workspaceId, id]);
          }
          await client.query('UPDATE org_units SET head_user_id=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id, patch.headUserId ?? null]);
        }

        for (const [field, column] of [['name', 'name'], ['purpose', 'purpose'], ['kind', 'kind']]) {
          if (patch[field] === undefined) continue;
          if (field === 'name' && !String(patch.name ?? '').trim()) throw fail('Unit name is required', 'INVALID_UNIT_NAME');
          await client.query(`UPDATE org_units SET ${column}=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, id, field === 'name' ? String(patch.name).trim() : patch[field]]);
        }

        const { rows } = await client.query(
          `SELECT u.*, (SELECT count(*) FROM org_unit_members m WHERE m.workspace_id=u.workspace_id AND m.unit_id=u.id) member_count
           FROM org_units u WHERE u.workspace_id=$1 AND u.id=$2`,
          [session.workspaceId, id],
        );
        return unitView(rows[0]);
      });
    },

    async deleteUnit(session, id) {
      return tx(async (client) => {
        await loadUnit(client, session, id);
        const { rows: children } = await client.query('SELECT count(*)::int c FROM org_units WHERE workspace_id=$1 AND parent_id=$2', [session.workspaceId, id]);
        if (children[0].c) throw fail('Move or remove the sub-units first', 'ORG_UNIT_HAS_CHILDREN', 409);
        const { rows: members } = await client.query('SELECT count(*)::int c FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2', [session.workspaceId, id]);
        if (members[0].c) throw fail('Move the people out of the unit first', 'ORG_UNIT_HAS_MEMBERS', 409);
        await client.query('DELETE FROM org_units WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id]);
        return { deleted: true };
      });
    },

    async listMembers(session, unitId) {
      const { rows } = await pool.query(
        `SELECT m.user_id "userId", m.role, m.created_at "createdAt", p.display_name "displayName", p.title, ms.role "workspaceRole"
         FROM org_unit_members m
         JOIN memberships ms ON ms.workspace_id=m.workspace_id AND ms.user_id=m.user_id
         LEFT JOIN workspace_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id
         WHERE m.workspace_id=$1 AND m.unit_id=$2
         ORDER BY CASE m.role WHEN 'head' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, p.display_name`,
        [session.workspaceId, unitId],
      );
      return rows;
    },

    async addMember(session, unitId, { userId, role = 'member' }) {
      if (!['head', 'admin', 'member'].includes(role)) throw fail('Unknown unit role', 'INVALID_UNIT_ROLE');
      return tx(async (client) => {
        const unit = await loadUnit(client, session, unitId);
        const { rowCount: isMember } = await client.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND role<>'guest'", [session.workspaceId, userId]);
        // A guest is somebody else's employee; placing them on the org chart
        // would make the chart lie about who works here.
        if (!isMember) throw fail('Only workspace staff can be placed in a unit', 'NOT_WORKSPACE_STAFF', 409);

        if (unit.seat_limit !== null) {
          // Counted under the unit's row lock taken above, so two concurrent
          // adds cannot both see the last free seat.
          const { rows: used } = await client.query('SELECT count(*)::int c FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2 AND user_id<>$3', [session.workspaceId, unitId, userId]);
          if (used[0].c >= unit.seat_limit) throw fail(`No free seats: the plan is ${unit.seat_limit}`, 'SEAT_LIMIT_REACHED', 409);
        }
        if (role === 'head') await client.query("UPDATE org_unit_members SET role='member' WHERE workspace_id=$1 AND unit_id=$2 AND role='head'", [session.workspaceId, unitId]);
        await client.query(
          `INSERT INTO org_unit_members(organization_id,workspace_id,unit_id,user_id,role,assigned_by)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT (workspace_id,unit_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
          [session.organizationId, session.workspaceId, unitId, userId, role, session.userId],
        );
        if (role === 'head') await client.query('UPDATE org_units SET head_user_id=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2', [session.workspaceId, unitId, userId]);
        return { unitId, userId, role };
      });
    },

    async removeMember(session, unitId, userId) {
      return tx(async (client) => {
        await loadUnit(client, session, unitId);
        const { rowCount } = await client.query('DELETE FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2 AND user_id=$3', [session.workspaceId, unitId, userId]);
        if (!rowCount) throw fail('That person is not in this unit', 'NOT_A_UNIT_MEMBER', 404);
        await client.query('UPDATE org_units SET head_user_id=NULL, updated_at=now() WHERE workspace_id=$1 AND id=$2 AND head_user_id=$3', [session.workspaceId, unitId, userId]);
        return { removed: true };
      });
    },

    /**
     * Who this person answers to, all the way up. The chain is derived from
     * the tree rather than stored on the person, so moving a unit moves
     * everyone's reporting line with it and the two can never disagree.
     */
    async reportingChain(session, userId) {
      const { rows } = await pool.query(
        `WITH RECURSIVE start AS (
           SELECT u.id, u.parent_id, u.name, u.kind, u.head_user_id, 0 AS step
           FROM org_unit_members m JOIN org_units u ON u.id=m.unit_id AND u.workspace_id=m.workspace_id
           WHERE m.workspace_id=$1 AND m.user_id=$2
           UNION ALL
           SELECT p.id, p.parent_id, p.name, p.kind, p.head_user_id, start.step+1
           FROM org_units p JOIN start ON p.id=start.parent_id WHERE p.workspace_id=$1
         )
         SELECT DISTINCT ON (s.id) s.id "unitId", s.name "unitName", s.kind, s.step, s.head_user_id "headUserId",
                pr.display_name "headName"
         FROM start s LEFT JOIN workspace_profiles pr ON pr.workspace_id=$1 AND pr.user_id=s.head_user_id
         ORDER BY s.id, s.step`,
        [session.workspaceId, userId],
      );
      return rows.sort((a, b) => a.step - b.step);
    },

    /** Every unit a person belongs to, for their profile card. */
    async unitsOf(session, userId) {
      const { rows } = await pool.query(
        `SELECT u.id "unitId", u.name, u.kind, m.role FROM org_unit_members m
         JOIN org_units u ON u.id=m.unit_id AND u.workspace_id=m.workspace_id
         WHERE m.workspace_id=$1 AND m.user_id=$2 ORDER BY u.depth, u.name`,
        [session.workspaceId, userId],
      );
      return rows;
    },
  };

  return repository;
}
