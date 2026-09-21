import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/store.js';
import { PostgresCallRepository } from '../src/media/call-repository.js';
import { createProcessingAwareMeetingRepository } from '../src/meeting/processing-repository.js';
import { PostgresMeetingRepository } from '../src/meeting/meeting-repository.js';
import { MeetingProcessor } from '../src/meeting/processor.js';
import { hashPassword, hashToken } from '../src/security.js';

const DATABASE_URL = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

async function workspace(store, suffix) {
  const password = hashPassword('WorkspacePass42');
  const created = await store.createCompany({
    companyName: `Обработка ${suffix}`, ownerName: 'Владелец',
    email: `proc-${suffix}@example.com`, passwordHash: password.hash, passwordSalt: password.salt,
  });
  const tokenHash = hashToken(`proc-${randomUUID()}`);
  await store.createSession({ userId: created.user.id, workspaceId: created.workspace.id, tokenHash,
    expiresAt: new Date(Date.now() + 86400000).toISOString() });
  return store.getSession(tokenHash);
}

/**
 * Очередь задач общая на всю базу, и рядом лежат задачи соседних тестов.
 * Сужаем выбор до своей — обработчик при этом работает как обычно: сам
 * заводит строку учёта, сам разбирается с отказом и сам закрывает задачу.
 */
const onlyOwnJob = (repository, jobId) => Object.assign(Object.create(repository), {
  claimJob: async () => repository.claimJobById(jobId),
});

/** Хранилище объектов на память: нам важна не запись, а её обработка. */
const objectStoreWith = (body) => ({
  status: () => ({ provider: 'memory', enabled: true, durable: false }),
  head: async () => ({ exists: true, sizeBytes: body.length }),
  get: async () => body,
});

async function readyRecording(pool, owner, suffix) {
  const calls = new PostgresCallRepository(pool);
  const meeting = createProcessingAwareMeetingRepository(new PostgresMeetingRepository(pool), pool);
  const store = new PostgresStore(pool);
  const general = (await store.listConversations(owner)).find((c) => c.slug === 'general');
  const call = await calls.create(owner, {
    conversationId: general.id, calendarEventId: null, title: 'Планёрка', mode: 'video',
    participantIds: [owner.userId], scheduledFor: null, providerRoomName: `proc-${suffix}`,
  });
  await calls.join(owner, call.id);
  const egressId = `EG_${suffix}`;
  await calls.startRecording(owner, call.id, {
    recordingId: randomUUID(), provider: 'livekit', providerRecordingId: egressId,
    storageKey: `recordings/${owner.workspaceId}/${call.id}/fixture.mp4`,
  });
  await calls.stopRecording(owner, call.id);
  const reconciled = await meeting.reconcileEgress(egressId, { success: true });
  return { meeting, calls, call, run: reconciled.run, job: reconciled.job };
}

/**
 * Отказ платного провайдера должен закрывать счётчик расхода.
 *
 * Строка учёта открывается перед обращением к провайдеру и закрывается
 * после. Ветка отказа не выполнялась ни одним тестом — а если она
 * сломается, счёт за расшифровку перестанет сходиться: открытые строки
 * не попадут в сумму, лимиты стоимости посчитают не то и либо не
 * сработают при перерасходе, либо зря заблокируют встречи.
 */
test('отказ провайдера закрывает строку учёта расхода',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const suffix = randomUUID().slice(0, 8);
  const owner = await workspace(store, suffix);
  const { meeting, run, job } = await readyRecording(pool, owner, suffix);

  let attempts = 0;
  const processor = new MeetingProcessor({
    repository: onlyOwnJob(meeting, job.id),
    objectStore: objectStoreWith(Buffer.from('звук')),
    transcriptionProvider: {
      status: () => ({ enabled: true, provider: 'openai', model: 'gpt-4o-transcribe' }),
      transcribe: async () => {
        attempts += 1;
        throw Object.assign(new Error('провайдер недоступен'), { code: 'PROVIDER_UNAVAILABLE', details: { requestId: 'req_fail' } });
      },
    },
    retryDelayMs: 10,
  });

  const result = await processor.runOnce('transcribe');
  assert.equal(attempts, 1, 'провайдера не спросили');
  assert.equal(result.processed, false);
  assert.equal(result.error.code, 'PROVIDER_UNAVAILABLE');

  const meters = (await pool.query(
    `SELECT status, provider_request_id, error_code, finished_at FROM meeting_provider_calls
      WHERE workspace_id=$1 AND run_id=$2`, [owner.workspaceId, run.id])).rows;
  assert.equal(meters.length, 1, 'строка учёта не заведена');
  assert.equal(meters[0].status, 'failed', 'строка учёта осталась открытой — сумма расхода не сойдётся');
  assert.ok(meters[0].finished_at, 'у незакрытой строки нет времени окончания');
  assert.equal(meters[0].provider_request_id, 'req_fail', 'потерян идентификатор запроса к провайдеру');

  // Задача не потеряна: её вернут в очередь, а прогон не остался
  // «обрабатывается» без объяснения.
  const afterFailure = (await pool.query(
    `SELECT status, attempts, last_error FROM meeting_intelligence_jobs WHERE run_id=$1 AND kind='transcribe'`,
    [run.id])).rows[0];
  assert.equal(afterFailure.status, 'failed');
  assert.equal(afterFailure.attempts, 1);
  assert.match(afterFailure.last_error, /провайдер недоступен/);
});

/**
 * Исчерпанные попытки должны переводить прогон в «не получилось».
 *
 * Иначе карточка встречи навсегда останется в «обрабатывается»: человек
 * ждёт выжимку, которой уже не будет, и никто об этом не узнает.
 */
test('исчерпанные попытки переводят встречу в «не получилось», а не в вечное ожидание',
  { skip: !DATABASE_URL && 'нет базы' }, async (t) => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  t.after(() => pool.end());
  const store = new PostgresStore(pool);
  const suffix = randomUUID().slice(0, 8);
  const owner = await workspace(store, suffix);
  const { meeting, run, job } = await readyRecording(pool, owner, suffix);

  // Последняя попытка: дальше отступать некуда.
  await pool.query(
    `UPDATE meeting_intelligence_jobs SET attempts=max_attempts-1, available_at=now() WHERE id=$1`, [job.id]);

  const processor = new MeetingProcessor({
    repository: onlyOwnJob(meeting, job.id),
    objectStore: objectStoreWith(Buffer.from('звук')),
    transcriptionProvider: {
      status: () => ({ enabled: true, provider: 'openai', model: 'gpt-4o-transcribe' }),
      transcribe: async () => { throw Object.assign(new Error('снова отказ'), { code: 'PROVIDER_UNAVAILABLE' }); },
    },
    retryDelayMs: 10,
  });
  await processor.runOnce('transcribe');

  const dead = (await pool.query(
    `SELECT status, finished_at FROM meeting_intelligence_jobs WHERE id=$1`, [job.id])).rows[0];
  assert.equal(dead.status, 'dead_letter', 'задача не ушла в мёртвые письма');
  assert.ok(dead.finished_at);

  const finished = (await pool.query(
    `SELECT status, error_code, error_message FROM meeting_intelligence_runs WHERE id=$1`, [run.id])).rows[0];
  assert.equal(finished.status, 'failed', 'карточка встречи осталась в «обрабатывается» навсегда');
  assert.ok(finished.error_code, 'человеку не сказали, почему не получилось');
  assert.match(String(finished.error_message ?? ''), /отказ|attempt|lease|попыт/i);
});
