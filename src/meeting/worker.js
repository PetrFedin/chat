const DEFAULT_POLL_MS=1500;
const DEFAULT_PROVIDER_WAIT_MS=30000;
const DEFAULT_SHUTDOWN_MS=5000;

const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,Math.max(0,Number(ms)||0)));

function boolEnv(value,defaultValue=true){
  if(value==null||value==='')return defaultValue;
  return ['1','true','yes','on'].includes(String(value).toLowerCase());
}

function intEnv(value,fallback,{min=1,max=600000}={}){
  const parsed=Number(value);
  if(!Number.isFinite(parsed))return fallback;
  return Math.min(max,Math.max(min,Math.round(parsed)));
}

function laneState(kind){
  return{
    kind,
    running:false,
    sleeping:false,
    processed:0,
    failures:0,
    noJob:0,
    lastStartedAt:null,
    lastFinishedAt:null,
    lastProcessedAt:null,
    lastResult:null,
    lastError:null,
  };
}

export class MeetingWorker{
  constructor({
    processor,
    enabled=true,
    pollIntervalMs=DEFAULT_POLL_MS,
    providerWaitMs=DEFAULT_PROVIDER_WAIT_MS,
    shutdownTimeoutMs=DEFAULT_SHUTDOWN_MS,
    logger=console,
  }={}){
    if(!processor)throw new Error('Meeting worker requires a processor');
    this.processor=processor;
    this.configuredEnabled=Boolean(enabled);
    this.pollIntervalMs=Math.max(100,Number(pollIntervalMs)||DEFAULT_POLL_MS);
    this.providerWaitMs=Math.max(this.pollIntervalMs,Number(providerWaitMs)||DEFAULT_PROVIDER_WAIT_MS);
    this.shutdownTimeoutMs=Math.max(100,Number(shutdownTimeoutMs)||DEFAULT_SHUTDOWN_MS);
    this.logger=logger;
    this.started=false;
    this.stopping=false;
    this.startedAt=null;
    this.stoppedAt=null;
    this.promises=new Map();
    this.wakers=new Map();
    this.lanes=new Map([
      ['transcribe',laneState('transcribe')],
      ['summarize',laneState('summarize')],
    ]);
  }

  providerStatus(kind){
    const status=this.processor.status?.()??{};
    return kind==='transcribe'?status.transcription:status.summary;
  }

  activeKinds(){
    if(!this.configuredEnabled)return[];
    return['transcribe','summarize'].filter((kind)=>Boolean(this.providerStatus(kind)?.enabled));
  }

  status(){
    const activeKinds=this.activeKinds();
    return{
      configured:this.configuredEnabled,
      running:this.started&&!this.stopping&&activeKinds.length>0,
      stopping:this.stopping,
      startedAt:this.startedAt,
      stoppedAt:this.stoppedAt,
      pollIntervalMs:this.pollIntervalMs,
      activeKinds,
      reason:!this.configuredEnabled?'MEETING_WORKER_ENABLED is disabled':activeKinds.length?'ready':'No enabled meeting processing provider is configured',
      lanes:Object.fromEntries([...this.lanes].map(([kind,state])=>[kind,{...state,provider:this.providerStatus(kind)??null}])),
    };
  }

  start(){
    if(this.started)return this.status();
    this.started=true;
    this.stopping=false;
    this.startedAt=new Date().toISOString();
    this.stoppedAt=null;
    for(const kind of this.activeKinds()){
      const promise=this.runLane(kind).catch((error)=>{
        const state=this.lanes.get(kind);
        state.lastError={code:error?.code??'MEETING_WORKER_CRASH',message:error?.message??String(error)};
        this.logger?.error?.(`meeting ${kind} worker crashed`,error);
      });
      this.promises.set(kind,promise);
    }
    return this.status();
  }

  async wait(kind,ms){
    if(this.stopping)return;
    const state=this.lanes.get(kind);
    state.sleeping=true;
    let wake;
    const wakePromise=new Promise((resolve)=>{wake=resolve});
    this.wakers.set(kind,wake);
    await Promise.race([sleep(ms),wakePromise]);
    if(this.wakers.get(kind)===wake)this.wakers.delete(kind);
    state.sleeping=false;
  }

  kick(kind=null){
    const kinds=kind?[kind]:['transcribe','summarize'];
    for(const value of kinds){
      const wake=this.wakers.get(value);
      if(wake){this.wakers.delete(value);wake()}
    }
  }

  async runLane(kind){
    const state=this.lanes.get(kind);
    state.running=true;
    try{
      while(!this.stopping){
        const provider=this.providerStatus(kind);
        if(!provider?.enabled){
          state.lastResult={processed:false,reason:kind==='transcribe'?'transcription_provider_unavailable':'summary_provider_unavailable'};
          await this.wait(kind,this.providerWaitMs);
          continue;
        }
        state.lastStartedAt=new Date().toISOString();
        let result;
        try{
          result=await this.processor.runOnce(kind);
        }catch(error){
          state.failures++;
          state.lastError={code:error?.code??'MEETING_WORKER_FAILED',message:error?.message??String(error)};
          this.logger?.error?.(`meeting ${kind} worker cycle failed`,error);
          await this.wait(kind,this.pollIntervalMs);
          continue;
        }finally{
          state.lastFinishedAt=new Date().toISOString();
        }
        state.lastResult=result??null;
        if(result?.processed){
          state.processed++;
          state.lastProcessedAt=new Date().toISOString();
          state.lastError=null;
          continue;
        }
        if(result?.error){
          state.failures++;
          state.lastError=result.error;
          await this.wait(kind,this.pollIntervalMs);
          continue;
        }
        if(result?.reason==='no_job'){
          state.noJob++;
          await this.wait(kind,this.pollIntervalMs);
          continue;
        }
        if(String(result?.reason??'').includes('provider_unavailable')){
          await this.wait(kind,this.providerWaitMs);
          continue;
        }
        await this.wait(kind,this.pollIntervalMs);
      }
    }finally{
      state.running=false;
      state.sleeping=false;
      this.wakers.delete(kind);
    }
  }

  async stop({timeoutMs=this.shutdownTimeoutMs}={}){
    if(!this.started){this.stoppedAt??=new Date().toISOString();return{drained:true,...this.status()}}
    this.stopping=true;
    this.kick();
    const pending=[...this.promises.values()];
    let drained=true;
    if(pending.length){
      const marker={timeout:true};
      const result=await Promise.race([
        Promise.allSettled(pending).then(()=>({timeout:false})),
        sleep(Math.max(100,Number(timeoutMs)||this.shutdownTimeoutMs)).then(()=>marker),
      ]);
      drained=!result.timeout;
    }
    this.started=false;
    this.stopping=false;
    this.promises.clear();
    this.stoppedAt=new Date().toISOString();
    return{drained,...this.status()};
  }
}

export function createMeetingWorker(processor,env=process.env,options={}){
  return new MeetingWorker({
    processor,
    enabled:options.enabled??boolEnv(env.MEETING_WORKER_ENABLED,true),
    pollIntervalMs:options.pollIntervalMs??intEnv(env.MEETING_WORKER_POLL_MS,DEFAULT_POLL_MS,{min:100,max:60000}),
    providerWaitMs:options.providerWaitMs??intEnv(env.MEETING_WORKER_PROVIDER_WAIT_MS,DEFAULT_PROVIDER_WAIT_MS,{min:1000,max:600000}),
    shutdownTimeoutMs:options.shutdownTimeoutMs??intEnv(env.MEETING_WORKER_SHUTDOWN_MS,DEFAULT_SHUTDOWN_MS,{min:100,max:60000}),
    logger:options.logger??console,
  });
}
