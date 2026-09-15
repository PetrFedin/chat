import { DomainError } from './commitment.js';

export const WorkspaceRole = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  MANAGER: 'manager',
  MEMBER: 'member',
  GUEST: 'guest'
});

export const InvitationStatus = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REVOKED: 'revoked',
  EXPIRED: 'expired'
});

const ROLES = new Set(Object.values(WorkspaceRole));

function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new DomainError('INVALID_ORGANIZATION_INPUT', `${field} is required`);
  return value.trim();
}

function email(value) {
  const normalized = text(value, 'email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new DomainError('INVALID_EMAIL', 'A valid email is required');
  return normalized;
}

export function createCompanySignup(input) {
  const organizationId = text(input?.organizationId, 'organizationId');
  const workspaceId = text(input?.workspaceId, 'workspaceId');
  const ownerUserId = text(input?.ownerUserId, 'ownerUserId');
  const organizationName = text(input?.organizationName, 'organizationName');
  const workspaceName = text(input?.workspaceName ?? organizationName, 'workspaceName');
  const ownerName = text(input?.ownerName, 'ownerName');
  const ownerEmail = email(input?.ownerEmail);
  const createdAt = input?.createdAt ?? new Date().toISOString();

  return Object.freeze({
    organization: Object.freeze({ id: organizationId, name: organizationName, createdAt }),
    workspace: Object.freeze({ id: workspaceId, organizationId, name: workspaceName, createdAt }),
    owner: Object.freeze({ userId: ownerUserId, displayName: ownerName, email: ownerEmail, role: WorkspaceRole.OWNER, createdAt }),
    bootstrapChannels: Object.freeze([
      Object.freeze({ key: 'general', title: 'Общий', visibility: 'workspace' }),
      Object.freeze({ key: 'announcements', title: 'Объявления', visibility: 'workspace', announcementOnly: true })
    ])
  });
}

export function createInvitation(input) {
  const role = input?.role ?? WorkspaceRole.MEMBER;
  if (!ROLES.has(role)) throw new DomainError('INVALID_WORKSPACE_ROLE', `Unsupported role: ${role}`);
  if (role === WorkspaceRole.OWNER) throw new DomainError('OWNER_INVITE_FORBIDDEN', 'Ownership transfer is a separate operation');
  const now = input?.createdAt ?? new Date().toISOString();
  const expiresAt = input?.expiresAt ?? new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString();
  if (Date.parse(expiresAt) <= Date.parse(now)) throw new DomainError('INVALID_INVITATION_EXPIRY', 'expiresAt must be in the future');

  return Object.freeze({
    id: text(input?.id, 'id'),
    workspaceId: text(input?.workspaceId, 'workspaceId'),
    invitedBy: text(input?.invitedBy, 'invitedBy'),
    email: email(input?.email),
    role,
    teamIds: Object.freeze([...new Set(input?.teamIds ?? [])]),
    status: InvitationStatus.PENDING,
    createdAt: now,
    expiresAt
  });
}

export function acceptInvitation(invitation, { userId, now = new Date().toISOString() }) {
  if (invitation.status !== InvitationStatus.PENDING) throw new DomainError('INVITATION_NOT_PENDING', 'Only pending invitations can be accepted');
  if (Date.parse(now) >= Date.parse(invitation.expiresAt)) throw new DomainError('INVITATION_EXPIRED', 'Invitation has expired');
  return Object.freeze({ ...invitation, status: InvitationStatus.ACCEPTED, acceptedBy: text(userId, 'userId'), acceptedAt: now });
}
