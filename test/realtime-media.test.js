import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryCallRepository } from '../src/media/call-repository.js';
import { LiveKitMediaProvider, opaqueRoomName } from '../src/media/livekit-provider.js';
import { LocalObjectStore } from '../src/storage/object-store.js';

const session = {
  organizationId: '00000000-0000-0000-0000-000000000001',
  workspaceId: '10000000-0000-0000-0000-000000000001',
  userId: '90000000-0000-0000-0000-000000000001',
  displayName: 'Owner',
};
const secondUser = '90000000-0000-0000-0000-000000000002';

test('opaque room names are deterministic and do not expose workspace id', () => {
  const first = opaqueRoomName(session.workspaceId, 'call-1');
  const second = opaqueRoomName(session.workspaceId, 'call-1');
  assert.equal(first, second);
  assert.match(first, /^chat-[a-f0-9]{32}$/);
  assert.equal(first.includes(session.workspaceId), false);
});

test('media provider is explicitly disabled without LiveKit secrets', () => {
  const provider = new LiveKitMediaProvider({});
  assert.deepEqual(provider.status(), {
    provider: 'livekit',
    enabled: false,
    recordingEnabled: false,
    transcriptionSidecarEnabled: false,
    serverUrl: null,
  });
});

test('recording can explicitly add an audio-only OGG transcription sidecar without replacing archive MP4', async () => {
  const provider = new LiveKitMediaProvider({
    LIVEKIT_URL: 'https://livekit.example.com',
    LIVEKIT_API_KEY: 'api-key',
    LIVEKIT_API_SECRET: 'api-secret',
    LIVEKIT_EGRESS_ENABLED: 'true',
    LIVEKIT_TRANSCRIPTION_EGRESS_ENABLED: 'true',
    S3_BUCKET: 'meeting-bucket',
    S3_REGION: 'test-region',
    S3_ENDPOINT: 'https://s3.example.com',
    S3_ACCESS_KEY_ID: 'access',
    S3_SECRET_ACCESS_KEY: 'secret',
  });
  const starts = [];
  const stops = [];
  provider.api = {
    egress: {
      async startRoomCompositeEgress(...args) {
        starts.push(args);
        return { egressId: `EG_${starts.length}` };
      },
      async stopEgress(id) { stops.push(id); return { egressId:id, status:3 }; },
      async listEgress() { return []; },
    },
  };

  const result = await provider.startRecording({
    workspaceId: session.workspaceId,
    callId: 'call-1',
    roomName: 'room-1',
  });

  assert.equal(provider.status().transcriptionSidecarEnabled, true);
  assert.equal(starts.length, 2);
  assert.equal(starts[0][0], 'room-1');
  assert.equal(starts[0][2].layout, 'grid');
  assert.equal(starts[0][2].audioOnly, undefined);
  assert.match(starts[0][1].file.filepath, /\.mp4$/);
  assert.equal(starts[1][0], 'room-1');
  assert.equal(starts[1][2].audioOnly, true);
  assert.match(starts[1][1].file.filepath, /\.transcription\.ogg$/);
  assert.equal(result.providerRecordingId, 'EG_1');
  assert.equal(result.transcriptionProviderRecordingId, 'EG_2');
  assert.equal(result.transcriptionSourceStatus, 'recording');

  await provider.stopRecording(result.providerRecordingId, result.transcriptionProviderRecordingId);
  assert.deepEqual(stops, ['EG_1', 'EG_2']);
});

test('archive recording remains single-egress when transcription sidecar is not explicitly enabled', async () => {
  const provider = new LiveKitMediaProvider({
    LIVEKIT_URL: 'https://livekit.example.com',
    LIVEKIT_API_KEY: 'api-key',
    LIVEKIT_API_SECRET: 'api-secret',
    LIVEKIT_EGRESS_ENABLED: 'true',
    S3_BUCKET: 'meeting-bucket',
  });
  const starts = [];
  provider.api = { egress:{ async startRoomCompositeEgress(...args){starts.push(args);return{egressId:'EG_ARCHIVE'}} } };
  const result = await provider.startRecording({ workspaceId:session.workspaceId, callId:'call-2', roomName:'room-2' });
  assert.equal(starts.length, 1);
  assert.equal(result.transcriptionProviderRecordingId, null);
  assert.equal(result.transcriptionStorageKey, null);
  assert.equal(result.transcriptionSourceStatus, 'not_requested');
});

test('call repository tracks join, media state, consent and automatic end', async () => {
  const repo = new MemoryCallRepository();
  const call = await repo.create(session, {
    conversationId: '20000000-0000-0000-0000-000000000001',
    mode: 'video',
    participantIds: [secondUser],
    providerRoomName: opaqueRoomName(session.workspaceId, 'call-placeholder'),
  });
  assert.equal(call.state, 'ringing');
  assert.equal(call.participants.length, 2);

  const active = await repo.join(session, call.id);
  assert.equal(active.state, 'active');
  assert.equal(active.participants.find((p) => p.userId === session.userId).connectionState, 'connected');

  const media = await repo.setMedia(session, call.id, { audioEnabled: false, screenSharing: true });
  assert.equal(media.audioEnabled, false);
  assert.equal(media.screenSharing, true);

  assert.equal(await repo.recordingConsentReady(session, call.id), false);
  await repo.consentRecording(session, call.id);
  assert.equal(await repo.recordingConsentReady(session, call.id), true);

  const ended = await repo.leave(session, call.id);
  assert.equal(ended.state, 'ended');
});

test('local object storage round-trips bytes and deletes them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chat-object-store-'));
  try {
    const store = new LocalObjectStore(root);
    const key = 'workspace/file.txt';
    await store.put(key, Buffer.from('hello'), 'text/plain');
    assert.equal((await store.get(key)).toString(), 'hello');
    await store.delete(key);
    await assert.rejects(() => store.get(key));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
