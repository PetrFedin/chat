// Deterministic, read-only planning forecast over the tasks the caller may see.
// Durations and finish-to-start lags use CALENDAR DAYS, not working days or
// effort estimates. No Task, Calendar or Project canonical state is modified.
const DAY_MS=86400000;
const failure=(message,code,statusCode=400)=>Object.assign(
  new Error(message),{code,statusCode,expose:true},
);
const idDate=value=>{
  const s=value instanceof Date?value.toISOString().slice(0,10):String(value??'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
  const ms=Date.parse(s+'T00:00:00.000Z');
  if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==s)return null;
  return Math.round(ms/DAY_MS);
};
const formatDay=n=>new Date(n*DAY_MS).toISOString().slice(0,10);

export function analyzeProjectForecast({schedules=[],dependencies=[],targetAt=null,visibleTaskCount=null}={}){
  if(!Array.isArray(schedules)||!Array.isArray(dependencies))
    throw failure('Invalid planning input','PLAN_ANALYSIS_INVALID');
  const targetDay=targetAt==null?null:idDate(targetAt);
  const known=new Map();
  for(const s of schedules){
    const from=idDate(s.plannedStart),to=idDate(s.plannedEnd);
    if(typeof s.taskId!=='string'||!s.taskId||from===null||to===null||to<from||known.has(s.taskId))
      throw failure('Invalid scheduled task','PLAN_ANALYSIS_INVALID');
    known.set(s.taskId,{taskId:s.taskId,start:from,end:to,durationDays:to-from+1});
  }
  const totalVisible=Number.isSafeInteger(visibleTaskCount)&&visibleTaskCount>=known.size
    ?visibleTaskCount:known.size;
  const coverage={visibleScheduledTasks:known.size,visibleUnscheduledTasks:totalVisible-known.size,
    unresolvedDependencies:0,mode:'visible_tasks_only'};
  if(!known.size)return{
    status:'empty',model:'calendar_days_finish_to_start_v1',coverage,
    criticalTaskIds:[],affectedTaskIds:[],tasks:[],forecastFinishAt:null,
    plannedFinishAt:null,targetAt:targetDay===null?null:formatDay(targetDay),
    targetGapDays:null,forecastDelayDays:null,
  };
  const incoming=new Map(),outgoing=new Map(),indeg=new Map();
  for(const key of known.keys()){incoming.set(key,[]);outgoing.set(key,[]);indeg.set(key,0);}
  const uniqueEdges=new Set();
  for(const edge of dependencies){
    const from=edge.predecessorTaskId,to=edge.successorTaskId;
    if(!known.has(from)||!known.has(to)){coverage.unresolvedDependencies++;continue;}
    const lag=edge.lagDays??0;
    if(!Number.isSafeInteger(lag)||lag<0||lag>365||from===to)
      throw failure('Invalid dependency','PLAN_ANALYSIS_INVALID');
    const key=from+'\u0000'+to;
    if(uniqueEdges.has(key))continue;
    uniqueEdges.add(key);
    const item={from,to,lag};
    incoming.get(to).push(item);outgoing.get(from).push(item);
    indeg.set(to,indeg.get(to)+1);
  }
  const ready=[...known.keys()].filter(key=>indeg.get(key)===0).sort();
  const order=[],earliest=new Map();
  while(ready.length){
    const key=ready.shift(),node=known.get(key);
    let begin=node.start;
    for(const link of incoming.get(key)){
      const parent=earliest.get(link.from);
      begin=Math.max(begin,parent.end+link.lag+1);
    }
    earliest.set(key,{start:begin,end:begin+node.durationDays-1});
    order.push(key);
    for(const link of outgoing.get(key)){
      const remaining=indeg.get(link.to)-1;indeg.set(link.to,remaining);
      if(remaining===0){ready.push(link.to);ready.sort();}
    }
  }
  if(order.length!==known.size)return{
    status:'invalid_dependency_cycle',model:'calendar_days_finish_to_start_v1',
    coverage,criticalTaskIds:[],affectedTaskIds:[],tasks:[],
    forecastFinishAt:null,plannedFinishAt:null,
    targetAt:targetDay===null?null:formatDay(targetDay),
    targetGapDays:null,forecastDelayDays:null,
  };
  const plannedFinish=Math.max(...[...known.values()].map(item=>item.end));
  const earliestStart=Math.min(...[...known.values()].map(item=>item.start));
  const finish=Math.max(...[...earliest.values()].map(item=>item.end));
  const latestStart=new Map();
  for(const key of [...order].reverse()){
    const task=known.get(key);
    let lastStart=finish-task.durationDays+1;
    for(const link of outgoing.get(key)){
      const candidate=latestStart.get(link.to)-link.lag-task.durationDays;
      lastStart=Math.min(lastStart,candidate);
    }
    latestStart.set(key,lastStart);
  }
  const tasks=order.map(key=>{
    const source=known.get(key),result=earliest.get(key);
    const float=Math.max(0,latestStart.get(key)-result.start);
    return {
      taskId:key,plannedStart:formatDay(source.start),plannedEnd:formatDay(source.end),
      forecastStart:formatDay(result.start),forecastEnd:formatDay(result.end),
      durationCalendarDays:source.durationDays,floatCalendarDays:float,
      critical:float===0,shiftCalendarDays:result.start-source.start,
    };
  });
  const scopedPartial=coverage.visibleUnscheduledTasks>0||coverage.unresolvedDependencies>0;
  return {
    status:scopedPartial?'partial':'calculated',
    model:'calendar_days_finish_to_start_v1',coverage,
    plannedStartAt:formatDay(earliestStart),plannedFinishAt:formatDay(plannedFinish),
    forecastFinishAt:formatDay(finish),
    forecastDelayDays:Math.max(0,finish-plannedFinish),
    targetAt:targetDay===null?null:formatDay(targetDay),
    targetGapDays:targetDay===null?null:finish-targetDay,
    criticalTaskIds:tasks.filter(t=>t.critical).map(t=>t.taskId),
    affectedTaskIds:tasks.filter(t=>t.shiftCalendarDays>0).map(t=>t.taskId),
    tasks,
  };
}

export function previewProjectShift(plan,{taskId,shiftDays}={}){
  const days=shiftDays;
  if(typeof taskId!=='string'||!Number.isSafeInteger(days)||Math.abs(days)>365)
    throw failure('Shift must be a whole number of calendar days between -365 and 365','PLAN_SHIFT_INVALID');
  const base=analyzeProjectForecast(plan);
  if(!plan?.schedules?.some(s=>s.taskId===taskId))
    throw failure('Scheduled task not found','PROJECT_TASK_NOT_FOUND',404);
  const shifted=plan.schedules.map(s=>s.taskId!==taskId?s:{
    ...s,
    plannedStart:formatDay(idDate(s.plannedStart)+days),
    plannedEnd:formatDay(idDate(s.plannedEnd)+days),
  });
  const scenario=analyzeProjectForecast({...plan,schedules:shifted});
  const before=new Map(base.tasks.map(t=>[t.taskId,t]));
  const changedTasks=scenario.tasks.filter(task=>{
    const old=before.get(task.taskId);
    return old&&(old.forecastStart!==task.forecastStart||old.forecastEnd!==task.forecastEnd);
  }).map(task=>({
    taskId:task.taskId,fromStart:before.get(task.taskId).forecastStart,
    fromEnd:before.get(task.taskId).forecastEnd,toStart:task.forecastStart,toEnd:task.forecastEnd,
  }));
  const original=idDate(base.forecastFinishAt),next=idDate(scenario.forecastFinishAt);
  return{
    kind:'read_only_preview',model:base.model,taskId,shiftDays:days,
    baselineFinishAt:base.forecastFinishAt,scenarioFinishAt:scenario.forecastFinishAt,
    changeInFinishCalendarDays:original===null||next===null?null:next-original,
    baselineTargetGapDays:base.targetGapDays,scenarioTargetGapDays:scenario.targetGapDays,
    coverage:scenario.coverage,changedTasks,
  };
}
