import { createHash, randomUUID } from 'node:crypto';
import {
  AccessToken,
  EncodedFileOutput,
  EncodedFileType,
  LiveKitAPI,
  S3Upload,
} from 'livekit-server-sdk';

function boolEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}

function apiHost(url) {
  return String(url ?? '').replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/$/, '');
}

function clientUrl(url) {
  const value = String(url ?? '').replace(/\/$/, '');
  if (value.startsWith('https://')) return value.replace(/^https:/, 'wss:');
  if (value.startsWith('http://')) return value.replace(/^http:/, 'ws:');
  return value;
}

export function opaqueRoomName(workspaceId, seed) {
  const digest = createHash('sha256').update(`${workspaceId}:${seed}`, 'utf8').digest('hex');
  return `chat-${digest.slice(0, 32)}`;
}

export class LiveKitMediaProvider {
  constructor(env = process.env) {
    this.url = env.LIVEKIT_URL ?? null;
    this.apiKey = env.LIVEKIT_API_KEY ?? null;
    this.apiSecret = env.LIVEKIT_API_SECRET ?? null;
    this.enabled = Boolean(this.url && this.apiKey && this.apiSecret);
    this.recordingEnabled = this.enabled && boolEnv(env.LIVEKIT_EGRESS_ENABLED) && Boolean(env.S3_BUCKET);
    this.transcriptionSidecarEnabled = this.recordingEnabled && boolEnv(env.LIVEKIT_TRANSCRIPTION_EGRESS_ENABLED);
    this.s3 = {
      bucket: env.S3_BUCKET ?? null,
      region: env.S3_REGION ?? '',
      endpoint: env.S3_ENDPOINT ?? '',
      accessKey: env.S3_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID ?? '',
      secret: env.S3_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY ?? '',
      forcePathStyle: boolEnv(env.S3_FORCE_PATH_STYLE),
    };
    this.api = this.enabled
      ? new LiveKitAPI({ host: apiHost(this.url), apiKey: this.apiKey, secret: this.apiSecret })
      : null;
  }

  status() {
    return {
      provider: 'livekit',
      enabled: this.enabled,
      recordingEnabled: this.recordingEnabled,
      transcriptionSidecarEnabled: this.transcriptionSidecarEnabled,
      serverUrl: this.enabled ? clientUrl(this.url) : null,
    };
  }

  s3Output(filepath, fileType) {
    return new EncodedFileOutput({
      fileType,
      filepath,
      output: {
        case: 's3',
        value: new S3Upload({
          accessKey: this.s3.accessKey,
          secret: this.s3.secret,
          bucket: this.s3.bucket,
          region: this.s3.region,
          endpoint: this.s3.endpoint,
          forcePathStyle: this.s3.forcePathStyle,
        }),
      },
    });
  }

  async issueJoinCredential({ workspaceId, callId, roomName = null, userId, displayName, canPublish = true }) {
    if (!this.enabled) {
      const error = new Error('Realtime media provider is not configured');
      error.code = 'MEDIA_PROVIDER_UNAVAILABLE';
      error.statusCode = 503;
      throw error;
    }
    const resolvedRoomName = roomName || opaqueRoomName(workspaceId, callId);
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: userId,
      name: displayName || undefined,
      ttl: '15m',
      metadata: JSON.stringify({ workspaceId, callId }),
    });
    token.addGrant({
      roomJoin: true,
      room: resolvedRoomName,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    });
    return {
      provider: 'livekit',
      roomName: resolvedRoomName,
      serverUrl: clientUrl(this.url),
      participantToken: await token.toJwt(),
    };
  }

  async stopEgressIdempotent(egressId) {
    if (!this.enabled || !egressId) return null;
    try {
      return await this.api.egress.stopEgress(egressId);
    } catch (error) {
      try {
        const items = await this.api.egress.listEgress({ egressId });
        const current = items?.[0] ?? null;
        if (current && Number(current.status) >= 3) return current;
      } catch {}
      throw error;
    }
  }

  async startRecording({ workspaceId, callId, roomName }) {
    if (!this.recordingEnabled) {
      const error = new Error('Call recording is not configured');
      error.code = 'RECORDING_PROVIDER_UNAVAILABLE';
      error.statusCode = 503;
      throw error;
    }
    const recordingId = randomUUID();
    const archivePath = `recordings/${workspaceId}/${callId}/${recordingId}.mp4`;
    const archiveInfo = await this.api.egress.startRoomCompositeEgress(
      roomName,
      { file: this.s3Output(archivePath, EncodedFileType.MP4) },
      { layout: 'grid' },
    );

    let transcriptionInfo = null;
    let transcriptionPath = null;
    if (this.transcriptionSidecarEnabled) {
      transcriptionPath = `recordings/${workspaceId}/${callId}/${recordingId}.transcription.ogg`;
      try {
        transcriptionInfo = await this.api.egress.startRoomCompositeEgress(
          roomName,
          { file: this.s3Output(transcriptionPath, EncodedFileType.OGG) },
          { audioOnly: true },
        );
      } catch (error) {
        await this.stopEgressIdempotent(archiveInfo.egressId).catch(() => {});
        throw error;
      }
    }

    return {
      recordingId,
      providerRecordingId: archiveInfo.egressId,
      storageKey: archivePath,
      transcriptionProviderRecordingId: transcriptionInfo?.egressId ?? null,
      transcriptionStorageKey: transcriptionPath,
      transcriptionSourceStatus: transcriptionInfo ? 'recording' : 'not_requested',
      status: 'recording',
    };
  }

  async stopRecording(providerRecordingId, transcriptionProviderRecordingId = null) {
    if (!this.enabled || !providerRecordingId) return null;
    const entries = [
      ['archive', providerRecordingId],
      ['transcription', transcriptionProviderRecordingId],
    ].filter(([, id]) => Boolean(id));
    const settled = await Promise.allSettled(entries.map(([, id]) => this.stopEgressIdempotent(id)));
    const result = {};
    const failures = [];
    settled.forEach((entry, index) => {
      const [kind] = entries[index];
      if (entry.status === 'fulfilled') result[kind] = entry.value;
      else failures.push({ kind, error: entry.reason });
    });
    if (failures.length) {
      const error = new Error(`Unable to stop ${failures.map((value) => value.kind).join(' and ')} recording egress`);
      error.code = 'RECORDING_STOP_PARTIAL';
      error.statusCode = 502;
      error.failures = failures;
      throw error;
    }
    return result;
  }
}

export function createMediaProvider(env = process.env) {
  return new LiveKitMediaProvider(env);
}
