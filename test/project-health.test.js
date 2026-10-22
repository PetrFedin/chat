import test from 'node:test';
import assert from 'node:assert/strict';
import { computeProjectHealth } from '../src/project/project-health.js';

const asOf='2026-10-22T12:00:00.000Z';

test('project health is a transparent bounded signal over visible active tasks',()=>{
  const health=computeProjectHealth([
    {status:'in_progress',promisedAt:'2026-10-20T12:00:00.000Z'},
    {status:'blocked',promisedAt:'2026-10-30T12:00:00.000Z'},
    {status:'in_progress',promisedAt:'2026-10-25T12:00:00.000Z',forecastAt:'2026-10-27T12:00:00.000Z'},
    {status:'in_review',evidenceCount:0},
    {status:'cancelled',promisedAt:'2026-10-01T12:00:00.000Z'},
  ],{asOf,projectTargetAt:'2026-11-30T00:00:00.000Z'});
  assert.equal(health.scope,'visible_active_tasks_only');
  assert.equal(health.formulaVersion,'v1');
  assert.equal(health.score,78);
  assert.equal(health.band,'watch');
  assert.equal(health.activeCount,4);
  assert.equal(health.overdueRate,25);
  assert.equal(health.constraintRate,25);
  assert.equal(health.forecastRiskRate,25);
  assert.equal(health.unscheduledRate,25);
  assert.equal(health.reviewEvidenceGapRate,25);
  assert.equal(health.scheduleCoverage,75);
  assert.deepEqual(health.weights,{overdue:30,constraint:25,forecast:20,unscheduled:10,reviewEvidenceGap:5,projectTargetRisk:10});
});

test('project target overrun is explicit and never presented as probability',()=>{
  const health=computeProjectHealth([
    {status:'in_progress',promisedAt:'2026-10-25T00:00:00.000Z',forecastAt:'2026-11-10T00:00:00.000Z'},
  ],{asOf,projectTargetAt:'2026-11-01T00:00:00.000Z'});
  assert.equal(health.projectTargetRisk,true);
  assert.equal(health.score,70);
  assert.equal(health.band,'watch');
  assert.equal('probability' in health,false);
});

test('completed-only and empty visible scopes stay distinguishable',()=>{
  const complete=computeProjectHealth([{status:'closed'}],{asOf});
  assert.equal(complete.score,100);
  assert.equal(complete.band,'stable');
  const empty=computeProjectHealth([],{asOf});
  assert.equal(empty.score,null);
  assert.equal(empty.band,'empty');
  assert.throws(()=>computeProjectHealth([],{asOf:'not-a-date'}),TypeError);
});


test('accepted result remains inside the active project scope until canonical closure',()=>{
  const health=computeProjectHealth([
    {status:'accepted_result',promisedAt:'2026-10-30T00:00:00.000Z'},
    {status:'closed',promisedAt:'2026-10-20T00:00:00.000Z'},
  ],{asOf});
  assert.equal(health.visibleCount,2);
  assert.equal(health.activeCount,1);
  assert.equal(health.score,100);
});
