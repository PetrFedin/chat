import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';
import { MemoryStore } from '../src/persistence/store.js';

class FakeMediaProvider {
  constructor() { this.started = []; this.stopped = []; }
  status() { return { provider:'livekit', enabled:true, recordingEnabled:true, serverUrl:'wss://media.test' }; }
  async issueJoinCredential({ workspaceId, callId, userId }) {
    return { provider:'livekit', roomName:`room-${callId}`, serverUrl:'wss://media.test', participantToken:`token-${workspaceId}-${userId}` };
  }
  async startRecording({ workspaceId, callId }) {
    const value={recordingId:'70000000-0000-0000-0000-000000000001',providerRecordingId:`egress-${callId}`,storageKey:`recordings/${workspaceId}/${callId}/meeting.mp4`,status:'recording'};
    this.started.push(value); return value;
  }
  async stopRecording(id) { this.stopped.push(id); return { id }; }
}

async function request(base, path, { cookie, method='GET', body }={}) {
  const response=await fetch(`${base}${path}`,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const payload=response.status===204?null:await response.json().catch(()=>null);
  return {response,payload,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}

test('two employees join a call and recording requires consent plus permission', async (t) => {
  const provider=new FakeMediaProvider();
  const app=await createChatServer({store:new MemoryStore(),mediaProvider:provider});
  await new Promise((resolve)=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;

  const owner=await request(base,'/api/v1/auth/register-company',{method:'POST',body:{companyName:'Call Co',ownerName:'Owner',email:'owner@call.test',password:'OwnerPassword42'}});
  assert.equal(owner.response.status,201);
  const ownerCookie=owner.cookie;
  const initial=await request(base,'/api/v1/bootstrap',{cookie:ownerCookie});
  const general=initial.payload.conversations.find((c)=>c.slug==='general');
  assert.ok(general);

  const invitation=await request(base,'/api/v1/invitations',{cookie:ownerCookie,method:'POST',body:{email:'member@call.test',role:'member'}});
  assert.equal(invitation.response.status,201);
  const token=new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const member=await request(base,'/api/v1/invitations/accept',{method:'POST',body:{token,displayName:'Member',password:'MemberPassword42'}});
  assert.equal(member.response.status,201);
  const memberCookie=member.cookie;

  const created=await request(base,`/api/v1/conversations/${general.id}/calls`,{cookie:ownerCookie,method:'POST',body:{mode:'video',title:'Weekly sync'}});
  assert.equal(created.response.status,201);
  const callId=created.payload.call.id;

  const ownerJoin=await request(base,`/api/v1/calls/${callId}/join`,{cookie:ownerCookie,method:'POST',body:{}});
  const memberJoin=await request(base,`/api/v1/calls/${callId}/join`,{cookie:memberCookie,method:'POST',body:{}});
  assert.equal(ownerJoin.response.status,200);
  assert.equal(memberJoin.response.status,200);
  assert.match(ownerJoin.payload.credentials.participantToken,/token-/);

  const ownerConsent=await request(base,`/api/v1/calls/${callId}/recording-consent`,{cookie:ownerCookie,method:'POST',body:{}});
  assert.equal(ownerConsent.payload.consentReady,false);
  const memberConsent=await request(base,`/api/v1/calls/${callId}/recording-consent`,{cookie:memberCookie,method:'POST',body:{}});
  assert.equal(memberConsent.payload.consentReady,true);

  const memberRecord=await request(base,`/api/v1/calls/${callId}/recording/start`,{cookie:memberCookie,method:'POST',body:{}});
  assert.equal(memberRecord.response.status,403);
  const ownerRecord=await request(base,`/api/v1/calls/${callId}/recording/start`,{cookie:ownerCookie,method:'POST',body:{}});
  assert.equal(ownerRecord.response.status,201);
  assert.equal(provider.started.length,1);

  const stopped=await request(base,`/api/v1/calls/${callId}/recording/stop`,{cookie:ownerCookie,method:'POST',body:{}});
  assert.equal(stopped.response.status,200);
  assert.equal(provider.stopped.length,1);

  await request(base,`/api/v1/calls/${callId}/leave`,{cookie:memberCookie,method:'POST',body:{}});
  const ended=await request(base,`/api/v1/calls/${callId}/end`,{cookie:ownerCookie,method:'POST',body:{}});
  assert.equal(ended.response.status,200);
  assert.equal(ended.payload.call.state,'ended');
});
