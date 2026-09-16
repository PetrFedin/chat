import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChatServer } from '../src/server.js';
import { MemoryStore } from '../src/persistence/store.js';

async function request(base, path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers:{ ...(cookie ? { cookie } : {}), ...(body ? { 'content-type':'application/json' } : {}) },
    body:body ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload, cookie:response.headers.get('set-cookie')?.split(';')[0] };
}

async function invite(base, ownerCookie, email, displayName) {
  const invitation = await request(base, '/api/v1/invitations', {
    cookie:ownerCookie,
    method:'POST',
    body:{ email, role:'member' },
  });
  assert.equal(invitation.response.status, 201);
  const token = new URL(invitation.payload.invitation.inviteUrl).searchParams.get('invite');
  const accepted = await request(base, '/api/v1/invitations/accept', {
    method:'POST',
    body:{ token, displayName, password:'MemberPassword42' },
  });
  assert.equal(accepted.response.status, 201);
  const bootstrap = await request(base, '/api/v1/bootstrap', { cookie:accepted.cookie });
  assert.equal(bootstrap.response.status, 200);
  return { cookie:accepted.cookie, session:bootstrap.payload.session };
}

test('private meeting proposals cannot be read, accepted, or rejected by workspace outsiders', async (t) => {
  const app = await createChatServer({ store:new MemoryStore() });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const ownerRegistration = await request(base, '/api/v1/auth/register-company', {
    method:'POST',
    body:{ companyName:'Private Meeting Co', ownerName:'Owner', email:'owner@private-meeting.test', password:'OwnerPassword42' },
  });
  assert.equal(ownerRegistration.response.status, 201);
  const ownerCookie = ownerRegistration.cookie;
  const ownerBootstrap = await request(base, '/api/v1/bootstrap', { cookie:ownerCookie });
  const ownerSession = ownerBootstrap.payload.session;

  const participant = await invite(base, ownerCookie, 'participant@private-meeting.test', 'Participant');
  const outsider = await invite(base, ownerCookie, 'outsider@private-meeting.test', 'Outsider');

  const privateConversation = await request(base, '/api/v1/conversations', {
    cookie:ownerCookie,
    method:'POST',
    body:{ kind:'group', title:'Private release', visibility:'private', participantIds:[participant.session.userId] },
  });
  assert.equal(privateConversation.response.status, 201);
  const conversationId = privateConversation.payload.conversation.id;

  const callResponse = await request(base, `/api/v1/conversations/${conversationId}/calls`, {
    cookie:ownerCookie,
    method:'POST',
    body:{ mode:'video', title:'Private release review' },
  });
  assert.equal(callResponse.response.status, 201);
  const callId = callResponse.payload.call.id;

  const providerRecordingId = `EG_PRIVATE_${randomUUID()}`;
  await app.meeting.registerRecording({
    id:randomUUID(),
    organizationId:ownerSession.organizationId,
    workspaceId:ownerSession.workspaceId,
    callId,
    providerRecordingId,
    storageKey:`recordings/${ownerSession.workspaceId}/${callId}/private.mp4`,
    status:'processing',
    transcriptStatus:'not_requested',
  });
  await app.meeting.reconcileEgress(providerRecordingId, { success:true });
  const transcriptionJob = await app.meeting.claimJob('transcribe');
  const transcript = await app.meeting.completeTranscription(transcriptionJob.id, transcriptionJob.lockToken, {
    provider:'fixture',
    model:'private-v1',
    language:'ru',
    sourceSha256:'a'.repeat(64),
    segments:[
      { startMs:0, endMs:2500, speakerUserId:participant.session.userId, speakerLabel:'Participant', text:'Закрываем mobile QA до релиза.', confidence:.99 },
      { startMs:2600, endMs:5000, speakerUserId:ownerSession.userId, speakerLabel:'Owner', text:'После QA выпускаем сборку.', confidence:.98 },
    ],
  });
  const summaryJob = await app.meeting.claimJob('summarize');
  await app.meeting.completeSummary(summaryJob.id, summaryJob.lockToken, {
    provider:'fixture',
    model:'private-v1',
    overview:'Private release review',
    proposals:[
      {
        proposalType:'action',
        title:'Закрыть mobile QA',
        body:'Проверить критические мобильные сценарии.',
        proposedOwnerId:participant.session.userId,
        sourceSegmentIds:[transcript.segments[0].id],
        confidence:.97,
      },
      {
        proposalType:'decision',
        title:'Релиз после QA',
        body:'Выпустить сборку только после завершения QA.',
        sourceSegmentIds:[transcript.segments[1].id],
        confidence:.95,
      },
    ],
  });

  const ownerMeeting = await request(base, `/api/v1/calls/${callId}/meeting`, { cookie:ownerCookie });
  assert.equal(ownerMeeting.response.status, 200);
  const action = ownerMeeting.payload.intelligence.proposals.find((proposal) => proposal.proposalType === 'action');
  const decision = ownerMeeting.payload.intelligence.proposals.find((proposal) => proposal.proposalType === 'decision');
  assert.ok(action && decision);

  const outsiderRead = await request(base, `/api/v1/calls/${callId}/meeting`, { cookie:outsider.cookie });
  assert.equal(outsiderRead.response.status, 404);

  const outsiderAccept = await request(base, `/api/v1/meeting-proposals/${action.id}/accept`, {
    cookie:outsider.cookie,
    method:'POST',
    body:{},
  });
  assert.equal(outsiderAccept.response.status, 404);

  const outsiderReject = await request(base, `/api/v1/meeting-proposals/${decision.id}/reject`, {
    cookie:outsider.cookie,
    method:'POST',
    body:{},
  });
  assert.equal(outsiderReject.response.status, 404);

  const unchanged = await request(base, `/api/v1/calls/${callId}/meeting`, { cookie:ownerCookie });
  assert.equal(unchanged.payload.intelligence.proposals.find((proposal) => proposal.id === action.id).status, 'proposed');
  assert.equal(unchanged.payload.intelligence.proposals.find((proposal) => proposal.id === decision.id).status, 'proposed');

  const ownerAccept = await request(base, `/api/v1/meeting-proposals/${action.id}/accept`, {
    cookie:ownerCookie,
    method:'POST',
    body:{ ownerId:participant.session.userId },
  });
  assert.equal(ownerAccept.response.status, 200);
  assert.ok(ownerAccept.payload.task?.id);
  assert.equal(ownerAccept.payload.task.ownerId, participant.session.userId);
});
