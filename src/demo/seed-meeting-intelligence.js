import { createHash, randomUUID } from 'node:crypto';
import { DEMO_EMAIL } from './seed-demo.js';

const DEMO_CALL_TITLE='Релизный созвон · mobile readiness';

async function demoOwner(store,auth){
  if(store.pool?.query){
    const {rows}=await store.pool.query(`SELECT w.organization_id "organizationId",m.role,p.display_name "displayName"
      FROM workspaces w
      JOIN memberships m ON m.workspace_id=w.id AND m.user_id=$2
      LEFT JOIN workspace_profiles p ON p.workspace_id=w.id AND p.user_id=m.user_id
      WHERE w.id=$1`,[auth.workspaceId,auth.id]);
    const row=rows[0];
    if(!row)return null;
    return{userId:auth.id,workspaceId:auth.workspaceId,organizationId:row.organizationId,displayName:row.displayName||auth.email,role:row.role};
  }
  const workspace=store.workspaces?.get?.(auth.workspaceId);
  const profileKey=store.membershipKey?.(auth.workspaceId,auth.id);
  const profile=profileKey?store.profiles?.get?.(profileKey):null;
  const membership=profileKey?store.memberships?.get?.(profileKey):null;
  if(!workspace||!profile)return null;
  return{userId:auth.id,workspaceId:auth.workspaceId,organizationId:workspace.organizationId,displayName:profile.displayName,role:membership?.role||'owner'};
}

async function demoActors(store,owner){
  const bootstrap=await store.getBootstrap(owner);
  const byName=new Map((bootstrap.people??[]).map((person)=>[person.displayName,person]));
  const build=(name)=>{
    const person=byName.get(name);
    return person?{
      userId:person.userId,workspaceId:owner.workspaceId,organizationId:owner.organizationId,
      displayName:person.displayName,role:person.role,
    }:null;
  };
  return{
    owner:build('Алексей Воронцов')??owner,
    marina:build('Марина Орлова'),
    maxim:build('Максим Лебедев'),
    anna:build('Анна Белова'),
    ilya:build('Илья Соколов'),
    conversations:bootstrap.conversations??[],
  };
}

async function existingSyntheticMeeting(store,meeting,workspaceId){
  if(store.pool?.query){
    const {rows}=await store.pool.query(`SELECT id "runId",call_id "callId" FROM meeting_intelligence_runs
      WHERE workspace_id=$1 AND status='review_ready'
        AND (summary_json->>'syntheticDemo'='true' OR transcript_provider LIKE 'demo-fixture%' OR summary_provider LIKE 'demo-fixture%')
      ORDER BY completed_at DESC NULLS LAST,created_at DESC LIMIT 1`,[workspaceId]);
    return rows[0]?{...rows[0],synthetic:true,existing:true}:null;
  }
  const run=[...(meeting.runs?.values?.()??[])].find((value)=>value.workspaceId===workspaceId
    && value.status==='review_ready'
    && (value.summaryJson?.syntheticDemo||String(value.transcriptProvider??'').startsWith('demo-fixture')||String(value.summaryProvider??'').startsWith('demo-fixture')));
  return run?{callId:run.callId,runId:run.id,synthetic:true,existing:true}:null;
}

async function cleanupIncompleteDemoCalls(store,workspaceId){
  if(!store.pool?.query)return;
  await store.pool.query('BEGIN');
  try{
    const {rows}=await store.pool.query(`SELECT c.id call_id,r.id run_id
      FROM call_sessions c
      LEFT JOIN meeting_intelligence_runs r ON r.workspace_id=c.workspace_id AND r.call_id=c.id
      WHERE c.workspace_id=$1 AND c.title=$2
        AND NOT EXISTS(
          SELECT 1 FROM meeting_intelligence_runs ready
          WHERE ready.workspace_id=c.workspace_id AND ready.call_id=c.id AND ready.status='review_ready'
            AND (ready.summary_json->>'syntheticDemo'='true' OR ready.transcript_provider LIKE 'demo-fixture%' OR ready.summary_provider LIKE 'demo-fixture%')
        ) FOR UPDATE OF c`,[workspaceId,DEMO_CALL_TITLE]);
    const callIds=[...new Set(rows.map((row)=>row.call_id).filter(Boolean))];
    const runIds=[...new Set(rows.map((row)=>row.run_id).filter(Boolean))];
    if(runIds.length)await store.pool.query('DELETE FROM outbox_events WHERE workspace_id=$1 AND aggregate_id=ANY($2::uuid[])',[workspaceId,runIds]);
    if(callIds.length)await store.pool.query('DELETE FROM call_sessions WHERE workspace_id=$1 AND id=ANY($2::uuid[])',[workspaceId,callIds]);
    await store.pool.query('COMMIT');
  }catch(error){
    try{await store.pool.query('ROLLBACK')}catch{}
    throw error;
  }
}

async function putDemoNotification(store,value){
  if(typeof store.insertNotification==='function')return store.insertNotification(value);
  if(typeof store.putNotification==='function')return store.putNotification(value);
  return null;
}

export async function seedDemoMeetingIntelligence({store,calls,meeting}){
  const auth=await store.findAuthByEmail(DEMO_EMAIL);
  if(!auth)return null;

  const existing=await existingSyntheticMeeting(store,meeting,auth.workspaceId);
  if(existing)return existing;

  await cleanupIncompleteDemoCalls(store,auth.workspaceId);

  const rawOwner=await demoOwner(store,auth);
  if(!rawOwner)return null;
  const actors=await demoActors(store,rawOwner);
  const {owner,marina,maxim,anna,ilya}=actors;
  if(!owner||!marina||!maxim||!anna||!ilya)return null;

  const conversation=actors.conversations.find((item)=>item.title==='Запуск мобильной версии');
  if(!conversation)return null;

  const call=await calls.create(owner,{
    conversationId:conversation.id,
    calendarEventId:null,
    title:DEMO_CALL_TITLE,
    mode:'video',
    participantIds:[marina.userId,maxim.userId,anna.userId,ilya.userId],
    scheduledFor:null,
    providerRoomName:`demo-${randomUUID().slice(0,8)}`,
  });
  await calls.join(owner,call.id);
  const recording=await calls.startRecording(owner,call.id,{
    recordingId:randomUUID(),
    provider:'livekit',
    providerRecordingId:`DEMO_EGRESS_${randomUUID()}`,
    storageKey:`recordings/${owner.workspaceId}/${call.id}/demo-fixture.mp4`,
  });
  await calls.stopRecording(owner,call.id);
  await calls.end(owner,call.id);

  await meeting.registerRecording?.({
    ...recording,
    organizationId:owner.organizationId,
    workspaceId:owner.workspaceId,
    callId:call.id,
    status:'processing',
    transcriptStatus:'not_requested',
  });
  const queued=await meeting.reconcileEgress(recording.providerRecordingId,{success:true});
  if(!queued?.job?.id)throw new Error('Demo transcription job was not queued');
  const transcriptionJob=await meeting.claimJobById(queued.job.id);
  if(!transcriptionJob)throw new Error('Demo transcription job could not be claimed');

  const segments=[
    {startMs:0,endMs:8200,speakerUserId:marina.userId,speakerLabel:marina.displayName,text:'По мобильному релизу остаётся один критичный сценарий: входящий звонок после повторной авторизации. Остальной контур готов.',confidence:.98},
    {startMs:8400,endMs:17100,speakerUserId:maxim.userId,speakerLabel:maxim.displayName,text:'Reconnect исправлен. Сегодня повторно проверю входящий push, восстановление после фона и переключение камеры.',confidence:.97},
    {startMs:17400,endMs:24700,speakerUserId:anna.userId,speakerLabel:anna.displayName,text:'Финальный visual QA сделаю сразу после технической проверки, чтобы не принимать интерфейс на старом состоянии.',confidence:.96},
    {startMs:25000,endMs:33300,speakerUserId:ilya.userId,speakerLabel:ilya.displayName,text:'Operational checklist пока блокирован этим же сценарием. После подтверждения push я закрываю чек-лист и даю статус готовности.',confidence:.97},
    {startMs:33600,endMs:43000,speakerUserId:owner.userId,speakerLabel:owner.displayName,text:'Решение: сборку выпускаем только после успешного mobile QA, проверки push после повторной авторизации и финального visual QA.',confidence:.99},
    {startMs:43400,endMs:50100,speakerUserId:marina.userId,speakerLabel:marina.displayName,text:'Нужно ещё заранее определить, что считаем rollback trigger, если после выкладки начнут расти ошибки входящих звонков.',confidence:.95},
  ];
  const transcript=await meeting.completeTranscription(transcriptionJob.id,transcriptionJob.lockToken,{
    provider:'demo-fixture',
    model:'demo-fixture-transcript-v1',
    language:'ru',
    sourceSha256:createHash('sha256').update(`demo-meeting:${call.id}`).digest('hex'),
    segments,
  });
  if(!transcript?.nextJob?.id)throw new Error('Demo summary job was not queued');

  const summaryJob=await meeting.claimJobById(transcript.nextJob.id);
  if(!summaryJob)throw new Error('Demo summary job could not be claimed');
  await meeting.completeSummary(summaryJob.id,summaryJob.lockToken,{
    provider:'demo-fixture',
    model:'demo-fixture-summary-v1',
    overview:'Команда готова к мобильному релизу после трёх последовательных подтверждений: критический mobile QA, push/re-auth сценарий и финальный visual QA. Отдельно требуется зафиксировать rollback trigger после выкладки.',
    summaryJson:{syntheticDemo:true,label:'Демонстрационные данные — не реальная стенограмма'},
    proposals:[
      {proposalType:'action',title:'Закрыть критический mobile QA входящего звонка',body:'Проверить входящий push после повторной авторизации, reconnect, background recovery и переключение камеры.',proposedOwnerId:maxim.userId,proposedDueAt:new Date(Date.now()+3*60*60*1000).toISOString(),sourceSegmentIds:[transcript.segments[1].id],confidence:.97},
      {proposalType:'action',title:'Провести финальный visual QA мобильного релиза',body:'Провести визуальную проверку после завершения технического mobile QA.',proposedOwnerId:anna.userId,proposedDueAt:new Date(Date.now()+5*60*60*1000).toISOString(),sourceSegmentIds:[transcript.segments[2].id],confidence:.95},
      {proposalType:'decision',title:'Выпускать сборку только после полного mobile readiness gate',body:'Релиз разрешён после успешного mobile QA, push/re-auth проверки и финального visual QA.',sourceSegmentIds:[transcript.segments[4].id],confidence:.99},
      {proposalType:'risk',title:'Повторная авторизация может нарушить входящий звонок',body:'Критичный пользовательский сценарий ещё требует финального подтверждения до релиза.',sourceSegmentIds:[transcript.segments[0].id,transcript.segments[1].id],confidence:.96},
      {proposalType:'open_question',title:'Какой порог ошибок запускает rollback?',body:'До релиза нужно зафиксировать измеримый rollback trigger для ошибок входящих звонков.',sourceSegmentIds:[transcript.segments[5].id],confidence:.94},
    ],
  });

  const callState=calls.calls?.get?.(call.id);
  if(callState)callState.recordingStatus='ready';
  const recordingState=calls.recordings?.get?.(recording.id);
  if(recordingState){
    recordingState.status='ready';
    recordingState.transcriptStatus='ready';
    recordingState.summaryStatus='ready';
  }

  const intelligence=await meeting.getMeeting(owner,call.id);
  for(const recipient of [owner,marina,maxim,anna,ilya]){
    await putDemoNotification(store,{
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
      metadata:{callId:call.id,runId:queued.run.id,syntheticDemo:true,proposalCount:intelligence.proposals.length},
    });
  }

  return{callId:call.id,runId:queued.run.id,synthetic:true};
}
