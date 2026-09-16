import { createHash, randomUUID } from 'node:crypto';
import {
  AccessToken,
  EncodedFileOutput,
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
      serverUrl: this.enabled ? clientUrl(this.url) : null,
    };
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

  async startRecording({ workspaceId, callId, roomName }) {
    if (!this.recordingEnabled) {
      const error = new Error('Call recording is not configured');
      error.code = 'RECORDING_PROVIDER_UNAVAILABLE';
      error.statusCode = 503;
      throw error;
    }
    const recordingId = randomUUID();
    const filepath = `recordings/${workspaceId}/${callId}/${recordingId}.mp4`;
    const fileOutput = new EncodedFileOutput({
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
    const info = await this.api.egress.startRoomCompositeEgress(roomName, {
      file: fileOutput,
      layout: 'grid',
    });
    return {
      recordingId,
      providerRecordingId: info.egressId,
      storageKey: filepath,
      status: 'recording',
    };
  }

  async stopRecording(providerRecordingId) {
    if (!this.enabled || !providerRecordingId) return null;
    return this.api.egress.stopEgress(providerRecordingId);
  }
}

export function createMediaProvider(env = process.env) {
  return new LiveKitMediaProvider(env);
}
