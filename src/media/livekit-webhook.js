import { createHash } from 'node:crypto';
import { WebhookReceiver } from 'livekit-server-sdk';

export class DisabledLiveKitWebhookReceiver {
  status(){return{provider:'livekit',enabled:false,reason:'LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required'}}
  async receive(){const error=new Error('LiveKit webhook verification is not configured');error.code='LIVEKIT_WEBHOOK_UNAVAILABLE';error.statusCode=503;throw error}
}

export class LiveKitWebhookReceiver {
  constructor(apiKey,apiSecret){this.receiver=new WebhookReceiver(apiKey,apiSecret)}
  status(){return{provider:'livekit',enabled:true}}
  async receive(rawBody,authorization){
    try{return await this.receiver.receive(rawBody,authorization)}
    catch(error){const wrapped=new Error('Invalid LiveKit webhook signature');wrapped.code='INVALID_WEBHOOK_SIGNATURE';wrapped.statusCode=401;wrapped.cause=error;throw wrapped}
  }
}

export function createLiveKitWebhookReceiver(env=process.env){
  if(!env.LIVEKIT_API_KEY||!env.LIVEKIT_API_SECRET)return new DisabledLiveKitWebhookReceiver();
  return new LiveKitWebhookReceiver(env.LIVEKIT_API_KEY,env.LIVEKIT_API_SECRET);
}

export function liveKitEventId(event,rawBody){
  const provided=String(event?.id??'').trim();
  if(provided)return provided;
  return createHash('sha256').update(rawBody).digest('hex');
}

export function normalizeLiveKitEgress(event){
  const info=event?.egressInfo??event?.egress_info??null;
  if(!info)return null;
  const providerRecordingId=String(info.egressId??info.egress_id??'').trim();
  if(!providerRecordingId)return null;
  const errorText=String(info.error??'').trim();
  return{
    providerRecordingId,
    success:!errorText,
    error:errorText||null,
    status:info.status??null,
    roomName:info.roomName??info.room_name??null,
    startedAt:info.startedAt??info.started_at??null,
    endedAt:info.endedAt??info.ended_at??null,
  };
}
