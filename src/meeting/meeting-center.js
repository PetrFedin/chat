const clampLimit = (value) => Math.min(Math.max(Number(value) || 40, 1), 100);

function durationMs(call) {
  if (!call?.startedAt) return null;
  const start = Date.parse(call.startedAt);
  const end = Date.parse(call.endedAt ?? new Date().toISOString());
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function proposalCounts(proposals = []) {
  const counts = {
    proposed:0,
    accepted:0,
    rejected:0,
    decisions:0,
    actions:0,
    risks:0,
    questions:0,
  };
  for (const proposal of proposals) {
    if (proposal.status in counts) counts[proposal.status] += 1;
    if (proposal.proposalType === 'decision') counts.decisions += 1;
    else if (proposal.proposalType === 'action') counts.actions += 1;
    else if (proposal.proposalType === 'risk') counts.risks += 1;
    else if (proposal.proposalType === 'open_question') counts.questions += 1;
  }
  return counts;
}

async function rawCalls(calls, session, conversationIds, limit) {
  if (!conversationIds.length) return [];
  if (calls?.pool) {
    const { rows } = await calls.pool.query(`SELECT
      id,conversation_id "conversationId",calendar_event_id "calendarEventId",created_by "createdBy",title,mode,state,
      scheduled_for "scheduledFor",started_at "startedAt",ended_at "endedAt",recording_status "recordingStatus",
      provider,provider_room_name "providerRoomName",created_at "createdAt",last_activity_at "lastActivityAt"
      FROM call_sessions
      WHERE workspace_id=$1 AND conversation_id=ANY($2::uuid[])
      ORDER BY created_at DESC,id DESC LIMIT $3`, [session.workspaceId, conversationIds, clampLimit(limit)]);
    return rows;
  }
  if (calls?.calls instanceof Map) {
    const accessible = new Set(conversationIds);
    return [...calls.calls.values()]
      .filter((call) => call.workspaceId === session.workspaceId && accessible.has(call.conversationId))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)))
      .slice(0, clampLimit(limit));
  }
  return [];
}

export async function listAccessibleMeetings({ calls, meeting, store, session, limit = 40 }) {
  const conversations = await store.listConversations(session);
  const conversationMap = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const candidates = await rawCalls(calls, session, [...conversationMap.keys()], limit);
  const items = [];

  for (const candidate of candidates) {
    if (!(await store.canAccessConversation(session, candidate.conversationId))) continue;
    const call = await calls.get(session, candidate.id);
    if (!call) continue;
    const intelligence = await meeting.getMeeting(session, call.id);
    const run = intelligence?.run ?? null;
    const proposals = intelligence?.proposals ?? [];
    const conversation = conversationMap.get(call.conversationId);
    const counts = proposalCounts(proposals);
    items.push({
      id:call.id,
      title:call.title || conversation?.title || 'Встреча',
      conversationId:call.conversationId,
      conversationTitle:conversation?.title ?? null,
      calendarEventId:call.calendarEventId ?? null,
      createdBy:call.createdBy,
      mode:call.mode,
      state:call.state,
      scheduledFor:call.scheduledFor ?? null,
      startedAt:call.startedAt ?? null,
      endedAt:call.endedAt ?? null,
      createdAt:call.createdAt,
      durationMs:durationMs(call),
      participantCount:(call.participants ?? []).length,
      recordingStatus:call.recordingStatus,
      intelligenceStatus:run?.status ?? 'not_started',
      intelligenceRunId:run?.id ?? null,
      overview:run?.summaryOverview ?? null,
      hasTranscript:Boolean(intelligence?.segments?.length),
      proposalCounts:counts,
      needsReview:counts.proposed > 0,
      synthetic:Boolean(
        String(run?.transcriptProvider ?? '').startsWith('demo-fixture')
        || String(run?.summaryProvider ?? '').startsWith('demo-fixture')
        || String(run?.transcriptModel ?? '').startsWith('demo-fixture')
        || String(run?.summaryModel ?? '').startsWith('demo-fixture')
      ),
      updatedAt:run?.updatedAt ?? call.lastActivityAt ?? call.createdAt,
    });
  }

  return items;
}
