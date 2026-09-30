import { randomUUID } from 'node:crypto';

const MAX_DEPTH = 6;

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

/**
 * Подразделение снаружи.
 *
 * У закрытого видно ровно три вещи: имя, замок и сколько человек внутри.
 * За места платит компания, поэтому прятать сам факт существования
 * нельзя. Всё остальное — состав, назначение, руководитель — тайна тех,
 * кто в нём состоит.
 */
const unitView = (row, { inside = true } = {}) => ({
  id: row.id,
  parentId: row.parent_id ?? null,
  kind: row.kind,
  name: row.name,
  closed: row.visibility === 'closed',
  inside: row.visibility === 'closed' ? Boolean(inside) : true,
  purpose: row.visibility === 'closed' && !inside ? null : (row.purpose ?? null),
  depth: row.depth,
  headUserId: row.visibility === 'closed' && !inside ? null : (row.head_user_id ?? null),
  // Комната подразделения закрыта по составу, и её адрес посторонним ни
  // к чему: по нему всё равно не войти, а знать о ней нечего.
  conversationId: inside ? (row.conversation_id ?? null) : null,
  // «Я здесь состою» — по этому признаку строится список своих
  // подразделений с непрочитанным.
  mine: Boolean(inside),
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
    if (!rows[0]) throw fail('Подразделение не найдено', 'ORG_UNIT_NOT_FOUND', 404);
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
        `SELECT u.*, (SELECT count(*) FROM org_unit_members m WHERE m.workspace_id=u.workspace_id AND m.unit_id=u.id) member_count,
           EXISTS(SELECT 1 FROM org_unit_members me WHERE me.workspace_id=u.workspace_id AND me.unit_id=u.id AND me.user_id=$2) inside
         FROM org_units u WHERE u.workspace_id=$1
         ORDER BY u.depth, u.position, u.name`,
        [session.workspaceId, session.userId],
      );
      return rows.map((row) => unitView(row, { inside: row.inside }));
    },

    /** Состоит ли человек в этом подразделении — вопрос доступа к закрытому. */
    async isInsideUnit(session, unitId) {
      const { rowCount } = await pool.query(
        'SELECT 1 FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2 AND user_id=$3',
        [session.workspaceId, unitId, session.userId],
      );
      return rowCount > 0;
    },

    /**
     * Можно ли заглянуть внутрь.
     *
     * Права на управление пространством сюда не годятся: если бы владелец
     * читал закрытый отдел просто потому, что он владелец, закрытости бы
     * не существовало. Внутрь пускает только членство.
     */
    async mayReadUnit(session, unitId) {
      const { rows } = await pool.query('SELECT visibility FROM org_units WHERE workspace_id=$1 AND id=$2', [session.workspaceId, unitId]);
      if (!rows.length) throw fail('Подразделение не найдено', 'ORG_UNIT_NOT_FOUND', 404);
      if (rows[0].visibility !== 'closed') return true;
      return repository.isInsideUnit(session, unitId);
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

    /**
     * След в журнале.
     *
     * Кто завёл отдел, кого туда поставил и кто назначил начальника —
     * ровно то, ради чего журнал и держат. Раньше оргструктура менялась
     * бесследно: тридцать восемь видов событий, и ни одного про неё.
     */
    /**
     * Какие подразделения этот человек вправе видеть изнутри.
     *
     * Нужно журналу: строки про закрытый отдел он показывает только тем,
     * кто в нём состоит, — иначе замок стоит в схеме, а состав читается
     * в журнале.
     */
    async visibleUnitIds(session) {
      const { rows } = await pool.query(
        `SELECT u.id FROM org_units u
          WHERE u.workspace_id=$1
            AND (u.visibility<>'closed'
              OR EXISTS(SELECT 1 FROM org_unit_members m
                         WHERE m.workspace_id=u.workspace_id AND m.unit_id=u.id AND m.user_id=$2))`,
        [session.workspaceId, session.userId],
      );
      return new Set(rows.map((row) => row.id));
    },

    async note(client, session, unitId, eventType, payload) {
      await client.query(
        `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
         VALUES($1,$2,'org_unit',$3,$4,$5,$6)`,
        [session.organizationId, session.workspaceId, unitId, eventType, session.userId, payload],
      );
    },

    async canManageUnit(session, unitId, { workspaceWide = false } = {}) {
      if (workspaceWide) return true;
      return (await repository.adminUnitIds(session)).includes(unitId);
    },

    /**
     * Кто вправе менять состав.
     *
     * Права на всё пространство сюда не годятся: возможность вписать в
     * закрытый отдел кого угодно — в том числе себя — это и есть доступ к
     * нему. Состав закрытого меняют только изнутри: его руководитель и
     * назначенные им администраторы.
     */
    async canManageMembers(session, unitId, { workspaceWide = false } = {}) {
      const { rows } = await pool.query('SELECT visibility FROM org_units WHERE workspace_id=$1 AND id=$2', [session.workspaceId, unitId]);
      if (!rows.length) throw fail('Подразделение не найдено', 'ORG_UNIT_NOT_FOUND', 404);
      if (rows[0].visibility !== 'closed') return repository.canManageUnit(session, unitId, { workspaceWide });
      const { rowCount } = await pool.query(
        "SELECT 1 FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2 AND user_id=$3 AND role IN ('head','admin')",
        [session.workspaceId, unitId, session.userId],
      );
      return rowCount > 0;
    },

    async createUnit(session, { parentId = null, kind = 'department', name, purpose = null, seatLimit = null, visibility = 'open' }) {
      if (!String(name ?? '').trim()) throw fail('Укажите название подразделения', 'INVALID_UNIT_NAME');
      if (!['open', 'closed'].includes(visibility)) throw fail('Неизвестная видимость подразделения', 'INVALID_UNIT_VISIBILITY');
      if (seatLimit !== null && seatLimit !== undefined && (!Number.isInteger(seatLimit) || seatLimit < 1)) {
        throw fail('Лимит мест должен быть положительным целым числом', 'INVALID_SEAT_LIMIT');
      }
      return tx(async (client) => {
        let depth = 0;
        if (parentId) {
          const parent = await loadUnit(client, session, parentId);
          depth = parent.depth + 1;
          if (depth > MAX_DEPTH) throw fail(`Подразделение не может быть вложено глубже ${MAX_DEPTH} уровней`, 'ORG_DEPTH_EXCEEDED', 409);
        }
        const id = randomUUID();
        const { rows } = await client.query(
          `INSERT INTO org_units(id,organization_id,workspace_id,parent_id,kind,name,purpose,seat_limit,depth,position,created_by,visibility)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,
             (SELECT coalesce(max(position),0)+1 FROM org_units WHERE workspace_id=$3 AND parent_id IS NOT DISTINCT FROM $4),$10,$11)
           RETURNING *`,
          [id, session.organizationId, session.workspaceId, parentId, kind, String(name).trim(), purpose, seatLimit ?? null, depth, session.userId, visibility],
        );
        // Комната подразделения. Её состав ведёт оргструктура, поэтому
        // беседа закрытая: попасть в неё можно только через отдел.
        const roomId = randomUUID();
        await client.query(
          `INSERT INTO conversations(id,organization_id,workspace_id,kind,title,purpose,visibility,created_by)
           VALUES($1,$2,$3,'team',$4,$5,'private',$6)`,
          [roomId, session.organizationId, session.workspaceId, String(name).trim(), purpose, session.userId],
        );
        await client.query('UPDATE org_units SET conversation_id=$3 WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id, roomId]);
        rows[0].conversation_id = roomId;
        // Закрытым подразделением надо кому-то управлять, а снаружи в него
        // не войти. Поэтому заводящий сразу становится его руководителем:
        // выйти он сможет, передав место другому.
        if (visibility === 'closed') {
          await client.query(
            `INSERT INTO org_unit_members(organization_id,workspace_id,unit_id,user_id,role,assigned_by)
             VALUES($1,$2,$3,$4,'head',$4)`,
            [session.organizationId, session.workspaceId, id, session.userId],
          );
          await client.query('UPDATE org_units SET head_user_id=$3 WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id, session.userId]);
          await client.query(
            `INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role)
             VALUES($1,$2,$3,$4,'owner') ON CONFLICT DO NOTHING`,
            [session.organizationId, session.workspaceId, roomId, session.userId],
          );
        }
        await repository.note(client, session, id, 'org.unit.created',
          { name: String(name).trim(), kind, parentId, seatLimit: seatLimit ?? null, visibility });
        return unitView({ ...rows[0], head_user_id: visibility === 'closed' ? session.userId : rows[0].head_user_id,
          member_count: visibility === 'closed' ? 1 : 0 });
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
            if (descendants.includes(patch.parentId)) throw fail('Подразделение нельзя перенести само в себя', 'ORG_CYCLE', 409);
            await loadUnit(client, session, patch.parentId);
          }
          const { rows: depthRows } = await client.query(
            'SELECT coalesce((SELECT depth FROM org_units WHERE workspace_id=$1 AND id=$2),-1)+1 new_depth',
            [session.workspaceId, patch.parentId],
          );
          const shift = depthRows[0].new_depth - unit.depth;
          const branch = await subtreeIds(client, session.workspaceId, id);
          const { rows: deepest } = await client.query('SELECT max(depth) d FROM org_units WHERE workspace_id=$1 AND id=ANY($2::uuid[])', [session.workspaceId, branch]);
          if (Number(deepest[0].d) + shift > MAX_DEPTH) throw fail(`Ветка окажется глубже ${MAX_DEPTH} уровней`, 'ORG_DEPTH_EXCEEDED', 409);
          await client.query('UPDATE org_units SET parent_id=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id, patch.parentId ?? null]);
          await client.query('UPDATE org_units SET depth=depth+$3, updated_at=now() WHERE workspace_id=$1 AND id=ANY($2::uuid[])', [session.workspaceId, branch, shift]);
        }

        if (patch.seatLimit !== undefined) {
          if (patch.seatLimit !== null && (!Number.isInteger(patch.seatLimit) || patch.seatLimit < 1)) throw fail('Лимит мест должен быть положительным целым числом', 'INVALID_SEAT_LIMIT');
          if (patch.seatLimit !== null) {
            const { rows: used } = await client.query('SELECT count(*)::int c FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2', [session.workspaceId, id]);
            // Lowering the plan below the people already in the unit would
            // record a number nobody can act on; say so instead.
            if (used[0].c > patch.seatLimit) throw fail(`В подразделении уже ${used[0].c} человек`, 'SEAT_LIMIT_BELOW_HEADCOUNT', 409);
          }
          await client.query('UPDATE org_units SET seat_limit=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id, patch.seatLimit]);
        }

        if (patch.headUserId !== undefined) {
          if (patch.headUserId) {
            const { rowCount } = await client.query('SELECT 1 FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2 AND user_id=$3', [session.workspaceId, id, patch.headUserId]);
            if (!rowCount) throw fail('Руководитель должен быть участником подразделения', 'HEAD_NOT_IN_UNIT', 409);
            await client.query("UPDATE org_unit_members SET role='member' WHERE workspace_id=$1 AND unit_id=$2 AND role='head'", [session.workspaceId, id]);
            await client.query("UPDATE org_unit_members SET role='head' WHERE workspace_id=$1 AND unit_id=$2 AND user_id=$3", [session.workspaceId, id, patch.headUserId]);
          } else {
            await client.query("UPDATE org_unit_members SET role='member' WHERE workspace_id=$1 AND unit_id=$2 AND role='head'", [session.workspaceId, id]);
          }
          await client.query('UPDATE org_units SET head_user_id=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id, patch.headUserId ?? null]);
        }

        for (const [field, column] of [['name', 'name'], ['purpose', 'purpose'], ['kind', 'kind']]) {
          if (patch[field] === undefined) continue;
          if (field === 'name' && !String(patch.name ?? '').trim()) throw fail('Укажите название подразделения', 'INVALID_UNIT_NAME');
          await client.query(`UPDATE org_units SET ${column}=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, id, field === 'name' ? String(patch.name).trim() : patch[field]]);
        }

        const { rows } = await client.query(
          `SELECT u.*, (SELECT count(*) FROM org_unit_members m WHERE m.workspace_id=u.workspace_id AND m.unit_id=u.id) member_count
           FROM org_units u WHERE u.workspace_id=$1 AND u.id=$2`,
          [session.workspaceId, id],
        );
        // Что именно поменяли, а не «что-то поменяли»: переезд отдела и
        // смена штатного плана — разные новости для того, кто потом
        // будет разбираться.
        const changed = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
        if (Object.keys(changed).length) {
          await repository.note(client, session, id, 'org.unit.updated', { changed, name: rows[0].name });
        }
        // Ответ на правку — такой же вид подразделения, как в схеме:
        // переименовать закрытый отдел владелец вправе, а узнать из
        // ответа его руководителя — нет.
        const { rowCount: inside } = await client.query(
          'SELECT 1 FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2 AND user_id=$3',
          [session.workspaceId, id, session.userId],
        );
        return unitView(rows[0], { inside: inside > 0 });
      });
    },

    async deleteUnit(session, id) {
      return tx(async (client) => {
        const unit = await loadUnit(client, session, id);
        const { rows: children } = await client.query('SELECT count(*)::int c FROM org_units WHERE workspace_id=$1 AND parent_id=$2', [session.workspaceId, id]);
        if (children[0].c) throw fail('Сначала перенесите или удалите вложенные подразделения', 'ORG_UNIT_HAS_CHILDREN', 409);
        const { rows: members } = await client.query('SELECT count(*)::int c FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2', [session.workspaceId, id]);
        // У открытого требуем сначала вывести людей: иначе подразделение
        // исчезает вместе с тем, кто где работал, и это легко сделать по
        // ошибке. У закрытого так нельзя: распускающий не видит его
        // состава и вывести оттуда никого не может — правило превратило
        // бы закрытый отдел в неразрушимый, а места в нём — в навсегда
        // занятые. Поэтому роспуск закрытого уносит и состав, а в журнале
        // остаётся число — не имена.
        if (members[0].c && unit.visibility !== 'closed') throw fail('Сначала переместите людей из подразделения', 'ORG_UNIT_HAS_MEMBERS', 409);
        if (members[0].c) await client.query('DELETE FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2', [session.workspaceId, id]);
        await client.query('DELETE FROM org_units WHERE workspace_id=$1 AND id=$2', [session.workspaceId, id]);
        await repository.note(client, session, id, 'org.unit.deleted',
          { name: unit.name, ...(unit.visibility === 'closed' ? { closed: true, peopleReleased: members[0].c } : {}) });
        return { deleted: true };
      });
    },

    async listMembers(session, unitId) {
      // Не 403, а 404: «доступ запрещён» — это уже ответ на вопрос, кто
      // там состоит. Закрытое подразделение для постороннего просто не
      // имеет состава.
      if (!(await repository.mayReadUnit(session, unitId))) throw fail('Подразделение не найдено', 'ORG_UNIT_NOT_FOUND', 404);
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
      if (!['head', 'admin', 'member'].includes(role)) throw fail('Неизвестная роль в подразделении', 'INVALID_UNIT_ROLE');
      return tx(async (client) => {
        const unit = await loadUnit(client, session, unitId);
        const { rowCount: isMember } = await client.query("SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND role<>'guest'", [session.workspaceId, userId]);
        // A guest is somebody else's employee; placing them on the org chart
        // would make the chart lie about who works here.
        if (!isMember) throw fail('В подразделение можно добавить только сотрудника компании', 'NOT_WORKSPACE_STAFF', 409);

        if (unit.seat_limit !== null) {
          // Counted under the unit's row lock taken above, so two concurrent
          // adds cannot both see the last free seat.
          const { rows: used } = await client.query('SELECT count(*)::int c FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2 AND user_id<>$3', [session.workspaceId, unitId, userId]);
          if (used[0].c >= unit.seat_limit) throw fail(`Нет свободных мест: лимит ${unit.seat_limit}`, 'SEAT_LIMIT_REACHED', 409);
        }
        if (role === 'head') await client.query("UPDATE org_unit_members SET role='member' WHERE workspace_id=$1 AND unit_id=$2 AND role='head'", [session.workspaceId, unitId]);
        await client.query(
          `INSERT INTO org_unit_members(organization_id,workspace_id,unit_id,user_id,role,assigned_by)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT (workspace_id,unit_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
          [session.organizationId, session.workspaceId, unitId, userId, role, session.userId],
        );
        if (role === 'head') await client.query('UPDATE org_units SET head_user_id=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2', [session.workspaceId, unitId, userId]);
        // Комната подразделения ведётся его составом: попасть в неё можно
        // только через отдел, и выйти — тоже.
        if (unit.conversation_id) {
          await client.query(
            `INSERT INTO conversation_members(organization_id,workspace_id,conversation_id,user_id,role)
             VALUES($1,$2,$3,$4,$5)
             ON CONFLICT (workspace_id,conversation_id,user_id) DO UPDATE SET role=EXCLUDED.role`,
            [session.organizationId, session.workspaceId, unit.conversation_id, userId, role === 'head' ? 'owner' : 'member'],
          );
        }
        await repository.note(client, session, unitId,
          role === 'head' ? 'org.unit.head_appointed' : 'org.unit.member_added', { userId, role });
        return { unitId, userId, role };
      });
    },

    async removeMember(session, unitId, userId) {
      return tx(async (client) => {
        const unit = await loadUnit(client, session, unitId);
        // Закрытым подразделением распоряжаются только изнутри — и это
        // верно. Но последний, кто мог им распоряжаться, спокойно выходил
        // сам, и дальше не мог никто: ни он (его там больше нет), ни
        // владелец компании (снаружи в закрытое не вписывают). Люди
        // оставались внутри навсегда, а починить это можно было только
        // правкой базы. Пусть сначала назначит себе смену.
        if (unit.visibility === 'closed') {
          const { rows: keepers } = await client.query(
            `SELECT user_id FROM org_unit_members
              WHERE workspace_id=$1 AND unit_id=$2 AND role IN ('head','admin')`,
            [session.workspaceId, unitId],
          );
          if (keepers.length === 1 && keepers[0].user_id === userId) {
            const { rows: rest } = await client.query(
              'SELECT count(*)::int n FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2 AND user_id<>$3',
              [session.workspaceId, unitId, userId],
            );
            if (rest[0].n > 0) {
              throw fail('Вы последний, кто ведёт это закрытое подразделение. Назначьте руководителя или администратора вместо себя — или распустите подразделение.',
                'LAST_UNIT_KEEPER', 409);
            }
          }
        }
        const { rowCount } = await client.query('DELETE FROM org_unit_members WHERE workspace_id=$1 AND unit_id=$2 AND user_id=$3', [session.workspaceId, unitId, userId]);
        if (!rowCount) throw fail('Этого человека нет в подразделении', 'NOT_A_UNIT_MEMBER', 404);
        if (unit.conversation_id) {
          await client.query('DELETE FROM conversation_members WHERE workspace_id=$1 AND conversation_id=$2 AND user_id=$3',
            [session.workspaceId, unit.conversation_id, userId]);
        }
        await client.query('UPDATE org_units SET head_user_id=NULL, updated_at=now() WHERE workspace_id=$1 AND id=$2 AND head_user_id=$3', [session.workspaceId, unitId, userId]);
        await repository.note(client, session, unitId, 'org.unit.member_removed', { userId });
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
         FROM start s
         JOIN org_units su ON su.workspace_id=$1 AND su.id=s.id
         LEFT JOIN workspace_profiles pr ON pr.workspace_id=$1 AND pr.user_id=s.head_user_id
         -- Единственный запрос по оргструктуре, где не было замка: список
         -- подразделений человека фильтровал, а цепочка подчинения — нет, и карточка
         -- человека выдавала название закрытого отдела и его руководителя
         -- тому, от кого отдел и закрывали. По одному человеку за раз
         -- собирался весь состав.
         WHERE su.visibility<>'closed' OR $2::uuid=$3::uuid
           OR EXISTS(SELECT 1 FROM org_unit_members me WHERE me.workspace_id=su.workspace_id AND me.unit_id=su.id AND me.user_id=$3)
         ORDER BY s.id, s.step`,
        [session.workspaceId, userId, session.userId],
      );
      return rows.sort((a, b) => a.step - b.step);
    },

    /** Every unit a person belongs to, for their profile card. */
    /**
     * В каких подразделениях человек.
     *
     * Закрытое показываем, только если смотрящий сам в нём состоит:
     * иначе карточка сотрудника выдавала бы состав закрытого отдела по
     * одному человеку за раз.
     */
    async unitsOf(session, userId) {
      const { rows } = await pool.query(
        `SELECT u.id "unitId", u.name, u.kind, m.role, u.visibility FROM org_unit_members m
         JOIN org_units u ON u.id=m.unit_id AND u.workspace_id=m.workspace_id
         WHERE m.workspace_id=$1 AND m.user_id=$2
           AND (u.visibility<>'closed' OR $3::uuid=$2::uuid
             OR EXISTS(SELECT 1 FROM org_unit_members me WHERE me.workspace_id=u.workspace_id AND me.unit_id=u.id AND me.user_id=$3))
         ORDER BY u.depth, u.name`,
        [session.workspaceId, userId, session.userId],
      );
      return rows.map(({ visibility, ...rest }) => ({ ...rest, closed: visibility === 'closed' }));
    },
  };

  return repository;
}
