import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createWikiRepository } from '../src/wiki/wiki-repository.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

test('Page restore preserves history, ACL and optimistic concurrency', { skip: !databaseUrl }, async t => {
  const pool = new pg.Pool({connectionString: databaseUrl});
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const password = hashPassword('WikiRestorePassword42');
  const created = await store.createCompany({
    companyName: 'Wiki Restore ' + randomUUID().slice(0,8),
    ownerName: 'Owner',
    email: 'wiki-restore-' + randomUUID() + '@example.test',
    passwordHash: password.hash,
    passwordSalt: password.salt,
  });
  const tokenHash = hashToken('restore-' + randomUUID());
  await store.createSession({userId:created.user.id,workspaceId:created.workspace.id,tokenHash,
    expiresAt:new Date(Date.now() + 86400000).toISOString()});
  const session = await store.getSession(tokenHash);
  const wiki = createWikiRepository(pool);
  const first = await wiki.create(session, {title:'First',content:'Initial',visibility:'restricted'});
  const second = await wiki.update(session,first.id,{
    title:'Second',content:'Current',expectedVersion:1,
  });
  assert.equal(second.version,2);
  await assert.rejects(() => wiki.restore(session,first.id,{version:1,expectedVersion:1}),
    error=>error.code==='STALE_VERSION' && error.statusCode===409);
  const restored = await wiki.restore(session,first.id,{version:1,expectedVersion:2});
  assert.equal(restored.version,3);
  assert.equal(restored.content,'Initial');
  assert.equal(restored.title,'First');
  assert.equal(restored.visibility,'restricted');
  const history = await wiki.history(session,first.id);
  assert.equal(history.find(row=>row.version===2)?.content,'Current');
  const reversed = await wiki.restore(session,first.id,{version:2,expectedVersion:3});
  assert.equal(reversed.version,4);
  assert.equal(reversed.content,'Current');
  assert.equal(reversed.title,'Second');
  await assert.rejects(() => wiki.restore(session,first.id,{version:999,expectedVersion:4}),
    error=>error.code==='WIKI_VERSION_NOT_FOUND' && error.statusCode===404);
  await wiki.archive(session,first.id);
  await assert.rejects(() => wiki.restore(session,first.id,{version:1,expectedVersion:4}),
    error=>error.statusCode===404);
});
