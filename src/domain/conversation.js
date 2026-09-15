import { DomainError } from './commitment.js';

export const ConversationKind = Object.freeze({
  DIRECT: 'direct',
  TEAM: 'team',
  PROJECT: 'project',
  TASK: 'task',
  DECISION: 'decision',
  APPROVAL: 'approval',
  CONTROL: 'control',
  INCIDENT: 'incident',
  EXTERNAL: 'external'
});

const CONVERSATION_KINDS = new Set(Object.values(ConversationKind));
const TITLED_KINDS = new Set(Object.values(ConversationKind).filter((kind) => kind !== ConversationKind.DIRECT));
const MAX_MESSAGE_LENGTH = 20_000;

function requireText(value, code, message) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DomainError(code, message);
  return value.trim();
}

function participants(createdBy, participantIds = []) {
  if (!Array.isArray(participantIds)) throw new DomainError('INVALID_PARTICIPANTS', 'participantIds must be an array');
  const ids = [...new Set([createdBy, ...participantIds].filter((value) => typeof value === 'string' && value.trim().length > 0))];
  if (!ids.length) throw new DomainError('INVALID_PARTICIPANTS', 'A conversation requires participants');
  return Object.freeze(ids);
}

export function createConversation(input) {
  const id = requireText(input?.id, 'INVALID_CONVERSATION', 'id is required');
  const workspaceId = requireText(input?.workspaceId, 'INVALID_CONVERSATION', 'workspaceId is required');
  const createdBy = requireText(input?.createdBy, 'INVALID_CONVERSATION', 'createdBy is required');
  const kind = requireText(input?.kind, 'INVALID_CONVERSATION', 'kind is required');
  if (!CONVERSATION_KINDS.has(kind)) throw new DomainError('INVALID_CONVERSATION_KIND', `Unsupported conversation kind: ${kind}`);
  const memberIds = participants(createdBy, input.participantIds);
  if (kind === ConversationKind.DIRECT && memberIds.length !== 2) {
    throw new DomainError('DIRECT_REQUIRES_TWO_PARTICIPANTS', 'A direct conversation must contain exactly two participants');
  }
  const title = input.title == null ? null : requireText(input.title, 'INVALID_CONVERSATION_TITLE', 'title cannot be blank');
  if (TITLED_KINDS.has(kind) && !title) throw new DomainError('CONVERSATION_TITLE_REQUIRED', `${kind} conversations require a title`);
  const createdAt = input.createdAt ?? new Date().toISOString();
  return Object.freeze({ id, workspaceId, kind, title, createdBy, participantIds: memberIds, createdAt });
}

export function createMessage(input) {
  const id = requireText(input?.id, 'INVALID_MESSAGE', 'id is required');
  const workspaceId = requireText(input?.workspaceId, 'INVALID_MESSAGE', 'workspaceId is required');
  const conversationId = requireText(input?.conversationId, 'INVALID_MESSAGE', 'conversationId is required');
  const authorId = requireText(input?.authorId, 'INVALID_MESSAGE', 'authorId is required');
  const body = requireText(input?.body, 'INVALID_MESSAGE_BODY', 'Message body is required');
  if (body.length > MAX_MESSAGE_LENGTH) throw new DomainError('MESSAGE_TOO_LONG', `Message body cannot exceed ${MAX_MESSAGE_LENGTH} characters`);
  const clientRequestId = input.clientRequestId == null
    ? null
    : requireText(input.clientRequestId, 'INVALID_CLIENT_REQUEST_ID', 'clientRequestId cannot be blank');
  const threadRootId = input.threadRootId == null
    ? null
    : requireText(input.threadRootId, 'INVALID_THREAD_ROOT', 'threadRootId cannot be blank');
  return Object.freeze({
    id,
    workspaceId,
    conversationId,
    threadRootId,
    authorId,
    body,
    clientRequestId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    editedAt: null
  });
}

export function editMessage(message, { actorId, body, now = new Date().toISOString() }) {
  if (actorId !== message.authorId) throw new DomainError('MESSAGE_AUTHOR_REQUIRED', 'Only the message author can edit it');
  const nextBody = requireText(body, 'INVALID_MESSAGE_BODY', 'Message body is required');
  if (nextBody.length > MAX_MESSAGE_LENGTH) throw new DomainError('MESSAGE_TOO_LONG', `Message body cannot exceed ${MAX_MESSAGE_LENGTH} characters`);
  if (nextBody === message.body) return message;
  return Object.freeze({ ...message, body: nextBody, editedAt: now });
}
