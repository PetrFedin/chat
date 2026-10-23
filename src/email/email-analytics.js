const DAY=24*60*60*1000;

const time=value=>{
  const parsed=Date.parse(value??'');
  return Number.isFinite(parsed)?parsed:null;
};
const percentile=(values,p)=>{
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*p)-1))];
};
const percent=(part,total)=>total?Math.round(part/total*100):null;

/**
 * Current-ACL operational snapshot. It describes communication flow only:
 * unread state, Task completion and email delivery are deliberately separate.
 */
export function summarizeEmailOperations({
  mailboxes=[],threads=[],messages=[],waiting=[],sendIntents=[],
  asOf=new Date().toISOString(),days=30,
}={}){
  const now=time(asOf);
  if(now===null)throw new TypeError('asOf must be a valid date');
  const windowDays=Math.min(90,Math.max(1,Math.trunc(Number(days)||30)));
  const from=now-windowDays*DAY;
  const mailboxById=new Map(mailboxes.map(row=>[row.id,row]));
  const threadById=new Map(threads.map(row=>[row.id,row]));
  const visibleMessages=messages.filter(row=>mailboxById.has(row.mailboxId)&&!row.deletedAt);
  const inWindow=visibleMessages.filter(row=>{
    const occurred=time(row.receivedAt??row.sentAt);
    return occurred!==null&&occurred>=from&&occurred<=now;
  });
  const byThread=new Map();
  for(const message of visibleMessages){
    if(!threadById.has(message.threadId))continue;
    const rows=byThread.get(message.threadId)||[];
    rows.push(message);byThread.set(message.threadId,rows);
  }
  for(const rows of byThread.values())rows.sort((a,b)=>
    (time(a.receivedAt??a.sentAt)??0)-(time(b.receivedAt??b.sentAt)??0));

  const actionable=threads.filter(thread=>{
    if(thread.archived)return false;
    const snoozed=time(thread.snoozedUntil);
    if(snoozed!==null&&snoozed>now)return false;
    const latest=byThread.get(thread.id)?.at(-1);
    return latest?.direction==='incoming';
  });
  const unassignedSharedCount=actionable.filter(thread=>
    mailboxById.get(thread.mailboxId)?.kind==='shared'&&!thread.assignedTo).length;

  const responseMinutes=[];
  let responseCandidates=0,respondedThreads=0;
  for(const thread of threads){
    const rows=(byThread.get(thread.id)||[]).filter(message=>{
      const occurred=time(message.receivedAt??message.sentAt);
      return occurred!==null&&occurred>=from&&occurred<=now;
    });
    const firstInbound=rows.find(message=>message.direction==='incoming');
    if(!firstInbound)continue;
    responseCandidates++;
    const inboundAt=time(firstInbound.receivedAt??firstInbound.sentAt);
    const reply=rows.find(message=>message.direction==='outgoing'&&
      (time(message.sentAt??message.receivedAt)??-Infinity)>=inboundAt);
    if(!reply)continue;
    respondedThreads++;
    const replyAt=time(reply.sentAt??reply.receivedAt);
    responseMinutes.push(Math.max(0,(replyAt-inboundAt)/60000));
  }

  const activeWaiting=waiting.filter(row=>mailboxById.has(row.mailboxId)&&!row.deletedAt&&row.status==='waiting');
  const overdueWaiting=activeWaiting.filter(row=>{
    const due=time(row.dueAt);
    return due!==null&&due<now;
  });
  const sendAttention=sendIntents.filter(row=>mailboxById.has(row.mailboxId)&&
    ['failed','unknown_outcome'].includes(row.status));

  return{
    scope:'current_accessible_mailboxes_only',
    formulaVersion:'v1',
    days:windowDays,asOf:new Date(now).toISOString(),windowStart:new Date(from).toISOString(),
    incomingCount:inWindow.filter(row=>row.direction==='incoming').length,
    needsReplyCount:actionable.length,
    unassignedSharedCount,
    activeWaitingCount:activeWaiting.length,
    overdueWaitingCount:overdueWaiting.length,
    sendAttentionCount:sendAttention.length,
    responseCandidates,
    respondedThreads,
    responseCoveragePercent:percent(respondedThreads,responseCandidates),
    medianFirstResponseMinutes:percentile(responseMinutes,.5),
    p75FirstResponseMinutes:percentile(responseMinutes,.75),
    responseDefinition:'first_outbound_after_first_inbound_within_window',
  };
}
