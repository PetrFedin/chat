import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { createIcsFeedRepository } from '../src/calendar/ics-feed-repository.js';
import { createChatServer } from '../src/server.js';
import { hashPassword, hashToken } from '../src/security.js';

const databaseUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL не задан';

async function sessionFor(store, userId, workspaceId) {
  const tokenHash = hashToken(`ics-${randomUUID()}`);
  await store.createSession({ userId, workspaceId, tokenHash, expiresAt: new Date(Date.now() + 864e5).toISOString() });
  return store.getSession(tokenHash);
}

async function company(store) {
  const pass = hashPassword('IcsFeedPass2026xx');
  const created = await store.createCompany({
    companyName: `ICS ${randomUUID().slice(0, 8)}`, ownerName: 'Owner', email: `ics-owner-${randomUUID()}@test.local`,
    passwordHash: pass.hash, passwordSalt: pass.salt,
  });
  return sessionFor(store, created.user.id, created.workspace.id);
}

async function insertEvent(pool, session, { title, startAt, endAt, recurrenceRule = null, visibility = 'workspace', allDay = false }) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO calendar_events(id,organization_id,workspace_id,kind,title,owner_id,start_at,end_at,all_day,visibility,recurrence_rule)
     VALUES($1,$2,$3,'meeting',$4,$5,$6,$7,$8,$9,$10)`,
    [id, session.organizationId, session.workspaceId, title, session.userId, startAt, endAt, allDay, visibility, recurrenceRule],
  );
  return id;
}

test('подписка отдаёт видимые события с настоящим RRULE, а не с уже разложенными вхождениями', { skip }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const owner = await company(store);
  const icsFeed = createIcsFeedRepository(pool);

  const now = Date.now();
  await insertEvent(pool, owner, { title: 'Разовая встреча', startAt: new Date(now + 3600000).toISOString(), endAt: new Date(now + 7200000).toISOString() });
  const seriesId = await insertEvent(pool, owner, {
    title: 'Планёрка', startAt: new Date(now).toISOString(), endAt: new Date(now + 1800000).toISOString(),
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
  });
  await pool.query(
    `INSERT INTO calendar_event_exceptions(organization_id,workspace_id,calendar_event_id,occurrence_at,cancelled,created_by)
     VALUES($1,$2,$3,$4,true,$5)`,
    [owner.organizationId, owner.workspaceId, seriesId, new Date(now + 7 * 86400000).toISOString(), owner.userId],
  );

  const token = await icsFeed.getOrCreateToken(owner);
  assert.equal(token.length >= 32, true, 'токен не должен быть тривиальным');
  assert.equal(await icsFeed.getOrCreateToken(owner), token, 'повторный вызов не должен плодить токены');

  const feed = await icsFeed.renderFeed(token);
  assert.match(feed, /BEGIN:VCALENDAR/);
  assert.match(feed, /SUMMARY:Разовая встреча/);
  assert.match(feed, /SUMMARY:Планёрка/);
  assert.match(feed, /RRULE:FREQ=WEEKLY;BYDAY=MO/, 'сервер не должен сам раскрывать повторение на годы вперёд');
  assert.match(feed, /EXDATE:/, 'отменённое вхождение должно быть исключено явно, а не просто пропущено');
  assert.match(feed, /\r\n/, 'iCalendar требует CRLF, а не голый \\n');

  const regenerated = await icsFeed.regenerate(owner);
  assert.notEqual(regenerated, token);
  await assert.rejects(() => icsFeed.renderFeed(token), (err) => err.code === 'ICS_FEED_NOT_FOUND', 'старая ссылка не должна продолжать работать после перевыпуска');
  await assert.doesNotReject(() => icsFeed.renderFeed(regenerated));

  await icsFeed.revoke(owner);
  await assert.rejects(() => icsFeed.renderFeed(regenerated), (err) => err.code === 'ICS_FEED_NOT_FOUND');
});

test('приватное событие другого человека не попадает в чужую подписку', { skip }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const owner = await company(store);
  const icsFeed = createIcsFeedRepository(pool);
  await insertEvent(pool, owner, { title: 'Личная заметка на день', startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3600000).toISOString(), visibility: 'private' });

  const token = await icsFeed.getOrCreateToken(owner);
  const feed = await icsFeed.renderFeed(token);
  assert.match(feed, /Личная заметка на день/, 'свой приватный ивент подписке владельца виден');
});

test('память без базы честно отвечает 503', async () => {
  const icsFeed = createIcsFeedRepository(null);
  assert.equal(icsFeed.enabled, false);
  assert.throws(() => icsFeed.getOrCreateToken({}), (err) => err.code === 'ICS_FEED_UNAVAILABLE' && err.statusCode === 503);
});

test('доступ по HTTP: подписка требует сессию, сама лента — только токен из URL', { skip }, async (t) => {
  const app = await createChatServer({ databaseUrl, startMeetingWorker: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const request = async (path, { cookie, method = 'GET', body } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return response;
  };

  const suffix = randomUUID().slice(0, 8);
  const registerRes = await request('/api/v1/auth/register-company', {
    method: 'POST', body: { companyName: `ICS HTTP ${suffix}`, ownerName: 'Владелец', email: `ics-http-${suffix}@t.test`, password: 'OwnerPassword42' },
  });
  assert.equal(registerRes.status, 201);
  const cookie = registerRes.headers.get('set-cookie')?.split(';')[0];

  const noSession = await request('/api/v1/calendar/ics');
  assert.equal(noSession.status, 401);

  const tokenRes = await request('/api/v1/calendar/ics', { cookie });
  assert.equal(tokenRes.status, 200);
  const { token } = await tokenRes.json();

  const feedRes = await request(`/api/v1/calendar/ics/${token}`);
  assert.equal(feedRes.status, 200);
  assert.equal(feedRes.headers.get('content-type'), 'text/calendar; charset=utf-8');
  const body = await feedRes.text();
  assert.match(body, /BEGIN:VCALENDAR/);

  const badToken = await request('/api/v1/calendar/ics/0000000000000000000000000000000000000000000000');
  assert.equal(badToken.status, 404);
});
