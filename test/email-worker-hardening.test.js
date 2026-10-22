import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEmailWorker } from '../src/email/email-worker.js';
import { createEmailRepository } from '../src/email/email-repository.js';

test('email worker isolates outbox, sync and waiting failures',async()=>{
  const calls=[];
  const email={
    durable:true,
    async processOutbox(){calls.push('outbox');return{processed:1,failedOperations:1,errorCode:'EMAIL_OUTBOX_PARTIAL_FAILURE'};},
    async processSync(){calls.push('sync');throw new Error('provider detail must not leak');},
    async processWaiting(){calls.push('waiting');return{processed:2};},
  };
  const worker=createEmailWorker(email);
  const result=await worker.tick();
  assert.deepEqual(calls.sort(),['outbox','sync','waiting']);
  assert.equal(result.processed,1);
  assert.equal(result.waitingWorkspaces,2);
  assert.equal(result.errorCode,'EMAIL_WORKER_FAILED');
  assert.equal(result.phaseErrors.outbox,'EMAIL_OUTBOX_FAILED');
  assert.equal(result.phaseErrors.sync,'EMAIL_SYNC_FAILED');
  assert.equal(result.phaseErrors.waiting,undefined);
  assert.equal(worker.status().lastError,'EMAIL_WORKER_FAILED');
});

test('a synchronous email phase exception does not pin the worker forever',async()=>{
  let first=true,syncCalls=0;
  const email={
    durable:true,
    processOutbox(){return{processed:0};},
    processSync(){syncCalls++;if(first){first=false;throw new Error('sync failure');}return{processed:1};},
    processWaiting(){return{processed:0};},
  };
  const worker=createEmailWorker(email);
  assert.equal((await worker.tick()).phaseErrors.sync,'EMAIL_SYNC_FAILED');
  const recovered=await worker.tick();
  assert.equal(recovered.syncedMailboxes,1);
  assert.equal(recovered.phaseErrors,undefined);
  assert.equal(syncCalls,2);
});

test('email notification mute keeps selected types and shared-mail focus',async()=>{
  const email=createEmailRepository({demo:true});
  const session={organizationId:randomUUID(),workspaceId:randomUUID(),userId:randomUUID(),role:'owner'};
  const saved=await email.setPreferences(session,{notifications:{
    enabled:false,focus:'assigned',reply:false,assignment:true,waiting:false,sendFailure:true,
  }});
  assert.deepEqual(saved.preferences.notifications,{
    enabled:false,focus:'assigned',reply:false,assignment:true,waiting:false,sendFailure:true,
  });
  const read=await email.getPreferences(session);
  assert.equal(read.preferences.notifications.enabled,false);
  assert.equal(read.preferences.notifications.focus,'assigned');
  assert.equal(read.preferences.notifications.assignment,true);
});
