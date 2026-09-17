import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatServer } from '../src/server.js';
import { MemoryMeetingRepository } from '../src/meeting/meeting-repository.js';
import { claimWebhookEvent } from '../src/meeting/webhook-journal.js';
import { MeetingProcessor } from '../src/meeting/processor.js';

async function request(base, path, { cookie, method='GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers:{ ...(cookie ? { cookie } : {}), ...(body ? { 'content-type':'application/json' } : {}) },
    body:body ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload, cookie:response.headers.get('set-cookie')?.split(';')[0] };
}

test('demo exposes a traceable meeting review without pretending synthetic data is production truth', async (t) => {
  const app = await createChatServer({ demoEnabled:true });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const login = await request(base, '/api/v1/auth/demo', { method:'POST', body:{} });
  assert.equal(login.response.status, 200);
  assert.ok(login.cookie);

  const list = await request(base, '/api/v1/meetings', { cookie:login.cookie });
  assert.equal(list.response.status, 200);
  const meeting = list.payload.items.find((item) => item.synthetic && item.intelligenceStatus === 'review_ready');
  assert.ok(meeting, 'demo should contain a clearly marked synthetic review-ready meeting');
  assert.equal(meeting.needsReview, true);
  assert.ok(meeting.proposalCounts.actions >= 1);
  assert.ok(meeting.hasTranscript);

  const detail = await request(base, `/api/v1/calls/${meeting.id}/meeting`, { cookie:login.cookie });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.intelligence.run.summaryProvider, 'demo-fixture');
  assert.ok(detail.payload.intelligence.segments.length >= 5);
  assert.ok(detail.payload.intelligence.proposals.every((proposal) => proposal.sourceSegmentIds.length >= 1));

  const notifications = await request(base, '/api/v1/notifications?limit=100', { cookie:login.cookie });
  assert.equal(notifications.response.status, 200);
  const reviewNotification = notifications.payload.items.find((item) => item.type === 'meeting.review_ready');
  assert.ok(reviewNotification);
  assert.equal(reviewNotification.metadata.syntheticDemo, true);
  assert.equal(reviewNotification.metadata.callId, meeting.id);

  const action = detail.payload.intelligence.proposals.find((proposal) => proposal.proposalType === 'action');
  const accepted = await request(base, `/api/v1/meeting-proposals/${action.id}/accept`, {
    cookie:login.cookie,
    method:'POST',
    body:{ ownerId:action.proposedOwnerId },
  });
  assert.equal(accepted.response.status, 200);
  assert.ok(accepted.payload.task?.id);

  const after = await request(base, `/api/v1/calls/${meeting.id}/meeting`, { cookie:login.cookie });
  const acceptedAction = after.payload.intelligence.proposals.find((proposal) => proposal.id === action.id);
  assert.equal(acceptedAction.status, 'accepted');
  assert.equal(acceptedAction.createdCommitmentId, accepted.payload.task.id);
});

test('failed webhook delivery can be reclaimed exactly once', async () => {
  const repository = new MemoryMeetingRepository();
  const value = { provider:'livekit', providerEventId:'WH_RETRY', eventType:'egress_ended', payload:{ event:'egress_ended' } };

  const first = await claimWebhookEvent(repository, value);
  assert.equal(first.claimed, true);
  const duplicate = await claimWebhookEvent(repository, value);
  assert.equal(duplicate.claimed, false);

  await repository.finishWebhook('livekit', 'WH_RETRY', { status:'failed', error:'transient database failure' });
  const retry = await claimWebhookEvent(repository, value);
  assert.equal(retry.claimed, true);
  assert.equal(retry.reclaimed, true);
  assert.equal(retry.event.status, 'received');
  const concurrentDuplicate = await claimWebhookEvent(repository, value);
  assert.equal(concurrentDuplicate.claimed, false);

  await repository.finishWebhook('livekit', 'WH_RETRY', { status:'processed' });
  const processedDuplicate = await claimWebhookEvent(repository, value);
  assert.equal(processedDuplicate.claimed, false);
  assert.equal(processedDuplicate.event.status, 'processed');
});

test('review-ready callback runs only after durable summary commit', async () => {
  const repository = new MemoryMeetingRepository();
  const workspaceId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const callId = crypto.randomUUID();
  const recordingId = crypto.randomUUID();
  const storageKey = 'recordings/callback.mp4';
  const reviewEvents = [];
  await repository.registerRecording({
    id:recordingId, organizationId, workspaceId, callId,
    providerRecordingId:'EG_CALLBACK', storageKey, status:'processing', transcriptStatus:'not_requested',
  });
  await repository.reconcileEgress('EG_CALLBACK', { success:true });
  const body = Buffer.from('callback-recording');
  const processor = new MeetingProcessor({
    repository,
    objectStore:{ head:async()=>({ exists:true, sizeBytes:body.length }), get:async()=>body },
    transcriptionProvider:{
      status:()=>({ provider:'fixture', enabled:true }),
      transcribe:async()=>({ provider:'fixture', model:'v1', language:'ru', segments:[{ startMs:0, endMs:1000, text:'Подтвердить выпуск после QA.' }] }),
    },
    summaryProvider:{
      status:()=>({ provider:'fixture', enabled:true }),
      summarize:async({ segments })=>({ provider:'fixture', model:'v1', overview:'Релиз после QA.', proposals:[{ proposalType:'decision', title:'Релиз после QA', sourceSegmentIds:[segments[0].id] }] }),
    },
    onReviewReady:async(event)=>reviewEvents.push(event),
  });

  assert.equal((await processor.runOnce('transcribe')).processed, true);
  assert.equal(reviewEvents.length, 0);
  assert.equal((await processor.runOnce('summarize')).processed, true);
  assert.equal(reviewEvents.length, 1);
  assert.equal(reviewEvents[0].callId, callId);
  assert.equal(reviewEvents[0].proposalCount, 1);
  assert.equal((await repository.getMeeting({ workspaceId }, callId)).run.status, 'review_ready');
});
