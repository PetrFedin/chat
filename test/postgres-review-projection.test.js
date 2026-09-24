import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { PostgresCallRepository } from '../src/media/call-repository.js';
import { createMeetingReviewProjector } from '../src/meeting/review-projection.js';
import { hashPassword, hashToken } from '../src/security.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

/**
 * «Итоги встречи готовы» — единственное, что связывает готовую выжимку с
 * людьми, которые на встрече были. Без этого уведомления саммари лежит в
 * базе, а участники о нём не узнают: жаловаться на то, чего не видел,
 * никто не станет, и обнаружится это через месяцы по «а почему у нас никто
 * не смотрит итоги».
 *
 * Тест на эту связь существовал, но проверял демонстрационную заглушку
 * (`metadata.syntheticDemo`), а не боевой проектор: удали проектор целиком
 * — тест остался бы зелёным.
 */
test('готовые итоги встречи доходят до участников', { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const calls = new PostgresCallRepository(pool);
  const suffix = randomUUID().slice(0, 8);

  const password = hashPassword('WorkspacePass42');
  const created = await store.createCompany({
    companyName: `Итоги ${suffix}`, ownerName: 'Организатор',
    email: `rev-${suffix}@example.com`, passwordHash: password.hash, passwordSalt: password.salt,
  });
  const tokenHash = hashToken(`rev-${randomUUID()}`);
  await store.createSession({ userId: created.user.id, workspaceId: created.workspace.id, tokenHash,
    expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const owner = await store.getSession(tokenHash);

  const inviteToken = hashToken(`rev-invite-${randomUUID()}`);
  await store.createInvitation(owner, { email: `mate-${suffix}@example.com`, role: 'member',
    tokenHash: inviteToken, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const matePassword = hashPassword('WorkspacePass42');
  const mate = await store.acceptInvitation({ tokenHash: inviteToken, displayName: 'Участник',
    passwordHash: matePassword.hash, passwordSalt: matePassword.salt });

  const general = (await store.listConversations(owner)).find((c) => c.slug === 'general');
  const call = await calls.create(owner, {
    conversationId: general.id, calendarEventId: null, title: 'Планёрка по смете', mode: 'video',
    participantIds: [owner.userId, mate.user.id], scheduledFor: null, providerRoomName: `rev-${suffix}`,
  });

  const pushed = [];
  const broadcast = [];
  const project = createMeetingReviewProjector({
    store, calls,
    hub: { broadcastUsers: (workspaceId, userIds, event, payload) => broadcast.push({ userIds, event, payload }) },
    notifyUsers: async (workspaceId, userIds, payload) => { pushed.push({ userIds, payload }); },
  });

  const runId = randomUUID();
  const result = await project({
    organizationId: owner.organizationId, workspaceId: owner.workspaceId,
    callId: call.id, runId, overview: 'Решили: смету согласовать до пятницы.', proposalCount: 2,
  });

  assert.equal(result.projected, true);
  assert.equal(result.audienceCount, 2, 'уведомление ушло не всем участникам');
  assert.equal(result.createdNotifications, 2);

  // Уведомление настоящее, а не демонстрационное: у демо-фикстуры стоит
  // metadata.syntheticDemo, и именно её ловил прежний тест.
  const { rows } = await pool.query(
    `SELECT recipient_user_id, title, body, priority, url, metadata FROM notifications
      WHERE workspace_id=$1 AND type='meeting.review_ready' AND source_event_id=$2`,
    [owner.workspaceId, runId]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.metadata?.syntheticDemo === undefined), 'это демонстрационная заглушка, а не боевой путь');
  assert.ok(rows.every((row) => row.title.includes('Планёрка по смете')));
  assert.ok(rows.every((row) => row.body.includes('смету согласовать')));
  assert.ok(rows.every((row) => row.priority === 'high'), 'с предложенными задачами итоги срочнее');
  assert.ok(rows.every((row) => row.url === `/#/meetings/${call.id}`));

  // И живой канал, и push получили тех же людей.
  assert.equal(broadcast.length, 2);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].userIds.length, 2);

  // Повторный прогон того же runId ничего не удваивает: у уведомлений свой
  // ключ от повторов.
  const again = await project({
    organizationId: owner.organizationId, workspaceId: owner.workspaceId,
    callId: call.id, runId, overview: 'Решили: смету согласовать до пятницы.', proposalCount: 2,
  });
  assert.equal(again.createdNotifications, 0, 'повторная проекция завела вторую пачку уведомлений');
  const total = Number((await pool.query(
    `SELECT count(*) n FROM notifications WHERE workspace_id=$1 AND source_event_id=$2`,
    [owner.workspaceId, runId])).rows[0].n);
  assert.equal(total, 2);
});
