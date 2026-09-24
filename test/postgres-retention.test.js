import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');
import pg from 'pg';
import { createRetentionSweeper } from '../src/maintenance/retention.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

// Во всём приложении был один сборщик мусора — по ключам идемпотентности.
// Остальное копилось вечно, и росло именно то, что уже никому не нужно.
test('уборка убирает отработавшее и не трогает нужное',
  { skip: !databaseUrl && 'нет базы' }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const sweeper = createRetentionSweeper(pool, { RETENTION_DAYS: '30', RETENTION_NOTIFICATION_DAYS: '10' });

  const organizationId = randomUUID(), workspaceId = randomUUID(), userId = randomUUID();
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [organizationId, `Уборка ${organizationId.slice(0, 8)}`]);
  await pool.query('INSERT INTO workspaces(id,organization_id,name) VALUES($1,$2,$3)', [workspaceId, organizationId, 'Пространство']);
  await pool.query('INSERT INTO users(id,email) VALUES($1,$2)', [userId, `${userId}@t.test`]);
  await pool.query('INSERT INTO memberships(organization_id,workspace_id,user_id,role) VALUES($1,$2,$3,$4)', [organizationId, workspaceId, userId, 'owner']);

  const old = `now() - interval '200 days'`;
  // Отработавшее: просроченная сессия, использованная ссылка, прочитанное уведомление.
  await pool.query(`INSERT INTO user_sessions(user_id,workspace_id,token_hash,expires_at,created_at)
    VALUES($1,$2,$3,now() - interval '199 days',${old})`, [userId, workspaceId, hash(`stale-${randomUUID()}`)]);
  await pool.query(`INSERT INTO password_resets(organization_id,workspace_id,user_id,token_hash,status,used_at,expires_at,created_at)
    VALUES($1,$2,$3,$4,'used',${old},now() - interval '199 days',${old})`, [organizationId, workspaceId, userId, hash(`used-${randomUUID()}`)]);
  const readNotice = randomUUID();
  await pool.query(`INSERT INTO notifications(id,organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body,status,read_at,created_at)
    VALUES($1,$2,$3,$4,$5,$6,'message.created','Старое','Прочитано','read',${old},${old})`,
    [readNotice, organizationId, workspaceId, userId, randomUUID(), `old-${readNotice}`]);

  // Нужное: живая сессия, ожидающая ссылка, непрочитанное уведомление.
  const liveSession = hash(`live-${randomUUID()}`);
  await pool.query(`INSERT INTO user_sessions(user_id,workspace_id,token_hash,expires_at)
    VALUES($1,$2,$3,now() + interval '30 days')`, [userId, workspaceId, liveSession]);
  const pendingReset = hash(`pending-${randomUUID()}`);
  await pool.query(`INSERT INTO password_resets(organization_id,workspace_id,user_id,token_hash,status,expires_at)
    VALUES($1,$2,$3,$4,'pending',now() + interval '1 day')`, [organizationId, workspaceId, userId, pendingReset]);
  const freshNotice = randomUUID();
  await pool.query(`INSERT INTO notifications(id,organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body,status,created_at)
    VALUES($1,$2,$3,$4,$5,$6,'message.created','Свежее','Ещё не прочитано','unread',${old})`,
    [freshNotice, organizationId, workspaceId, userId, randomUUID(), `fresh-${freshNotice}`]);

  const removed = await sweeper.sweep();
  assert.ok(removed.sessions >= 1 && removed.passwordResets >= 1 && removed.notifications >= 1);

  const alive = async (sql, params) => Number((await pool.query(sql, params)).rows[0].n);
  assert.equal(await alive('SELECT count(*) n FROM user_sessions WHERE token_hash=$1', [liveSession]), 1, 'живую сессию не трогаем');
  assert.equal(await alive('SELECT count(*) n FROM password_resets WHERE token_hash=$1', [pendingReset]), 1, 'ожидающую ссылку не трогаем');
  assert.equal(await alive('SELECT count(*) n FROM notifications WHERE id=$1', [freshNotice]), 1, 'непрочитанное не трогаем, сколько бы ему ни было лет');
  assert.equal(await alive('SELECT count(*) n FROM notifications WHERE id=$1', [readNotice]), 0);

  // Самое тонкое правило уборки: событие очереди уходит, только когда от
  // него не осталось доставок. Иначе уборщик съест исходное событие у
  // недоставленного вебхука — интеграция заказчика молча недосчитается
  // события, и следов в базе не останется.
  const liveEvent = (await pool.query(
    `INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload,published_at,created_at)
     VALUES($1,$2,'task.transitioned',$3,'{}',${old},${old}) RETURNING id`,
    [organizationId, workspaceId, randomUUID()])).rows[0].id;
  const doneEvent = (await pool.query(
    `INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload,published_at,created_at)
     VALUES($1,$2,'task.transitioned',$3,'{}',${old},${old}) RETURNING id`,
    [organizationId, workspaceId, randomUUID()])).rows[0].id;
  const endpoint = (await pool.query(
    `INSERT INTO webhook_endpoints(organization_id,workspace_id,label,url,secret,topics,created_by)
     VALUES($1,$2,'Приёмник','https://example.test/hook','whsec_'||repeat('x',40),ARRAY[]::text[],$3) RETURNING id`,
    [organizationId, workspaceId, userId])).rows[0].id;
  // Доставка, которая ещё ждёт своего часа.
  await pool.query(
    `INSERT INTO webhook_deliveries(organization_id,workspace_id,endpoint_id,event_id,topic,payload,status,created_at)
     VALUES($1,$2,$3,$4,'task.transitioned','{}','pending',${old})`,
    [organizationId, workspaceId, endpoint, liveEvent]);

  await sweeper.sweep();
  assert.equal(await alive('SELECT count(*) n FROM outbox_events WHERE id=$1', [liveEvent]), 1,
    'уборщик съел событие, у которого осталась недоставленная доставка');
  assert.equal(await alive('SELECT count(*) n FROM outbox_events WHERE id=$1', [doneEvent]), 0,
    'событие без доставок должно уйти');

  // Журнал не чистится никогда — он для того и ведётся.
  await pool.query(`INSERT INTO audit_events(organization_id,workspace_id,aggregate_type,aggregate_id,event_type,actor_id,payload,created_at)
    VALUES($1,$2,'membership',$3,'invitation.issued',$3,'{}',${old})`, [organizationId, workspaceId, userId]);
  await sweeper.sweep();
  assert.equal(await alive('SELECT count(*) n FROM audit_events WHERE workspace_id=$1', [workspaceId]), 1, 'журнал переживает уборку');
});
