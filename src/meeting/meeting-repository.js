import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : structuredClone(value);

function cleanSegments(segments = []) {
  return segments.map((segment, index) => ({
    id: segment.id ?? randomUUID(),
    segmentIndex: index,
    startMs: Number(segment.startMs),
    endMs: Number(segment.endMs),
    speakerUserId: segment.speakerUserId ?? null,
    speakerLabel: segment.speakerLabel ?? null,
    text: String(segment.text ?? '').trim(),
    confidence: segment.confidence ?? null,
    language: segment.language ?? null,
    providerSegmentId: segment.providerSegmentId ?? null,
  })).filter((segment) => Number.isFinite(segment.startMs)
    && Number.isFinite(segment.endMs)
    && segment.endMs >= segment.startMs
    && segment.text);
}

export class MemoryMeetingRepository {
  constructor() {
    this.runs = new Map();
    this.jobs = new Map();
    this.segments = new Map();
    this.proposals = new Map();
    this.sources = new Map();
    this.webhooks = new Map();
    this.recordings = new Map();
  }

  webhookKey(provider, id) { return `${provider}:${id}`; }

  async recordWebhook(value) {
    const key = this.webhookKey(value.provider, value.providerEventId);
    if (this.webhooks.has(key)) return { inserted:false, event:clone(this.webhooks.get(key)) };
    const event = { id:randomUUID(), status:'received', receivedAt:now(), ...value };
    this.webhooks.set(key, event);
    return { inserted:true, event:clone(event) };
  }

  async finishWebhook(provider, id, { status = 'processed', error = null } = {}) {
    const row = this.webhooks.get(this.webhookKey(provider, id));
    if (!row) return null;
    row.status = status;
    row.processedAt = status === 'processed' || status === 'ignored' ? now() : null;
    row.failedAt = status === 'failed' ? now() : null;
    row.lastError = error;
    return clone(row);
  }

  async registerRecording(recording) {
    this.recordings.set(recording.providerRecordingId, clone(recording));
  }

  async reconcileEgress(providerRecordingId, { success = true, error = null } = {}) {
    const recording = this.recordings.get(providerRecordingId);
    if (!recording) return null;
    if (!success) {
      recording.status = 'failed';
      recording.failedAt = now();
      recording.transcriptStatus = 'failed';
      recording.lastError = error;
      return { recording:clone(recording), run:null, job:null };
    }
    recording.status = 'ready';
    recording.readyAt ??= now();
    if (recording.transcriptStatus === 'not_requested') recording.transcriptStatus = 'queued';
    let run = [...this.runs.values()].find((value) => value.recordingId === recording.id);
    if (!run) {
      run = {
        id:randomUUID(), organizationId:recording.organizationId, workspaceId:recording.workspaceId,
        callId:recording.callId, recordingId:recording.id, status:'queued', createdAt:now(), updatedAt:now(),
      };
      this.runs.set(run.id, run);
    }
    let job = [...this.jobs.values()].find((value) => value.runId === run.id && value.kind === 'transcribe');
    if (!job) {
      job = {
        id:randomUUID(), organizationId:recording.organizationId, workspaceId:recording.workspaceId,
        runId:run.id, kind:'transcribe', status:'pending', attempts:0, maxAttempts:5,
        availableAt:now(), createdAt:now(), updatedAt:now(),
      };
      this.jobs.set(job.id, job);
    }
    return { recording:clone(recording), run:clone(run), job:clone(job) };
  }

  async getMeeting(session, callId) {
    const runs = [...this.runs.values()]
      .filter((run) => run.workspaceId === session.workspaceId && run.callId === callId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const run = runs[0] ?? null;
    if (!run) return { run:null, segments:[], proposals:[] };
    return {
      run: clone(run),
      segments: clone([...this.segments.values()].filter((segment) => segment.runId === run.id).sort((a, b) => a.segmentIndex - b.segmentIndex)),
      proposals: clone([...this.proposals.values()].filter((proposal) => proposal.runId === run.id).map((proposal) => ({
        ...proposal,
        sourceSegmentIds:[...(this.sources.get(proposal.id) ?? new Set())],
      }))),
    };
  }

  async getProposal(session, proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.workspaceId !== session.workspaceId) return null;
    const run = this.runs.get(proposal.runId);
    if (!run || run.workspaceId !== session.workspaceId) return null;
    return {
      ...clone(proposal),
      callId:run.callId,
      sourceSegmentIds:[...(this.sources.get(proposal.id) ?? new Set())],
    };
  }

  async claimJob(kind = 'transcribe') {
    const job = [...this.jobs.values()].find((value) => value.kind === kind
      && ['pending','failed'].includes(value.status)
      && Date.parse(value.availableAt) <= Date.now()
      && value.attempts < value.maxAttempts);
    if (!job) return null;
    job.status = 'processing';
    job.attempts++;
    job.lockToken = randomUUID();
    job.lockedAt = now();
    job.updatedAt = now();
    return clone(job);
  }

  async failJob(jobId, lockToken, error, { retryDelayMs = 30000 } = {}) {
    const job = this.jobs.get(jobId);
    if (!job || job.lockToken !== lockToken) return null;
    job.lastError = String(error?.message ?? error ?? 'Unknown error').slice(0, 4000);
    job.status = job.attempts >= job.maxAttempts ? 'dead_letter' : 'failed';
    job.availableAt = new Date(Date.now() + retryDelayMs).toISOString();
    job.lockedAt = null;
    job.lockToken = null;
    job.updatedAt = now();
    return clone(job);
  }

  async completeTranscription(jobId, lockToken, { segments, language = null, provider = null, model = null, sourceSha256 = null } = {}) {
    const job = this.jobs.get(jobId);
    if (!job || job.lockToken !== lockToken || job.kind !== 'transcribe') return null;
    const run = this.runs.get(job.runId);
    const cleaned = cleanSegments(segments);
    for (const old of [...this.segments.values()]) if (old.runId === run.id) this.segments.delete(old.id);
    for (const segment of cleaned) this.segments.set(segment.id, { ...segment, organizationId:run.organizationId, workspaceId:run.workspaceId, runId:run.id, createdAt:now() });
    run.status = 'summarizing';
    run.language = language;
    run.transcriptProvider = provider;
    run.transcriptModel = model;
    run.sourceSha256 = sourceSha256;
    run.updatedAt = now();
    job.status = 'succeeded';
    job.finishedAt = now();
    job.lockedAt = null;
    job.lockToken = null;
    let summary = [...this.jobs.values()].find((value) => value.runId === run.id && value.kind === 'summarize');
    if (!summary) {
      summary = {
        id:randomUUID(), organizationId:run.organizationId, workspaceId:run.workspaceId, runId:run.id,
        kind:'summarize', status:'pending', attempts:0, maxAttempts:5, availableAt:now(), createdAt:now(), updatedAt:now(),
      };
      this.jobs.set(summary.id, summary);
    }
    return { run:clone(run), segments:clone(cleaned), nextJob:clone(summary) };
  }

  async completeSummary(jobId, lockToken, { overview = '', summaryJson = {}, proposals = [], provider = null, model = null } = {}) {
    const job = this.jobs.get(jobId);
    if (!job || job.lockToken !== lockToken || job.kind !== 'summarize') return null;
    const run = this.runs.get(job.runId);
    const segmentIds = new Set([...this.segments.values()].filter((segment) => segment.runId === run.id).map((segment) => segment.id));
    for (const old of [...this.proposals.values()]) {
      if (old.runId === run.id) {
        this.proposals.delete(old.id);
        this.sources.delete(old.id);
      }
    }
    for (const value of proposals) {
      const proposal = {
        id:randomUUID(), organizationId:run.organizationId, workspaceId:run.workspaceId, runId:run.id,
        proposalType:value.proposalType, title:String(value.title ?? '').trim(), body:value.body ?? null,
        proposedOwnerId:value.proposedOwnerId ?? null, proposedDueAt:value.proposedDueAt ?? null,
        confidence:value.confidence ?? null, status:'proposed', createdAt:now(), updatedAt:now(),
      };
      if (!proposal.title || !['decision','action','risk','open_question'].includes(proposal.proposalType)) continue;
      this.proposals.set(proposal.id, proposal);
      this.sources.set(proposal.id, new Set((value.sourceSegmentIds ?? []).filter((id) => segmentIds.has(id))));
    }
    run.status = 'review_ready';
    run.summaryOverview = overview;
    run.summaryJson = summaryJson;
    run.summaryProvider = provider;
    run.summaryModel = model;
    run.completedAt = now();
    run.updatedAt = now();
    job.status = 'succeeded';
    job.finishedAt = now();
    job.lockedAt = null;
    job.lockToken = null;
    return this.getMeeting({ workspaceId:run.workspaceId }, run.callId);
  }

  async acceptProposal(session, proposalId, { ownerId = null, promisedAt = null, acceptorId = null } = {}) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.workspaceId !== session.workspaceId || proposal.status !== 'proposed') return null;
    proposal.status = 'accepted';
    proposal.acceptedBy = session.userId;
    proposal.acceptedAt = now();
    proposal.updatedAt = now();
    if (proposal.proposalType === 'action') {
      proposal.confirmedTaskDraft = {
        title:proposal.title,
        outcome:proposal.body || proposal.title,
        ownerId:ownerId ?? proposal.proposedOwnerId ?? session.userId,
        acceptorId:acceptorId ?? session.userId,
        promisedAt:promisedAt ?? proposal.proposedDueAt ?? null,
      };
    }
    return clone(proposal);
  }

  async attachCommitment(session, proposalId, commitmentId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.workspaceId !== session.workspaceId || proposal.status !== 'accepted' || proposal.proposalType !== 'action') return null;
    proposal.createdCommitmentId = commitmentId;
    proposal.updatedAt = now();
    return clone(proposal);
  }

  async rejectProposal(session, proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.workspaceId !== session.workspaceId || proposal.status !== 'proposed') return null;
    proposal.status = 'rejected';
    proposal.rejectedBy = session.userId;
    proposal.rejectedAt = now();
    proposal.updatedAt = now();
    return clone(proposal);
  }
}

export class PostgresMeetingRepository {
  constructor(pool) { this.pool = pool; }

  async tx(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async recordWebhook(value) {
    const { rows } = await this.pool.query(`INSERT INTO media_webhook_events(provider,provider_event_id,event_type,payload)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(provider,provider_event_id) DO NOTHING
      RETURNING id,provider,provider_event_id "providerEventId",event_type "eventType",status,received_at "receivedAt"`,
    [value.provider, value.providerEventId, value.eventType, value.payload ?? {}]);
    if (rows[0]) return { inserted:true, event:rows[0] };
    const existing = (await this.pool.query(`SELECT id,provider,provider_event_id "providerEventId",event_type "eventType",status,received_at "receivedAt"
      FROM media_webhook_events WHERE provider=$1 AND provider_event_id=$2`, [value.provider, value.providerEventId])).rows[0];
    return { inserted:false, event:existing };
  }

  async finishWebhook(provider, id, { status = 'processed', error = null } = {}) {
    const { rows } = await this.pool.query(`UPDATE media_webhook_events
      SET status=$3,
          processed_at=CASE WHEN $3 IN('processed','ignored') THEN now() ELSE processed_at END,
          failed_at=CASE WHEN $3='failed' THEN now() ELSE failed_at END,
          last_error=$4
      WHERE provider=$1 AND provider_event_id=$2
      RETURNING id,status,processed_at "processedAt",failed_at "failedAt"`,
    [provider, id, status, error ? String(error).slice(0, 4000) : null]);
    return rows[0] ?? null;
  }

  async reconcileEgress(providerRecordingId, { success = true, error = null } = {}) {
    return this.tx(async (client) => {
      const recording = (await client.query(`SELECT id,organization_id "organizationId",workspace_id "workspaceId",call_id "callId",
        provider_recording_id "providerRecordingId",storage_key "storageKey",status
        FROM call_recordings WHERE provider='livekit' AND provider_recording_id=$1 FOR UPDATE`, [providerRecordingId])).rows[0];
      if (!recording) return null;

      if (!success) {
        await client.query(`UPDATE call_recordings
          SET status='failed',failed_at=COALESCE(failed_at,now()),transcript_status='failed',updated_at=now()
          WHERE id=$1`, [recording.id]);
        return { recording:{ ...recording, status:'failed', error }, run:null, job:null };
      }

      const firstReadyTransition = recording.status !== 'ready';
      await client.query(`UPDATE call_recordings
        SET status='ready',ready_at=COALESCE(ready_at,now()),
            transcript_status=CASE WHEN transcript_status='not_requested' THEN 'queued' ELSE transcript_status END,
            updated_at=now()
        WHERE id=$1`, [recording.id]);

      const run = (await client.query(`INSERT INTO meeting_intelligence_runs(organization_id,workspace_id,call_id,recording_id,status)
        VALUES($1,$2,$3,$4,'queued')
        ON CONFLICT(workspace_id,recording_id) DO UPDATE SET updated_at=meeting_intelligence_runs.updated_at
        RETURNING id,organization_id "organizationId",workspace_id "workspaceId",call_id "callId",recording_id "recordingId",status,created_at "createdAt"`,
      [recording.organizationId, recording.workspaceId, recording.callId, recording.id])).rows[0];

      const job = (await client.query(`INSERT INTO meeting_intelligence_jobs(organization_id,workspace_id,run_id,kind,status)
        VALUES($1,$2,$3,'transcribe','pending')
        ON CONFLICT(workspace_id,run_id,kind) DO UPDATE SET updated_at=meeting_intelligence_jobs.updated_at
        RETURNING id,run_id "runId",kind,status,attempts,max_attempts "maxAttempts",available_at "availableAt"`,
      [recording.organizationId, recording.workspaceId, run.id])).rows[0];

      if (firstReadyTransition) {
        await client.query(`INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload)
          VALUES($1,$2,'meeting.recording.ready',$3,$4)`,
        [recording.organizationId, recording.workspaceId, run.id, { callId:recording.callId, recordingId:recording.id, jobId:job.id }]);
      }
      return { recording:{ ...recording, status:'ready' }, run, job };
    });
  }

  async getMeeting(session, callId) {
    const run = (await this.pool.query(`SELECT id,call_id "callId",recording_id "recordingId",status,language,
      transcript_provider "transcriptProvider",transcript_model "transcriptModel",summary_provider "summaryProvider",
      summary_model "summaryModel",summary_overview "summaryOverview",summary_json "summaryJson",error_code "errorCode",
      error_message "errorMessage",created_at "createdAt",updated_at "updatedAt",completed_at "completedAt"
      FROM meeting_intelligence_runs WHERE workspace_id=$1 AND call_id=$2 ORDER BY created_at DESC LIMIT 1`,
    [session.workspaceId, callId])).rows[0] ?? null;
    if (!run) return { run:null, segments:[], proposals:[] };

    const [segments, proposals, sources] = await Promise.all([
      this.pool.query(`SELECT id,segment_index "segmentIndex",start_ms "startMs",end_ms "endMs",speaker_user_id "speakerUserId",
        speaker_label "speakerLabel",text,confidence,language
        FROM meeting_transcript_segments WHERE workspace_id=$1 AND run_id=$2 ORDER BY segment_index`, [session.workspaceId, run.id]),
      this.pool.query(`SELECT id,proposal_type "proposalType",title,body,proposed_owner_id "proposedOwnerId",
        proposed_due_at "proposedDueAt",confidence,status,accepted_by "acceptedBy",accepted_at "acceptedAt",
        rejected_by "rejectedBy",rejected_at "rejectedAt",created_commitment_id "createdCommitmentId",created_at "createdAt"
        FROM meeting_proposals WHERE workspace_id=$1 AND run_id=$2 ORDER BY created_at,id`, [session.workspaceId, run.id]),
      this.pool.query(`SELECT proposal_id "proposalId",segment_id "segmentId" FROM meeting_proposal_sources
        WHERE workspace_id=$1 AND proposal_id IN(SELECT id FROM meeting_proposals WHERE workspace_id=$1 AND run_id=$2)`,
      [session.workspaceId, run.id]),
    ]);
    const byProposal = new Map();
    for (const source of sources.rows) {
      const list = byProposal.get(source.proposalId) ?? [];
      list.push(source.segmentId);
      byProposal.set(source.proposalId, list);
    }
    return {
      run,
      segments:segments.rows,
      proposals:proposals.rows.map((proposal) => ({ ...proposal, sourceSegmentIds:byProposal.get(proposal.id) ?? [] })),
    };
  }

  async getProposal(session, proposalId) {
    return (await this.pool.query(`SELECT p.id,p.run_id "runId",r.call_id "callId",p.proposal_type "proposalType",p.title,p.body,
      p.proposed_owner_id "proposedOwnerId",p.proposed_due_at "proposedDueAt",p.status,p.created_commitment_id "createdCommitmentId"
      FROM meeting_proposals p
      JOIN meeting_intelligence_runs r ON r.workspace_id=p.workspace_id AND r.id=p.run_id
      WHERE p.workspace_id=$1 AND p.id=$2`, [session.workspaceId, proposalId])).rows[0] ?? null;
  }

  async claimJob(kind = 'transcribe') {
    return this.tx(async (client) => {
      const job = (await client.query(`SELECT id FROM meeting_intelligence_jobs
        WHERE kind=$1 AND status IN('pending','failed') AND available_at<=now() AND attempts<max_attempts
        ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1`, [kind])).rows[0];
      if (!job) return null;
      const lockToken = randomUUID();
      const { rows } = await client.query(`UPDATE meeting_intelligence_jobs
        SET status='processing',attempts=attempts+1,locked_at=now(),lock_token=$2,updated_at=now()
        WHERE id=$1
        RETURNING id,organization_id "organizationId",workspace_id "workspaceId",run_id "runId",kind,status,attempts,
          max_attempts "maxAttempts",available_at "availableAt",lock_token "lockToken"`, [job.id, lockToken]);
      return rows[0];
    });
  }

  async failJob(jobId, lockToken, error, { retryDelayMs = 30000 } = {}) {
    const { rows } = await this.pool.query(`UPDATE meeting_intelligence_jobs
      SET status=CASE WHEN attempts>=max_attempts THEN 'dead_letter' ELSE 'failed' END,
          last_error=$3,available_at=now()+($4::bigint*interval '1 millisecond'),locked_at=NULL,lock_token=NULL,updated_at=now()
      WHERE id=$1 AND lock_token=$2
      RETURNING id,status,attempts,max_attempts "maxAttempts",available_at "availableAt"`,
    [jobId, lockToken, String(error?.message ?? error ?? 'Unknown error').slice(0, 4000), retryDelayMs]);
    return rows[0] ?? null;
  }

  async jobContext(job) {
    return (await this.pool.query(`SELECT j.id,j.kind,j.lock_token "lockToken",r.id "runId",r.call_id "callId",
      r.recording_id "recordingId",cr.storage_key "storageKey",cr.provider_recording_id "providerRecordingId",
      r.workspace_id "workspaceId",r.organization_id "organizationId"
      FROM meeting_intelligence_jobs j
      JOIN meeting_intelligence_runs r ON r.workspace_id=j.workspace_id AND r.id=j.run_id
      JOIN call_recordings cr ON cr.workspace_id=r.workspace_id AND cr.id=r.recording_id
      WHERE j.id=$1`, [job.id])).rows[0] ?? null;
  }

  async completeTranscription(jobId, lockToken, { segments, language = null, provider = null, model = null, sourceSha256 = null } = {}) {
    const cleaned = cleanSegments(segments);
    return this.tx(async (client) => {
      const job = (await client.query(`SELECT id,workspace_id "workspaceId",organization_id "organizationId",run_id "runId",kind
        FROM meeting_intelligence_jobs WHERE id=$1 AND lock_token=$2 AND status='processing' FOR UPDATE`, [jobId, lockToken])).rows[0];
      if (!job || job.kind !== 'transcribe') return null;
      const run = (await client.query(`SELECT id,call_id "callId",recording_id "recordingId"
        FROM meeting_intelligence_runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [job.workspaceId, job.runId])).rows[0];

      await client.query('DELETE FROM meeting_transcript_segments WHERE workspace_id=$1 AND run_id=$2', [job.workspaceId, run.id]);
      for (const segment of cleaned) {
        await client.query(`INSERT INTO meeting_transcript_segments(
          id,organization_id,workspace_id,run_id,segment_index,start_ms,end_ms,speaker_user_id,speaker_label,text,confidence,language,provider_segment_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [segment.id, job.organizationId, job.workspaceId, run.id, segment.segmentIndex, segment.startMs, segment.endMs,
          segment.speakerUserId, segment.speakerLabel, segment.text, segment.confidence, segment.language, segment.providerSegmentId]);
      }
      await client.query(`UPDATE meeting_intelligence_runs
        SET status='summarizing',language=$3,transcript_provider=$4,transcript_model=$5,source_sha256=$6,updated_at=now()
        WHERE workspace_id=$1 AND id=$2`, [job.workspaceId, run.id, language, provider, model, sourceSha256]);
      await client.query(`UPDATE call_recordings
        SET transcript_status='ready',transcript=$3,summary_status='queued',updated_at=now()
        WHERE workspace_id=$1 AND id=$2`, [job.workspaceId, run.recordingId, cleaned.map((segment) => segment.text).join('\n')]);
      await client.query(`UPDATE meeting_intelligence_jobs
        SET status='succeeded',finished_at=now(),locked_at=NULL,lock_token=NULL,updated_at=now() WHERE id=$1`, [job.id]);
      const summary = (await client.query(`INSERT INTO meeting_intelligence_jobs(organization_id,workspace_id,run_id,kind,status)
        VALUES($1,$2,$3,'summarize','pending')
        ON CONFLICT(workspace_id,run_id,kind) DO UPDATE SET updated_at=meeting_intelligence_jobs.updated_at
        RETURNING id,kind,status,available_at "availableAt"`, [job.organizationId, job.workspaceId, run.id])).rows[0];
      await client.query(`INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload)
        VALUES($1,$2,'meeting.transcript.ready',$3,$4)`,
      [job.organizationId, job.workspaceId, run.id, { callId:run.callId, recordingId:run.recordingId, summaryJobId:summary.id }]);
      return { runId:run.id, segments:cleaned, nextJob:summary };
    });
  }

  async completeSummary(jobId, lockToken, { overview = '', summaryJson = {}, proposals = [], provider = null, model = null } = {}) {
    return this.tx(async (client) => {
      const job = (await client.query(`SELECT id,workspace_id "workspaceId",organization_id "organizationId",run_id "runId",kind
        FROM meeting_intelligence_jobs WHERE id=$1 AND lock_token=$2 AND status='processing' FOR UPDATE`, [jobId, lockToken])).rows[0];
      if (!job || job.kind !== 'summarize') return null;
      const run = (await client.query(`SELECT id,call_id "callId",recording_id "recordingId"
        FROM meeting_intelligence_runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [job.workspaceId, job.runId])).rows[0];
      const validSegments = new Set((await client.query(`SELECT id FROM meeting_transcript_segments WHERE workspace_id=$1 AND run_id=$2`,
        [job.workspaceId, run.id])).rows.map((row) => row.id));

      await client.query('DELETE FROM meeting_proposals WHERE workspace_id=$1 AND run_id=$2', [job.workspaceId, run.id]);
      for (const value of proposals) {
        if (!['decision','action','risk','open_question'].includes(value.proposalType) || !String(value.title ?? '').trim()) continue;
        const id = randomUUID();
        await client.query(`INSERT INTO meeting_proposals(
          id,organization_id,workspace_id,run_id,proposal_type,title,body,proposed_owner_id,proposed_due_at,confidence)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, job.organizationId, job.workspaceId, run.id, value.proposalType, String(value.title).trim(), value.body ?? null,
          value.proposedOwnerId ?? null, value.proposedDueAt ?? null, value.confidence ?? null]);
        for (const segmentId of new Set(value.sourceSegmentIds ?? [])) {
          if (!validSegments.has(segmentId)) continue;
          await client.query(`INSERT INTO meeting_proposal_sources(organization_id,workspace_id,proposal_id,segment_id)
            VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [job.organizationId, job.workspaceId, id, segmentId]);
        }
      }
      await client.query(`UPDATE meeting_intelligence_runs
        SET status='review_ready',summary_provider=$3,summary_model=$4,summary_overview=$5,summary_json=$6,completed_at=now(),updated_at=now()
        WHERE workspace_id=$1 AND id=$2`, [job.workspaceId, run.id, provider, model, overview, summaryJson]);
      await client.query(`UPDATE call_recordings SET summary_status='ready',ai_summary=$3,updated_at=now()
        WHERE workspace_id=$1 AND id=$2`, [job.workspaceId, run.recordingId, overview]);
      await client.query(`UPDATE meeting_intelligence_jobs
        SET status='succeeded',finished_at=now(),locked_at=NULL,lock_token=NULL,updated_at=now() WHERE id=$1`, [job.id]);
      await client.query(`INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload)
        VALUES($1,$2,'meeting.intelligence.review_ready',$3,$4)`,
      [job.organizationId, job.workspaceId, run.id, { callId:run.callId, recordingId:run.recordingId }]);
      return { runId:run.id, callId:run.callId };
    });
  }

  async acceptProposal(session, proposalId, { ownerId = null, promisedAt = null, acceptorId = null } = {}) {
    return this.tx(async (client) => {
      const proposal = (await client.query(`SELECT p.*,r.call_id
        FROM meeting_proposals p
        JOIN meeting_intelligence_runs r ON r.workspace_id=p.workspace_id AND r.id=p.run_id
        WHERE p.workspace_id=$1 AND p.id=$2 FOR UPDATE`, [session.workspaceId, proposalId])).rows[0];
      if (!proposal || proposal.status !== 'proposed') return null;

      if (proposal.proposal_type !== 'action') {
        const { rows } = await client.query(`UPDATE meeting_proposals
          SET status='accepted',accepted_by=$3,accepted_at=now(),updated_at=now()
          WHERE workspace_id=$1 AND id=$2
          RETURNING id,proposal_type "proposalType",title,status,accepted_by "acceptedBy",accepted_at "acceptedAt"`,
        [session.workspaceId, proposalId, session.userId]);
        await client.query(`INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload)
          VALUES($1,$2,'meeting.proposal.accepted',$3,$4)`,
        [session.organizationId, session.workspaceId, proposalId, { callId:proposal.call_id, commitmentId:null }]);
        return { proposal:rows[0], task:null };
      }

      const taskOwner = ownerId ?? proposal.proposed_owner_id ?? session.userId;
      const taskAcceptor = acceptorId ?? session.userId;
      const uniqueParticipants = [...new Set([taskOwner, taskAcceptor])];
      const members = await client.query(`SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=ANY($2::uuid[])`,
        [session.workspaceId, uniqueParticipants]);
      if (members.rowCount !== uniqueParticipants.length) {
        throw Object.assign(new Error('Task owner and acceptor must belong to this workspace'), { code:'INVALID_TASK_PARTICIPANT', statusCode:400 });
      }

      const taskId = randomUUID();
      const task = (await client.query(`INSERT INTO commitments(
        id,organization_id,workspace_id,title,outcome,owner_id,requester_id,acceptor_id,status,priority,promised_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'proposed','normal',$9)
        RETURNING id,title,outcome,owner_id "ownerId",requester_id "requesterId",acceptor_id "acceptorId",status,priority,
          promised_at "promisedAt",created_at "createdAt"`,
      [taskId, session.organizationId, session.workspaceId, proposal.title, proposal.body || proposal.title,
        taskOwner, session.userId, taskAcceptor, promisedAt ?? proposal.proposed_due_at ?? null])).rows[0];

      const acceptedProposal = (await client.query(`UPDATE meeting_proposals
        SET status='accepted',accepted_by=$3,accepted_at=now(),created_commitment_id=$4,updated_at=now()
        WHERE workspace_id=$1 AND id=$2
        RETURNING id,proposal_type "proposalType",title,status,accepted_by "acceptedBy",accepted_at "acceptedAt",
          created_commitment_id "createdCommitmentId"`,
      [session.workspaceId, proposalId, session.userId, taskId])).rows[0];

      await client.query(`INSERT INTO evidence(organization_id,workspace_id,commitment_id,type,value,added_by)
        VALUES($1,$2,$3,'note',$4,$5)`,
      [session.organizationId, session.workspaceId, taskId, `Meeting proposal ${proposalId} from call ${proposal.call_id}`, session.userId]);

      if (taskOwner !== session.userId) {
        await client.query(`INSERT INTO notifications(
          organization_id,workspace_id,recipient_user_id,source_event_id,dedupe_key,type,title,body,
          actor_user_id,commitment_id,url,priority,metadata)
          VALUES($1,$2,$3,$4,$5,'task.assigned',$6,$7,$8,$4,$9,'normal',$10)
          ON CONFLICT(workspace_id,dedupe_key) DO NOTHING`,
        [session.organizationId, session.workspaceId, taskOwner, taskId, `task.assigned:${taskId}:${taskOwner}`,
          `Новая задача от ${session.displayName ?? 'участника встречи'}`, task.title, session.userId, `/#/tasks/${taskId}`,
          { source:'meeting_intelligence', proposalId }]);
      }

      await client.query(`INSERT INTO outbox_events(organization_id,workspace_id,topic,aggregate_id,payload)
        VALUES($1,$2,'meeting.proposal.accepted',$3,$4)`,
      [session.organizationId, session.workspaceId, proposalId, { callId:proposal.call_id, commitmentId:taskId }]);
      return { proposal:acceptedProposal, task };
    });
  }

  async attachCommitment() { return null; }

  async rejectProposal(session, proposalId) {
    const { rows } = await this.pool.query(`UPDATE meeting_proposals
      SET status='rejected',rejected_by=$3,rejected_at=now(),updated_at=now()
      WHERE workspace_id=$1 AND id=$2 AND status='proposed'
      RETURNING id,proposal_type "proposalType",title,status,rejected_by "rejectedBy",rejected_at "rejectedAt"`,
    [session.workspaceId, proposalId, session.userId]);
    return rows[0] ?? null;
  }
}

export function createMeetingRepository(pool = null) {
  return pool ? new PostgresMeetingRepository(pool) : new MemoryMeetingRepository();
}
