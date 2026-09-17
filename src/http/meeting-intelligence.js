import { Permission, requirePermission } from '../rbac.js';
import { json, readJson } from './helpers.js';
import { liveKitEventId, normalizeLiveKitEgress } from '../media/livekit-webhook.js';
import { listAccessibleMeetings } from '../meeting/meeting-center.js';
import { claimWebhookEvent } from '../meeting/webhook-journal.js';

const UUID = '([0-9a-f-]+)';

function notFound(message = 'Meeting not found') {
  return Object.assign(new Error(message), { code:'NOT_FOUND', statusCode:404 });
}

async function readRaw(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Webhook payload too large'), { code:'PAYLOAD_TOO_LARGE', statusCode:413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function accessibleMeetingCall(ctx, session, callId) {
  const call = await ctx.calls.get(session, callId);
  if (!call || !(await ctx.store.canAccessConversation(session, call.conversationId))) throw notFound();
  return call;
}

async function proposalFor(meeting, session, proposalId) {
  if (typeof meeting.getProposal === 'function') return meeting.getProposal(session, proposalId);
  const value = meeting.proposals?.get?.(proposalId);
  if (!value || value.workspaceId !== session.workspaceId) return null;
  const run = meeting.runs?.get?.(value.runId);
  return { ...structuredClone(value), callId:run?.callId ?? null };
}

function newlyQueuedSource(result) {
  if (!result?.run) return false;
  // With an optional sidecar two distinct Egress events belong to one intelligence run.
  // If the sidecar is already ready, a later archive terminal event is lifecycle evidence,
  // not a second queue transition. Archive fallback (sidecar failed/absent) still emits once.
  return !(result.sidecar === false && result.recording?.transcriptionSourceStatus === 'ready');
}

export function createMeetingIntelligenceHandler() {
  return async function handleMeetingIntelligence(req, res, ctx, path, method) {
    const { store, meeting, meetingProcessor, meetingWorker, requireSession, hub, liveKitWebhook, calls } = ctx;

    if (path === '/api/v1/media/livekit/webhook' && method === 'POST') {
      const raw = await readRaw(req);
      const event = await liveKitWebhook.receive(raw, req.headers.authorization ?? req.headers.authorize);
      const providerEventId = liveKitEventId(event, raw);
      const eventType = String(event.event ?? 'unknown');
      const recorded = await claimWebhookEvent(meeting, { provider:'livekit', providerEventId, eventType, payload:JSON.parse(raw) });
      if (!recorded.claimed) {
        json(res, 200, { ok:true, duplicate:true, status:recorded.event?.status ?? null });
        return true;
      }
      try {
        if (eventType === 'egress_ended') {
          const egress = normalizeLiveKitEgress(event);
          if (!egress) {
            await meeting.finishWebhook('livekit', providerEventId, { status:'ignored' });
            json(res, 200, { ok:true, ignored:true });
            return true;
          }
          const result = await meeting.reconcileEgress(egress.providerRecordingId, { success:egress.success, error:egress.error });
          await meeting.finishWebhook('livekit', providerEventId, { status:result ? 'processed' : 'ignored' });
          const queued = newlyQueuedSource(result);
          if (queued) {
            meetingWorker?.kick?.('transcribe');
            hub.broadcastWorkspace(result.run.workspaceId, 'meeting.intelligence.queued', {
              callId:result.run.callId,
              runId:result.run.id,
              recordingId:result.run.recordingId,
            });
          }
          json(res, 200, { ok:true, matched:Boolean(result), queued, reclaimed:Boolean(recorded.reclaimed), egress:{ status:egress.status, success:egress.success } });
          return true;
        }
        await meeting.finishWebhook('livekit', providerEventId, { status:'ignored' });
        json(res, 200, { ok:true, ignored:true });
        return true;
      } catch (error) {
        await meeting.finishWebhook('livekit', providerEventId, { status:'failed', error:error.message }).catch(() => {});
        throw error;
      }
    }

    if (path === '/api/v1/meetings' && method === 'GET') {
      const session = await requireSession(req);
      const url = new URL(req.url ?? '/api/v1/meetings', `http://${req.headers.host ?? 'localhost'}`);
      const items = await listAccessibleMeetings({ calls, meeting, store, session, limit:url.searchParams.get('limit') ?? 40 });
      json(res, 200, { items });
      return true;
    }

    let match = path.match(new RegExp(`^/api/v1/calls/${UUID}/meeting$`, 'i'));
    if (match && method === 'GET') {
      const session = await requireSession(req);
      const call = await accessibleMeetingCall(ctx, session, match[1]);
      const intelligence = await meeting.getMeeting(session, call.id);
      json(res, 200, {
        call,
        intelligence,
        processing:{
          webhook:liveKitWebhook.status(),
          processor:meetingProcessor?.status?.() ?? { enabled:false },
          worker:meetingWorker?.status?.() ?? { configured:false, running:false },
        },
      });
      return true;
    }

    match = path.match(new RegExp(`^/api/v1/meeting-proposals/${UUID}/accept$`, 'i'));
    if (match && method === 'POST') {
      const session = await requireSession(req);
      requirePermission(session.role, Permission.AI_USE);
      const proposal = await proposalFor(meeting, session, match[1]);
      if (!proposal?.callId) throw notFound('Meeting proposal not found');
      await accessibleMeetingCall(ctx, session, proposal.callId);
      if (proposal.proposalType === 'action') requirePermission(session.role, Permission.TASK_CREATE);
      const body = await readJson(req).catch(() => ({}));
      const result = await meeting.acceptProposal(session, proposal.id, {
        ownerId:body.ownerId ?? null,
        promisedAt:body.promisedAt ?? null,
        acceptorId:body.acceptorId ?? null,
      });
      if (!result) throw Object.assign(new Error('Proposal is no longer pending'), { code:'PROPOSAL_ALREADY_RESOLVED', statusCode:409 });
      if (result.confirmedTaskDraft) {
        const task = await store.createTask(session, result.confirmedTaskDraft);
        await meeting.attachCommitment(session, proposal.id, task.id);
        result.task = task;
      }
      if (result.task) {
        const recipients = [...new Set([result.task.ownerId, result.task.requesterId, result.task.acceptorId].filter(Boolean))];
        hub.broadcastUsers(session.workspaceId, recipients, 'task.created', result.task);
      }
      hub.broadcastUsers(session.workspaceId, [session.userId], 'meeting.proposal.accepted', { proposalId:proposal.id, task:result.task ?? null });
      json(res, 200, result);
      return true;
    }

    match = path.match(new RegExp(`^/api/v1/meeting-proposals/${UUID}/reject$`, 'i'));
    if (match && method === 'POST') {
      const session = await requireSession(req);
      requirePermission(session.role, Permission.AI_USE);
      const current = await proposalFor(meeting, session, match[1]);
      if (!current?.callId) throw notFound('Pending meeting proposal not found');
      await accessibleMeetingCall(ctx, session, current.callId);
      const proposal = await meeting.rejectProposal(session, current.id);
      if (!proposal) throw notFound('Pending meeting proposal not found');
      hub.broadcastUsers(session.workspaceId, [session.userId], 'meeting.proposal.rejected', { proposalId:proposal.id });
      json(res, 200, { proposal });
      return true;
    }

    return false;
  };
}
