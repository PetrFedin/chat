import { DomainError } from './commitment.js';

export const ConversationKind = Object.freeze({
  DIRECT: 'direct',
  GROUP: 'group',
  CHANNEL: 'channel',
  TEAM: 'team',
  PROJECT: 'project',
  TASK: 'task',
  DECISION: 'decision',
  APPROVAL: 'approval',
  CONTROL: 'control',
  INCIDENT: 'incident',
  MEETING: 'meeting',
  EXTERNAL: 'external'
});

export const ConversationVisibility = Object.freeze({
  PRIVATE: 'private',
  WORKSPACE: 'workspace',
  ORGANIZATION: 'organization',
  EXTERNAL: 'external'
});

export const MessageKind = Object.freeze({
  TEXT: 'text',
  SYSTEM: 'system',
  VOICE: 'voice',
  FILE: 'file',
  CALL: 'call',
  TASK: 'task',
  CALENDAR: 'calendar',
  POLL: 'poll'
});

const CONVERSATION_KINDS = new Set(Object.values(ConversationKind));
const VISIBILITIES = new Set(Object.values(ConversationVisibility));
const MESSAGE_KINDS = new Set(Object.values(MessageKind));
const TITLED_KINDS = new Set(Object.values(ConversationKind).filter((kind) => kind !== ConversationKind.DIRECT));
const BODY_REQUIRED_KINDS = new Set([MessageKind.TEXT, MessageKind.POLL]);
const MAX_MESSAGE_LENGTH = 20_000;

function requireText(value, code, message) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new DomainError(code, message);
  return value.trim();
}

function optionalText(value, code, message) {
  return value == null ? null : requireText(value, code, message);
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

  const title = optionalText(input.title, 'INVALID_CONVERSATION_TITLE', 'title cannot be blank');
  if (TITLED_KINDS.has(kind) && !title) throw new DomainError('CONVERSATION_TITLE_REQUIRED', `${kind} conversations require a title`);

  const defaultVisibility = kind === ConversationKind.DIRECT ? ConversationVisibility.PRIVATE : ConversationVisibility.WORKSPACE;
  const visibility = input.visibility ?? defaultVisibility;
  if (!VISIBILITIES.has(visibility)) throw new DomainError('INVALID_CONVERSATION_VISIBILITY', `Unsupported visibility: ${visibility}`);
  if (kind === ConversationKind.DIRECT && visibility !== ConversationVisibility.PRIVATE) {
    throw new DomainError('DIRECT_MUST_BE_PRIVATE', 'Direct conversations must be private');
  }

  return Object.freeze({
    id,
    workspaceId,
    kind,
    title,
    purpose: optionalText(input.purpose, 'INVALID_CONVERSATION_PURPOSE', 'purpose cannot be blank'),
    visibility,
    announcementOnly: Boolean(input.announcementOnly),
    createdBy,
    participantIds: memberIds,
    createdAt: input.createdAt ?? new Date().toISOString(),
    archivedAt: null
  });
}

export function createMessage(input) {
  const id = requireText(input?.id, 'INVALID_MESSAGE', 'id is required');
  const workspaceId = requireText(input?.workspaceId, 'INVALID_MESSAGE', 'workspaceId is required');
  const conversationId = requireText(input?.conversationId, 'INVALID_MESSAGE', 'conversationId is required');
  const authorId = requireText(input?.authorId, 'INVALID_MESSAGE', 'authorId is required');
  const kind = input?.kind ?? MessageKind.TEXT;
  if (!MESSAGE_KINDS.has(kind)) throw new DomainError('INVALID_MESSAGE_KIND', `Unsupported message kind: ${kind}`);

  const body = input?.body == null ? null : String(input.body).trim();
  if (BODY_REQUIRED_KINDS.has(kind) && !body) throw new DomainError('INVALID_MESSAGE_BODY', 'Message body is required');
  if (body && body.length > MAX_MESSAGE_LENGTH) throw new DomainError('MESSAGE_TOO_LONG', `Message body cannot exceed ${MAX_MESSAGE_LENGTH} characters`);

  const clientRequestId = optionalText(input.clientRequestId, 'INVALID_CLIENT_REQUEST_ID', 'clientRequestId cannot be blank');
  const threadRootId = optionalText(input.threadRootId, 'INVALID_THREAD_ROOT', 'threadRootId cannot be blank');
  const replyToId = optionalText(input.replyToId, 'INVALID_REPLY_TARGET', 'replyToId cannot be blank');

  return Object.freeze({
    id,
    workspaceId,
    conversationId,
    kind,
    threadRootId,
    replyToId,
    authorId,
    body,
    clientRequestId,
    scheduledFor: input.scheduledFor ?? null,
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
    createdAt: input.createdAt ?? new Date().toISOString(),
    editedAt: null,
    deletedAt: null
  });
}

export function editMessage(message, { actorId, body, now = new Date().toISOString() }) {
  if (actorId !== message.authorId) throw new DomainError('MESSAGE_AUTHOR_REQUIRED', 'Only the message author can edit it');
  if (message.deletedAt) throw new DomainError('MESSAGE_DELETED', 'Deleted messages cannot be edited');
  const nextBody = requireText(body, 'INVALID_MESSAGE_BODY', 'Message body is required');
  if (nextBody.length > MAX_MESSAGE_LENGTH) throw new DomainError('MESSAGE_TOO_LONG', `Message body cannot exceed ${MAX_MESSAGE_LENGTH} characters`);
  if (nextBody === message.body) return message;
  return Object.freeze({ ...message, body: nextBody, editedAt: now });
}

export function deleteMessage(message, { actorId, isModerator = false, now = new Date().toISOString() }) {
  if (actorId !== message.authorId && !isModerator) {
    throw new DomainError('MESSAGE_DELETE_FORBIDDEN', 'Only the author or a moderator can delete a message');
  }
  if (message.deletedAt) return message;
  return Object.freeze({ ...message, body: null, deletedAt: now, deletedBy: actorId });
}
