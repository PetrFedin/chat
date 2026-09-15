import { DomainError } from './commitment.js';

export const CalendarEventKind = Object.freeze({
  MEETING: 'meeting',
  FOCUS: 'focus',
  TASK_BLOCK: 'task_block',
  DEADLINE: 'deadline',
  REMINDER: 'reminder',
  MILESTONE: 'milestone',
  OTHER: 'other'
});

export const CalendarVisibility = Object.freeze({
  PRIVATE: 'private',
  WORKSPACE: 'workspace',
  PARTICIPANTS: 'participants'
});

const EVENT_KINDS = new Set(Object.values(CalendarEventKind));
const VISIBILITIES = new Set(Object.values(CalendarVisibility));
const RANGE_REQUIRED = new Set([CalendarEventKind.MEETING, CalendarEventKind.FOCUS, CalendarEventKind.TASK_BLOCK]);

function text(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DomainError('INVALID_CALENDAR_EVENT', `${field} is required`);
  return value.trim();
}

function instant(value, field) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new DomainError('INVALID_CALENDAR_TIME', `${field} must be a valid timestamp`);
  return value;
}

function normalizeParticipants(ownerId, participantIds = []) {
  if (!Array.isArray(participantIds)) throw new DomainError('INVALID_CALENDAR_PARTICIPANTS', 'participantIds must be an array');
  return Object.freeze([...new Set([ownerId, ...participantIds].filter(Boolean))]);
}

export function createCalendarEvent(input) {
  const id = text(input?.id, 'id');
  const workspaceId = text(input?.workspaceId, 'workspaceId');
  const ownerId = text(input?.ownerId, 'ownerId');
  const title = text(input?.title, 'title');
  const kind = text(input?.kind, 'kind');
  const visibility = input.visibility ?? CalendarVisibility.PARTICIPANTS;
  if (!EVENT_KINDS.has(kind)) throw new DomainError('INVALID_CALENDAR_KIND', `Unsupported calendar event kind: ${kind}`);
  if (!VISIBILITIES.has(visibility)) throw new DomainError('INVALID_CALENDAR_VISIBILITY', `Unsupported calendar visibility: ${visibility}`);
  const startAt = instant(input.startAt, 'startAt');
  const endAt = input.endAt == null ? null : instant(input.endAt, 'endAt');
  if (RANGE_REQUIRED.has(kind) && !endAt) throw new DomainError('CALENDAR_END_REQUIRED', `${kind} events require endAt`);
  if (endAt && Date.parse(endAt) <= Date.parse(startAt)) throw new DomainError('INVALID_CALENDAR_RANGE', 'Calendar event endAt must be after startAt');
  const timezone = text(input.timezone ?? 'UTC', 'timezone');
  const createdAt = input.createdAt ?? new Date().toISOString();
  return Object.freeze({
    id,
    workspaceId,
    kind,
    title,
    description: input.description?.trim() || null,
    ownerId,
    startAt,
    endAt,
    timezone,
    allDay: Boolean(input.allDay),
    visibility,
    participantIds: normalizeParticipants(ownerId, input.participantIds),
    commitmentId: input.commitmentId ?? null,
    conversationId: input.conversationId ?? null,
    recurrenceRule: input.recurrenceRule ?? null,
    version: 1,
    createdAt,
    updatedAt: createdAt
  });
}

export function rescheduleCalendarEvent(event, { startAt, endAt = event.endAt, actorId, reason, now = new Date().toISOString() }) {
  if (!actorId) throw new DomainError('CALENDAR_ACTOR_REQUIRED', 'actorId is required');
  if (typeof reason !== 'string' || reason.trim().length === 0) throw new DomainError('REASON_REQUIRED', 'Calendar rescheduling requires a reason');
  const nextStart = instant(startAt, 'startAt');
  const nextEnd = endAt == null ? null : instant(endAt, 'endAt');
  if (RANGE_REQUIRED.has(event.kind) && !nextEnd) throw new DomainError('CALENDAR_END_REQUIRED', `${event.kind} events require endAt`);
  if (nextEnd && Date.parse(nextEnd) <= Date.parse(nextStart)) throw new DomainError('INVALID_CALENDAR_RANGE', 'Calendar event endAt must be after startAt');
  return Object.freeze({
    ...event,
    startAt: nextStart,
    endAt: nextEnd,
    version: event.version + 1,
    updatedAt: now,
    lastChange: Object.freeze({
      type: 'calendar.rescheduled',
      actorId,
      reason: reason.trim(),
      previousStartAt: event.startAt,
      previousEndAt: event.endAt,
      at: now
    })
  });
}
