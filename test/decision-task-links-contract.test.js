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
