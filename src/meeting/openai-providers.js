const DEFAULT_BASE_URL='https://api.openai.com/v1';
const DEFAULT_TRANSCRIPTION_MODEL='gpt-4o-transcribe-diarize';
const DEFAULT_SUMMARY_MODEL='gpt-5.6';

function providerError(code,message,statusCode=502,details=null){
  const error=new Error(message);
  error.code=code;
  error.statusCode=statusCode;
  if(details)error.details=details;
  return error;
}

function parseBoolean(value,defaultValue=false){
  if(value==null||value==='')return defaultValue;
  return ['1','true','yes','on'].includes(String(value).toLowerCase());
}

function extensionFor(storageKey=''){
  const match=String(storageKey).toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return match?.[1]??'mp4';
}

function contentTypeFor(storageKey=''){
  const ext=extensionFor(storageKey);
  return ({
    mp4:'video/mp4',m4a:'audio/mp4',mp3:'audio/mpeg',mpeg:'audio/mpeg',mpga:'audio/mpeg',
    wav:'audio/wav',webm:'audio/webm',ogg:'audio/ogg',flac:'audio/flac',
  })[ext]??'application/octet-stream';
}

function filenameFor(storageKey=''){
  const ext=extensionFor(storageKey);
  return `meeting.${ext}`;
}

function timeoutSignal(ms){
  const value=Math.max(Number(ms)||120000,1000);
  if(typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function')return AbortSignal.timeout(value);
  return undefined;
}

function requestId(response){return response?.headers?.get?.('x-request-id')??response?.headers?.get?.('request-id')??null}

async function responseError(response){
  const payload=await response.json().catch(()=>null);
  const message=payload?.error?.message||payload?.message||`Provider request failed with HTTP ${response.status}`;
  return {
    message,status:response.status,type:payload?.error?.type??null,providerCode:payload?.error?.code??null,
    requestId:requestId(response),
  };
}

function outputText(payload){
  if(typeof payload?.output_text==='string'&&payload.output_text.trim())return payload.output_text;
  for(const item of payload?.output??[]){
    if(item?.type!=='message')continue;
    for(const content of item.content??[]){
      if(content?.type==='output_text'&&typeof content.text==='string'&&content.text.trim())return content.text;
    }
  }
  return null;
}

function timecode(ms){
  const total=Math.max(0,Math.round(Number(ms)||0));
  const hours=Math.floor(total/3600000);
  const minutes=Math.floor((total%3600000)/60000);
  const seconds=Math.floor((total%60000)/1000);
  const millis=total%1000;
  return `${hours?`${String(hours).padStart(2,'0')}:`:''}${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}.${String(millis).padStart(3,'0')}`;
}

const summarySchema={
  type:'object',
  additionalProperties:false,
  properties:{
    overview:{type:'string'},
    proposals:{
      type:'array',
      items:{
        type:'object',
        additionalProperties:false,
        properties:{
          proposalType:{type:'string',enum:['decision','action','risk','open_question']},
          title:{type:'string'},
          body:{type:['string','null']},
          proposedOwnerId:{type:['string','null']},
          proposedDueAt:{type:['string','null']},
          confidence:{type:['number','null'],minimum:0,maximum:1},
          sourceSegmentIds:{type:'array',items:{type:'string'},minItems:1},
        },
        required:['proposalType','title','body','proposedOwnerId','proposedDueAt','confidence','sourceSegmentIds'],
      },
    },
  },
  required:['overview','proposals'],
};

export class OpenAITranscriptionProvider{
  constructor({apiKey,baseUrl=DEFAULT_BASE_URL,model=DEFAULT_TRANSCRIPTION_MODEL,language=null,fetchImpl=globalThis.fetch,timeoutMs=180000}={}){
    this.apiKey=apiKey??null;
    this.baseUrl=String(baseUrl||DEFAULT_BASE_URL).replace(/\/$/,'');
    this.model=model||DEFAULT_TRANSCRIPTION_MODEL;
    this.language=language||null;
    this.fetchImpl=fetchImpl;
    this.timeoutMs=timeoutMs;
  }

  status(){
    return{
      provider:'openai',
      enabled:Boolean(this.apiKey&&this.fetchImpl),
      model:this.model,
      diarization:true,
      reason:this.apiKey?null:'OPENAI_API_KEY is not configured',
    };
  }

  async transcribe({body,storageKey}){
    if(!this.status().enabled)throw providerError('TRANSCRIPTION_PROVIDER_UNAVAILABLE','OpenAI transcription provider is not configured',503);
    if(!body?.length)throw providerError('TRANSCRIPTION_INPUT_EMPTY','Recording bytes are empty',400);
    const form=new FormData();
    form.set('file',new Blob([body],{type:contentTypeFor(storageKey)}),filenameFor(storageKey));
    form.set('model',this.model);
    form.set('response_format','diarized_json');
    form.set('chunking_strategy','auto');
    if(this.language)form.set('language',this.language);
    const response=await this.fetchImpl(`${this.baseUrl}/audio/transcriptions`,{
      method:'POST',
      headers:{authorization:`Bearer ${this.apiKey}`},
      body:form,
      signal:timeoutSignal(this.timeoutMs),
    });
    if(!response.ok){
      const details=await responseError(response);
      throw providerError('OPENAI_TRANSCRIPTION_FAILED',details.message,response.status>=500?502:400,details);
    }
    const payload=await response.json();
    const segments=(payload?.segments??[]).map((segment,index)=>({
      startMs:Math.max(0,Math.round(Number(segment.start??0)*1000)),
      endMs:Math.max(0,Math.round(Number(segment.end??segment.start??0)*1000)),
      speakerUserId:null,
      speakerLabel:segment.speaker==null?null:String(segment.speaker),
      text:String(segment.text??'').trim(),
      confidence:null,
      language:payload?.language??payload?.languages?.[0]?.code??null,
      providerSegmentId:segment.id==null?String(index):String(segment.id),
    })).filter((segment)=>segment.text&&segment.endMs>=segment.startMs);
    if(!segments.length)throw providerError('OPENAI_TRANSCRIPT_EMPTY','OpenAI returned no diarized transcript segments',502,{requestId:requestId(response),usage:payload?.usage??null});
    return{
      provider:'openai',
      model:this.model,
      requestId:requestId(response),
      language:payload?.language??payload?.languages?.[0]?.code??null,
      segments,
      usage:payload?.usage??null,
    };
  }
}

export class OpenAIMeetingSummaryProvider{
  constructor({apiKey,baseUrl=DEFAULT_BASE_URL,model=DEFAULT_SUMMARY_MODEL,fetchImpl=globalThis.fetch,timeoutMs=180000,reasoningEffort='low'}={}){
    this.apiKey=apiKey??null;
    this.baseUrl=String(baseUrl||DEFAULT_BASE_URL).replace(/\/$/,'');
    this.model=model||DEFAULT_SUMMARY_MODEL;
    this.fetchImpl=fetchImpl;
    this.timeoutMs=timeoutMs;
    this.reasoningEffort=reasoningEffort||'low';
  }

  status(){
    return{
      provider:'openai',
      enabled:Boolean(this.apiKey&&this.fetchImpl),
      model:this.model,
      structuredOutputs:true,
      reason:this.apiKey?null:'OPENAI_API_KEY is not configured',
    };
  }

  async summarize({callId,segments}){
    if(!this.status().enabled)throw providerError('SUMMARY_PROVIDER_UNAVAILABLE','OpenAI meeting summary provider is not configured',503);
    if(!Array.isArray(segments)||!segments.length)throw providerError('SUMMARY_INPUT_EMPTY','Transcript segments are required',400);
    const transcript=segments.map((segment)=>{
      const speaker=segment.speakerUserId?`user:${segment.speakerUserId}`:(segment.speakerLabel||'speaker');
      return `[${segment.id}] ${timecode(segment.startMs)}-${timecode(segment.endMs)} ${speaker}: ${segment.text}`;
    }).join('\n');
    const instructions=[
      'You produce evidence-grounded meeting intelligence for a corporate work system.',
      'Use only the supplied transcript. Do not invent decisions, actions, owners, deadlines, facts, or speaker identities.',
      'Every proposal must cite one or more exact source segment IDs from the transcript.',
      'An action is only a proposal. It does not assign authority or create a task.',
      'Set proposedOwnerId to null unless the transcript itself contains an exact workspace user UUID, which is unusual.',
      'Set proposedDueAt to null unless the transcript explicitly states an unambiguous absolute date/time. Relative phrases must stay in body text instead.',
      'Keep the overview concise and useful for a manager. Consolidate duplicates.',
      'The output must match the supplied JSON schema exactly.',
    ].join(' ');
    const response=await this.fetchImpl(`${this.baseUrl}/responses`,{
      method:'POST',
      headers:{authorization:`Bearer ${this.apiKey}`,'content-type':'application/json'},
      body:JSON.stringify({
        model:this.model,
        store:false,
        truncation:'disabled',
        reasoning:{effort:this.reasoningEffort},
        instructions,
        input:`Meeting call ID: ${callId}\n\nTranscript with authoritative evidence IDs:\n${transcript}`,
        text:{format:{type:'json_schema',name:'meeting_intelligence',strict:true,schema:summarySchema}},
      }),
      signal:timeoutSignal(this.timeoutMs),
    });
    if(!response.ok){
      const details=await responseError(response);
      throw providerError('OPENAI_SUMMARY_FAILED',details.message,response.status>=500?502:400,details);
    }
    const payload=await response.json();
    const text=outputText(payload);
    if(!text)throw providerError('OPENAI_SUMMARY_EMPTY','OpenAI returned no structured meeting summary',502,{requestId:requestId(response),usage:payload?.usage??null});
    let parsed;
    try{parsed=JSON.parse(text)}catch{throw providerError('OPENAI_SUMMARY_INVALID_JSON','OpenAI returned invalid structured meeting JSON',502,{requestId:requestId(response),usage:payload?.usage??null})}
    if(typeof parsed?.overview!=='string'||!Array.isArray(parsed?.proposals))throw providerError('OPENAI_SUMMARY_INVALID','OpenAI meeting summary did not match the expected contract',502,{requestId:requestId(response),usage:payload?.usage??null});
    return{
      provider:'openai',
      model:this.model,
      requestId:requestId(response),
      overview:parsed.overview,
      summaryJson:{source:'openai_structured_output',responseId:payload?.id??null},
      proposals:parsed.proposals,
      usage:payload?.usage??null,
    };
  }
}

class DisabledConfiguredProvider{
  constructor(kind,provider,reason){this.kind=kind;this.provider=provider;this.reason=reason}
  status(){return{provider:this.provider,enabled:false,reason:this.reason}}
  async transcribe(){throw providerError('TRANSCRIPTION_PROVIDER_UNAVAILABLE',this.reason,503)}
  async summarize(){throw providerError('SUMMARY_PROVIDER_UNAVAILABLE',this.reason,503)}
}

export function createConfiguredMeetingProviders(env=process.env,{fetchImpl=globalThis.fetch}={}){
  const apiKey=env.OPENAI_API_KEY??null;
  const baseUrl=env.OPENAI_BASE_URL||DEFAULT_BASE_URL;
  const transcriptionChoice=String(env.MEETING_TRANSCRIPTION_PROVIDER??'').trim().toLowerCase();
  const summaryChoice=String(env.MEETING_SUMMARY_PROVIDER??'').trim().toLowerCase();
  let transcriptionProvider;
  let summaryProvider;

  if(transcriptionChoice==='openai'){
    transcriptionProvider=new OpenAITranscriptionProvider({
      apiKey,baseUrl,
      model:env.OPENAI_TRANSCRIPTION_MODEL||DEFAULT_TRANSCRIPTION_MODEL,
      language:env.MEETING_TRANSCRIPTION_LANGUAGE||null,
      fetchImpl,
      timeoutMs:Number(env.MEETING_TRANSCRIPTION_TIMEOUT_MS||180000),
    });
  }else if(transcriptionChoice){
    transcriptionProvider=new DisabledConfiguredProvider('transcription',transcriptionChoice,`Unsupported transcription provider: ${transcriptionChoice}`);
  }

  if(summaryChoice==='openai'){
    summaryProvider=new OpenAIMeetingSummaryProvider({
      apiKey,baseUrl,
      model:env.OPENAI_MEETING_SUMMARY_MODEL||DEFAULT_SUMMARY_MODEL,
      fetchImpl,
      timeoutMs:Number(env.MEETING_SUMMARY_TIMEOUT_MS||180000),
      reasoningEffort:env.OPENAI_MEETING_SUMMARY_REASONING||'low',
    });
  }else if(summaryChoice){
    summaryProvider=new DisabledConfiguredProvider('summary',summaryChoice,`Unsupported summary provider: ${summaryChoice}`);
  }

  return{
    transcriptionProvider,
    summaryProvider,
    status:{
      transcription:transcriptionProvider?.status?.()??{provider:'none',enabled:false},
      summary:summaryProvider?.status?.()??{provider:'none',enabled:false},
      openAIConfigured:Boolean(apiKey),
      storeResponses:parseBoolean(env.OPENAI_STORE_RESPONSES,false),
    },
  };
}
