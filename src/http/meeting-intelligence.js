import { Permission, requirePermission } from '../rbac.js';
import { json, readJson } from './helpers.js';
import { liveKitEventId, normalizeLiveKitEgress } from '../media/livekit-webhook.js';

const UUID='([0-9a-f-]+)';

function notFound(message='Meeting not found'){return Object.assign(new Error(message),{code:'NOT_FOUND',statusCode:404})}

async function readRaw(req,maxBytes=1024*1024){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw Object.assign(new Error('Webhook payload too large'),{code:'PAYLOAD_TOO_LARGE',statusCode:413});chunks.push(chunk)}
  return Buffer.concat(chunks).toString('utf8');
}

async function accessibleMeetingCall(ctx,session,callId){
  const call=await ctx.calls.get(session,callId);
  if(!call||!(await ctx.store.canAccessConversation(session,call.conversationId)))throw notFound();
  return call;
}

export function createMeetingIntelligenceHandler(){
  return async function handleMeetingIntelligence(req,res,ctx,path,method){
    const{store,calls,meeting,requireSession,hub,liveKitWebhook}=ctx;

    if(path==='/api/v1/media/livekit/webhook'&&method==='POST'){
      const raw=await readRaw(req);
      const event=await liveKitWebhook.receive(raw,req.headers.authorization??req.headers.authorize);
      const providerEventId=liveKitEventId(event,raw),eventType=String(event.event??'unknown');
      const recorded=await meeting.recordWebhook({provider:'livekit',providerEventId,eventType,payload:JSON.parse(raw)});
      if(!recorded.inserted)return json(res,200,{ok:true,duplicate:true});
      try{
        if(eventType==='egress_ended'){
          const egress=normalizeLiveKitEgress(event);
          if(!egress){await meeting.finishWebhook('livekit',providerEventId,{status:'ignored'});return json(res,200,{ok:true,ignored:true})}
          const result=await meeting.reconcileEgress(egress.providerRecordingId,{success:egress.success,error:egress.error});
          await meeting.finishWebhook('livekit',providerEventId,{status:result?'processed':'ignored'});
          if(result?.run){hub.broadcastWorkspace(result.run.workspaceId,'meeting.intelligence.queued',{callId:result.run.callId,runId:result.run.id,recordingId:result.run.recordingId})}
          return json(res,200,{ok:true,matched:Boolean(result)});
        }
        await meeting.finishWebhook('livekit',providerEventId,{status:'ignored'});
        return json(res,200,{ok:true,ignored:true});
      }catch(error){await meeting.finishWebhook('livekit',providerEventId,{status:'failed',error:error.message}).catch(()=>{});throw error}
    }

    let match=path.match(new RegExp(`^/api/v1/calls/${UUID}/meeting$`,'i'));
    if(match&&method==='GET'){
      const session=await requireSession(req),call=await accessibleMeetingCall(ctx,session,match[1]);
      const intelligence=await meeting.getMeeting(session,call.id);
      json(res,200,{call,intelligence,processing:{webhook:liveKitWebhook.status()}});
      return true;
    }

    match=path.match(new RegExp(`^/api/v1/meeting-proposals/${UUID}/accept$`,'i'));
    if(match&&method==='POST'){
      const session=await requireSession(req);requirePermission(session.role,Permission.AI_USE);
      const proposal=await meeting.getProposal?.(session,match[1]);
      if(!proposal)throw notFound('Meeting proposal not found');
      if(proposal.proposalType==='action')requirePermission(session.role,Permission.TASK_CREATE);
      const body=await readJson(req).catch(()=>({}));
      const result=await meeting.acceptProposal(session,proposal.id,{ownerId:body.ownerId??null,promisedAt:body.promisedAt??null,acceptorId:body.acceptorId??null});
      if(!result)throw Object.assign(new Error('Proposal is no longer pending'),{code:'PROPOSAL_ALREADY_RESOLVED',statusCode:409});
      if(result.confirmedTaskDraft){
        const task=await store.createTask(session,result.confirmedTaskDraft);
        await meeting.attachCommitment(session,proposal.id,task.id);
        result.task=task;
      }
      if(result.task)hub.broadcastUsers(session.workspaceId,await store.conversationAudience(session,(await calls.get(session,(await meeting.getMeeting(session,(result.callId??''))).run?.callId||'')).catch(()=>[])??[],'task.created',result.task);
      hub.broadcastWorkspace(session.workspaceId,'meeting.proposal.accepted',{proposalId:proposal.id,task:result.task??null});
      json(res,200,result);
      return true;
    }

    match=path.match(new RegExp(`^/api/v1/meeting-proposals/${UUID}/reject$`,'i'));
    if(match&&method==='POST'){
      const session=await requireSession(req);requirePermission(session.role,Permission.AI_USE);
      const proposal=await meeting.rejectProposal(session,match[1]);
      if(!proposal)throw notFound('Pending meeting proposal not found');
      hub.broadcastWorkspace(session.workspaceId,'meeting.proposal.rejected',{proposalId:proposal.id});
      json(res,200,{proposal});
      return true;
    }

    return false;
  }
}
