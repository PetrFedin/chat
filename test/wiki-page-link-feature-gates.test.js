import test from 'node:test';
import assert from 'node:assert/strict';
import {featuresForPath} from '../src/features/registry.js';

test('Page relation endpoints require source and target feature gates',()=>{
  const id='00000000-0000-4000-8000-000000000001';
  const nested='/api/v1/wiki/pages/'+id;
  assert.deepEqual(featuresForPath(nested+'/calendar-meetings'),['wiki','calendar']);
  assert.deepEqual(featuresForPath(nested+'/calendar-meetings/'+id),['wiki','calendar']);
  assert.deepEqual(featuresForPath(nested+'/calls'),['wiki','meetings']);
  assert.deepEqual(featuresForPath(nested+'/calls/'+id),['wiki','meetings']);
  assert.deepEqual(featuresForPath(nested+'/tasks'),['wiki','tasks']);
  assert.deepEqual(featuresForPath(nested+'/projects'),['wiki','projects']);
  assert.deepEqual(featuresForPath(nested+'/decisions'),['wiki','decisions']);
  assert.deepEqual(featuresForPath(nested+'/history'),['wiki']);
});
