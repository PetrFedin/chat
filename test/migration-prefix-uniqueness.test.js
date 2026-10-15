import test from 'node:test';
import assert from 'node:assert/strict';
import { readMigrations } from '../scripts/migrate.mjs';

test('migration numeric prefixes stay unique across independently developed feature stacks', () => {
  const migrations = readMigrations();
  const byPrefix = new Map();

  for (const migration of migrations) {
    const match = migration.name.match(/^(\d{3})_/);
    assert.ok(match, `migration must start with a three-digit prefix: ${migration.name}`);
    const prefix = match[1];
    const prior = byPrefix.get(prefix);
    assert.equal(prior, undefined,
      `migration prefix ${prefix} is reused by ${prior} and ${migration.name}`);
    byPrefix.set(prefix, migration.name);
  }

  assert.equal(byPrefix.get('071'), '071_workspace_features.sql');
  assert.equal(byPrefix.get('072'), '072_conversation_topics.sql');
  assert.equal(byPrefix.get('073'), '073_working_schedule.sql');
  assert.equal(byPrefix.get('074'), '074_projects.sql');
  assert.equal(byPrefix.get('084'), '084_wiki_page_decisions.sql');
});
