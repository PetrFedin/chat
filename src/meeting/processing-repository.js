import { randomUUID } from 'node:crypto';

const now=()=>new Date().toISOString();
const clone=(value)=>value==null?value:structuredClone(value);

function queueable(status){return status==='not_requested'}
function isTerminalRecording(status){return ['ready','failed','cancelled'].includes(status)}
function sourceKind(recording){
  return recording.transcriptionSourceStatus==='ready'&&recording.transcriptionStorageKey?'audio_sidecar':'archive';
}

function decorate(base,wrapper){
  return new Proxy(wrapper,{
    get(target,property,receiver){
      if(Reflect.has(target,property)){
        const value=Reflect.get(target,property,receiver);
        return typeof value==='function'?value.bind(target):value;
      }
      const value=base[property];
      return typeof value==='function'?value.bind(base):value;
    },
    set(target,property,value,receiver){
      if(Reflect.has(target,property))return Reflect.set(target,property,value,receiver);
      base[property]=value;
      return true;
    },
  });
}

export class ProcessingAwareMeetingRepository{
  constructor(base,pool=null){
    this.base=base;
    this.pool=pool;
    this.providerCalls=new Map();
  }

  async tx(fn){
    if(!this.pool)return fn(null);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const value=await fn(client);
      await client.query('COMMIT');
      return value;
    }catch(error){
      try{await client.query('ROLLBACK')}catch{}
      throw error;
    }finally{client.release()}
  }

  async registerRecording(recording){
    if(typeof this.base.registerRecording==='function')return this.base.registerRecording(recording);
    return null;
  }

  async queueMemory(recording){
    let run=[...this.base.runs.values()].find((value)=>value.recordingId===recording.id);
    if(!run){
      run={
        id:randomUUID(),organizationId:recording.organizationId,workspaceId:recording.workspaceId,
        callId:recording.callId,recordingId:recording.id,status:'queued',createdAt:now(),updatedAt:now(),
      };
      this.base.runs.set(run.id,run);
    }
    let job=[...this.base.jobs.values()].find((value)=>value.runId===run.id&&value.kind==='transcribe');
    if(!job){
      job={
        id:randomUUID(),organizationId:recording.organizationId,workspaceId:recording.workspaceId,
        runId:run.id,kind:'transcribe',status:'pending',attempts:0,maxAttempts:5,availableAt:now(),createdAt:now(),updatedAt:now(),
      };
      this.base.jobs.set(job.id,job);
    }
    return{run:clone(run),job:clone(job)};
  }

  async reconcileMemory(providerRecordingId,{success=true,error=null}={}){
    const recording=[...this.base.recordings.values()].find((value)=>
      value.providerRecordingId===providerRecordingId||value.transcriptionProviderRecordingId===providerRecordingId);
    if(!recording)return null;
    const sidecar=recording.transcriptionProviderRecordingId===providerRecordingId;
    let shouldQueue=false;

    if(sidecar){
      if(success){
        recording.transcriptionSourceStatus='ready';
        recording.transcriptionSourceError=null;
        shouldQueue=queueable(recording.transcriptStatus);
      }else{
        recording.transcriptionSourceStatus='failed';
        recording.transcriptionSourceError=error??'Transcription sidecar egress failed';
        if(recording.status==='ready')shouldQueue=queueable(recording.transcriptStatus);
        else if(['failed','cancelled'].includes(recording.status))recording.transcriptStatus='failed';
      }
    }else if(success){
      recording.status='ready';
      recording.readyAt??=now();
      const sidecarPending=Boolean(recording.transcriptionProviderRecordingId)
        && !['ready','failed'].includes(recording.transcriptionSourceStatus);
      if(!sidecarPending&&recording.transcriptionSourceStatus!=='ready')shouldQueue=queueable(recording.transcriptStatus);
      if(!recording.transcriptionProviderRecordingId)shouldQueue=queueable(recording.transcriptStatus);
    }else{
      recording.status='failed';
      recording.failedAt??=now();
      if(recording.transcriptionSourceStatus==='ready')shouldQueue=queueable(recording.transcriptStatus);
      else if(!recording.transcriptionProviderRecordingId||recording.transcriptionSourceStatus==='failed')recording.transcriptStatus='failed';
    }

    if(shouldQueue)recording.transcriptStatus='queued';
    recording.updatedAt=now();
    const queued=shouldQueue?await this.queueMemory(recording):null;
    const existingRun=[...this.base.runs.values()].find((value)=>value.recordingId===recording.id)??null;
    const existingJob=existingRun?[...this.base.jobs.values()].find((value)=>value.runId===existingRun.id&&value.kind==='transcribe')??null:null;
    return{
      recording:clone(recording),
      run:queued?.run??clone(existingRun),
      job:queued?.job??clone(existingJob),
      sourceKind:sourceKind(recording),
      sidecar,
    };
  }

  async queuePostgres(client,recording){
    const firstQueue=queueable(recording.transcriptStatus);
    if(firstQueue){
      await client.query(`UPDATE call_recordings SET transcript_status='queued',updated_at=now() WHERE id=$1`,[recording.id]);
    }
    const run=(await client.query(`INSERT INTO meeting_intelligence_runs(organization_id,workspace_id,call_id,recording_id,status)
      VALUES($1,$2,$3,$4,'queued')
      ON CONFLICT(workspace_id,recording_id) DO UPDATE SET updated_at=meeting_intelligence_runs.updated_at
      RETURNING id,organization_id "organizationId",workspace_id "workspaceId",call_id "callId",recording_id "recordingId",status,created_at "createdAt"`,
    [recording.organizationId,recording.workspaceId,recording.callId,recording.id])).rows[0];
    const job=(await client.query(`INSERT INTO meeting_intelligence_jobs(organization_id,workspace_id,run_id,kind,status)
      VALUES($1,$2,$3,'transcribe','pending')
      ON CONFLICT(workspace_id,run_id,kind) DO UPDATE SET updated_at=meeting_intelligence_jobs.updated_at
      RETURNING id,run_id "runId",kind,status,attempts,max_attempts "maxAttempts",available_at "availableAt"`,
    [recording.organizationId,recording.workspaceId,run.id])).rows[0];
    if(firstQueue){
      await client.query(`INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload)
        VALUES($1,$2,'meeting.recording.ready',$3,$4)`,
      [recording.organizationId,recording.workspaceId,run.id,{callId:recording.callId,recordingId:recording.id,jobId:job.id,sourceKind:sourceKind(recording)}]);
    }
    return{run,job,firstQueue};
  }

  async reconcilePostgres(providerRecordingId,{success=true,error=null}={}){
    return this.tx(async(client)=>{
      const recording=(await client.query(`SELECT id,organization_id "organizationId",workspace_id "workspaceId",call_id "callId",
        provider_recording_id "providerRecordingId",storage_key "storageKey",status,transcript_status "transcriptStatus",
        transcription_provider_recording_id "transcriptionProviderRecordingId",transcription_storage_key "transcriptionStorageKey",
        transcription_source_status "transcriptionSourceStatus",transcription_source_error "transcriptionSourceError"
        FROM call_recordings
        WHERE provider='livekit' AND (provider_recording_id=$1 OR transcription_provider_recording_id=$1)
        FOR UPDATE`,[providerRecordingId])).rows[0];
      if(!recording)return null;
      const sidecar=recording.transcriptionProviderRecordingId===providerRecordingId;
      let shouldQueue=false;

      if(sidecar){
        if(success){
          await client.query(`UPDATE call_recordings SET transcription_source_status='ready',transcription_source_error=NULL,updated_at=now()
            WHERE id=$1`,[recording.id]);
          recording.transcriptionSourceStatus='ready';
          recording.transcriptionSourceError=null;
          shouldQueue=queueable(recording.transcriptStatus);
        }else{
          const message=String(error??'Transcription sidecar egress failed').slice(0,4000);
          await client.query(`UPDATE call_recordings SET transcription_source_status='failed',transcription_source_error=$2,updated_at=now()
            WHERE id=$1`,[recording.id,message]);
          recording.transcriptionSourceStatus='failed';
          recording.transcriptionSourceError=message;
          if(recording.status==='ready')shouldQueue=queueable(recording.transcriptStatus);
          else if(['failed','cancelled'].includes(recording.status)){
            await client.query(`UPDATE call_recordings SET transcript_status='failed',updated_at=now() WHERE id=$1`,[recording.id]);
            recording.transcriptStatus='failed';
          }
        }
      }else if(success){
        await client.query(`UPDATE call_recordings SET status='ready',ready_at=COALESCE(ready_at,now()),updated_at=now() WHERE id=$1`,[recording.id]);
        await client.query(`UPDATE call_sessions SET recording_status='ready',last_activity_at=now() WHERE workspace_id=$1 AND id=$2`,
          [recording.workspaceId,recording.callId]);
        recording.status='ready';
        const sidecarPending=Boolean(recording.transcriptionProviderRecordingId)
          && !['ready','failed'].includes(recording.transcriptionSourceStatus);
        if(!recording.transcriptionProviderRecordingId)shouldQueue=queueable(recording.transcriptStatus);
        else if(recording.transcriptionSourceStatus==='failed')shouldQueue=queueable(recording.transcriptStatus);
        else if(!sidecarPending&&recording.transcriptionSourceStatus!=='ready')shouldQueue=queueable(recording.transcriptStatus);
      }else{
        await client.query(`UPDATE call_recordings SET status='failed',failed_at=COALESCE(failed_at,now()),updated_at=now() WHERE id=$1`,[recording.id]);
        await client.query(`UPDATE call_sessions SET recording_status='failed',last_activity_at=now() WHERE workspace_id=$1 AND id=$2`,
          [recording.workspaceId,recording.callId]);
        recording.status='failed';
        if(recording.transcriptionSourceStatus==='ready')shouldQueue=queueable(recording.transcriptStatus);
        else if(!recording.transcriptionProviderRecordingId||recording.transcriptionSourceStatus==='failed'){
          await client.query(`UPDATE call_recordings SET transcript_status='failed',updated_at=now() WHERE id=$1`,[recording.id]);
          recording.transcriptStatus='failed';
        }
      }

      let queued=null;
      if(shouldQueue){
        queued=await this.queuePostgres(client,recording);
        recording.transcriptStatus='queued';
      }else{
        const run=(await client.query(`SELECT id,organization_id "organizationId",workspace_id "workspaceId",call_id "callId",
          recording_id "recordingId",status,created_at "createdAt" FROM meeting_intelligence_runs
          WHERE workspace_id=$1 AND recording_id=$2`,[recording.workspaceId,recording.id])).rows[0]??null;
        const job=run?(await client.query(`SELECT id,run_id "runId",kind,status,attempts,max_attempts "maxAttempts",available_at "availableAt"
          FROM meeting_intelligence_jobs WHERE workspace_id=$1 AND run_id=$2 AND kind='transcribe'`,[recording.workspaceId,run.id])).rows[0]??null:null;
        queued={run,job,firstQueue:false};
      }
      return{recording,run:queued.run,job:queued.job,sourceKind:sourceKind(recording),sidecar};
    });
  }

  async reconcileEgress(providerRecordingId,value={}){
    if(this.pool)return this.reconcilePostgres(providerRecordingId,value);
    if(this.base?.recordings instanceof Map)return this.reconcileMemory(providerRecordingId,value);
    return this.base.reconcileEgress(providerRecordingId,value);
  }

  async jobContext(job){
    if(!this.pool){
      const run=this.base.runs?.get?.(job.runId);
      if(!run)return null;
      const recording=[...(this.base.recordings?.values?.()??[])].find((value)=>value.id===run.recordingId);
      if(!recording)return null;
      const useSidecar=recording.transcriptionSourceStatus==='ready'&&recording.transcriptionStorageKey;
      return{
        id:job.id,kind:job.kind,lockToken:job.lockToken,runId:run.id,callId:run.callId,recordingId:run.recordingId,
        storageKey:useSidecar?recording.transcriptionStorageKey:recording.storageKey,
        providerRecordingId:useSidecar?recording.transcriptionProviderRecordingId:recording.providerRecordingId,
        sourceKind:useSidecar?'audio_sidecar':'archive',
        workspaceId:run.workspaceId,organizationId:run.organizationId,
      };
    }
    return(await this.pool.query(`SELECT j.id,j.kind,j.lock_token "lockToken",j.attempts,r.id "runId",r.call_id "callId",
      r.recording_id "recordingId",
      CASE WHEN cr.transcription_source_status='ready' AND cr.transcription_storage_key IS NOT NULL
        THEN cr.transcription_storage_key ELSE cr.storage_key END "storageKey",
      CASE WHEN cr.transcription_source_status='ready' AND cr.transcription_provider_recording_id IS NOT NULL
        THEN cr.transcription_provider_recording_id ELSE cr.provider_recording_id END "providerRecordingId",
      CASE WHEN cr.transcription_source_status='ready' AND cr.transcription_storage_key IS NOT NULL
        THEN 'audio_sidecar' ELSE 'archive' END "sourceKind",
      r.workspace_id "workspaceId",r.organization_id "organizationId"
      FROM meeting_intelligence_jobs j
      JOIN meeting_intelligence_runs r ON r.workspace_id=j.workspace_id AND r.id=j.run_id
      JOIN call_recordings cr ON cr.workspace_id=r.workspace_id AND cr.id=r.recording_id
      WHERE j.id=$1`,[job.id])).rows[0]??null;
  }

  async startProviderCall(job,context,{provider,model,inputMetadata={}}={}){
    if(!provider||!model)return null;
    const attemptNumber=Math.max(Number(job.attempts)||1,1);
    if(!this.pool){
      const existing=[...this.providerCalls.values()].find((value)=>value.workspaceId===context.workspaceId&&value.jobId===job.id&&value.attemptNumber===attemptNumber);
      if(existing)return clone(existing);
      const row={
        id:randomUUID(),organizationId:context.organizationId,workspaceId:context.workspaceId,runId:context.runId,jobId:job.id,
        kind:job.kind,attemptNumber,provider,model,status:'started',inputMetadata:clone(inputMetadata),usage:null,
        providerRequestId:null,startedAt:now(),finishedAt:null,latencyMs:null,errorCode:null,errorMessage:null,
      };
      this.providerCalls.set(row.id,row);
      return clone(row);
    }
    const {rows}=await this.pool.query(`INSERT INTO meeting_provider_calls(
      organization_id,workspace_id,run_id,job_id,kind,attempt_number,provider,model,status,input_metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'started',$9)
      ON CONFLICT(workspace_id,job_id,attempt_number) DO NOTHING
      RETURNING id,workspace_id "workspaceId",run_id "runId",job_id "jobId",kind,attempt_number "attemptNumber",provider,model,status,
        input_metadata "inputMetadata",started_at "startedAt"`,
    [context.organizationId,context.workspaceId,context.runId,job.id,job.kind,attemptNumber,provider,model,inputMetadata]);
    if(rows[0])return rows[0];
    return(await this.pool.query(`SELECT id,workspace_id "workspaceId",run_id "runId",job_id "jobId",kind,
      attempt_number "attemptNumber",provider,model,status,input_metadata "inputMetadata",started_at "startedAt"
      FROM meeting_provider_calls WHERE workspace_id=$1 AND job_id=$2 AND attempt_number=$3`,
    [context.workspaceId,job.id,attemptNumber])).rows[0]??null;
  }

  async finishProviderCall(providerCallId,{status,requestId=null,usage=null,error=null}={}){
    if(!providerCallId)return null;
    const finalStatus=status==='succeeded'?'succeeded':'failed';
    const errorCode=finalStatus==='failed'?(error?.code??'PROVIDER_CALL_FAILED'):null;
    const errorMessage=finalStatus==='failed'?String(error?.message??error??'Provider call failed').slice(0,4000):null;
    if(!this.pool){
      const row=this.providerCalls.get(providerCallId);
      if(!row||row.status!=='started')return clone(row??null);
      row.status=finalStatus;
      row.providerRequestId=requestId??error?.details?.requestId??null;
      row.usage=clone(usage);
      row.finishedAt=now();
      row.latencyMs=Math.max(0,Date.parse(row.finishedAt)-Date.parse(row.startedAt));
      row.errorCode=errorCode;
      row.errorMessage=errorMessage;
      return clone(row);
    }
    const {rows}=await this.pool.query(`UPDATE meeting_provider_calls SET
      status=$2,provider_request_id=$3,usage=$4,finished_at=now(),
      latency_ms=GREATEST(0,round(extract(epoch FROM (now()-started_at))*1000)::bigint),
      error_code=$5,error_message=$6
      WHERE id=$1 AND status='started'
      RETURNING id,status,provider_request_id "providerRequestId",usage,started_at "startedAt",finished_at "finishedAt",
        latency_ms "latencyMs",error_code "errorCode",error_message "errorMessage"`,
    [providerCallId,finalStatus,requestId??error?.details?.requestId??null,usage,errorCode,errorMessage]);
    if(rows[0])return rows[0];
    return(await this.pool.query(`SELECT id,status,provider_request_id "providerRequestId",usage,started_at "startedAt",
      finished_at "finishedAt",latency_ms "latencyMs",error_code "errorCode",error_message "errorMessage"
      FROM meeting_provider_calls WHERE id=$1`,[providerCallId])).rows[0]??null;
  }

  async getProviderCalls(session,runId){
    if(!runId)return[];
    if(!this.pool){
      return clone([...this.providerCalls.values()].filter((value)=>value.workspaceId===session.workspaceId&&value.runId===runId)
        .sort((a,b)=>String(a.startedAt).localeCompare(String(b.startedAt)))
        .map(({inputMetadata,providerRequestId,...value})=>value));
    }
    return(await this.pool.query(`SELECT kind,attempt_number "attemptNumber",provider,model,status,usage,
      started_at "startedAt",finished_at "finishedAt",latency_ms "latencyMs",error_code "errorCode"
      FROM meeting_provider_calls WHERE workspace_id=$1 AND run_id=$2 ORDER BY started_at,id`,[session.workspaceId,runId])).rows;
  }

  async getMeeting(session,callId){
    const meeting=await this.base.getMeeting(session,callId);
    const providerCalls=meeting?.run?await this.getProviderCalls(session,meeting.run.id):[];
    return{...meeting,providerCalls};
  }
}

export function createProcessingAwareMeetingRepository(base,pool=null){
  const wrapper=new ProcessingAwareMeetingRepository(base,pool);
  return decorate(base,wrapper);
}
