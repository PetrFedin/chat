// Read-only projection. It MUST NOT infer that all canonical Task links are visible.
// The Decision and Task authorities continue to own access, state and evidence.
const EXCLUDED_FROM_OVERDUE=new Set(['closed','cancelled','rejected']);

export function summarizeVisibleExecution(tasks,{asOf=new Date().toISOString()}={}){
  const time=Date.parse(asOf);
  if(!Number.isFinite(time))throw new TypeError('Invalid execution snapshot date');
  const visible=Array.isArray(tasks)?tasks:[];
  const count=status=>visible.filter(task=>task.status===status).length;
  const closedCount=count('closed');
  const blockedCount=count('blocked');
  const reviewCount=count('in_review')+count('accepted_result');
  const cancelledCount=count('cancelled')+count('rejected');
  const overdueCount=visible.filter(task=>{
    if(EXCLUDED_FROM_OVERDUE.has(task.status))return false;
    const due=typeof task.dueAt==='string'?Date.parse(task.dueAt):NaN;
    return Number.isFinite(due)&&due<time;
  }).length;
  // A count of zero says only that the viewer cannot see linked Tasks.
  // Never return private link counts or a 'decision complete' assertion.
  let state='in_execution_visible';
  if(!visible.length)state='no_visible_tasks';
  else if(overdueCount)state='overdue_visible';
  else if(blockedCount)state='blocked_visible';
  else if(visible.every(task=>task.status==='closed'))state='all_visible_tasks_closed';
  else if(reviewCount)state='awaiting_review_visible';
  return {
    scope:'visible_linked_tasks_only',state,visibleCount:visible.length,
    closedCount,blockedCount,reviewCount,overdueCount,cancelledCount,asOf,
  };
}
