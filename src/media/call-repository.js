import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : structuredClone(value);

function callView(call, participants = [], recordings = []) {
  return { ...call, participants: clone(participants), recordings: clone(recordings) };
}

export class MemoryCallRepository {
  constructor() {
    this.calls = new Map();
    this.participants = new Map();
    this.recordings = new Map();
  }

  participantKey(callId, userId) { return `${callId}:${userId}`; }

  async create(session, value) {
    const id = randomUUID();
    const createdAt = now();
    const call = {
      id,
      organizationId: session.organizationId,
      workspaceId: session.workspaceId,
      conversationId: value.conversationId,
      calendarEventId: value.calendarEventId ?? null,
      createdBy: session.userId,
      title: value.title ?? null,
      mode: value.mode ?? 'video',
      state: value.scheduledFor ? 'scheduled' : 'ringing',
      scheduledFor: value.scheduledFor ?? null,
      startedAt: null,
      endedAt: null,
      recordingStatus: 'off',
      provider: 'livekit',
      providerRoomName: value.providerRoomName,
      createdAt,
      lastActivityAt: createdAt,
    };
    this.calls.set(id, call);
    for (const userId of new Set([session.userId, ...(value.participantIds ?? [])])) {
      this.participants.set(this.participantKey(id, userId), {
        callId: id,
        workspaceId: session.workspaceId,
        userId,
        joinedAt: null,
        leftAt: null,
        audioEnabled: true,
        videoEnabled: value.mode !== 'audio',
        screenSharing: false,
        recordingConsentedAt: null,
        connectionState: 'invited',
      });
    }
    return this.get(session, id);
  }

  async get(session, callId) {
    const call = this.calls.get(callId);
    if (!call || call.workspaceId !== session.workspaceId) return null;
    const participants = [...this.participants.values()].filter((p) => p.callId === callId);
    const recordings = [...this.recordings.values()].filter((r) => r.callId === callId);
    return callView(clone(call), participants, recordings);
  }

  async join(session, callId) {
    const call = this.calls.get(callId);
    if (!call || call.workspaceId !== session.workspaceId) return null;
    const key = this.participantKey(callId, session.userId);
    const participant = this.participants.get(key) ?? {
      callId,
      workspaceId: session.workspaceId,
      userId: session.userId,
      audioEnabled: true,
      videoEnabled: call.mode !== 'audio',
      screenSharing: false,
      recordingConsentedAt: null,
    };
    participant.joinedAt ??= now();
    participant.leftAt = null;
    participant.connectionState = 'connected';
    participant.lastMediaAt = now();
    this.participants.set(key, participant);
    if (['scheduled', 'ringing'].includes(call.state)) {
      call.state = 'active';
      call.startedAt ??= now();
    }
    call.lastActivityAt = now();
    return this.get(session, callId);
  }

  async leave(session, callId) {
    const key = this.participantKey(callId, session.userId);
    const participant = this.participants.get(key);
    if (!participant) return null;
    participant.leftAt = now();
    participant.connectionState = 'disconnected';
    const active = [...this.participants.values()].filter((p) => p.callId === callId && p.joinedAt && !p.leftAt);
    const call = this.calls.get(callId);
    if (call && active.length === 0 && call.state === 'active') {
      call.state = 'ended';
      call.endedAt = now();
    }
    return this.get(session, callId);
  }

  async setMedia(session, callId, value) {
    const participant = this.participants.get(this.participantKey(callId, session.userId));
    if (!participant) return null;
    if (typeof value.audioEnabled === 'boolean') participant.audioEnabled = value.audioEnabled;
    if (typeof value.videoEnabled === 'boolean') participant.videoEnabled = value.videoEnabled;
    if (typeof value.screenSharing === 'boolean') participant.screenSharing = value.screenSharing;
    if (value.connectionState) participant.connectionState = value.connectionState;
    participant.lastMediaAt = now();
    return clone(participant);
  }

  async consentRecording(session, callId) {
    const participant = this.participants.get(this.participantKey(callId, session.userId));
    if (!participant) return null;
    participant.recordingConsentedAt = now();
    return clone(participant);
  }

  async recordingConsentReady(session, callId) {
    const active = [...this.participants.values()].filter((p) => p.callId === callId && p.joinedAt && !p.leftAt);
    return active.length > 0 && active.every((p) => p.recordingConsentedAt);
  }

  async startRecording(session, callId, value) {
    const recording = {
      id: value.recordingId,
      organizationId: session.organizationId,
      workspaceId: session.workspaceId,
      callId,
      provider: 'livekit',
      providerRecordingId: value.providerRecordingId,
      storageKey: value.storageKey,
      transcriptionProviderRecordingId: value.transcriptionProviderRecordingId ?? null,
      transcriptionStorageKey: value.transcriptionStorageKey ?? null,
      transcriptionSourceStatus: value.transcriptionProviderRecordingId ? (value.transcriptionSourceStatus ?? 'recording') : 'not_requested',
      transcriptionSourceError: null,
      status: 'recording',
      startedBy: session.userId,
      startedAt: now(),
      transcriptStatus: 'not_requested',
      summaryStatus: 'not_requested',
    };
    this.recordings.set(recording.id, recording);
    const call = this.calls.get(callId);
    if (call) call.recordingStatus = 'recording';
    return clone(recording);
  }

  async stopRecording(session, callId) {
    const recording = [...this.recordings.values()].filter((r) => r.callId === callId && r.status === 'recording').at(-1);
    if (!recording) return null;
    recording.status = 'processing';
    if (recording.transcriptionProviderRecordingId && recording.transcriptionSourceStatus === 'recording') recording.transcriptionSourceStatus = 'processing';
    recording.stoppedAt = now();
    const call = this.calls.get(callId);
    if (call) call.recordingStatus = 'processing';
    return clone(recording);
  }

  async end(session, callId) {
    const call = this.calls.get(callId);
    if (!call || call.workspaceId !== session.workspaceId) return null;
    call.state = 'ended';
    call.endedAt ??= now();
    for (const participant of this.participants.values()) {
      if (participant.callId === callId && participant.joinedAt && !participant.leftAt) {
        participant.leftAt = call.endedAt;
        participant.connectionState = 'disconnected';
      }
    }
    return this.get(session, callId);
  }
}

export class PostgresCallRepository {
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
    } finally { client.release(); }
  }

  async create(session, value) {
    const id = randomUUID();
    await this.tx(async (c) => {
      await c.query(`INSERT INTO call_sessions(
        id,organization_id,workspace_id,conversation_id,calendar_event_id,created_by,title,mode,state,scheduled_for,provider,provider_room_name
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'livekit',$11)`, [
        id, session.organizationId, session.workspaceId, value.conversationId, value.calendarEventId ?? null,
        session.userId, value.title ?? null, value.mode ?? 'video', value.scheduledFor ? 'scheduled' : 'ringing',
        value.scheduledFor ?? null, value.providerRoomName,
      ]);
      for (const userId of new Set([session.userId, ...(value.participantIds ?? [])])) {
        await c.query(`INSERT INTO call_participants(
          organization_id,workspace_id,call_id,user_id,audio_enabled,video_enabled,connection_state
        ) VALUES($1,$2,$3,$4,true,$5,'invited')`, [
          session.organizationId, session.workspaceId, id, userId, (value.mode ?? 'video') !== 'audio',
        ]);
      }
    });
    return this.get(session, id);
  }

  async get(session, callId) {
    const { rows } = await this.pool.query(`SELECT
      id,conversation_id "conversationId",calendar_event_id "calendarEventId",created_by "createdBy",title,mode,state,
      scheduled_for "scheduledFor",started_at "startedAt",ended_at "endedAt",recording_status "recordingStatus",
      provider,provider_room_name "providerRoomName",created_at "createdAt",last_activity_at "lastActivityAt"
      FROM call_sessions WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, callId]);
    if (!rows[0]) return null;
    const participants = (await this.pool.query(`SELECT user_id "userId",joined_at "joinedAt",left_at "leftAt",
      audio_enabled "audioEnabled",video_enabled "videoEnabled",screen_sharing "screenSharing",
      recording_consented_at "recordingConsentedAt",connection_state "connectionState",last_media_at "lastMediaAt"
      FROM call_participants WHERE workspace_id=$1 AND call_id=$2 ORDER BY joined_at NULLS FIRST,user_id`, [session.workspaceId, callId])).rows;
    const recordings = (await this.pool.query(`SELECT id,provider,provider_recording_id "providerRecordingId",storage_key "storageKey",status,
      transcription_provider_recording_id "transcriptionProviderRecordingId",transcription_storage_key "transcriptionStorageKey",
      transcription_source_status "transcriptionSourceStatus",transcription_source_error "transcriptionSourceError",
      started_by "startedBy",started_at "startedAt",stopped_at "stoppedAt",transcript_status "transcriptStatus",
      summary_status "summaryStatus" FROM call_recordings WHERE workspace_id=$1 AND call_id=$2 ORDER BY created_at`, [session.workspaceId, callId])).rows;
    return callView(rows[0], participants, recordings);
  }

  async join(session, callId) {
    await this.tx(async (c) => {
      const call = (await c.query('SELECT mode FROM call_sessions WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [session.workspaceId, callId])).rows[0];
      if (!call) return;
      await c.query(`INSERT INTO call_participants(
        organization_id,workspace_id,call_id,user_id,joined_at,audio_enabled,video_enabled,connection_state,last_media_at
      ) VALUES($1,$2,$3,$4,now(),true,$5,'connected',now())
      ON CONFLICT(workspace_id,call_id,user_id) DO UPDATE SET
        joined_at=COALESCE(call_participants.joined_at,now()),left_at=NULL,connection_state='connected',last_media_at=now()`,
      [session.organizationId, session.workspaceId, callId, session.userId, call.mode !== 'audio']);
      await c.query(`UPDATE call_sessions SET state=CASE WHEN state IN('scheduled','ringing') THEN 'active' ELSE state END,
        started_at=CASE WHEN state IN('scheduled','ringing') THEN COALESCE(started_at,now()) ELSE started_at END,last_activity_at=now()
        WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, callId]);
    });
    return this.get(session, callId);
  }

  async leave(session, callId) {
    await this.tx(async (c) => {
      await c.query(`UPDATE call_participants SET left_at=now(),connection_state='disconnected',last_media_at=now()
        WHERE workspace_id=$1 AND call_id=$2 AND user_id=$3`, [session.workspaceId, callId, session.userId]);
      const active = Number((await c.query(`SELECT count(*) n FROM call_participants WHERE workspace_id=$1 AND call_id=$2 AND joined_at IS NOT NULL AND left_at IS NULL`, [session.workspaceId, callId])).rows[0].n);
      if (!active) await c.query(`UPDATE call_sessions SET state=CASE WHEN state='active' THEN 'ended' ELSE state END,
        ended_at=CASE WHEN state='active' THEN COALESCE(ended_at,now()) ELSE ended_at END,last_activity_at=now() WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, callId]);
    });
    return this.get(session, callId);
  }

  async setMedia(session, callId, value) {
    const { rows } = await this.pool.query(`UPDATE call_participants SET
      audio_enabled=COALESCE($4,audio_enabled),video_enabled=COALESCE($5,video_enabled),screen_sharing=COALESCE($6,screen_sharing),
      connection_state=COALESCE($7,connection_state),last_media_at=now()
      WHERE workspace_id=$1 AND call_id=$2 AND user_id=$3
      RETURNING user_id "userId",audio_enabled "audioEnabled",video_enabled "videoEnabled",screen_sharing "screenSharing",connection_state "connectionState"`,
    [session.workspaceId, callId, session.userId, value.audioEnabled, value.videoEnabled, value.screenSharing, value.connectionState]);
    return rows[0] ?? null;
  }

  async consentRecording(session, callId) {
    const { rows } = await this.pool.query(`UPDATE call_participants SET recording_consented_at=now()
      WHERE workspace_id=$1 AND call_id=$2 AND user_id=$3
      RETURNING user_id "userId",recording_consented_at "recordingConsentedAt"`, [session.workspaceId, callId, session.userId]);
    return rows[0] ?? null;
  }

  async recordingConsentReady(session, callId) {
    const { rows } = await this.pool.query(`SELECT count(*) FILTER(WHERE joined_at IS NOT NULL AND left_at IS NULL) active,
      count(*) FILTER(WHERE joined_at IS NOT NULL AND left_at IS NULL AND recording_consented_at IS NOT NULL) consented
      FROM call_participants WHERE workspace_id=$1 AND call_id=$2`, [session.workspaceId, callId]);
    return Number(rows[0].active) > 0 && Number(rows[0].active) === Number(rows[0].consented);
  }

  async startRecording(session, callId, value) {
    const { rows } = await this.pool.query(`INSERT INTO call_recordings(
      id,organization_id,workspace_id,call_id,provider,provider_recording_id,storage_key,status,started_by,
      transcription_provider_recording_id,transcription_storage_key,transcription_source_status
      ) VALUES($1,$2,$3,$4,'livekit',$5,$6,'recording',$7,$8,$9,$10)
      RETURNING id,provider,provider_recording_id "providerRecordingId",storage_key "storageKey",status,
        transcription_provider_recording_id "transcriptionProviderRecordingId",transcription_storage_key "transcriptionStorageKey",
        transcription_source_status "transcriptionSourceStatus",started_at "startedAt"`,
    [value.recordingId, session.organizationId, session.workspaceId, callId, value.providerRecordingId, value.storageKey, session.userId,
      value.transcriptionProviderRecordingId ?? null, value.transcriptionStorageKey ?? null,
      value.transcriptionProviderRecordingId ? (value.transcriptionSourceStatus ?? 'recording') : 'not_requested']);
    await this.pool.query(`UPDATE call_sessions SET recording_status='recording',last_activity_at=now() WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, callId]);
    return rows[0];
  }

  async stopRecording(session, callId) {
    const { rows } = await this.pool.query(`UPDATE call_recordings SET status='processing',stopped_at=now(),updated_at=now(),
      transcription_source_status=CASE
        WHEN transcription_provider_recording_id IS NOT NULL AND transcription_source_status='recording' THEN 'processing'
        ELSE transcription_source_status END
      WHERE id=(SELECT id FROM call_recordings WHERE workspace_id=$1 AND call_id=$2 AND status='recording' ORDER BY created_at DESC LIMIT 1)
      RETURNING id,provider_recording_id "providerRecordingId",storage_key "storageKey",status,stopped_at "stoppedAt",
        transcription_provider_recording_id "transcriptionProviderRecordingId",transcription_storage_key "transcriptionStorageKey",
        transcription_source_status "transcriptionSourceStatus"`, [session.workspaceId, callId]);
    if (rows[0]) await this.pool.query(`UPDATE call_sessions SET recording_status='processing',last_activity_at=now() WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, callId]);
    return rows[0] ?? null;
  }

  async end(session, callId) {
    await this.tx(async (c) => {
      await c.query(`UPDATE call_sessions SET state='ended',ended_at=COALESCE(ended_at,now()),last_activity_at=now() WHERE workspace_id=$1 AND id=$2`, [session.workspaceId, callId]);
      await c.query(`UPDATE call_participants SET left_at=COALESCE(left_at,now()),connection_state='disconnected' WHERE workspace_id=$1 AND call_id=$2 AND joined_at IS NOT NULL`, [session.workspaceId, callId]);
    });
    return this.get(session, callId);
  }
}

export function createCallRepository(pool = null) {
  return pool ? new PostgresCallRepository(pool) : new MemoryCallRepository();
}
