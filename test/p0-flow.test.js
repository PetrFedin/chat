import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CommitmentStatus,
  createCommitment,
  transition,
  addCalendarBlock,
  addEvidence,
  reschedule
} from '../src/domain/commitment.js';
import { messageSource, assertTraceable } from '../src/domain/context.js';

const ids = { requester: 'u-requester', owner: 'u-owner', acceptor: 'u-acceptor' };

function base() {
  return createCommitment({
    id: 'task-1', workspaceId: 'ws-1',
    title: 'Ship the approved result',
    outcome: 'Accepted deliverable is available to requester',
    ownerId: ids.owner, requesterId: ids.requester, acceptorId: ids.acceptor,
    promisedAt: '2026-09-20T15:00:00Z',
    source: messageSource({ chatId: 'chat-1', threadId: 'thread-1', messageId: 'msg-7' }),
    now: '2026-09-15T12:00:00Z'
  });
}

test('golden path: message -> commitment -> calendar -> evidence -> acceptance', () => {
  let c = base();
  c = transition(c, CommitmentStatus.ACCEPTED, { actorId: ids.owner });
  c = addCalendarBlock(c, {
    id: 'block-1', startAt: '2026-09-18T09:00:00Z', endAt: '2026-09-18T11:00:00Z'
  }, { actorId: ids.owner });
  c = transition(c, CommitmentStatus.SCHEDULED, { actorId: ids.owner });
  c = transition(c, CommitmentStatus.IN_PROGRESS, { actorId: ids.owner });
  c = addEvidence(c, { id: 'ev-1', type: 'url', value: 'https://example.invalid/result/1' }, { actorId: ids.owner });
  c = transition(c, CommitmentStatus.IN_REVIEW, { actorId: ids.owner });
  c = transition(c, CommitmentStatus.ACCEPTED_RESULT, { actorId: ids.acceptor });
  assert.equal(assertTraceable(c), true);
  c = transition(c, CommitmentStatus.CLOSED, { actorId: ids.requester });
  assert.equal(c.status, 'closed');
  assert.ok(c.audit.length >= 8);
});

test('owner acceptance cannot be performed by requester', () => {
  assert.throws(() => transition(base(), 'accepted', { actorId: ids.requester }), { code: 'OWNER_MUST_ACCEPT' });
});

test('review cannot start without evidence', () => {
  let c = transition(base(), 'accepted', { actorId: ids.owner });
  c = transition(c, 'in_progress', { actorId: ids.owner });
  assert.throws(() => transition(c, 'in_review', { actorId: ids.owner }), { code: 'EVIDENCE_REQUIRED' });
});

test('only designated acceptor can accept result', () => {
  let c = transition(base(), 'accepted', { actorId: ids.owner });
  c = transition(c, 'in_progress', { actorId: ids.owner });
  c = addEvidence(c, { id: 'ev-1', type: 'file', value: 'artifact.pdf' }, { actorId: ids.owner });
  c = transition(c, 'in_review', { actorId: ids.owner });
  assert.throws(() => transition(c, 'accepted_result', { actorId: ids.owner }), { code: 'ACCEPTOR_MUST_ACCEPT_RESULT' });
});

test('rescheduling is auditable and requires reason', () => {
  assert.throws(() => reschedule(base(), { promisedAt: '2026-09-22T15:00:00Z', actorId: ids.owner }), { code: 'REASON_REQUIRED' });
  const c = reschedule(base(), {
    promisedAt: '2026-09-22T15:00:00Z', forecastAt: '2026-09-21T15:00:00Z',
    actorId: ids.owner, reason: 'External dependency moved'
  });
  assert.equal(c.promisedAt, '2026-09-22T15:00:00Z');
  assert.equal(c.audit.at(-1).type, 'commitment.rescheduled');
  assert.equal(c.audit.at(-1).previousPromisedAt, '2026-09-20T15:00:00Z');
});

test('calendar rejects non-positive ranges', () => {
  assert.throws(() => addCalendarBlock(base(), {
    id: 'bad', startAt: '2026-09-18T11:00:00Z', endAt: '2026-09-18T10:00:00Z'
  }, { actorId: ids.owner }), { code: 'INVALID_CALENDAR_RANGE' });
});

test('traceability gate rejects superficially completed work', () => {
  assert.throws(() => assertTraceable(base()), { code: 'NOT_END_TO_END_TRACEABLE' });
});
