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
    serverUrl: null,
  });
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
