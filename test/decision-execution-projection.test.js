import test from 'node:test';
import assert from 'node:assert/strict';
import {featuresForPath} from '../src/features/registry.js';
import {summarizeVisibleExecution,buildVisibleExecutionCockpit} from '../src/decisions/execution-projection.js';

const asOf='2026-10-20T12:00:00.000Z';

test('Decision cockpit route requires both canonical feature gates',()=>{
  assert.deepEqual(featuresForPath('/api/v1/meetings/decisions/execution'),['decisions','tasks']);
});

test('Execution metrics classify only currently visible Task references',()=>{
  const tasks=[
    {id:'a',status:'closed',dueAt:'2026-10-01T00:00:00.000Z'},
    {id:'b',status:'blocked',dueAt:'2026-10-18T00:00:00.000Z'},
    {id:'c',status:'in_review',dueAt:'2026-10-25T00:00:00.000Z'},
    {id:'d',status:'cancelled',dueAt:'2026-10-01T00:00:00.000Z'},
    {id:'e',status:'accepted_result'},
  ];
  const result=summarizeVisibleExecution(tasks,{asOf});
  assert.deepEqual(result,{
    scope:'visible_linked_tasks_only',state:'overdue_visible',visibleCount:5,
    closedCount:1,blockedCount:1,reviewCount:2,overdueCount:1,cancelledCount:1,asOf,
  });
  assert.equal('complete' in result,false,'must not imply all canonical tasks have been seen');
  assert.equal('hiddenCount' in result,false,'hidden Task count would leak private relations');
});

test('A lack of accessible Task links is NOT an unassigned Decision assertion',()=>{
  const result=summarizeVisibleExecution([],{asOf});
  assert.equal(result.state,'no_visible_tasks');
  assert.equal(result.visibleCount,0);
  assert.equal(result.scope,'visible_linked_tasks_only');
  assert.equal(summarizeVisibleExecution([{status:'closed'}],{asOf}).state,'all_visible_tasks_closed');
  assert.equal(summarizeVisibleExecution([{status:'blocked'}],{asOf}).state,'blocked_visible');
  assert.equal(summarizeVisibleExecution([{status:'in_review'}],{asOf}).state,'awaiting_review_visible');
  assert.throws(()=>summarizeVisibleExecution([],{asOf:'not a date'}),TypeError);
});

test('Cockpit reauthorizes each accepted Decision, drops revoked rows and does not expose extra fields',async()=>{
  const seen={};const session={workspaceId:'w',userId:'reader'};
  const meeting={
    decisions:async(s,opts)=>{
      assert.equal(s,session);seen.opts=opts;
      return [
        {id:'visible',title:'Visible',acceptedAt:asOf,body:'DO_NOT_COPY_BODY'},
        {id:'revoked',title:'Revoked',acceptedAt:asOf},
        {id:'none',title:'No visible tasks',acceptedAt:asOf},
      ];
    },
  };
  const decisionTasks={list:async(s,id)=>{
    assert.equal(s,session);
    if(id==='revoked')throw Object.assign(new Error('Not found'),{code:'DECISION_NOT_FOUND',statusCode:404});
    if(id==='visible')return [{id:'task',status:'closed',dueAt:null}];
    return [];
  }};
  const report=await buildVisibleExecutionCockpit({
    meeting,decisionTasks,session,query:'priority',limit:900,asOf,
  });
  assert.equal(seen.opts.limit,20);
  assert.equal(seen.opts.query,'priority');
  assert.equal(report.window.complete,false,'pagination must not claim a complete company list');
  assert.equal(report.scope,'accessible_accepted_decisions_and_visible_tasks_only');
  assert.deepEqual(report.items.map(x=>x.decision.id),['visible','none']);
  assert.equal(report.items[0].execution.state,'all_visible_tasks_closed');
  assert.equal(report.items[1].execution.state,'no_visible_tasks');
  assert.equal(JSON.stringify(report).includes('DO_NOT_COPY_BODY'),false);
});

test('Cockpit fails closed when authority unavailable or an unexpected lookup fails',async()=>{
  await assert.rejects(
    buildVisibleExecutionCockpit({meeting:null,decisionTasks:null,session:{}}),
    {code:'DECISION_EXECUTION_UNAVAILABLE',statusCode:503},
  );
  await assert.rejects(
    buildVisibleExecutionCockpit({
      meeting:{decisions:async()=>[{id:'v',title:'Visible'}]},
      decisionTasks:{list:async()=>{throw new Error('DB temporarily unavailable')}},
      session:{},
    }),
    /DB temporarily unavailable/,
  );
});
