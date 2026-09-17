import { createHash } from 'node:crypto';

function providerError(code,message){const error=new Error(message);error.code=code;return error}

export class DisabledTranscriptionProvider{
  status(){return{provider:'none',enabled:false,reason:'No transcription provider is configured'}}
  async transcribe(){throw providerError('TRANSCRIPTION_PROVIDER_UNAVAILABLE','No transcription provider is configured')}
}

export class DisabledMeetingSummaryProvider{
  status(){return{provider:'none',enabled:false,reason:'No meeting summary provider is configured'}}
  async summarize(){throw providerError('SUMMARY_PROVIDER_UNAVAILABLE','No meeting summary provider is configured')}
}

async function contextFor(repository,job){
  if(typeof repository.jobContext==='function')return repository.jobContext(job);
  const run=repository.runs?.get?.(job.runId);
  if(!run)return null;
  const recording=[...(repository.recordings?.values?.()??[])].find((value)=>value.id===run.recordingId);
  return recording?{
    id:job.id,kind:job.kind,lockToken:job.lockToken,runId:run.id,callId:run.callId,recordingId:run.recordingId,
    storageKey:recording.storageKey,providerRecordingId:recording.providerRecordingId,workspaceId:run.workspaceId,organizationId:run.organizationId,
  }:null;
}

export class MeetingProcessor{
  constructor({repository,objectStore,transcriptionProvider=new DisabledTranscriptionProvider(),summaryProvider=new DisabledMeetingSummaryProvider(),retryDelayMs=30_000,onReviewReady=null}={}){
    this.repository=repository;
    this.objectStore=objectStore;
    this.transcriptionProvider=transcriptionProvider;
    this.summaryProvider=summaryProvider;
    this.retryDelayMs=retryDelayMs;
    this.onReviewReady=onReviewReady;
  }

  status(){
    return{
      enabled:Boolean(this.repository&&this.objectStore),
      transcription:this.transcriptionProvider?.status?.()??{enabled:false},
      summary:this.summaryProvider?.status?.()??{enabled:false},
    };
  }

  async runOnce(kind='transcribe'){
    if(!this.repository||!this.objectStore)return{processed:false,reason:'processor_unavailable'};
    if(kind==='transcribe'&&!this.transcriptionProvider?.status?.().enabled)return{processed:false,reason:'transcription_provider_unavailable'};
    if(kind==='summarize'&&!this.summaryProvider?.status?.().enabled)return{processed:false,reason:'summary_provider_unavailable'};
    const job=await this.repository.claimJob(kind);
    if(!job)return{processed:false,reason:'no_job'};
    try{
      const context=await contextFor(this.repository,job);
      if(!context)throw providerError('MEETING_JOB_CONTEXT_MISSING','Meeting intelligence job context is missing');
      if(kind==='transcribe')return await this.processTranscription(job,context);
      if(kind==='summarize')return await this.processSummary(job,context);
      throw providerError('INVALID_MEETING_JOB_KIND',`Unsupported meeting job kind: ${kind}`);
    }catch(error){
      await this.repository.failJob(job.id,job.lockToken,error,{retryDelayMs:this.retryDelayMs}).catch(()=>{});
      return{processed:false,jobId:job.id,error:{code:error.code??'MEETING_PROCESSING_FAILED',message:error.message}};
    }
  }

  async processTranscription(job,context){
    if(!context.storageKey)throw providerError('RECORDING_STORAGE_KEY_MISSING','Recording storage key is missing');
    const head=await this.objectStore.head(context.storageKey);
    if(!head?.exists)throw providerError('RECORDING_OBJECT_MISSING','Recording object does not exist in object storage');
    if(Number(head.sizeBytes)===0)throw providerError('RECORDING_OBJECT_EMPTY','Recording object is empty');
    const body=await this.objectStore.get(context.storageKey);
    if(!body?.length)throw providerError('RECORDING_OBJECT_EMPTY','Recording object is empty');
    const sourceSha256=createHash('sha256').update(body).digest('hex');
    const result=await this.transcriptionProvider.transcribe({
      body,
      storageKey:context.storageKey,
      callId:context.callId,
      recordingId:context.recordingId,
      providerRecordingId:context.providerRecordingId,
      workspaceId:context.workspaceId,
      organizationId:context.organizationId,
    });
    if(!Array.isArray(result?.segments)||!result.segments.length)throw providerError('TRANSCRIPT_EMPTY','Transcription provider returned no transcript segments');
    const completed=await this.repository.completeTranscription(job.id,job.lockToken,{
      segments:result.segments,
      language:result.language??null,
      provider:result.provider??this.transcriptionProvider.status?.().provider??null,
      model:result.model??null,
      sourceSha256,
    });
    if(!completed)throw providerError('TRANSCRIPTION_COMMIT_REJECTED','Transcription result could not be committed');
    return{processed:true,kind:'transcribe',jobId:job.id,runId:context.runId,segmentCount:result.segments.length,sourceSha256};
  }

  async processSummary(job,context){
    const meeting=await this.repository.getMeeting({workspaceId:context.workspaceId},context.callId);
    if(!meeting?.run||!Array.isArray(meeting.segments)||!meeting.segments.length)throw providerError('TRANSCRIPT_NOT_READY','Transcript is not ready for summarization');
    const result=await this.summaryProvider.summarize({
      callId:context.callId,
      recordingId:context.recordingId,
      run:meeting.run,
      segments:meeting.segments,
      workspaceId:context.workspaceId,
      organizationId:context.organizationId,
    });
    if(!result||typeof result.overview!=='string')throw providerError('SUMMARY_INVALID','Meeting summary provider returned an invalid result');
    const completed=await this.repository.completeSummary(job.id,job.lockToken,{
      overview:result.overview,
      summaryJson:result.summaryJson??{},
      proposals:Array.isArray(result.proposals)?result.proposals:[],
      provider:result.provider??this.summaryProvider.status?.().provider??null,
      model:result.model??null,
    });
    if(!completed)throw providerError('SUMMARY_COMMIT_REJECTED','Meeting summary could not be committed');
    const committed=await this.repository.getMeeting({workspaceId:context.workspaceId},context.callId);
    const proposalCount=Array.isArray(committed?.proposals)?committed.proposals.length:0;
    if(this.onReviewReady){
      try{
        await this.onReviewReady({
          organizationId:context.organizationId,
          workspaceId:context.workspaceId,
          callId:context.callId,
          recordingId:context.recordingId,
          runId:context.runId,
          proposalCount,
          overview:committed?.run?.summaryOverview??result.overview,
        });
      }catch(error){console.error('meeting review projection failed',error)}
    }
    return{processed:true,kind:'summarize',jobId:job.id,runId:context.runId,proposalCount};
  }
}

export function createMeetingProcessor(options={}){return new MeetingProcessor(options)}
