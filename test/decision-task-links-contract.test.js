import test from 'node:test';
import assert from 'node:assert/strict';
import {featuresForPath} from '../src/features/registry.js';
import {createDecisionTaskLinks} from '../src/decisions/decision-task-links.js';

test('Decision Task relation routes require both canonical features',()=>{
  const id='00000000-0000-4000-8000-000000000001';
  assert.deepEqual(featuresForPath('/api/v1/meetings/decisions/'+id+'/tasks'),['decisions','tasks']);
  assert.deepEqual(featuresForPath('/api/v1/meetings/decisions/'+id+'/tasks/'+id),['decisions','tasks']);
});

test('Decision Task references must fail closed without persistent authorities',()=>{
  const model=createDecisionTaskLinks({pool:null,store:null,meeting:null});
  assert.equal(model.enabled,false);
  assert.throws(()=>model.list({},'anything'),error=>
    error.code==='DECISION_TASKS_UNAVAILABLE' && error.statusCode===503);
  assert.throws(()=>model.link({},'anything','anything','reason'),error=>
    error.code==='DECISION_TASKS_UNAVAILABLE');
});

test('Decision Task projection retains the canonical promisedAt deadline',async()=>{
  const decisionId='00000000-0000-4000-8000-000000000001';
  const taskId='00000000-0000-4000-8000-000000000002';
  const promisedAt='2026-12-15T18:00:00.000Z';
  const model=createDecisionTaskLinks({
    pool:{query:async()=>({rows:[{taskId,linkedBy:'owner',linkedAt:promisedAt,reason:'Delivery'}]})},
    store:{getTask:async()=>({id:taskId,title:'Canonical task',status:'accepted',
      promisedAt,priority:'high',ownerId:'owner'})},
    meeting:{getDecision:async()=>({id:decisionId})},
  });
  const result=await model.list({workspaceId:'test'},decisionId);
  assert.equal(result.length,1);
  assert.equal(result[0].id,taskId);
  assert.equal(result[0].dueAt,promisedAt);
  assert.equal(result[0].priority,'high');
});
