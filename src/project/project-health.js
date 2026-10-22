const ACTIVE_TASK=new Set(['proposed','accepted','scheduled','in_progress','blocked','in_review','deferred','clarify','inbox']);
const DROPPED_TASK=new Set(['cancelled','rejected']);

const finiteDate=value=>{
  const parsed=Date.parse(value??'');
  return Number.isFinite(parsed)?parsed:null;
};
const pct=(count,total)=>total?Math.round(count/total*100):0;
const clamp=value=>Math.max(0,Math.min(100,Math.round(value)));

export function computeProjectHealth(tasks=[],{projectTargetAt=null,asOf=new Date().toISOString()}={}){
  if(!Array.isArray(tasks))throw new TypeError('tasks must be an array');
  const now=finiteDate(asOf);
  if(now===null)throw new TypeError('asOf must be a valid date');

  const visible=tasks.filter(task=>task&&!DROPPED_TASK.has(task.status));
  const active=visible.filter(task=>ACTIVE_TASK.has(task.status));
  const overdue=active.filter(task=>{
    const due=finiteDate(task.promisedAt);
    return due!==null&&due<now;
  });
  const constrained=active.filter(task=>task.status==='blocked'||Number(task.blockedBy||0)>0);
  const forecastRisk=active.filter(task=>{
    const forecast=finiteDate(task.forecastAt),promise=finiteDate(task.promisedAt);
    return forecast!==null&&promise!==null&&forecast>promise;
  });
  const unscheduled=active.filter(task=>finiteDate(task.promisedAt)===null);
  const reviewEvidenceGap=active.filter(task=>task.status==='in_review'&&Number(task.evidenceCount||0)===0);
  const target=finiteDate(projectTargetAt);
  const projectTargetRisk=target!==null&&active.some(task=>{
    const effective=finiteDate(task.forecastAt)??finiteDate(task.promisedAt);
    return effective!==null&&effective>target;
  });

  const activeCount=active.length;
  const rates={
    overdueRate:pct(overdue.length,activeCount),
    constraintRate:pct(constrained.length,activeCount),
    forecastRiskRate:pct(forecastRisk.length,activeCount),
    unscheduledRate:pct(unscheduled.length,activeCount),
    reviewEvidenceGapRate:pct(reviewEvidenceGap.length,activeCount),
    scheduleCoverage:activeCount?pct(activeCount-unscheduled.length,activeCount):100,
  };
  const weights={overdue:30,constraint:25,forecast:20,unscheduled:10,reviewEvidenceGap:5,projectTargetRisk:10};
  const penalty=activeCount
    ? overdue.length/activeCount*weights.overdue+
      constrained.length/activeCount*weights.constraint+
      forecastRisk.length/activeCount*weights.forecast+
      unscheduled.length/activeCount*weights.unscheduled+
      reviewEvidenceGap.length/activeCount*weights.reviewEvidenceGap+
      (projectTargetRisk?weights.projectTargetRisk:0)
    : 0;
  const score=visible.length?clamp(100-penalty):null;
  const band=score===null?'empty':score>=85?'stable':score>=70?'watch':score>=50?'risk':'critical';

  return{
    scope:'visible_active_tasks_only',
    formulaVersion:'v1',
    score,band,weights,
    visibleCount:visible.length,activeCount,
    overdueCount:overdue.length,constraintCount:constrained.length,
    forecastRiskCount:forecastRisk.length,unscheduledCount:unscheduled.length,
    reviewEvidenceGapCount:reviewEvidenceGap.length,projectTargetRisk,
    ...rates,
    asOf:new Date(now).toISOString(),
  };
}
