export const CommitmentStatus = Object.freeze({
  INBOX: 'inbox',
  CLARIFY: 'clarify',
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  IN_REVIEW: 'in_review',
  ACCEPTED_RESULT: 'accepted_result',
  CLOSED: 'closed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  DEFERRED: 'deferred'
});

const transitions = new Map([
  ['inbox', new Set(['clarify', 'proposed', 'cancelled'])],
  ['clarify', new Set(['proposed', 'cancelled'])],
  ['proposed', new Set(['accepted', 'rejected', 'clarify'])],
  ['accepted', new Set(['scheduled', 'in_progress', 'deferred', 'cancelled'])],
  ['scheduled', new Set(['in_progress', 'blocked', 'deferred', 'cancelled'])],
  ['in_progress', new Set(['blocked', 'in_review', 'deferred', 'cancelled'])],
  ['blocked', new Set(['in_progress', 'deferred', 'cancelled'])],
  ['in_review', new Set(['accepted_result', 'in_progress'])],
  ['accepted_result', new Set(['closed', 'in_progress'])],
  ['deferred', new Set(['accepted', 'scheduled', 'cancelled'])],
  ['closed', new Set([])],
  ['rejected', new Set([])],
  ['cancelled', new Set([])]
]);

export class DomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export function createCommitment(input) {
  const required = ['id', 'workspaceId', 'title', 'outcome', 'ownerId', 'requesterId', 'acceptorId'];
  for (const key of required) {
    if (!input[key] || String(input[key]).trim() === '') {
      throw new DomainError('INVALID_COMMITMENT', `${key} is required`);
    }
  }
  if (Array.isArray(input.ownerId)) {
    throw new DomainError('ONE_ACCOUNTABLE_OWNER', 'A commitment must have exactly one accountable owner');
  }
  const now = input.now ?? new Date().toISOString();
  return Object.freeze({
    id: input.id,
    workspaceId: input.workspaceId,
    title: input.title,
    outcome: input.outcome,
    ownerId: input.ownerId,
    requesterId: input.requesterId,
    acceptorId: input.acceptorId,
    promisedAt: input.promisedAt ?? null,
    forecastAt: input.forecastAt ?? null,
    source: input.source ?? null,
    status: CommitmentStatus.PROPOSED,
    version: 1,
    evidence: [],
    calendarBlocks: [],
    audit: [{ type: 'commitment.created', at: now, actorId: input.requesterId }]
  });
}

function appendAudit(commitment, event, actorId, now, details = {}) {
  return {
    ...commitment,
    version: commitment.version + 1,
    audit: [...commitment.audit, { type: event, at: now, actorId, ...details }]
  };
}

export function transition(commitment, to, { actorId, reason = null, now = new Date().toISOString() }) {
  if (!transitions.get(commitment.status)?.has(to)) {
    throw new DomainError('INVALID_TRANSITION', `${commitment.status} -> ${to} is not allowed`);
  }
  if (['deferred', 'cancelled'].includes(to) && !reason) {
    throw new DomainError('REASON_REQUIRED', `Reason is required for ${to}`);
  }
  if (to === 'accepted' && actorId !== commitment.ownerId) {
    throw new DomainError('OWNER_MUST_ACCEPT', 'Only the accountable owner can accept responsibility');
  }
  if (to === 'accepted_result' && actorId !== commitment.acceptorId) {
    throw new DomainError('ACCEPTOR_MUST_ACCEPT_RESULT', 'Only the designated acceptor can accept the result');
  }
  if (to === 'in_review' && commitment.evidence.length === 0) {
    throw new DomainError('EVIDENCE_REQUIRED', 'Execution evidence is required before review');
  }
  return Object.freeze({
    ...appendAudit(commitment, 'commitment.transitioned', actorId, now, { from: commitment.status, to, reason }),
    status: to
  });
}

export function addCalendarBlock(commitment, block, { actorId, now = new Date().toISOString() }) {
  if (!block?.id || !block?.startAt || !block?.endAt) {
    throw new DomainError('INVALID_CALENDAR_BLOCK', 'Calendar block requires id, startAt and endAt');
  }
  if (Date.parse(block.endAt) <= Date.parse(block.startAt)) {
    throw new DomainError('INVALID_CALENDAR_RANGE', 'Calendar block endAt must be after startAt');
  }
  return Object.freeze({
    ...appendAudit(commitment, 'calendar.block_linked', actorId, now, { calendarBlockId: block.id }),
    calendarBlocks: [...commitment.calendarBlocks, Object.freeze({ ...block })]
  });
}

export function addEvidence(commitment, evidence, { actorId, now = new Date().toISOString() }) {
  if (!evidence?.id || !evidence?.type || !evidence?.value) {
    throw new DomainError('INVALID_EVIDENCE', 'Evidence requires id, type and value');
  }
  return Object.freeze({
    ...appendAudit(commitment, 'evidence.added', actorId, now, { evidenceId: evidence.id }),
    evidence: [...commitment.evidence, Object.freeze({ ...evidence, addedBy: actorId, addedAt: now })]
  });
}

export function reschedule(commitment, { promisedAt, forecastAt, actorId, reason, now = new Date().toISOString() }) {
  if (!reason) throw new DomainError('REASON_REQUIRED', 'Rescheduling requires a reason');
  return Object.freeze({
    ...appendAudit(commitment, 'commitment.rescheduled', actorId, now, {
      previousPromisedAt: commitment.promisedAt,
      promisedAt: promisedAt ?? commitment.promisedAt,
      previousForecastAt: commitment.forecastAt,
      forecastAt: forecastAt ?? commitment.forecastAt,
      reason
    }),
    promisedAt: promisedAt ?? commitment.promisedAt,
    forecastAt: forecastAt ?? commitment.forecastAt
  });
}
