import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readMigrations, migrate, status } from '../scripts/migrate.mjs';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

function schemaUrl(base, schema) {
  const url = new URL(base);
  url.searchParams.set('options', `-csearch_path=${schema},public`);
  return url.toString();
}

test('upgrade path 001-070 -> 071-088 applies only the integrated tail in order',
  { skip: !databaseUrl, timeout: 120000 }, async () => {
    const schema = 'upgrade_' + randomUUID().replaceAll('-', '').slice(0, 16);
    const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    const all = readMigrations();
    const baseline = all.filter((m) => Number(m.name.slice(0, 3)) <= 70);
    const tail = all.filter((m) => Number(m.name.slice(0, 3)) >= 71);
    assert.equal(tail[0]?.name, '071_workspace_features.sql');
    assert.equal(tail[1]?.name, '072_conversation_topics.sql');
    assert.equal(tail.at(-1)?.name, '088_decision_task_links.sql');

    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const url = schemaUrl(databaseUrl, schema);
      const pool = new pg.Pool({ connectionString: url, max: 1 });
      const client = await pool.connect();
      try {
        await client.query(`CREATE TABLE schema_migrations (
          name text PRIMARY KEY,
          checksum text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now(),
          duration_ms integer NOT NULL DEFAULT 0
        )`);
        for (const migration of baseline) {
          await client.query('BEGIN');
          try {
            await client.query(migration.sql);
            await client.query(
              'INSERT INTO schema_migrations(name,checksum,duration_ms) VALUES($1,$2,0)',
              [migration.name, migration.checksum],
            );
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw new Error(`baseline ${migration.name} failed: ${error.message}`);
          }
        }
      } finally {
        client.release();
        await pool.end();
      }

      const result = await migrate({ databaseUrl: url, log: () => {} });
      assert.deepEqual(result.applied, tail.map((m) => m.name),
        'existing schema 070 must apply exactly the integrated 071-088 tail');
      assert.equal(result.total, all.length);

      const rows = await status({ databaseUrl: url });
      assert.equal(rows.filter((row) => !row.applied).length, 0);
      assert.deepEqual(rows.slice(-18).map((row) => row.name), tail.map((m) => m.name));
    } finally {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
      await admin.end();
    }
  });
