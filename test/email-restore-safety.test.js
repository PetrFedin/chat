import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('restored email outbox is quarantined before commit',async()=>{
  const source=await readFile(new URL('../scripts/restore.mjs',import.meta.url),'utf8');
  assert.match(source,/status IN \('queued','scheduled','dispatching'\)/);
  assert.match(source,/status='unknown_outcome'/);
  assert.match(source,/EMAIL_BACKUP_RESTORED/);
  assert.match(source,/consumer\.stdin\.write\('BEGIN;/);
  assert.match(source,/COMMIT;/);
});
