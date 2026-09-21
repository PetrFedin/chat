import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { PostgresCallRepository } from '../src/media/call-repository.js';
import { hashPassword, hashToken } from '../src/security.js';
import { createChatServer } from '../src/server.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

/**
 * LiveKit повторяет вебхуки, пока не получит подтверждения. Если
 * дедупликация сломается, одна запись встречи обработается дважды: две
 * расшифровки и две выжимки у платного провайдера, два комплекта
 * предложенных задач в карточке, два уведомления участникам. Счёт придёт в
 * конце месяца, а дубли увидят сразу и не поймут, откуда они.
 *
 * До сих пор проверялась только память, через самодельный репозиторий:
 * ни HTTP-путь, ни ветка `claimWebhookEvent` в PostgreSQL не выполнялись.
 */
test('повторный вебхук LiveKit не запускает вторую обработку',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const calls = new PostgresCallRepository(pool);
  const suffix = randomUUID().slice(0, 8);

  // Фикстура строится напрямую: живой звонок с согласием на запись — это
  // отдельная история, а здесь проверяется путь вебхука.
  const password = hashPassword('WorkspacePass42');
  const created = await store.createCompany({
    companyName: `Вебхук ${suffix}`, ownerName: 'Владелец',
    email: `wh-${suffix}@example.com`, passwordHash: password.hash, passwordSalt: password.salt,
  });
  const tokenHash = hashToken(`wh-${randomUUID()}`);
  await store.createSession({ userId: created.user.id, workspaceId: created.workspace.id, tokenHash,
    expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const owner = await store.getSession(tokenHash);
  const general = (await store.listConversations(owner)).find((c) => c.slug === 'general');

  const call = await calls.create(owner, {
    conversationId: general.id, calendarEventId: null, title: 'Разбор сметы', mode: 'video',
    participantIds: [owner.userId], scheduledFor: null, providerRoomName: `wh-${suffix}`,
  });
  await calls.join(owner, call.id);
  const egressId = `EG_${suffix}`;
  await calls.startRecording(owner, call.id, {
    recordingId: randomUUID(), provider: 'livekit', providerRecordingId: egressId,
    storageKey: `recordings/${owner.workspaceId}/${call.id}/fixture.mp4`,
  });
  await calls.stopRecording(owner, call.id);

  // Подпись проверяет сам LiveKit; здесь важен путь после проверки,
  // поэтому приёмник подменён — он просто разбирает тело.
  const app = await createChatServer({
    databaseUrl: DATABASE_URL,
    startMeetingWorker: false,
    liveKitWebhook: {
      status: () => ({ provider: 'livekit-test', enabled: true }),
      receive: async (raw) => JSON.parse(String(raw)),
    },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const event = JSON.stringify({ id: `WH_${suffix}`, event: 'egress_ended', egressInfo: { egressId, status: 3 } });
  const post = async () => {
    const response = await fetch(`${base}/api/v1/media/livekit/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'test' }, body: event });
    return { status: response.status, payload: await response.json().catch(() => null) };
  };

  const first = await post();
  assert.equal(first.status, 200, JSON.stringify(first.payload));
  assert.notEqual(first.payload.duplicate, true, 'первый вебхук принят за повтор');
  assert.equal(first.payload.matched, true, 'вебхук не нашёл свою запись');

  const second = await post();
  assert.equal(second.status, 200);
  assert.equal(second.payload.duplicate, true, 'повтор обработан как новое событие');

  // Главное: прогон обработки один, а не два.
  const count = async (sql) => Number((await pool.query(sql, [egressId])).rows[0].n);
  assert.equal(await count(`SELECT count(*) n FROM meeting_intelligence_runs r
     JOIN call_recordings cr ON cr.workspace_id=r.workspace_id AND cr.id=r.recording_id
    WHERE cr.provider_recording_id=$1`), 1, 'прогонов обработки больше одного');
  assert.equal(await count(`SELECT count(*) n FROM meeting_intelligence_jobs j
     JOIN meeting_intelligence_runs r ON r.id=j.run_id
     JOIN call_recordings cr ON cr.workspace_id=r.workspace_id AND cr.id=r.recording_id
    WHERE cr.provider_recording_id=$1 AND j.kind='transcribe'`), 1,
    'задач на расшифровку больше одной — платный провайдер получил бы их все');

  // Неизвестное событие не ломает приём и не заводит ничего лишнего.
  const other = await fetch(`${base}/api/v1/media/livekit/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'test' },
    body: JSON.stringify({ id: `WH_other_${suffix}`, event: 'room_started' }) });
  assert.equal(other.status, 200);
  assert.equal((await other.json()).ignored, true);
});
