import test from 'node:test';
import assert from 'node:assert/strict';
import { MeetingWorker, createMeetingWorker } from '../src/meeting/worker.js';

const delay=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

function providerStatus(enabled=true){return{provider:'fixture',enabled,model:'fixture-v1'}}

test('meeting worker remains dormant when providers are not configured',async()=>{
  let calls=0;
  const processor={
    status:()=>({transcription:providerStatus(false),summary:providerStatus(false)}),
    async runOnce(){calls++;return{processed:false,reason:'no_job'}},
  };
  const worker=new MeetingWorker({processor,pollIntervalMs:100,providerWaitMs:100,logger:{error(){},warn(){}}});
  const started=worker.start();
  assert.equal(started.running,false);
  assert.deepEqual(started.activeKinds,[]);
  await delay(130);
  assert.equal(calls,0);
  const stopped=await worker.stop();
  assert.equal(stopped.drained,true);
});

test('successful transcription wakes summary lane without waiting for the long poll interval',async()=>{
  let transcriptCalls=0,summaryCalls=0,summaryReady=false;
  const processor={
    status:()=>({transcription:providerStatus(true),summary:providerStatus(true)}),
    async runOnce(kind){
      if(kind==='transcribe'){
        transcriptCalls++;
        if(transcriptCalls===1){
          await delay(30);
          summaryReady=true;
          return{processed:true,kind:'transcribe'};
        }
        return{processed:false,reason:'no_job'};
      }
      summaryCalls++;
      if(summaryReady&&summaryCalls>=2)return{processed:true,kind:'summarize'};
      return{processed:false,reason:'no_job'};
    },
  };
  const worker=new MeetingWorker({processor,pollIntervalMs:10000,providerWaitMs:10000,shutdownTimeoutMs:500,logger:{error(){},warn(){}}});
  worker.start();
  const startedAt=Date.now();
  while(worker.status().lanes.summarize.processed<1&&Date.now()-startedAt<1000)await delay(10);
  assert.equal(worker.status().lanes.transcribe.processed,1);
  assert.equal(worker.status().lanes.summarize.processed,1);
  assert.ok(Date.now()-startedAt<1000,'summary lane should be kicked instead of waiting 10 seconds');
  assert.equal((await worker.stop()).drained,true);
});

test('timed-out shutdown invalidates the worker generation so a late job cannot create a zombie loop',async()=>{
  let calls=0,release;
  const gate=new Promise((resolve)=>{release=resolve});
  const processor={
    status:()=>({transcription:providerStatus(true),summary:providerStatus(false)}),
    async runOnce(){calls++;await gate;return{processed:true,kind:'transcribe'}},
  };
  const worker=new MeetingWorker({processor,pollIntervalMs:100,shutdownTimeoutMs:100,logger:{error(){},warn(){}}});
  worker.start();
  while(calls===0)await delay(5);
  const stopped=await worker.stop({timeoutMs:100});
  assert.equal(stopped.drained,false);
  release();
  await delay(180);
  assert.equal(calls,1,'late completion from an invalidated generation must not continue polling');
  assert.equal(worker.status().running,false);
});

test('worker environment configuration is bounded and explicit',()=>{
  const processor={status:()=>({transcription:providerStatus(true),summary:providerStatus(false)}),runOnce:async()=>({processed:false,reason:'no_job'})};
  const worker=createMeetingWorker(processor,{
    MEETING_WORKER_ENABLED:'false',
    MEETING_WORKER_POLL_MS:'5',
    MEETING_WORKER_PROVIDER_WAIT_MS:'9999999',
    MEETING_WORKER_SHUTDOWN_MS:'1',
  },{logger:{error(){},warn(){}}});
  const status=worker.start();
  assert.equal(status.configured,false);
  assert.equal(status.pollIntervalMs,100);
  assert.equal(worker.providerWaitMs,600000);
  assert.equal(worker.shutdownTimeoutMs,100);
});
