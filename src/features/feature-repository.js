import { FEATURES, GROUPS, featureById, planChange, dependentsOf, requirementsOf, featureForPath } from './registry.js';

const TTL_MS = 5000;

/**
 * Состояние функций пространства. Читается на каждом запросе к закрываемому разделу, поэтому кеш на пять секунд;
 * при изменении кеш этого пространства сбрасывается сразу.
 */
export function createFeatureRepository(pool) {
  const cache = new Map();

  const load = async (workspaceId) => {
    const hit = cache.get(workspaceId);
    if (hit && hit.at > Date.now() - TTL_MS) return hit.state;
    const state = new Map();
    if (pool) {
      const { rows } = await pool.query('SELECT feature, enabled, cascade_from FROM workspace_features WHERE workspace_id=$1', [workspaceId]);
      for (const row of rows) state.set(row.feature, { enabled: row.enabled, cascadeFrom: row.cascade_from });
    }
    cache.set(workspaceId, { at: Date.now(), state });
    return state;
  };

  const view = (state) => FEATURES.map((f) => {
    const s = state.get(f.id);
    return {
      id: f.id, group: f.group, groupTitle: GROUPS[f.group], title: { ru: f.ru, en: f.en }, description: { ru: f.descRu, en: f.descEn },
      enabled: s?.enabled !== false, cascadeFrom: s?.cascadeFrom ?? null, requires: f.requires, requiredBy: dependentsOf(f.id).filter((d) => featureById(d).requires.includes(f.id)),
      allRequires: requirementsOf(f.id), allDependents: dependentsOf(f.id),
    };
  });

  return {
    async map(workspaceId) {
      const state = await load(workspaceId);
      return Object.fromEntries(FEATURES.map((f) => [f.id, state.get(f.id)?.enabled !== false]));
    },
    async isEnabled(workspaceId, id) {
      if (!id) return true;
      return (await load(workspaceId)).get(id)?.enabled !== false;
    },
    async list(workspaceId) { return view(await load(workspaceId)); },

    /** Что произойдёт при переключении — без записи: экран показывает это до подтверждения. */
    async preview(workspaceId, id, enable) {
      return planChange(await load(workspaceId), id, enable);
    },

    async set(session, id, enable) {
      if (!pool) throw Object.assign(new Error('Настройка функций работает только с базой данных'), { code: 'FEATURES_UNAVAILABLE', statusCode: 503, expose: true });
      const client = await pool.connect();
      let changes;
      try {
        await client.query('BEGIN');
        // Два администратора, переключающих связанные функции одновременно, не должны разойтись: замок на пространство.
        await client.query('SELECT 1 FROM workspaces WHERE id=$1 FOR UPDATE', [session.workspaceId]);
        const { rows } = await client.query('SELECT feature, enabled, cascade_from FROM workspace_features WHERE workspace_id=$1', [session.workspaceId]);
        const state = new Map(rows.map((r) => [r.feature, { enabled: r.enabled, cascadeFrom: r.cascade_from }]));
        changes = planChange(state, id, enable);
        for (const change of changes) {
          await client.query(
            `INSERT INTO workspace_features(workspace_id,feature,enabled,cascade_from,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,now())
             ON CONFLICT (workspace_id,feature) DO UPDATE SET enabled=$3,cascade_from=$4,updated_by=$5,updated_at=now()`,
            [session.workspaceId, change.id, change.enabled, change.cascadeFrom, session.userId]);
        }
        if (changes.length) {
          await client.query(
            `INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload)
             VALUES($1,$2,'workspace',$2,'feature.toggled',$3,$4)`,
            [session.organizationId, session.workspaceId, session.userId, JSON.stringify({ feature: id, enabled: enable, changes })]);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
      cache.delete(session.workspaceId);
      return changes;
    },

    featureForPath,
  };
}
