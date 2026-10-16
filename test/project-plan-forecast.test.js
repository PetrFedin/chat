import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProjectForecast,previewProjectShift } from '../src/project/project-plan-forecast.js';

const s=(taskId,plannedStart,plannedEnd)=>({taskId,plannedStart,plannedEnd});
const edge=(predecessorTaskId,successorTaskId,lagDays=0)=>({predecessorTaskId,successorTaskId,lagDays});

test('critical path respects linked finish-to-start and calendar day lag',()=>{
  const input={schedules:[
    s('design','2026-11-01','2026-11-03'),
    s('build','2026-11-02','2026-11-04'),
    s('qa','2026-11-03','2026-11-05'),
    s('marketing','2026-11-01','2026-11-02'),
  ],dependencies:[edge('design','build',2),edge('build','qa')] ,targetAt:'2026-11-12',visibleTaskCount:4};
  const r=analyzeProjectForecast(input);
  assert.equal(r.status,'calculated');
  assert.equal(r.plannedFinishAt,'2026-11-05');
  assert.equal(r.forecastFinishAt,'2026-11-11');
  assert.equal(r.targetGapDays,-1);
  assert.deepEqual(r.criticalTaskIds,['design','build','qa']);
  assert.equal(r.tasks.find(t=>t.taskId==='build').forecastStart,'2026-11-06');
  assert.equal(r.tasks.find(t=>t.taskId==='marketing').critical,false);
  assert.equal(r.tasks.find(t=>t.taskId==='marketing').floatCalendarDays,9);
});

test('what-if shift previews dependencies without mutating canonical input',()=>{
  const source={schedules:[s('a','2026-11-01','2026-11-02'),s('b','2026-11-03','2026-11-04')],
    dependencies:[edge('a','b')],targetAt:'2026-11-05',visibleTaskCount:2};
  const before=JSON.stringify(source);
  const preview=previewProjectShift(source,{taskId:'a',shiftDays:3});
  assert.equal(preview.kind,'read_only_preview');
  assert.equal(preview.baselineFinishAt,'2026-11-04');
  assert.equal(preview.scenarioFinishAt,'2026-11-07');
  assert.equal(preview.changeInFinishCalendarDays,3);
  assert.ok(preview.changedTasks.some(t=>t.taskId==='b'&&t.toStart==='2026-11-06'));
  assert.equal(JSON.stringify(source),before);
});

test('incomplete visibility never masquerades as an exact delivery forecast',()=>{
  const r=analyzeProjectForecast({schedules:[s('a','2026-11-01','2026-11-02')],
    dependencies:[edge('a','hidden')],visibleTaskCount:3});
  assert.equal(r.status,'partial');
  assert.equal(r.coverage.visibleUnscheduledTasks,2);
  assert.equal(r.coverage.unresolvedDependencies,1);
});

test('cyclic or invalid source data is visibly rejected',()=>{
  const r=analyzeProjectForecast({schedules:[s('a','2026-11-01','2026-11-02'),s('b','2026-11-01','2026-11-02')],
    dependencies:[edge('a','b'),edge('b','a')]});
  assert.equal(r.status,'invalid_dependency_cycle');
  assert.equal(r.forecastFinishAt,null);
  assert.throws(()=>previewProjectShift({schedules:[],dependencies:[]},{taskId:'x',shiftDays:400}),e=>e.code==='PLAN_SHIFT_INVALID');
});
