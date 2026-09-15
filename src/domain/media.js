import { DomainError } from './commitment.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_VOICE_DURATION_MS = 60 * 60 * 1000;

function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new DomainError('INVALID_MEDIA_INPUT', `${field} is required`);
  return value.trim();
}

export function createFileAsset(input) {
  const sizeBytes = Number(input?.sizeBytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FILE_BYTES) {
    throw new DomainError('INVALID_FILE_SIZE', `sizeBytes must be between 1 and ${MAX_FILE_BYTES}`);
  }
  return Object.freeze({
    id: text(input?.id, 'id'),
    workspaceId: text(input?.workspaceId, 'workspaceId'),
    uploadedBy: text(input?.uploadedBy, 'uploadedBy'),
    name: text(input?.name, 'name'),
    mimeType: text(input?.mimeType, 'mimeType'),
    sizeBytes,
    storageKey: text(input?.storageKey, 'storageKey'),
    sha256: input?.sha256 ? text(input.sha256, 'sha256') : null,
    status: input?.status ?? 'ready',
    createdAt: input?.createdAt ?? new Date().toISOString()
  });
}

export function createVoiceMessage(input) {
  const durationMs = Number(input?.durationMs);
  if (!Number.isInteger(durationMs) || durationMs < 250 || durationMs > MAX_VOICE_DURATION_MS) {
    throw new DomainError('INVALID_VOICE_DURATION', 'Voice duration must be between 250 ms and 60 minutes');
  }
  return Object.freeze({
    id: text(input?.id, 'id'),
    workspaceId: text(input?.workspaceId, 'workspaceId'),
    messageId: text(input?.messageId, 'messageId'),
    fileId: text(input?.fileId, 'fileId'),
    durationMs,
    waveform: Object.freeze(Array.isArray(input?.waveform) ? [...input.waveform] : []),
    transcriptStatus: input?.transcriptStatus ?? 'not_requested',
    transcript: input?.transcript ?? null,
    createdAt: input?.createdAt ?? new Date().toISOString()
  });
}
