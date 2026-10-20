// Read-only projection. Decision/Task Authorities own visibility, state and evidence.
// Every number here describes only the linked Tasks accessible to the current viewer.
const NON_ACTIVE=new Set(['closed','cancelled','rejected']);
const DAY_MS=24*60*60*1000;
export const EXECUTION_DUE_SOON_DAYS=7;

const deadlineTime=value=>{
  const ms=value instanceof Date?value.getTime():
    typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(ms)?ms:null;
};

export function summarizeVisibleExecution(tasks,{asOf=new Date().toISOString()}={}){
  const time=Date.parse(asOf);
  if(!Number.isFinite(time))throw new TypeError('Invalid execution snapshot date');
  const visible=Array.isArray(tasks)?tasks:[];
  const count=status=>visible.filter(task=>task.status===status).length;
  const closedCount=count('closed');
  const blockedCount=count('blocked');
  const reviewCount=count('in_review')+count('accepted_result');
  const cancelledCount=count('cancelled')+count('rejected');
  let overdueCount=0,dueSoonCount=0,unscheduledCount=0;
  for(const task of visible){
    if(NON_ACTIVE.has(task.status))continue;
    const due=deadlineTime(task.dueAt);
    if(due===null){unscheduledCount++;continue}
    if(due<time)overdueCount++;
    else if(due<=time+EXECUTION_DUE_SOON_DAYS*DAY_MS)dueSoonCount++;
  }
  // This is an alert category, not a probability, score or full Decision status.
  const riskLevel=overdueCount?'overdue':blockedCount?'blocked':
    dueSoonCount?'due_soon':'none';
  let state='in_execution_visible';
  if(!visible.length)state='no_visible_tasks';
  else if(overdueCount)state='overdue_visible';
  else if(blockedCount)state='blocked_visible';
  else if(visible.every(task=>task.status==='closed'))state='all_visible_tasks_closed';
  else if(reviewCount)state='awaiting_review_visible';
  return{
    scope:'visible_linked_tasks_only',state,visibleCount:visible.length,
    closedCount,blockedCount,reviewCount,overdueCount,cancelledCount,
    // 7 calendar days from this snapshot, including the boundary.
    dueSoonCount,dueSoonDays:EXECUTION_DUE_SOON_DAYS,unscheduledCount,riskLevel,
    asOf,
  };
}

/**
 * Bounded, visibility-filtered report. It cannot certify completion of
 * an entire Decision; invisible links do not appear in counts or metadata.
 */
export async function buildVisibleExecutionCockpit({meeting,decisionTasks,session,query=null,from=null,to=null,limit=20,asOf=new Date().toISOString()}={}){
  if(typeof meeting?.decisions!=='function'||typeof decisionTasks?.list!=='function'){
    throw Object.assign(new Error('Decision Execution authorities unavailable'),{
      code:'DECISION_EXECUTION_UNAVAILABLE',statusCode:503,expose:true,
    });
  }
  const parsed=Number(limit);
  const size=Number.isInteger(parsed)&&parsed>0?Math.min(parsed,20):20;
  const decisions=await meeting.decisions(session,{query,from,to,limit:size});
  const items=[];
  for(const decision of decisions){
    let tasks;
    try{
      // Reauthorizes the accepted Decision and every linked Task at read time.
      tasks=await decisionTasks.list(session,decision.id);
    }catch(error){
      if(error?.code==='DECISION_NOT_FOUND'&&error.statusCode===404)continue;
      throw error;
    }
    items.push({
      decision:{id:decision.id,title:decision.title,acceptedAt:decision.acceptedAt,
        acceptedByName:decision.acceptedByName??null,callTitle:decision.callTitle??null},
      execution:summarizeVisibleExecution(tasks,{asOf}),
    });
  }
  return{
    asOf,scope:'accessible_accepted_decisions_and_visible_tasks_only',
    window:{limit:size,returned:items.length,complete:false},
    items,
  };
}
