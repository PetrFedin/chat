import { DomainError } from './commitment.js';

export const CallMode = Object.freeze({ AUDIO: 'audio', VIDEO: 'video' });
export const CallState = Object.freeze({ SCHEDULED: 'scheduled', RINGING: 'ringing', ACTIVE: 'active', ENDED: 'ended', CANCELLED: 'cancelled' });

const MODES = new Set(Object.values(CallMode));

function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new DomainError('INVALID_CALL_INPUT', `${field} is required`);
  return value.trim();
}

export function createCallSession(input) {
  const mode = input?.mode ?? CallMode.VIDEO;
  if (!MODES.has(mode)) throw new DomainError('INVALID_CALL_MODE', `Unsupported call mode: ${mode}`);
  const participantIds = [...new Set([text(input?.createdBy, 'createdBy'), ...(input?.participantIds ?? [])])];
  if (participantIds.length < 2) throw new DomainError('CALL_REQUIRES_PARTICIPANTS', 'Для звонка нужно минимум два участника');
  const scheduledFor = input?.scheduledFor ?? null;
  return Object.freeze({
    id: text(input?.id, 'id'),
    workspaceId: text(input?.workspaceId, 'workspaceId'),
    conversationId: text(input?.conversationId, 'conversationId'),
    calendarEventId: input?.calendarEventId ?? null,
    createdBy: input.createdBy,
    mode,
    title: input?.title?.trim() || null,
    participantIds: Object.freeze(participantIds),
    state: scheduledFor ? CallState.SCHEDULED : CallState.RINGING,
    scheduledFor,
    startedAt: null,
    endedAt: null,
    recordingStatus: 'off',
    createdAt: input?.createdAt ?? new Date().toISOString()
  });
}

export function startCall(call, { actorId, now = new Date().toISOString() }) {
  if (![CallState.SCHEDULED, CallState.RINGING].includes(call.state)) throw new DomainError('CALL_CANNOT_START', `Cannot start call from ${call.state}`);
  if (!call.participantIds.includes(actorId)) throw new DomainError('CALL_PARTICIPANT_REQUIRED', 'Начать звонок может только участник');
  return Object.freeze({ ...call, state: CallState.ACTIVE, startedAt: now });
}

export function endCall(call, { actorId, now = new Date().toISOString() }) {
  if (call.state !== CallState.ACTIVE) throw new DomainError('CALL_NOT_ACTIVE', 'Завершить можно только активный звонок');
  if (!call.participantIds.includes(actorId)) throw new DomainError('CALL_PARTICIPANT_REQUIRED', 'Завершить звонок может только участник');
  return Object.freeze({ ...call, state: CallState.ENDED, endedAt: now });
}

export function enableRecording(call, { actorId, consentedParticipantIds = [] }) {
  if (call.state !== CallState.ACTIVE) throw new DomainError('CALL_NOT_ACTIVE', 'Запись требует активного звонка');
  if (!call.participantIds.includes(actorId)) throw new DomainError('CALL_PARTICIPANT_REQUIRED', 'Запросить запись может только участник');
  const consent = new Set(consentedParticipantIds);
  if (!call.participantIds.every((id) => consent.has(id))) throw new DomainError('RECORDING_CONSENT_REQUIRED', 'Все нынешние участники должны согласиться на запись');
  return Object.freeze({ ...call, recordingStatus: 'recording', recordingStartedBy: actorId });
}
