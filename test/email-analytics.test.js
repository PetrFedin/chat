import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEmailOperations } from '../src/email/email-analytics.js';

const asOf='2026-10-22T12:00:00.000Z';
const p='11111111-1111-4111-8111-111111111111';
const s='22222222-2222-4222-8222-222222222222';

test('communication operations uses visible mail only and keeps reply state separate from read/task state',()=>{
  const report=summarizeEmailOperations({
    asOf,days:30,
    mailboxes:[{id:p,kind:'personal'},{id:s,kind:'shared'}],
    threads:[
      {id:'t1',mailboxId:s,assignedTo:null,archived:false},
      {id:'t2',mailboxId:p,assignedTo:null,archived:false},
      {id:'t3',mailboxId:s,assignedTo:null,archived:true},
      {id:'t4',mailboxId:s,assignedTo:'u',archived:false,snoozedUntil:'2026-10-23T12:00:00.000Z'},
    ],
    messages:[
      {id:'1',threadId:'t1',mailboxId:s,direction:'incoming',receivedAt:'2026-10-21T09:00:00.000Z'},
      {id:'2',threadId:'t1',mailboxId:s,direction:'outgoing',sentAt:'2026-10-21T09:30:00.000Z'},
      {id:'3',threadId:'t1',mailboxId:s,direction:'incoming',receivedAt:'2026-10-21T11:00:00.000Z'},
      {id:'4',threadId:'t2',mailboxId:p,direction:'incoming',receivedAt:'2026-10-20T10:00:00.000Z'},
      {id:'5',threadId:'t3',mailboxId:s,direction:'incoming',receivedAt:'2026-10-19T10:00:00.000Z'},
      {id:'6',threadId:'t4',mailboxId:s,direction:'incoming',receivedAt:'2026-10-18T10:00:00.000Z'},
      {id:'hidden',threadId:'x',mailboxId:'33333333-3333-4333-8333-333333333333',direction:'incoming',receivedAt:'2026-10-18T10:00:00.000Z'},
    ],
    waiting:[
      {mailboxId:s,status:'waiting',dueAt:'2026-10-21T12:00:00.000Z'},
      {mailboxId:s,status:'waiting',dueAt:'2026-10-24T12:00:00.000Z'},
      {mailboxId:p,status:'answered',dueAt:'2026-10-20T12:00:00.000Z'},
    ],
    sendIntents:[
      {mailboxId:s,status:'failed'},
      {mailboxId:p,status:'unknown_outcome'},
      {mailboxId:s,status:'provider_accepted'},
    ],
  });
  assert.equal(report.scope,'current_accessible_mailboxes_only');
  assert.equal(report.formulaVersion,'v1');
  assert.equal(report.incomingCount,5);
  assert.equal(report.needsReplyCount,2);
  assert.equal(report.unassignedSharedCount,1);
  assert.equal(report.activeWaitingCount,2);
  assert.equal(report.overdueWaitingCount,1);
  assert.equal(report.sendAttentionCount,2);
  assert.equal(report.responseCandidates,4);
  assert.equal(report.respondedThreads,1);
  assert.equal(report.responseCoveragePercent,25);
  assert.equal(report.medianFirstResponseMinutes,30);
  assert.equal(report.p75FirstResponseMinutes,30);
});

test('communication analytics makes empty response samples explicit',()=>{
  const report=summarizeEmailOperations({asOf,mailboxes:[],threads:[],messages:[],waiting:[],sendIntents:[]});
  assert.equal(report.responseCoveragePercent,null);
  assert.equal(report.medianFirstResponseMinutes,null);
  assert.equal(report.p75FirstResponseMinutes,null);
  assert.equal(report.needsReplyCount,0);
  assert.throws(()=>summarizeEmailOperations({asOf:'invalid'}),TypeError);
});
