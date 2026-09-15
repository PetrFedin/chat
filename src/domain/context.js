import { DomainError } from './commitment.js';

export function messageSource({ chatId, threadId = null, messageId }) {
  if (!chatId || !messageId) throw new DomainError('INVALID_MESSAGE_SOURCE', 'chatId and messageId are required');
  return Object.freeze({ type: 'message', chatId, threadId, messageId });
}

export function assertTraceable(commitment) {
  const problems = [];
  if (!commitment.source) problems.push('source');
  if (!commitment.ownerId) problems.push('owner');
  if (!commitment.outcome) problems.push('outcome');
  if (commitment.calendarBlocks.length === 0) problems.push('calendar');
  if (commitment.evidence.length === 0) problems.push('evidence');
  if (!['accepted_result', 'closed'].includes(commitment.status)) problems.push('acceptance');
  if (problems.length) {
    throw new DomainError('NOT_END_TO_END_TRACEABLE', `Missing end-to-end links: ${problems.join(', ')}`);
  }
  return true;
}
