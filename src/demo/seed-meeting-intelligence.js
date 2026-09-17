import { createHash, randomUUID } from 'node:crypto';
import { DEMO_EMAIL } from './seed-demo.js';

function findProfile(store, workspaceId, displayName) {
  for (const [key, profile] of store.profiles?.entries?.() ?? []) {
    if (!key.startsWith(`${workspaceId}:`)) continue;
    if (profile.displayName === displayName) return profile;
  }
  return null;
}

function actor(store, auth, displayName, role = 'member') {
  const workspace = store.workspaces?.get?.(auth.workspaceId);
  const profile = findProfile(store, auth.workspaceId, displayName);
  if (!workspace || !profile) return null;
  return {
    userId:profile.userId,
    workspaceId:auth.workspaceId,
    organizationId:workspace.organizationId,
    displayName:profile.displayName,
    role,
  };
}

export async function seedDemoMeetingIntelligence({ store, calls, meeting }) {
  if (!(store?.conversations instanceof Map) || !(calls?.calls instanceof Map) || !(meeting?.runs instanceof Map)) return null;
  const auth = await store.findAuthByEmail(DEMO_EMAIL);
  if (!auth) return null;
  if ([...meeting.runs.values()].some((run) => run.workspaceId === auth.workspaceId)) return null;

  const owner = actor(store, auth, 'Алексей Воронцов', 'owner');
  const marina = actor(store, auth, 'Марина Орлова', 'manager');
  const maxim = actor(store, auth, 'Максим Лебедев', 'member');
  const anna = actor(store, auth, 'Анна Белова', 'member');
  const ilya = actor(store, auth, 'Илья Соколов', 'manager');
  if (!owner || !marina || !maxim || !anna || !ilya) return null;

  const conversation = [...store.conversations.values()].find((item) =>
    item.workspaceId === auth.workspaceId && item.title === 'Запуск мобильной версии');
  if (!conversation) return null;

  const call = await calls.create(owner, {
    conversationId:conversation.id,
    calendarEventId:null,
    title:'Релизный созвон · mobile readiness',
    mode:'video',
    participantIds:[marina.userId, maxim.userId, anna.userId, ilya.userId],
    scheduledFor:null,
    providerRoomName:`demo-${randomUUID().slice(0, 8)}`,
  });
  await calls.join(owner, call.id);
  const recording = await calls.startRecording(owner, call.id, {
    recordingId:randomUUID(),
    provider:'livekit',
    providerRecordingId:`DEMO_EGRESS_${randomUUID()}`,
    storageKey:`recordings/${owner.workspaceId}/${call.id}/demo-fixture.mp4`,
  });
  await calls.stopRecording(owner, call.id);
  await calls.end(owner, call.id);

  await meeting.registerRecording({
    ...recording,
    organizationId:owner.organizationId,
    workspaceId:owner.workspaceId,
    callId:call.id,
    status:'processing',
    transcriptStatus:'not_requested',
  });
  const queued = await meeting.reconcileEgress(recording.providerRecordingId, { success:true });
  const transcriptionJob = await meeting.claimJob('transcribe');
  const segments = [
    { startMs:0, endMs:8200, speakerUserId:marina.userId, speakerLabel:marina.displayName, text:'По мобильному релизу остаётся один критичный сценарий: входящий звонок после повторной авторизации. Остальной контур готов.', confidence:.98 },
    { startMs:8400, endMs:17100, speakerUserId:maxim.userId, speakerLabel:maxim.displayName, text:'Reconnect исправлен. Сегодня повторно проверю входящий push, восстановление после фона и переключение камеры.', confidence:.97 },
    { startMs:17400, endMs:24700, speakerUserId:anna.userId, speakerLabel:anna.displayName, text:'Финальный visual QA сделаю сразу после технической проверки, чтобы не принимать интерфейс на старом состоянии.', confidence:.96 },
    { startMs:25000, endMs:33300, speakerUserId:ilya.userId, speakerLabel:ilya.displayName, text:'Operational checklist пока блокирован этим же сценарием. После подтверждения push я закрываю чек-лист и даю статус готовности.', confidence:.97 },
    { startMs:33600, endMs:43000, speakerUserId:owner.userId, speakerLabel:owner.displayName, text:'Решение: сборку выпускаем только после успешного mobile QA, проверки push после повторной авторизации и финального visual QA.', confidence:.99 },
    { startMs:43400, endMs:50100, speakerUserId:marina.userId, speakerLabel:marina.displayName, text:'Нужно ещё заранее определить, что считаем rollback trigger, если после выкладки начнут расти ошибки входящих звонков.', confidence:.95 },
  ];
  const transcript = await meeting.completeTranscription(transcriptionJob.id, transcriptionJob.lockToken, {
    provider:'demo-fixture',
    model:'demo-fixture-transcript-v1',
    language:'ru',
    sourceSha256:createHash('sha256').update(`demo-meeting:${call.id}`).digest('hex'),
    segments,
  });

  const summaryJob = await meeting.claimJob('summarize');
  await meeting.completeSummary(summaryJob.id, summaryJob.lockToken, {
    provider:'demo-fixture',
    model:'demo-fixture-summary-v1',
    overview:'Команда готова к мобильному релизу после трёх последовательных подтверждений: критический mobile QA, push/re-auth сценарий и финальный visual QA. Отдельно требуется зафиксировать rollback trigger после выкладки.',
    summaryJson:{ syntheticDemo:true, label:'Демонстрационные данные — не реальная стенограмма' },
    proposals:[
      {
        proposalType:'action',
        title:'Закрыть критический mobile QA входящего звонка',
        body:'Проверить входящий push после повторной авторизации, reconnect, background recovery и переключение камеры.',
        proposedOwnerId:maxim.userId,
        proposedDueAt:new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        sourceSegmentIds:[transcript.segments[1].id],
        confidence:.97,
      },
      {
        proposalType:'action',
        title:'Провести финальный visual QA мобильного релиза',
        body:'Провести визуальную проверку после завершения технического mobile QA.',
        proposedOwnerId:anna.userId,
        proposedDueAt:new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
        sourceSegmentIds:[transcript.segments[2].id],
        confidence:.95,
      },
      {
        proposalType:'decision',
        title:'Выпускать сборку только после полного mobile readiness gate',
        body:'Релиз разрешён после успешного mobile QA, push/re-auth проверки и финального visual QA.',
        sourceSegmentIds:[transcript.segments[4].id],
        confidence:.99,
      },
      {
        proposalType:'risk',
        title:'Повторная авторизация может нарушить входящий звонок',
        body:'Критичный пользовательский сценарий ещё требует финального подтверждения до релиза.',
        sourceSegmentIds:[transcript.segments[0].id, transcript.segments[1].id],
        confidence:.96,
      },
      {
        proposalType:'open_question',
        title:'Какой порог ошибок запускает rollback?',
        body:'До релиза нужно зафиксировать измеримый rollback trigger для ошибок входящих звонков.',
        sourceSegmentIds:[transcript.segments[5].id],
        confidence:.94,
      },
    ],
  });

  const callState = calls.calls.get(call.id);
  if (callState) callState.recordingStatus = 'ready';
  const recordingState = calls.recordings.get(recording.id);
  if (recordingState) {
    recordingState.status = 'ready';
    recordingState.transcriptStatus = 'ready';
    recordingState.summaryStatus = 'ready';
  }

  const intelligence = await meeting.getMeeting(owner, call.id);
  const recipients = [owner, marina, maxim, anna, ilya];
  for (const recipient of recipients) {
    store.putNotification?.({
      organizationId:owner.organizationId,
      workspaceId:owner.workspaceId,
      recipientUserId:recipient.userId,
      sourceEventId:queued.run.id,
      dedupeKey:`meeting.review_ready:${queued.run.id}:${recipient.userId}`,
      type:'meeting.review_ready',
      title:'Итоги встречи готовы',
      body:'Проверьте решения, действия и источники в стенограмме.',
      actorUserId:owner.userId,
      conversationId:conversation.id,
      url:`/#/meetings/${call.id}`,
      priority:'high',
      metadata:{ callId:call.id, runId:queued.run.id, syntheticDemo:true, proposalCount:intelligence.proposals.length },
    });
  }

  return { callId:call.id, runId:queued.run.id, synthetic:true };
}
