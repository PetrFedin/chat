export function createMeetingReviewProjector({store,calls,hub=null,notifyUsers=null}={}){
  if(!store||!calls)throw new Error('Meeting review projector requires store and calls');
  return async function projectMeetingReviewReady(value){
    const systemSession={workspaceId:value.workspaceId,organizationId:value.organizationId};
    const call=await calls.get(systemSession,value.callId);
    if(!call)return {projected:false,reason:'call_not_found'};
    const participantIds=[...new Set((call.participants??[]).map((participant)=>participant.userId).filter(Boolean))];
    const audience=participantIds.length?participantIds:await store.conversationAudience(systemSession,call.conversationId);
    const body=String(value.overview??'').trim()||'Проверьте решения, действия и источники в стенограмме.';
    const title=`Итоги встречи готовы${call.title?`: ${call.title}`:''}`;
    let created=0;
    for(const userId of audience){
      const notificationValue={
        organizationId:value.organizationId,
        workspaceId:value.workspaceId,
        recipientUserId:userId,
        sourceEventId:value.runId,
        dedupeKey:`meeting.review_ready:${value.runId}:${userId}`,
        type:'meeting.review_ready',
        title,
        body:body.slice(0,1000),
        actorUserId:call.createdBy??null,
        conversationId:call.conversationId,
        url:`/#/meetings/${value.callId}`,
        priority:value.proposalCount>0?'high':'normal',
        metadata:{callId:value.callId,runId:value.runId,proposalCount:value.proposalCount},
      };
      const notification=typeof store.insertNotification==='function'
        ?await store.insertNotification(notificationValue)
        :store.putNotification?.(notificationValue)??null;
      if(notification){
        created++;
        hub?.broadcastUsers?.(value.workspaceId,[userId],'notification.created',notification);
      }
    }
    if(notifyUsers&&audience.length){
      await notifyUsers(value.workspaceId,audience,{title,body:body.slice(0,180),url:`/#/meetings/${value.callId}`});
    }
    return {projected:true,audienceCount:audience.length,createdNotifications:created};
  };
}
